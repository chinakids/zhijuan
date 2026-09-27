// 织卷无头冒烟 · 超长回复显示截断（体验层候选 1「CHAR_LIMIT 渲染层截断评估」收口，2026-09-27）
// 前置：npm run build；node scripts/serve-renderer.mjs 8123（或 http.server --directory out/renderer）；CDP 127.0.0.1:9224
// 验收点（devShim「模拟超长」触发词：两段增量 + final 全量 61000 字，> 渲染层显示上限 60000）：
// ① content 存全量：store 中最后一条 assistant 消息 content.length === 61000（旧实现=60000+'…（截断）'）；
// ② 渲染层仅显示前 60000 字：.prose 内 <p> 文本长度 === 60000（提示行为独立 19 字状态行，不计入正文）；
// ③ 中性提示「（回复较长，仅显示前 60000 字）」（中数间加空格=口径表 §3）出现且恰一次（独立状态行，非终点警示）；
// ④ 旧标记「…（截断）」不再出现（content 与正文均无）；
// ⑤ 全程无 JS 异常（双通道捕获：Runtime.exceptionThrown + consoleAPICalled error）。
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function openTab(url) {
  const r = await fetch(CDP + '/json/new?' + encodeURIComponent(url), { method: 'PUT' })
  return r.json()
}
function attach(wsUrl) {
  const ws = new WebSocket(wsUrl)
  let seq = 0
  const pending = new Map()
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  }
  const cmd = (method, params = {}) =>
    new Promise((res, rej) => {
      const id = ++seq
      pending.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)))
      ws.send(JSON.stringify({ id, method, params }))
    })
  return new Promise((res) => {
    ws.onopen = async () => {
      const errors = []
      ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data)
        if (m.method === 'Runtime.exceptionThrown') errors.push((m.params?.exceptionDetails?.text || '') + ' ' + (m.params?.exceptionDetails?.exception?.description || '').slice(0, 200))
        if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') errors.push('console.error: ' + JSON.stringify((m.params.args || []).map((a) => a.value ?? a.description).join(' ')).slice(0, 200))
        if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
      }
      await cmd('Runtime.enable').catch(() => {})
      res({
        cmd,
        errors,
        eval: async (expression) => {
          const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
          if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 300))
          return r.result?.value
        },
        close: () => ws.close()
      })
    }
  })
}
async function evalUntil(page, expr, pred, timeoutMs = 20000, label = expr) {
  const t0 = Date.now()
  for (;;) {
    try {
      const v = await page.eval(expr)
      if (pred(v)) return v
    } catch {}
    if (Date.now() - t0 > timeoutMs) throw new Error('TIMEOUT waiting: ' + label)
    await sleep(250)
  }
}

