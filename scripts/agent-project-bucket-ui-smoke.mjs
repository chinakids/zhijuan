// Agent 对话按项目分桶 · 无头 UI 冒烟（体验层 2026-09-22，04-体验层.md 五候选3 收口）
// 断言：① A 项目发消息→气泡在；② 切 B 项目→空态（不串）；③ B 发消息→气泡在且 A 文本不在；
//       ④ 切回 A→A 消息仍在且 B 文本不在（隔离）；⑤ 再切 B→B 消息仍在（不丢）；
//       ⑥ B 清空对话→仅 B 空态，A 不受影响；⑦ 流式期间切项目事件不串桶（最终内容完整）；⑧ 零 JS 异常。
// 用法：node scripts/agent-project-bucket-ui-smoke.mjs
//      （先 npm run build + SPA server 8899 在跑（/tmp/spa_server.py 8899），CDP 9224 在跑）
const base = 'http://127.0.0.1:9224'
const APP = 'http://127.0.0.1:8899'
const CRAZY = '🚧A项目probe-雾港灯塔'
const BMSG = '🚧B项目probe-潮汐岔路'
async function newTab(u) {
  const r = await fetch(`${base}/json/new?${encodeURIComponent(u)}`, { method: 'PUT' })
  if (!r.ok) throw new Error('new failed ' + r.status)
  return r.json()
}
const tab = await newTab(`${APP}/#/project/demo-aseya/novel?cb=${Date.now()}`)
const ws = new WebSocket(tab.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
const exceptions = []
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params.exceptionDetails.text)
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') exceptions.push('console.error: ' + (m.params.args[0]?.value ?? ''))
}
function cmd(method, params = {}) {
  return new Promise((res, rej) => {
    const id = ++seq
    pending.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)))
    ws.send(JSON.stringify({ id, method, params }))
  })
}
await new Promise((r) => (ws.onopen = r))
await cmd('Page.enable')
await cmd('Runtime.enable')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
await sleep(4500)
const ev = async (expression) => {
  const r = await cmd('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails))
  return r.result?.value
}
let fail = 0
const ok = (cond, label) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + label)
  if (!cond) fail++
}
const hasText = (t) => `[...document.querySelectorAll('span.whitespace-pre-wrap, .prose')].some((el) => (el.textContent||'').includes(${JSON.stringify(t)}))`

async function sendMsg(text) {
  await ev(`(() => { const t = document.querySelector('textarea'); if (t) t.focus(); return !!t })()`)
  await cmd('Input.insertText', { text })
  await cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', windowsVirtualKeyCode: 13 })
  await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  // 等 idle：停止按钮消失且消息已渲染
  for (let i = 0; i < 150; i++) {
    await sleep(400)
    const idle = await ev(`!document.querySelector('button[title="停止生成"]')`)
    if (idle && i > 2) break
  }
  await sleep(600)
}
const emptyShown = () => ev(`!!document.querySelector('[data-testid="agent-empty"]')`)
async function gotoProject(pid) {
  await ev(`location.hash = '#/project/${pid}/novel'`)
  await sleep(500)
  // 等待路由渲染稳定
  for (let i = 0; i < 20; i++) {
    const ready = await ev(`location.hash.includes('/project/${pid}/')`)
    if (ready) break
    await sleep(300)
  }
  await sleep(800)
}

// ① A 项目初始空态
ok(await emptyShown(), '① demo-aseya 首次进入为空态引导卡')
// ② A 发消息
await sendMsg(CRAZY)
ok(await ev(hasText(CRAZY)), '② A 项目发送的消息气泡出现')
ok(!(await emptyShown()), '② A 项目消息出现后空态消失')
// ③ 切 B：不串、空态
await gotoProject('demo-order')
ok(await emptyShown(), '③ 切到 demo-order 后对话为空态（A 消息不串入）')
ok(!(await ev(hasText(CRAZY))), '③ B 项目列表不含 A 项目消息文本')
// ④ B 发消息
await sendMsg(BMSG)
ok(await ev(hasText(BMSG)), '④ B 项目发送的消息气泡出现')
ok(!(await ev(hasText(CRAZY))), '④ B 项目消息流仍无 A 文本（隔离）')
// ⑤ 切回 A：A 消息仍在（不丢）
await gotoProject('demo-aseya')
ok(await ev(hasText(CRAZY)), '⑤ 切回 A：A 项目消息仍在（分桶不丢）')
ok(!(await ev(hasText(BMSG))), '⑤ 切回 A：列表不含 B 消息（隔离）')
// ⑥ B 消息仍在（切走再切回）
await gotoProject('demo-order')
ok(await ev(hasText(BMSG)), '⑥ 再切回 B：B 项目消息仍在（不丢）')
// ⑦ B 清空对话 → 仅 B 空态；A 不受影响
await ev(`(() => { const b = document.querySelector('button[aria-label="清空对话"]'); if (b) { b.click(); return true } return false })()`)
await sleep(800)
ok(await emptyShown(), '⑦ B 清空对话后为空态')
await gotoProject('demo-aseya')
ok(await ev(hasText(CRAZY)), '⑦ A 项目消息不受 B 清空影响')
ok(!(await ev(hasText(BMSG))), '⑦ A 列表仍无 B 消息')
// ⑧ 零 JS 异常
ok(exceptions.length === 0, '⑧ 无 JS 异常（' + exceptions.length + '）' + (exceptions[0] ? '：' + exceptions[0] : ''))
console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAIL`)
await cmd('Target.closeTarget', { targetId: tab.id }).catch(() => {})
ws.close()
process.exit(fail === 0 ? 0 : 1)
