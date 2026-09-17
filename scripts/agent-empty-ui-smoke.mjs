// Agent 面板空态引导冒烟（体验层 2026-09-17 17:15 轮）
// 断言：空态卡片存在、4 条引导含「对话/@//命令」、无过时「添加到对话」、发消息后空态消失
const base = 'http://127.0.0.1:9224'
async function newTab(u) {
  const r = await fetch(`${base}/json/new?${encodeURIComponent(u)}`, { method: 'PUT' })
  if (!r.ok) throw new Error('new failed ' + r.status)
  return r.json()
}
const tab = await newTab('http://127.0.0.1:8899/#/project/demo-aseya/novel?cb=empty-smoke')
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
  return r.result?.value
}
let fail = 0
const ok = (cond, label) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + label)
  if (!cond) fail++
}
// ① 空态存在
const empty = await ev(`(() => {
  const el = document.querySelector('[data-testid="agent-empty"]')
  if (!el) return null
  const guides = [...el.querySelectorAll('[data-testid="agent-empty-guide"]')].map(g => g.innerText.trim())
  return { title: el.querySelector('p')?.innerText, guides }
})()`)
ok(!!empty, '空态卡片存在')
ok(empty && empty.guides.length === 4, '4 条引导（实际 ' + (empty ? empty.guides.length : 0) + '）')
ok(empty && empty.title && /边聊边生成/.test(empty.title), '标题含「边聊边生成」')
const allText = empty ? empty.guides.join('|') : ''
ok(/「对话」/.test(allText) && !/添加到对话/.test(allText), '引用入口写「对话」且无过时「添加到对话」')
ok(/输入 @ 引用/.test(allText), '@ 引用可发现性指引')
ok(/输入 \/ 使用命令/.test(allText) && /续写/.test(allText), '/ 命令可发现性指引（含命令名）')
ok(/采纳即写入/.test(allText), '改正文机制一句话')
// ② 各条不溢出（truncate 生效：scrollWidth 有限）
const overflow = await ev(`(() => {
  const gs = [...document.querySelectorAll('[data-testid="agent-empty-guide"]')]
  return gs.every(g => g.scrollWidth <= g.clientWidth + 1)
})()`)
ok(overflow === true, '引导行无溢出')
// ③ 发消息后空态消失
await cmd('Runtime.evaluate', { expression: `(() => { const t = document.querySelector('textarea'); if (t) t.focus(); return !!t })()`, returnByValue: true })
await cmd('Input.insertText', { text: '你好' })
await cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', windowsVirtualKeyCode: 13 })
await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
for (let i = 0; i < 120; i++) {
  await sleep(500)
  const idle = await ev(`!document.querySelector('button[title="停止生成"]')`)
  if (idle && i > 2) break
}
await sleep(800)
const gone = await ev(`!document.querySelector('[data-testid="agent-empty"]')`)
ok(gone === true, '发送后空态消失（消息流置顶）')
// ④ 无 JS 异常
ok(exceptions.length === 0, '无 JS 异常（' + exceptions.length + '）' + (exceptions[0] ? '：' + exceptions[0] : ''))
console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAIL`)
await cmd('Target.closeTarget', { targetId: tab.id }).catch(() => {})
ws.close()
process.exit(fail === 0 ? 0 : 1)