const errors = []
let tab = null
let shotPath = null
try {
  tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel')
  console.log('TAB:', tab.id)
  const page = await attach(tab.webSocketDebuggerUrl)
  errors.push(...page.errors)

  await evalUntil(
    page,
    `document.body.innerText.includes('Agent') && !!document.querySelector('textarea')`,
    (v) => v === true,
    20000,
    '正文页就绪'
  )
  console.log('OK 正文页就绪')

  await evalUntil(page, `[...document.querySelectorAll('button')].some(b => (b.textContent||'').includes('第1章 · 雾港'))`, (v) => v === true, 10000, '章节项出现')
  await page.eval(`(() => { const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').includes('第1章 · 雾港')); b.click(); return true })()`)
  await sleep(800)
  console.log('OK 选中第1章')

  // 发送「模拟超长」（devShim：两段增量 + final 全量 61000 字）
  await page.eval(`(() => {
    const ta = document.querySelector('textarea')
    ta.focus()
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(ta), 'value').set
    setter.call(ta, '模拟超长')
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    return ta.value
  })()`)
  await sleep(400)
  await page.eval(`(() => {
    const ta = document.querySelector('textarea')
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    return true
  })()`)

  // 等：显示截断提示出现（=final 已过、轮次近收尾）
  await evalUntil(
    page,
    `!!document.querySelector('[data-testid="zj-clip-note"]') && !document.querySelector('button[title="停止生成"]')`,
    (v) => v === true,
    30000,
    '显示截断提示出现且轮次结束'
  )
  await sleep(500)
  console.log('OK 超长回复轮次完成，显示截断提示出现')

  // ① content 存全量（store 只读面）：最后一条 assistant content = 61000，且无旧标记
  const st = await page.eval(`(() => {
    const s = window.__ZJ_AGENT_STORE.getState()
    const last = s.messages[s.messages.length - 1]
    return { role: last?.role ?? null, len: last?.content?.length ?? -1, hasOldMark: (last?.content || '').includes('…（截断）'), total: s.messages.length }
  })()`)
  if (st.role !== 'assistant' || st.len !== 61000) throw new Error('content 未存全量：' + JSON.stringify(st))
  if (st.hasOldMark) throw new Error('content 仍含旧标记「…（截断）」')
  console.log('OK ① content 存全量（61000 字，无旧标记），旧「slice+标记写回」已移除')

  // ② 渲染层仅显示前 60000 字（.prose 内 <p> 文本长度恰为 60000；状态提示行不计入正文）
  const plen = await page.eval(`(() => {
    const pros = [...document.querySelectorAll('.prose')]
    const p = pros[pros.length - 1]?.querySelector('p')
    return p ? p.textContent.length : -1
  })()`)
  if (plen !== 60000) throw new Error('.prose <p> 渲染长度异常：' + plen + '（应=60000 显示截断）')
  console.log('OK ② 渲染层仅显示前 60000 字（<p> 文本 ' + plen + '）')

  // ③ 中性提示恰一次且为独立状态行（文案含中数间空格=口径表 §3）
  const NOTE = '（回复较长，仅显示前 60000 字）'
  const noteCnt = await page.eval(`document.body.innerText.split('${NOTE}').length - 1`)
  if (noteCnt !== 1) throw new Error('提示文案出现 ' + noteCnt + ' 次（应为 1）')
  const nl = await page.eval(`(() => { const el = document.querySelector('[data-testid="zj-clip-note"]'); return el ? el.textContent : '' })()`)
  if (!nl.includes(NOTE)) throw new Error('提示行缺失：' + nl)
  console.log('OK ③ 中性提示独立状态行恰一次：' + nl)

  // ④ 旧标记「…（截断）」不出现
  const oldCnt = await page.eval(`document.body.innerText.split('…（截断）').length - 1`)
  if (oldCnt !== 0) throw new Error('「…（截断）」仍在正文出现 ' + oldCnt + ' 次（应 0）')
  console.log('OK ④ 旧标记「…（截断）」全页零出现')

  // ⑤ 无 JS 异常
  await sleep(500)
  const jsErrors = errors.filter((e) => !/favicon|ResizeObserver loop/i.test(e))
  if (jsErrors.length) throw new Error('JS 异常：' + jsErrors.join(' | ').slice(0, 500))
  console.log('OK ⑤ 全程无 JS 异常（双通道 ' + errors.length + ' 条原始收集）')

  // 契约截图
  const shot = await page.cmd('Page.captureScreenshot', { format: 'png' })
  if (shot?.data) {
    const fs = await import('node:fs')
    const hh = String(new Date().getHours()).padStart(2, '0')
    const mm = String(new Date().getMinutes()).padStart(2, '0')
    fs.mkdirSync(process.env.HOME + '/Pictures/zhijuan', { recursive: true })
    shotPath = `${process.env.HOME}/Pictures/zhijuan/clip-display-${hh}${mm}.png`
    fs.writeFileSync(shotPath, Buffer.from(shot.data, 'base64'))
    console.log('SCREENSHOT:', shotPath)
  }

  console.log('CLIP-DISPLAY UI OK')
} catch (e) {
  console.error('CLIP-DISPLAY UI FAILED:', e.message)
  process.exitCode = 1
} finally {
  tab && fetch(CDP + '/json/close/' + tab.id).catch(() => {})
}
