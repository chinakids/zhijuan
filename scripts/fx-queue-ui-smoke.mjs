// 织卷无头冒烟 · 忙时固定命令排队（/巡查 /导演）——体验层 2026-09-24（04-体验层.md 五候选3⑥）
// 背景：生成中/导演执行中输入固定命令曾被 doSend 静默 return（无任何反馈）；现改为排队+toast 后
//       空闲自动按序执行（Claude Code 命令排队语义：turn 结束后逐条执行；
//       依据 docs.claude.com/en/docs/claude-code/interactive-mode「Queue messages while Claude works」）。
// 断言语义（devShim）：A 生成中 /巡查 本章 → 「命令已排队」→ 不立即执行 → 切走项目不跨项目跑 → 切回自动执行；
//          B 生成中 /导演 → 排队 → 空闲后自动跑导演（工具卡+导演板落盘文案）；
//          C 导演执行中：普通消息 → 「导演任务执行中」提示（输入保留）；/导演 → 排队 → 串行执行第二个。
// 用法：node scripts/fx-queue-ui-smoke.mjs（先 npm run build + serve-renderer 8899 + CDP 9224）
const base = 'http://127.0.0.1:9224'
const APP = 'http://127.0.0.1:8899'
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
  const insertText = async (text) => {
    await ev(`(() => { const t = document.querySelector('textarea'); if (t) { t.focus(); return true } return false })()`)
    await cmd('Input.insertText', { text })
  }
  // 普通消息：一次 Enter 发送
  const sendMsg = async (text) => {
    await insertText(text)
    await pressEnter()
  }
  // 固定命令（无参数，如 /导演）：/ 命令浮层会截获首个 Enter 选中候选（插入 /导演␣），再 Enter 才发送——
  // 走真实用户两次 Enter 链路
  const sendCmd = async (text) => {
    await insertText(text)
    await sleep(400) // 等浮层候选渲染
    await pressEnter()
    await sleep(400)
    await pressEnter()
  }
  const inputVal = () => ev(`(document.querySelector('textarea')?.value) ?? ''`)
  const waitIdle = async () => {
    for (let i = 0; i < 240; i++) {
      await sleep(300)
      const busy = await ev(
        `!!document.querySelector('button[title="停止生成"]') || !!document.querySelector('button[title^="停止导演任务"]')`
      )
      if (!busy && i > 1) break
    }
    await sleep(500)
  }
  const bodyHas = (t) => ev(`document.body.innerText.includes(${JSON.stringify(t)})`)
  const countHas = (t) => ev(`(document.body.innerText.split(${JSON.stringify(t)}).length - 1)`)
  const gotoCh = async (pid, ch) => {
    const chPart = ch ? '?ch=' + encodeURIComponent(ch) : ''
    await ev(`location.hash = '#/project/${pid}/novel${chPart}'`)
    await sleep(700)
    for (let i = 0; i < 20; i++) {
      const ready = await ev(`location.hash.includes('/project/${pid}/')`)
      if (ready) break
      await sleep(300)
    }
    await sleep(800)
  }
  const until = async (f, ms, label) => {
    const t0 = Date.now()
    for (;;) {
      try { const v = await f(); if (v) return v } catch {}
      if (Date.now() - t0 > ms) throw new Error('TIMEOUT ' + label)
      await sleep(250)
    }
  }
  return { ev, cmd, sendMsg, sendCmd, inputVal, waitIdle, bodyHas, countHas, gotoCh, until, exceptions, ws }
}
let fail = 0
const ok = (cond, label) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + label)
  if (!cond) fail++
}

// ---------- Tab：场景 A/B/C 同一 tab（devShim 数据按 tab 独立，多场景连贯走完） ----------
const tab = await newTab(`${APP}/?zj-agent-delay=250&zj-delay=agentDirector:3000&cb=${Date.now()}#/project/demo-aseya/novel?ch=${encodeURIComponent('第02章_灯塔.md')}`)
const d = await drive(tab)
await d.until(() => d.ev(`!!document.querySelector('textarea')`), 20000, '正文页就绪')
console.log('OK 正文页就绪（第02章_灯塔 选中态）')

