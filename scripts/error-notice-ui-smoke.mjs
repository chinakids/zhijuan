// 织卷无头冒烟 · 对话流负反馈离散场景（智能层候选3，2026-09-16）
// 前置：node scripts/serve-renderer.mjs 8123（或已起 http.server --directory out/renderer）；CDP 127.0.0.1:9224
// 验收点（devShim「模拟超时」触发词：先产修改卡+部分增量，再发顶层 error 事件，与真机「引擎超时→error」同构）：
// ① 错误后已流式部分内容「保留」不丢（旧实现 setError 会把 content 整体替换掉）；
// ② 错误提示=warn 降级（本轮未完整生成 + 已生成修改方案仍保留），非红色硬失败；
// ③ 修改卡仍在（可继续采纳），不销毁；
// ④ 错误提示带「重试」→ 点击后新轮开始（复用原 prompt），旧气泡置「已重试」，旧产出仍保留。
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
    ws.onopen = () =>
      res({
        cmd,
        eval: async (expression) => {
          const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
          if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 300))
          return r.result?.value
        },
        close: () => ws.close()
      })
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

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel')
console.log('TAB:', tab.id, tab.url)
const page = await attach(tab.webSocketDebuggerUrl)

try {
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

  // 输入「模拟超时」并发送（devShim：部分增量+修改卡 → error 事件）
  await page.eval(`(() => {
    const ta = document.querySelector('textarea')
    ta.focus()
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(ta), 'value').set
    setter.call(ta, '模拟超时')
    ta.setSelectionRange(ta.value.length, ta.value.length)
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    return ta.value
  })()`)
  await sleep(400)
  await page.eval(`(() => {
    const ta = document.querySelector('textarea')
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    return true
  })()`)

  // ① warn 降级提示出现（含「本轮未完整生成」+「写作引擎驱动超时」）
  await evalUntil(
    page,
    `document.body.innerText`,
    (v) => v.includes('本轮未完整生成') && v.includes('写作引擎驱动超时（已中止引擎本轮）'),
    20000,
    'warn 降级提示'
  )
  console.log('OK ① 错误=warn 降级提示（本轮未完整生成 + 引擎超时文案）')

  // ② 已流式部分内容保留（旧实现会被错误文案整体替换）
  const body1 = await page.eval(`document.body.innerText`)
  if (!body1.includes('已读完当前章节，定位到灯语伏笔处')) throw new Error('已流式部分内容丢失！')
  console.log('OK ② 已流式部分内容保留（未被错误文案替换）')

  // ③ 修改卡仍在 + 提示说明「修改方案仍保留」
  if (!body1.includes('已生成的正文修改方案仍保留')) throw new Error('提示未说明修改方案保留')
  if (!body1.includes('采纳')) throw new Error('修改卡丢失（无采纳按钮）')
  console.log('OK ③ 修改卡仍在（可继续采纳）+ 提示含「修改方案仍保留」')

  // ④ 重试按钮存在 → 点击 → 新轮开始（旧气泡「已重试」+ 出现第二轮 warn）
  if (!body1.includes('重试')) throw new Error('错误提示缺「重试」按钮')
  await page.eval(`(() => {
    const btn = [...document.querySelectorAll('button')].find(b => (b.textContent||'').trim() === '重试')
    if (!btn) throw new Error('no retry btn')
    btn.click()
    return true
  })()`)
  await evalUntil(
    page,
    `document.body.innerText`,
    (v) => v.includes('已重试') && v.split('本轮未完整生成').length - 1 >= 2,
    25000,
    '重试后新轮'
  )
  const body2 = await page.eval(`document.body.innerText`)
  if (!body2.includes('已读完当前章节，定位到灯语伏笔处')) throw new Error('重试后旧轮保留内容丢失')
  console.log('OK ④ 重试=新轮复用原 prompt；旧气泡置「已重试」，旧轮产出仍保留')

  // ⑤ 红色硬失败 NOT 出现（本轮有产出，不应是 danger 样式）：body 不应有独立的旧式「（…）」重复
  if (body2.includes('（写作引擎驱动超时')) throw new Error('出现旧式括号重复渲染')
  console.log('OK ⑤ 无旧式「（错误文案）」重复渲染')

  console.log('ERROR-NOTICE UI OK')
} catch (e) {
  console.error('ERROR-NOTICE UI FAILED:', e.message)
  process.exitCode = 1
} finally {
  page.close()
  tab && fetch(CDP + '/json/close/' + tab.id).catch(() => {})
}
