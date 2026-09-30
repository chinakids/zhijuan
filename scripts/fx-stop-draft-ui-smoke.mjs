// 织卷无头冒烟 · 固定命令停止后草稿恢复（/导演 中点「停止导演任务」→ 命令恢复回输入框可编辑重发）
// 体验层 2026-09-30（04-体验层.md 五候选1；09-29 观察项① 延伸，与 f615e87 普通消息中断恢复同族）
// 背景：doSend 启动 /导演 时 setInput('') 清空；stopFx 此前无恢复——作者误停/想改参数需重打长命令。
// 本轮落地：runFixed director 分支把命令原文写入 draftsRef（recordDraft 同源），stopFx 时恢复输入框
//          （可编辑不代发；作者已开始打的新消息优先保留不覆盖）。devShim agentDirector 700ms mock 窗口。
// 断言语义（devShim）：A 导演执行中点停止 → 原命令（含参数）恢复+已取消提示+未落盘+不代发；
//          B 恢复后可编辑；清空后 ↑ 回取同源可达；再执行导演正常完成不恢复；
//          C 导演执行中作者打了新消息，停止后新消息保留（不覆盖）。
// 用法：node scripts/fx-stop-draft-ui-smoke.mjs（先 npm run build + SPA server + CDP 9224；base 可用 ZJ_SMOKE_BASE 覆盖）
const base = 'http://127.0.0.1:9224'
const APP = process.env.ZJ_SMOKE_BASE || 'http://127.0.0.1:8123'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function newTab(u) {
  const r = await fetch(`${base}/json/new?${encodeURIComponent(u)}`, { method: 'PUT' })
  if (!r.ok) throw new Error('new failed ' + r.status)
  return r.json()
}
function makeConn(tab) {
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
  return { ws, cmd, exceptions }
}
async function drive(tab) {
  const { ws, cmd, exceptions } = makeConn(tab)
  await new Promise((r) => (ws.onopen = r))
  await cmd('Page.enable')
  await cmd('Runtime.enable')
  const ev = async (expression) => {
    const r = await cmd('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails))
    return r.result?.value
  }
  const pressEnter = () => ev(`(() => { const t = document.querySelector('textarea'); if (!t) return false; t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); return true })()`)
  const pressArrowUp = () => ev(`(() => { const t = document.querySelector('textarea'); if (!t) return false; t.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true })); return true })()`)
  const insertText = async (text) => {
    await ev(`(() => { const t = document.querySelector('textarea'); if (t) { t.focus(); return true } return false })()`)
    await cmd('Input.insertText', { text })
  }
  // 固定命令：/ 命令浮层可能截获首个 Enter（选中候选插入「/导演␣」），走真实用户两次 Enter 链路
  const sendCmd = async (text) => {
    await insertText(text)
    await sleep(400)
    await pressEnter()
    await sleep(400)
    await pressEnter()
  }
  const taValue = () => ev(`(document.querySelector('textarea')?.value) ?? ''`)
  const bodyHas = (t) => ev(`document.body.innerText.includes(${JSON.stringify(t)})`)
  const until = async (f, ms, label, step = 60) => {
    const t0 = Date.now()
    for (;;) {
      try { const v = await f(); if (v) return v } catch {}
      if (Date.now() - t0 > ms) throw new Error('TIMEOUT ' + label)
      await sleep(step)
    }
  }
  return { ev, cmd, sendCmd, insertText, taValue, bodyHas, until, exceptions, ws, pressArrowUp }
}
let fail = 0
const ok = (cond, label) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + label)
  if (!cond) fail++
}

const CMD = '/导演 本章开头加一个雨夜钩子'
const tab = await newTab(`${APP}/?cb=${Date.now()}#/project/demo-aseya/novel?ch=${encodeURIComponent('第02章_灯塔.md')}`)
const d = await drive(tab)
await d.until(() => d.ev(`!!document.querySelector('textarea')`), 20000, '正文页就绪')
console.log('OK 正文页就绪（第02章_灯塔 选中态）')

