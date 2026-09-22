// 错误重试/排队续发 · 跨项目桶语义 · 无头 UI 冒烟（体验层 2026-09-23，04-体验层.md 五候选1）
// 背景：Agent 消息按项目分桶（78edf4f）后，错误「重试」与「排队续发」的新轮次必须落入
//       「发起消息归属项目」的对话桶与装配（messageProject 查询 + send project hint），
//       而不是「当前面板所在项目」——否则拆散原对话且污染另一项目上下文。
// 断言语义（devShim「模拟超时」触发词=先产修改卡+部分增量再发 error，与真机引擎超时同构）：
// Tab1：① A 项目发「模拟超时」→错误卡出现；② 点「重试」→重试轮再失败；
//       ③ 第一条错误卡置「已重试」+ 页面共两条错误卡（重试轮确已发出）；
//       ④ 切 B 空态不串；⑤ 切回 A 消息完整；⑥ 零 JS 异常。
// Tab2：① A 生成中再发一条（排队 toast）；② 立即切 B；③ 等 idle 后 B 仍空态（续发未落 B 桶）；
//       ④ 切回 A：排队消息+其回复都在 A 桶（落原项目）；⑤ 零 JS 异常。
// 用法：node scripts/error-retry-bucket-ui-smoke.mjs（先 npm run build + SPA server 8899 + CDP 9224）
const base = 'http://127.0.0.1:9224'
const APP = 'http://127.0.0.1:8899'
const ERR = '模拟超时'
const QUEUED = '排队保留探测'
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
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
  const sendMsg = async (text) => {
    await ev(`(() => { const t = document.querySelector('textarea'); if (t) { t.focus(); return true } return false })()`)
    await cmd('Input.insertText', { text })
    await cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', windowsVirtualKeyCode: 13 })
    await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  }
  const waitIdle = async () => {
    for (let i = 0; i < 200; i++) {
      await sleep(300)
      const busy = await ev(`!!document.querySelector('button[title="停止生成"]')`)
      if (!busy && i > 1) break
    }
    await sleep(500)
  }
  const hasText = (t) => `[...document.querySelectorAll('span.whitespace-pre-wrap, .prose')].some((el) => (el.textContent||'').includes(${JSON.stringify(t)}))`
  const bodyHas = (t) => `document.body.innerText.includes(${JSON.stringify(t)})`
  const emptyShown = () => ev(`!!document.querySelector('[data-testid="agent-empty"]')`)
  const gotoProject = async (pid) => {
    await ev(`location.hash = '#/project/${pid}/novel'`)
    await sleep(500)
    for (let i = 0; i < 20; i++) {
      const ready = await ev(`location.hash.includes('/project/${pid}/')`)
      if (ready) break
      await sleep(300)
    }
    await sleep(800)
  }
  return { ev, cmd, sendMsg, waitIdle, hasText, bodyHas, emptyShown, gotoProject, exceptions, ws }
}
let fail = 0
const ok = (cond, label) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + label)
  if (!cond) fail++
}

// ---------- Tab1：错误重试落原桶 ----------
{
  const tab = await newTab(`${APP}/?zj-agent-delay=120&cb=${Date.now()}#/project/demo-aseya/novel`)
  const d = await drive(tab)
  await sleep(4500)
  ok(await d.emptyShown(), 'T1-① demo-aseya 初始空态')
  await d.sendMsg(ERR)
  await d.waitIdle()
  ok(await d.ev(d.bodyHas('本轮未完整生成')), 'T1-② 「模拟超时」错误卡出现（warn 降级）')
  ok(await d.ev(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '重试')`), 'T1-② 错误卡带「重试」按钮')
  // 点第一条错误卡的重试
  await d.ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '重试'); if (b) { b.click(); return true } return false })()`)
  await d.waitIdle()
  ok(await d.ev(d.bodyHas('已重试')), 'T1-③ 重试后原错误卡置「已重试」')
  ok((await d.ev(`(document.body.innerText.match(/${ERR}/g) || []).length`)) >= 2, 'T1-③ 重试轮已发出（「模拟超时」出现 ≥2 次）')
  ok((await d.ev(`(document.body.innerText.match(/本轮未完整生成/g) || []).length`)) >= 2, 'T1-③ 重试轮再失败（错误卡 ×2）')
  await d.gotoProject('demo-order')
  ok(await d.emptyShown(), 'T1-④ 切 demo-order 空态（A 桶错误对话不串）')
  ok(!(await d.ev(d.bodyHas(ERR))), 'T1-④ B 列表不含「模拟超时」')
  await d.gotoProject('demo-aseya')
  ok((await d.ev(`(document.body.innerText.match(/本轮未完整生成/g) || []).length`)) >= 2, 'T1-⑤ 切回 A：错误对话完整（重试轮仍在原桶）')
  ok(await d.ev(d.bodyHas('已重试')), 'T1-⑤ 「已重试」标记保持')
  ok(d.exceptions.length === 0, 'T1-⑥ 无 JS 异常（' + d.exceptions.length + '）' + (d.exceptions[0] ? '：' + d.exceptions[0] : ''))
  await d.cmd('Target.closeTarget', { targetId: tab.id }).catch(() => {})
  d.ws.close()
}

// ---------- Tab2：排队续发跨项目落原桶 ----------
{
  const tab = await newTab(`${APP}/?zj-agent-delay=120&cb=${Date.now() + 1}#/project/demo-aseya/novel`)
  const d = await drive(tab)
  await sleep(4500)
  await d.sendMsg(ERR)
  await sleep(150) // 第一条仍在流式中
  await d.sendMsg(QUEUED)
  ok(await d.ev(d.bodyHas('消息已排队')), 'T2-① 生成中再发→「消息已排队」提示')
  await d.gotoProject('demo-order') // 排队期间切到 B
  await d.waitIdle() // 等第一条 error + 第二条续发都完成
  ok(await d.emptyShown(), 'T2-③ 切 B 后 B 桶空态（续发未落当前面板桶）')
  ok(!(await d.ev(d.bodyHas(QUEUED))), 'T2-③ B 列表不含排队消息')
  ok(!(await d.ev(d.bodyHas('（dev 模式模拟回复）'))), 'T2-③ B 列表不含续发轮回复')
  await d.gotoProject('demo-aseya')
  ok(await d.ev(d.bodyHas(QUEUED)), 'T2-④ 切回 A：排队消息在 A 桶')
  ok(await d.ev(d.bodyHas('（dev 模式模拟回复）')), 'T2-④ 排队轮回复在 A 桶（续发落原项目）')
  ok(await d.ev(d.bodyHas('本轮未完整生成')), 'T2-④ 原「模拟超时」错误卡同在 A 桶')
  ok(d.exceptions.length === 0, 'T2-⑤ 无 JS 异常（' + d.exceptions.length + '）' + (d.exceptions[0] ? '：' + d.exceptions[0] : ''))
  await d.cmd('Target.closeTarget', { targetId: tab.id }).catch(() => {})
  d.ws.close()
}

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAIL`)
process.exit(fail === 0 ? 0 : 1)
