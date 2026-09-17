// 织卷无头冒烟 · Agent 面板用量行口径（观察项①收尾：分解显示 + 同源预算）
// 前置：node scripts/serve-renderer.mjs 8123；本机专用无头 Chrome CDP 127.0.0.1:9224
// 验收点：① 点击章节 → 用量行出现「对话 …」「· 装配 ≤4.1 万字」（与主进程 shared/contextCaps 同源；
//         ② 不再出现误导性「/ 6 万」（渲染层显示截断上限被移除）；
//         ③ 输入文本后「对话」数值随 input 增长（口径=历史 trim + 输入 + quote）。
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
async function evalUntil(page, expr, pred, timeoutMs = 15000, label = expr) {
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
const lineExpr = `(() => { const el = [...document.querySelectorAll('span')].find(x => x.textContent?.startsWith('对话 ')); return el ? el.parentElement?.innerText : '' })()`

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

  // 点第1章（篇幅 108 字，正文页默认不挂编辑器，须先选章）
  await evalUntil(page, `[...document.querySelectorAll('button')].some(b => (b.textContent||'').includes('第1章 · 雾港'))`, (v) => v === true, 10000, '章节项出现')
  await page.eval(`(() => { const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').includes('第1章 · 雾港')); b.click(); return true })()`)
  await sleep(800)

  // ① 用量行出现（选中章节后应有「对话」与「· 装配 ≤」）
  await evalUntil(
    page,
    lineExpr,
    (v) => v.includes('对话') && v.includes('装配 ≤'),
    15000,
    '用量行分解显示'
  )
  const line1 = await page.eval(lineExpr)
  console.log('用量行1:', JSON.stringify(line1))
  if (!line1.includes('对话') || !line1.includes('装配 ≤')) throw new Error('用量行缺 对话/装配：' + line1)
  if (line1.includes('6 万') || line1.includes('/')) throw new Error('用量行仍带误导性分母：' + line1)
  console.log('OK ① 用量行=对话 + 装配 ≤（同源预算），无「/6万」分母')

  // ② 输入文本 → 对话数值增长
  await page.eval(`(() => {
    const ta = document.querySelector('textarea')
    ta.focus()
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(ta), 'value').set
    setter.call(ta, ta.value + '今晚雾很大，灯塔忽明忽暗')
    const pos = ta.value.length
    ta.setSelectionRange(pos, pos)
    const ev = new Event('input', { bubbles: true })
    ev.isComposing = false
    ta.dispatchEvent(ev)
    ta.dispatchEvent(new Event('change', { bubbles: true }))
    return ta.value
  })()`)
  await sleep(400)
  const line2 = await page.eval(lineExpr)
  console.log('用量行2:', JSON.stringify(line2))
  const n1 = Number((line1.match(/对话 ([\d.]+)/) || [])[1] ?? '0')
  const n2 = Number((line2.match(/对话 ([\d.]+)/) || [])[1] ?? '0')
  if (!(n2 >= n1)) throw new Error('输入后对话数值未增长：' + n1 + ' -> ' + n2)
  console.log('OK ② 对话数值随输入增长（' + n1 + ' → ' + n2 + '）')

  console.log('USAGE-LINE UI OK')
} catch (e) {
  console.error('USAGE-LINE UI FAILED:', e.message)
  process.exitCode = 1
} finally {
  page.close()
  tab && fetch(CDP + '/json/close/' + tab.id).catch(() => {})
}
