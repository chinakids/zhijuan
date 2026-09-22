// 编辑器实时字数 · 无头 UI 冒烟（2026-09-23 创作层：编辑器状态条「约 N 字」）
// 断言：① 打开 demo-aseya 选中第1章 → 状态条出现「约 N 字」（N>0，countWords 口径）；
//       ② 向编辑器插入中文文本 → 字数实时 +4；③ 读取失败态不显示字数（?zj-fail=readDoc）。
// 用法：node scripts/wordcount-ui-smoke.mjs  （先 npm run build + node scripts/serve-renderer.mjs 8123，CDP 9224 在跑）
// 注：注入表达式内正则一律用 [0-9] 字符类（无转义），勿写 \d（两层传输会把 \d 打平成字面反斜杠——health-bar 同坑）。
const PORT = 8123
const BASE = process.env.ZJ_SMOKE_BASE || `http://localhost:${PORT}`
const list = await (await fetch('http://127.0.0.1:9224/json')).json()
let page = list.find((t) => t.type === 'page' && new RegExp(`:${PORT}`).test(t.url) && /novel/.test(t.url))
if (!page) {
  const any = list.find((t) => t.type === 'page' && new RegExp(`:${PORT}`).test(t.url))
  if (!any) {
    const r = await fetch('http://127.0.0.1:9224/json/new?' + encodeURIComponent(`${BASE}/?cb=${Date.now()}`), { method: 'PUT' })
    page = await r.json()
  } else {
    page = any
  }
}
if (!page) { console.error('NO NOVEL PAGE'); process.exit(1) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
const errors = []
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.method === 'Runtime.exceptionThrown') errors.push((m.params.exceptionDetails?.exception?.description ?? '').slice(0, 200))
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push((m.params.args?.map((a) => a.value ?? a.description ?? '').join(' ') ?? '').slice(0, 200))
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
  const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
  return r.result?.value
}
await new Promise((r) => (ws.onopen = r))
await cmd('Runtime.enable')
let pass = 0, fail = 0
const ok = (cond, msg) => { console.log((cond ? '✅ ' : '❌ ') + msg); cond ? pass++ : fail++ }

await cmd('Page.navigate', { url: `${BASE}/?cb=${Date.now()}#/project/demo-aseya/novel` })
await sleep(3500)

// 选第1章（状态条仅在选中章时渲染）
await ev(`(() => {
  const btn = [...document.querySelectorAll('aside button, [data-testid="chapter-sidebar"] button')].find((b) => (b.innerText || '').includes('第1章') && (b.innerText || '').includes('雾港'))
  if (!btn) return false
  btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
  btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }))
  btn.click()
  return true
})()`)
await sleep(2500)

const readCount = async () => {
  const t = await ev(`(() => {
    const els = [...document.querySelectorAll('span')].filter((e) => /约 [0-9]+ 字/.test(e.textContent || ''))
    return els.length ? els[0].textContent : null
  })()`)
  if (!t) return null
  const m = /约 ([0-9]+) 字/.exec(t)
  return m ? parseInt(m[1], 10) : null
}

let n = null
for (let i = 0; i < 20; i++) {
  n = await readCount()
  if (n !== null) break
  await sleep(500)
}
ok(n !== null && n > 0, `① 状态条显示实时字数（实际 ${n}）`)

// ② 插入中文文本 → 字数 +4
await ev(`(() => { const ed = document.querySelector('.zj-md .ProseMirror'); if (!ed) return false; ed.focus(); return true })()`)
await sleep(300)
await cmd('Input.insertText', { text: '测试文字' })
await sleep(800)
const n2 = await readCount()
ok(n2 !== null && n2 === (n ?? 0) + 4, `② 输入后字数实时更新（${n} → ${n2}）`)

// ③ 读取失败态不显示字数
await cmd('Page.navigate', { url: `${BASE}/?cb=${Date.now()}&zj-fail=readDoc#/project/demo-aseya/novel` })
await sleep(3000)
await ev(`(() => {
  const btn = [...document.querySelectorAll('aside button, [data-testid="chapter-sidebar"] button')].find((b) => (b.innerText || '').includes('第1章') && (b.innerText || '').includes('雾港'))
  if (!btn) return false
  btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
  btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }))
  btn.click()
  return true
})()`)
await sleep(2000)
const n3 = await readCount()
const errCard = await ev(`!!document.body.innerText.includes('读取文档失败')`)
ok(n3 === null && errCard, `③ 读取失败态不显示字数（字数=${n3}，失败卡=${errCard}）`)

if (errors.length) { console.log('⚠️ JS 异常：' + errors.join(' | ')); fail++ }
console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