// ---------- 场景 A：生成中 /巡查 排队 → 切走项目保留 → 切回自动执行 ----------
await d.sendMsg('请先通读这一章。')
await d.until(() => d.ev(`!!document.querySelector('button[title="停止生成"]')`), 8000, 'A 流式开始')
await sleep(600)
await d.sendMsg('/巡查 本章') // 含参数（令牌含空格）/ 浮层不截获，一次 Enter 即发送
ok((await d.bodyHas('命令已排队')), 'A1-① 生成中固定命令→「命令已排队」toast')
ok((await d.inputVal()) === '', 'A1-② 排队后输入框清空')
ok(!(await d.bodyHas('已调起本章小环·短巡查')), 'A1-③ 生成中未立即执行命令')
ok(!(await d.bodyHas('/巡查 本章\n')), 'A1-③ 命令用户消息未立即入对话')
// 切走项目：命令应保留在队列（归属原项目），不跨项目执行
await d.gotoCh('demo-order', null)
await d.waitIdle()
await sleep(1000)
ok(!(await d.bodyHas('已调起本章小环·短巡查')), 'A2-① 切走项目：命令未跨项目执行')
ok(!(await d.bodyHas('/巡查 本章')), 'A2-② 命令未落 B 项目对话')
// 切回原项目：effect 因 projectId 变化触发 drain → 自动执行
await d.gotoCh('demo-aseya', '第02章_灯塔.md')
await d.until(() => d.ev(`document.body.innerText.includes('已调起本章小环·短巡查')`), 12000, 'A3-① 切回后命令自动执行')
ok((await d.bodyHas('已调起本章小环·短巡查（右侧抽屉')), 'A3-① 切回后自动执行（短巡查调起）')
ok((await d.bodyHas('/巡查 本章')), 'A3-② 命令用户消息已入对话')
ok(d.exceptions.length === 0, 'A4 无 JS 异常（' + d.exceptions.length + '）' + (d.exceptions[0] ? '：' + d.exceptions[0] : ''))

// ---------- 场景 B：生成中 /导演 排队 → 空闲自动执行（导演板落盘文案 + 工具卡） ----------
await d.ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
await sleep(600)
await d.sendMsg('继续。')
await d.until(() => d.ev(`!!document.querySelector('button[title="停止生成"]')`), 8000, 'B 流式开始')
await sleep(600)
await d.sendCmd('/导演')
ok((await d.bodyHas('命令已排队')), 'B1 生成中 /导演→「命令已排队」toast')
await d.waitIdle() // 对话轮结束 → drain 自动执行导演
await d.until(() => d.ev(`document.body.innerText.includes('已写入 大纲/第02章_灯塔_导演.md')`), 20000, 'B2 排队导演自动执行')
ok((await d.bodyHas('已写入 大纲/第02章_灯塔_导演.md')), 'B2-① 导演板自动执行并落盘')
ok((await d.bodyHas('章节导演')), 'B2-② 导演工具卡入对话流')
await d.waitIdle()
ok(d.exceptions.length === 0, 'B3 无 JS 异常（' + d.exceptions.length + '）' + (d.exceptions[0] ? '：' + d.exceptions[0] : ''))

// ---------- 场景 C：导演执行中 → 普通消息提示（不静默）+ /导演 排队串行执行 ----------
await d.sendCmd('/导演') // 直接执行（非排队），700ms mock 窗口
await d.until(() => d.ev(`!!document.querySelector('button[title^="停止导演任务"]')`), 6000, 'C 导演执行中')
await sleep(150)
await d.sendMsg('你好')
ok((await d.bodyHas('导演任务执行中')), 'C1-① 导演执行中普通消息→可见提示')
ok((await d.inputVal()) === '你好', 'C1-② 输入保留（不静默清除）')
await d.ev(`(() => { const t = document.querySelector('textarea'); if (t) { t.value = ''; t.dispatchEvent(new Event('input', { bubbles: true })) } return true })()`)
await sleep(300)
ok((await d.ev(`!!document.querySelector('button[title^="停止导演任务"]')`)), 'C2-⓪ 仍处导演执行中（排队上下文成立）')
await d.sendCmd('/导演') // 导演执行中再排 /导演 → 串行（Claude Code 命令排队语义）
ok((await d.bodyHas('命令已排队')), 'C2-① 导演执行中 /导演→排队 toast')
await d.waitIdle() // 第一个导演结束 → drain 执行第二个
await d.until(() => d.ev(`(document.body.innerText.split('已写入 大纲/第02章_灯塔_导演.md').length - 1) >= 3`), 25000, 'C2-② 第二个导演串行执行')
ok((await d.countHas('已写入 大纲/第02章_灯塔_导演.md')) >= 3, 'C2-② 排队导演已串行执行（B1+C 直执+C 排队=3 次落盘文案）')
await d.waitIdle()
ok(d.exceptions.length === 0, 'C3 无 JS 异常（' + d.exceptions.length + '）' + (d.exceptions[0] ? '：' + d.exceptions[0] : ''))

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAIL`)
process.exit(fail === 0 ? 0 : 1)