// ---------- 场景 A：导演执行中点停止 → 原命令恢复（含参数）+ 已取消提示 + 未落盘 + 不代发 ----------
await d.sendCmd(CMD)
await d.until(() => d.ev(`!!document.querySelector('button[title^="停止导演任务"]')`), 6000, 'A0 导演执行中', 50)
ok(true, 'A0 导演执行中（停止按钮出现）')
await d.ev(`document.querySelector('button[title^="停止导演任务"]')?.click()`)
await d.until(() => d.ev(`document.body.innerText.includes('已取消导演任务') && document.body.innerText.includes('已取消（未落盘）')`), 5000, 'A1 取消提示', 60)
ok(true, 'A1 取消提示入对话流（已取消（未落盘））')
await sleep(400)
ok((await d.taValue()) === CMD, `A2 停止后命令恢复回输入框（含参数）：${JSON.stringify(await d.taValue())}`)
// 不代发 + 未落盘：等待 mock 剩余窗口（700ms 已过），确认无「已写入」出现
await sleep(1500)
ok(!(await d.bodyHas('已写入 大纲/第02章_灯塔_导演.md')), 'A3 恢复不代发且取消未落盘（无「已写入 大纲/…导演.md」）')

// ---------- 场景 B：恢复后可编辑；清空后 ↑ 回取同源可达；再执行导演正常完成不恢复 ----------
await d.ev(`(() => { const t = document.querySelector('textarea'); if (t) { t.focus(); const proto = Object.getPrototypeOf(t); const setter = Object.getOwnPropertyDescriptor(proto, 'value').set; setter.call(t, t.value + '（改）'); t.dispatchEvent(new Event('input', { bubbles: true })); return true } return false })()`)
await sleep(300)
const editable = await d.taValue()
ok(editable === CMD + '（改）', `B1 恢复内容可编辑（追加后：${JSON.stringify(editable)}）`)
// 清空 → ↑ 回取
await d.ev(`(() => { const t = document.querySelector('textarea'); if (t) { const proto = Object.getPrototypeOf(t); const setter = Object.getOwnPropertyDescriptor(proto, 'value').set; setter.call(t, ''); t.dispatchEvent(new Event('input', { bubbles: true })); return true } return false })()`)
await sleep(300)
await d.pressArrowUp()
await sleep(500)
ok((await d.taValue()) === CMD, `B2 清空后 ↑ 回取到导演命令（draftsRef 同源：${JSON.stringify(await d.taValue())}）`)
// 再执行导演（正常完成不停止）：恢复面不影响执行；完成后输入框空（不恢复）
await d.ev(`(() => { const t = document.querySelector('textarea'); if (t) { const proto = Object.getPrototypeOf(t); const setter = Object.getOwnPropertyDescriptor(proto, 'value').set; setter.call(t, ''); t.dispatchEvent(new Event('input', { bubbles: true })); return true } return false })()`)
await sleep(200)
await d.sendCmd('/导演')
await d.until(() => d.ev(`document.body.innerText.includes('已写入 大纲/第02章_灯塔_导演.md')`), 15000, 'B3 导演正常完成')
ok(true, 'B3-① 导演正常执行并落盘（恢复面不影响）')
await sleep(400)
ok((await d.taValue()) === '', 'B3-② 正常完成输入框空（无停止不恢复）')

// ---------- 场景 C：导演执行中作者打了新消息 → 停止后新消息保留（不覆盖） ----------
await d.sendCmd('/导演')
await d.until(() => d.ev(`!!document.querySelector('button[title^="停止导演任务"]')`), 6000, 'C0 导演执行中', 50)
await d.insertText('我改主意了')
await sleep(300)
await d.ev(`document.querySelector('button[title^="停止导演任务"]')?.click()`)
await sleep(500)
ok((await d.taValue()) === '我改主意了', `C1 执行中作者新消息优先保留（不被导演草稿覆盖：${JSON.stringify(await d.taValue())}）`)
await d.until(() => d.ev(`document.body.innerText.includes('已取消导演任务')`), 5000, 'C2 取消提示', 60)
ok(true, 'C2 停止提示正常（已取消导演任务）')
ok(d.exceptions.length === 0, 'D 无 JS 异常（' + d.exceptions.length + '）' + (d.exceptions[0] ? '：' + d.exceptions[0] : ''))

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAIL`)
process.exit(fail === 0 ? 0 : 1)
