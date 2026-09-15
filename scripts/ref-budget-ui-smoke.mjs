// 织卷无头冒烟 · @ 引用注入预算提示（AgentPanel 上下文用量行）
// 用法：node scripts/ref-budget-ui-smoke.mjs
// 前置：node scripts/serve-renderer.mjs 8123；CDP 127.0.0.1:9224
// 验收：① 初始无引用 → 用量行有「对话」（09-14 7805329 改版后无「上下文」字样）且无「@注入」；② 输入含 2 个引用 → 显示「@注入 2条 ≤8.0 千字」；
//       ③ 4 条引用 → ≤1.2 万字（总预算兜底）；④ 清空 → 「@注入」消失；⑤ 截图留档
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

// 直接设置 textarea 值（React 受控：原生 setter + input/change 事件）
async function setInput(page, text) {
  await page.eval(`(() => {
    const ta = document.querySelector('textarea')
    if (!ta) return 'NO_TA'
    ta.focus()
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(ta), 'value').set
    setter.call(ta, ${JSON.stringify(text)})
    ta.setSelectionRange(ta.value.length, ta.value.length)
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    ta.dispatchEvent(new Event('change', { bubbles: true }))
    return ta.value
  })()`)
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

  // ① 初始：用量行有「对话」（改版口径，见 AgentPanel L978），无「@注入」
  await evalUntil(page, `document.body.innerText.includes('对话')`, (v) => v === true, 8000, '用量行存在')
  const t0 = await page.eval(`document.body.innerText`)
  if (t0.includes('@注入')) throw new Error('初始不应显示 @注入：' + t0.slice(-200))
  console.log('OK ① 初始无引用 → 无 @注入 提示')
  // before 截图（无引用态＝旧口径观感）
  const { writeFileSync, mkdirSync } = await import('node:fs')
  mkdirSync(process.env.HOME + '/Pictures/zhijuan', { recursive: true })
  const shotB = await page.cmd('Page.captureScreenshot', { format: 'png' })
  const hhmmB = new Date().toTimeString().slice(0, 5).replace(':', '')
  writeFileSync(process.env.HOME + '/Pictures/zhijuan/ref-inject-budget-before-' + hhmmB + '.png', Buffer.from(shotB.data, 'base64'))

  // ② 2 个引用 → 「@注入 2条 ≤8.0 千字」
  await setInput(page, '看看〔人物·沈藏｜人物/沈藏.md〕和〔世界观·总纲｜世界观/总纲.md〕')
  await evalUntil(
    page,
    `document.body.innerText`,
    (v) => v.includes('@注入 2条 ≤8.0 千字') || v.includes('@注入 2条≤8.0 千字'),
    8000,
    '2条注入预算'
  )
  console.log('OK ② 2 条引用 → @注入 2条 ≤8.0 千字')

  // ③ 4 条引用 → 总预算兜底 1.2 万字
  await setInput(page, '〔人物·a｜人物/a.md〕〔人物·b｜人物/b.md〕〔人物·c｜人物/c.md〕〔人物·d｜人物/d.md〕')
  await evalUntil(
    page,
    `document.body.innerText`,
    (v) => v.includes('@注入 4条') && (v.includes('1.2 万字') || v.includes('1.2万字')),
    8000,
    '4条注入预算'
  )
  console.log('OK ③ 4 条引用 → @注入 4条 ≤1.2 万字（总预算兜底）')

  // ④ 清空 → @注入 消失
  await setInput(page, '普通消息')
  await evalUntil(
    page,
    `document.querySelector('textarea')?.value === '普通消息' && !document.body.innerText.includes('@注入')`,
    (v) => v === true,
    8000,
    '无引用后提示消失'
  )
  console.log('OK ④ 无引用 → @注入 提示消失')

  // ⑤ 截图（2 条引用显示态）
  await setInput(page, '看看〔人物·沈藏｜人物/沈藏.md〕和〔世界观·总纲｜世界观/总纲.md〕')
  await evalUntil(page, `document.body.innerText.includes('@注入 2条')`, (v) => v === true, 8000, '截图态就绪')
  await sleep(300)
  const shot = await page.cmd('Page.captureScreenshot', { format: 'png' })
  const hhmm = new Date().toTimeString().slice(0, 5).replace(':', '')
  const fpath = process.env.HOME + '/Pictures/zhijuan/ref-inject-budget-' + hhmm + '.png'
  writeFileSync(fpath, Buffer.from(shot.data, 'base64'))
  console.log('OK ⑤ 截图：' + fpath)

  console.log('ALL OK ✅')
} catch (err) {
  console.error('FAIL:', err.message)
  process.exitCode = 1
} finally {
  page.close()
}
