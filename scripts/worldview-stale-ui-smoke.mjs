// 世界观页「历史」徽标（孤儿切片文件标注）· 无头 UI 冒烟（2026-09-19 创作层）
// 断言：① 初始零徽标（demo-aseya 无切片_前缀孤儿）；② writeDoc 孤儿 切片_已改名_雾港.md → 列表出现+徽标；
//       ③ writeDoc 活跃名 切片_第一幕_雾港之夜.md → 出现但无徽标（活跃切片不被误标）；④ 无 JS 异常。
// 用法：node scripts/worldview-stale-ui-smoke.mjs  （先 npm run build + node scripts/serve-renderer.mjs 8123，CDP 9224 在跑）
const PORT = 8123
const BASE = process.env.ZJ_SMOKE_BASE || `http://localhost:${PORT}`
const r = await fetch('http://127.0.0.1:9224/json/new?' + encodeURIComponent(`${BASE}/?cb=${Date.now()}`), { method: 'PUT' })
const page = await r.json()
const ws = new WebSocket(page.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
const errors = []
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.method === 'Runtime.exceptionThrown') errors.push(JSON.stringify(m.params?.exceptionDetails?.exception?.description ?? m.params))
  if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') errors.push(m.params?.args?.map((a) => a.value ?? a.description ?? '').join(' '))
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
}
function cmd(method, params = {}) {
  return new Promise((res, rej) => {
    const id = ++seq
    pending.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)))
    ws.send(JSON.stringify({ id, method, params }))
  })
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ev = async (expression) => {
  const r2 = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r2.exceptionDetails) throw new Error(JSON.stringify(r2.exceptionDetails))
  return r2.result?.value
}
await new Promise((r) => (ws.onopen = r))
async function onopenFirst() { await cmd('Runtime.enable') }
await onopenFirst()
let pass = 0, fail = 0
const ok = (cond, msg) => { console.log((cond ? '✅ ' : '❌ ') + msg); cond ? pass++ : fail++ }

await cmd('Page.navigate', { url: `${BASE}/?cb=${Date.now()}#/project/demo-aseya/worldview` })
await sleep(3500)

// ① 初始：文档列存在、含 总纲/第一幕_雾港之夜、零「历史」徽标
const init = await ev(`(() => {
  const col = document.querySelector('[data-testid="doc-col"]')
  if (!col) return { col: false, names: [], badges: 0 }
  const names = [...col.querySelectorAll('button')].map((b) => (b.innerText || '').trim()).filter(Boolean)
  const badges = [...col.querySelectorAll('span[title*="保留为历史"]')].length
  return { col: true, names, badges }
})()`)
ok(init.col === true, '① 文档列表已渲染')
ok(init.names.some((n) => n.includes('总纲')), '① 含总纲')
ok(init.names.some((n) => n.includes('第一幕_雾港之夜')), '① 含既有世界观文档（无前缀旧名）')
ok(init.badges === 0, `① 初始零「历史」徽标（实际 ${init.badges}）`)

// ② writeDoc 孤儿（切片_已改名_雾港，非活跃切片名）
await ev(`window.zhijuan.writeDoc('demo-aseya', '世界观/切片_已改名_雾港.md', '# 切片：已改名_雾港\\n\\n> 历史快照\\n').then(() => true)`)
await sleep(1800)
const orphan = await ev(`(() => {
  const btn = [...document.querySelectorAll('[data-testid="doc-col"] button')].find((b) => (b.innerText || '').includes('切片_已改名_雾港'))
  if (!btn) return { found: false }
  return { found: true, badge: !!btn.querySelector('span[title*="保留为历史"]'), text: (btn.innerText || '').trim() }
})()`)
ok(orphan.found === true, '② 孤儿文件出现在列表')
ok(orphan.badge === true, '② 孤儿文件带「历史」徽标')

// ③ writeDoc 活跃名文件（demo-aseya 第01章切片=第一幕_雾港之夜）→ 出现但无徽标
await ev(`window.zhijuan.writeDoc('demo-aseya', '世界观/切片_第一幕_雾港之夜.md', '# 切片：第一幕_雾港之夜\\n\\n> 活跃\\n').then(() => true)`)
await sleep(1800)
const live = await ev(`(() => {
  const btn = [...document.querySelectorAll('[data-testid="doc-col"] button')].find((b) => (b.innerText || '').includes('切片_第一幕_雾港之夜'))
  if (!btn) return { found: false }
  return { found: true, badge: !!btn.querySelector('span[title*="保留为历史"]') }
})()`)
ok(live.found === true, '③ 活跃切片名文件出现在列表')
ok(live.badge === false, '③ 活跃切片文件无「历史」徽标（不被误标）')

// 截图
const shot = await cmd('Page.captureScreenshot', { format: 'png' })
if (shot?.data) {
  const fs = await import('fs')
  const t = new Date()
  const hh = String(t.getHours()).padStart(2, '0'), mm = String(t.getMinutes()).padStart(2, '0')
  fs.writeFileSync(`${process.env.HOME}/Pictures/zhijuan/worldview-stale-${hh}${mm}.png`, Buffer.from(shot.data, 'base64'))
  console.log(`└ 截图 worldview-stale-${hh}${mm}.png`)
}
ok(errors.length === 0, `无 JS 异常（${errors.length}）${errors[0] ? '：' + errors[0].slice(0, 120) : ''}`)
console.log(`RESULT: ${pass}/${pass + fail}`)
process.exit(fail === 0 ? 0 : 1)
