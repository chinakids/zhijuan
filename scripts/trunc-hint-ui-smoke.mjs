// 织卷无头冒烟 · 输出截断提示（智能层候选 1「finish=length 截断提示面」，2026-09-25）
// 前置：npm run build；node scripts/serve-renderer.mjs 8123（或 http.server --directory out/renderer）；CDP 127.0.0.1:9224
// 验收点（devShim「模拟截断」触发词：部分增量 → truncated 事件 → 残缺 final → done，与真机
//  translate 转发 turn/end reason=max-tokens 同构）：
// ① 回复末尾出现「（输出已截断）」终态标记（残缺正文不再被当完整内容）；
// ② 已流式残缺正文保留（不被标记替换）；
// ③ 全程无 JS 异常（双通道捕获：Runtime.exceptionThrown + consoleAPICalled error）。
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
      // 无 JS 异常断言（编辑器域 36 支同款双通道模板）：
      // ① Runtime.enable 后收集 exceptionThrown；② consoleAPICalled type=error
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

  // 输入「模拟截断」并发送（devShim：部分增量 → truncated → 残缺 final → done）
  await page.eval(`(() => {
    const ta = document.querySelector('textarea')
    ta.focus()
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(ta), 'value').set
    setter.call(ta, '模拟截断')
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    return ta.value
  })()`)
  await sleep(400)
  await page.eval(`(() => {
    const ta = document.querySelector('textarea')
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    return true
  })()`)

  // ① 「（输出已截断）」终态标记出现
  await evalUntil(
    page,
    `document.body.innerText`,
    (v) => v.includes('（输出已截断）'),
    25000,
    '截断终态标记'
  )
  console.log('OK ① 回复末尾出现「（输出已截断）」终态标记')

  // ② 已流式残缺正文保留
  const body = await page.eval(`document.body.innerText`)
  if (!body.includes('渔火在潮声里明明灭灭')) throw new Error('残缺正文丢失！')
  console.log('OK ② 残缺正文保留（未被标记替换）')

  // ③ 无 JS 异常
  await sleep(500)
  const jsErrors = errors.filter((e) => !/favicon|ResizeObserver loop/i.test(e))
  if (jsErrors.length) throw new Error('JS 异常：' + jsErrors.join(' | ').slice(0, 500))
  console.log('OK ③ 全程无 JS 异常（双通道 ' + errors.length + ' 条原始收集）')

  // 契约截图（主人 2026-09-12：UI/功能实现留图）
  const shot = await page.cmd('Page.captureScreenshot', { format: 'png' })
  if (shot?.data) {
    const fs = await import('node:fs')
    const hh = String(new Date().getHours()).padStart(2, '0')
    const mm = String(new Date().getMinutes()).padStart(2, '0')
    fs.mkdirSync(process.env.HOME + '/Pictures/zhijuan', { recursive: true })
    const p = `${process.env.HOME}/Pictures/zhijuan/trunc-hint-${hh}${mm}.png`
    fs.writeFileSync(p, Buffer.from(shot.data, 'base64'))
    console.log('SCREENSHOT:', p)
  }

  console.log('TRUNC-HINT UI OK')
} catch (e) {
  console.error('TRUNC-HINT UI FAILED:', e.message)
  process.exitCode = 1
} finally {
  tab && fetch(CDP + '/json/close/' + tab.id).catch(() => {})
}
