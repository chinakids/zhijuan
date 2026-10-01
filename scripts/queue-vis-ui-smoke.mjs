// 织卷无头冒烟 · 排队消息/命令可视化列表——体验层 2026-10-01（04-体验层.md 五候选 1）
// 背景：生成中/导演执行中再发的命令与消息仅弹 toast「消息已排队/命令已排队」（8ec9cdb/c3fb655），
//       队列内容作者不可见——排了 2-3 条后无法确认「都排上了/都是什么」。
// 调研：Claude Code 官方 interactive-mode 现行范式=「lists the queued entries in the conversation until
//       it sends them」+「Sent and queued messages show in gray until Claude starts responding」
//       （code.claude.com/docs/en/interactive-mode，2026-10-01 实抓）——排队条目列在对话流灰显。
//       落地：排队条目灰显气泡渲染在消息流末尾（不入 store/不进上下文载荷），逐条可取消。
// 断言语义（devShim）：
//   A 生成中排队两条消息 → 队列条目可见（2 条/顺序/「已排队 · 消息」标记）→ 取消第一条 →
//      剩余 1 条、取消的从未入对话流 → 剩余一条自动发送 → 队列消失；
//   B 生成中排队命令 → 条目含「已排队 · 命令」→ 取消 → 命令未执行；
//   C 生成中排队命令 → 切走项目条目不可见（不跨项目显示）→ 切回可见且自动执行 → 队列消失；
//   零 JS 异常。
// 用法：node scripts/queue-vis-ui-smoke.mjs（先 npm run build + serve-renderer 8899 + CDP 9224）
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
  const sendMsg = async (text) => {
    await insertText(text)
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
  const queueItems = () =>
    ev(`[...document.querySelectorAll('[data-testid="agent-queue-item"]')].map((x) => x.innerText.replace(/\\n/g, ' ⏎ '))`)
  const queueCount = () => ev(`document.querySelectorAll('[data-testid="agent-queue-item"]').length`)
  const cancelFirst = () =>
    ev(`(() => { const b = document.querySelector('[data-testid="agent-queue-item"] button[aria-label="取消排队"]'); if (!b) return false; b.click(); return true })()`)
  const userBubbleHas = (t) =>
    ev(`[...document.querySelectorAll('div.flex.justify-end > div')].some((x) => (x.classList.contains('bg-accent') || (x.className && String(x.className).includes('bg-accent'))) && x.innerText.includes(${JSON.stringify(t)}))`)
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
  return { ev, cmd, sendMsg, inputVal, waitIdle, bodyHas, queueItems, queueCount, cancelFirst, userBubbleHas, gotoCh, until, exceptions, ws }
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

// ---------- 场景 A：生成中排队两条消息 → 条目可见/顺序 → 取消第一条 → 剩余自动发送 ----------
await d.sendMsg('请先通读这一章。')
await d.until(() => d.ev(`!!document.querySelector('button[title="停止生成"]')`), 8000, 'A 流式开始')
await sleep(600)
await d.sendMsg('排队消息一')
await d.until(() => d.ev(`document.querySelectorAll('[data-testid="agent-queue-item"]').length >= 1`), 5000, 'A1 队列条目出现')
ok((await d.queueCount()) === 1, 'A1-① 生成中排队消息→队列条目出现（1 条）')
ok((await d.bodyHas('已排队 · 消息')), 'A1-② 条目带「已排队 · 消息」标记')
ok((await d.bodyHas('完成后按序发送')), 'A1-③ 条目带结语「完成后按序发送」')
const items1 = await d.queueItems()
ok(items1.length >= 1 && items1[0].includes('排队消息一'), 'A1-④ 条目内容=排队原文：' + JSON.stringify(items1))
await d.sendMsg('排队消息二')
await d.until(() => d.ev(`document.querySelectorAll('[data-testid="agent-queue-item"]').length >= 2`), 5000, 'A2 第二条入列')
const items2 = await d.queueItems()
ok(items2.length === 2, 'A2-① 两条排队条目均在列（' + items2.length + '）')
ok(items2[0].includes('排队消息一') && items2[1].includes('排队消息二'), 'A2-② 顺序=排队先后：' + JSON.stringify(items2.map((x) => x.slice(0, 20))))
// 取消第一条 → 剩余一条、第一条不入对话流
ok((await d.cancelFirst()), 'A3-① 取消第一条成功（点击）')
await d.until(() => d.ev(`document.querySelectorAll('[data-testid="agent-queue-item"]').length === 1`), 5000, 'A3 取消后剩 1 条')
const items3 = await d.queueItems()
ok(items3.length === 1 && items3[0].includes('排队消息二') && !items3[0].includes('排队消息一'), 'A3-② 取消的条目移除、剩余条目完好')
await d.waitIdle()
await d.until(() => d.ev(`document.querySelectorAll('[data-testid="agent-queue-item"]').length === 0`), 15000, 'A4 队列清空')
ok((await d.queueCount()) === 0, 'A4-① 自动发送后队列清空（agent-queue 不再渲染）')
ok((await d.bodyHas('排队消息二')), 'A4-② 剩余消息已发送（入对话流）')
ok(!(await d.bodyHas('排队消息一')), 'A4-③ 取消的消息从未入对话流')
await d.waitIdle() // 场景收尾：等 A 轮流式结束，避免残留流式污染 B 场景（queue 混入两条）
await sleep(500)
ok((await d.queueCount()) === 0, 'A4-④ 收尾队列空')
ok(d.exceptions.length === 0, 'A5 无 JS 异常（' + d.exceptions.length + '）' + (d.exceptions[0] ? '：' + d.exceptions[0] : ''))

// ---------- 场景 B：生成中排队命令 → 条目标记「命令」→ 取消 → 未执行 ----------
await d.sendMsg('继续。')
await d.until(() => d.ev(`!!document.querySelector('button[title="停止生成"]')`), 8000, 'B 流式开始')
await sleep(600)
await d.sendMsg('/巡查 本章') // 含参数（令牌含空格）/ 浮层不截获，一次 Enter 即发送
await d.until(() => d.ev(`document.querySelectorAll('[data-testid="agent-queue-item"]').length >= 1`), 5000, 'B1 命令入列')
ok((await d.queueCount()) === 1, 'B0-① 队列仅命令一条（无残留）')
ok((await d.bodyHas('已排队 · 命令')), 'B1-① 命令条目带「已排队 · 命令」标记')
ok((await d.cancelFirst()), 'B2-① 取消排队命令')
await d.waitIdle()
await sleep(1500)
ok((await d.queueCount()) === 0, 'B2-② 取消后队列清空')
ok(!(await d.bodyHas('已调起本章小环·短巡查')), 'B2-③ 取消的命令未执行')
ok(d.exceptions.length === 0, 'B3 无 JS 异常（' + d.exceptions.length + '）' + (d.exceptions[0] ? '：' + d.exceptions[0] : ''))

// ---------- 场景 C：排队命令跨项目可见性——切走不可见、切回可见并自动执行 ----------
await d.sendMsg('再续一章。')
await d.until(() => d.ev(`!!document.querySelector('button[title="停止生成"]')`), 8000, 'C 流式开始')
await sleep(600)
await d.sendMsg('/巡查 本章')
await d.until(() => d.ev(`document.querySelectorAll('[data-testid="agent-queue-item"]').length >= 1`), 5000, 'C1 命令入列')
ok((await d.queueCount()) === 1, 'C1-① 生成中命令入列')
await d.gotoCh('demo-order', null)
await sleep(800)
ok((await d.queueCount()) === 0, 'C2-① 切走项目：队列条目不可见（不跨项目显示）')
ok(!(await d.bodyHas('已排队 · 命令')), 'C2-② 切走项目无排队标记残留')
await d.gotoCh('demo-aseya', '第02章_灯塔.md')
await d.until(() => d.ev(`document.querySelectorAll('[data-testid="agent-queue-item"]').length >= 1`), 8000, 'C3-① 切回项目：队列条目复现')
ok((await d.bodyHas('已排队 · 命令')), 'C3-① 切回后排队条目可见（保留原桶）')
await d.until(() => d.ev(`document.body.innerText.includes('已调起本章小环·短巡查')`), 15000, 'C3-② 命令自动执行')
ok((await d.bodyHas('已调起本章小环·短巡查（右侧抽屉')), 'C3-② 切回后命令自动执行')
await d.until(() => d.ev(`document.querySelectorAll('[data-testid="agent-queue-item"]').length === 0`), 10000, 'C4 队列清空')
ok((await d.queueCount()) === 0, 'C4-① 执行后队列清空')
ok(d.exceptions.length === 0, 'C5 无 JS 异常（' + d.exceptions.length + '）' + (d.exceptions[0] ? '：' + d.exceptions[0] : ''))

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAIL`)
process.exit(fail === 0 ? 0 : 1)
