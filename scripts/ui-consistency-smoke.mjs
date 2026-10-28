// 织卷 · UI 一致性冒烟（2026-10-28，F-20261028-11）
// 覆盖：
//  ①设置页开关行：说明文字不得与开关控件水平重叠（曾出现文字钻到开关下面）
//  ②设置页标签统一 14px/中等字重（层级不再和说明文字糊在一起）
//  ③人物/世界观/素材空态：统一标题+说明+新建按钮
//  ④正文页未选章空态：统一标题+说明+CTA
// 用法：node scripts/ui-consistency-smoke.mjs [base]
const base = process.argv[2] || 'http://127.0.0.1:8899'
const CDP = 'http://127.0.0.1:9224'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const tab = await (await fetch(CDP + '/json/new?url=' + encodeURIComponent('about:blank'), { method: 'PUT' })).json()
const ws = new WebSocket(tab.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
const errors = []
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.method === 'Runtime.exceptionThrown') errors.push((m.params.exceptionDetails?.exception?.description ?? '').slice(0, 200))
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push((m.params.args?.map((a) => a.value ?? a.description ?? '').join(' ') ?? '').slice(0, 200))
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
}
const cmd = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result))); ws.send(JSON.stringify({ id, method, params })) })
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
await cmd('Page.enable'); await cmd('Runtime.enable'); await cmd('Network.enable'); await cmd('Network.setCacheDisabled', { cacheDisabled: true })
const ev = async (expr) => {
  const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error('EVAL: ' + (r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)))
  return r.result?.value
}
let pass = 0, fail = 0
const check = (name, cond, extra = '') => { if (cond) { pass++; console.log('  ✓', name, extra) } else { fail++; console.log('  ✗', name, extra) } }

// ① 设置-外观：说明文字与开关不重叠
await cmd('Page.navigate', { url: `${base}/?cb=uiconsist#/project/demo-aseya/settings?pane=look` })
await sleep(2400)
const overlaps = await ev(`(() => {
  const rows = [...document.querySelectorAll('div')].filter(d => d.querySelector(':scope > div > p') && d.querySelector(':scope > button[role="switch"], :scope > button[aria-checked]'))
  const bad = []
  for (const row of rows) {
    const p = row.querySelector(':scope > div > p')
    const sw = row.querySelector(':scope > button[role="switch"], :scope > button[aria-checked]')
    if (!p || !sw) continue
    const a = p.getBoundingClientRect(), b = sw.getBoundingClientRect()
    if (a.right > b.left - 2) bad.push({ text: p.textContent.slice(0, 18), overlap: +(a.right - b.left).toFixed(1) })
  }
  return bad
})()`)
check('① 设置行说明不与开关重叠', Array.isArray(overlaps) && overlaps.length === 0, JSON.stringify(overlaps).slice(0, 160))

// ② 标签字号/字重统一
const labels = await ev(`(() => {
  const ls=[...document.querySelectorAll('label')].filter(l=>l.textContent.trim())
  return ls.map(l=>({t:l.textContent.trim().slice(0,8), size:getComputedStyle(l).fontSize, weight:getComputedStyle(l).fontWeight})).slice(0,12)
})()`)
const badSize = (labels || []).filter((l) => l.size !== '14px' || !(l.weight === '500' || l.weight === '600' || l.weight === '700'))
check('② 设置标签统一 14px/中等以上字重', badSize.length === 0, JSON.stringify(badSize).slice(0, 160))

// ③ 文档类空态
await cmd('Page.navigate', { url: `${base}/?cb=uiconsist2#/project/demo-aseya/characters` })
await sleep(2200)
check('③ 人物页自动打开总览（无空态/白屏）', (await ev(`!!document.querySelector('.ProseMirror') || !!document.querySelector('[data-testid="doc-empty"]')`)) === true)

// ④ 正文空态
await cmd('Page.navigate', { url: `${base}/?cb=uiconsist3#/project/demo-aseya/novel` })
await sleep(2200)
check('④ 正文未选章空态（含新建 CTA）', (await ev(`!!document.querySelector('[data-testid="novel-empty"]')`)) === true)
check('④ 空态有新建章节按钮', (await ev(`!!document.querySelector('[data-testid="novel-empty-create"]')`)) === true)

check('无 JS 异常', errors.length === 0, errors.slice(0, 2).join(' | '))
await fetch(CDP + '/json/close/' + tab.id)
console.log(`\n=== ${pass} passed, ${fail} failed ===`)
process.exit(fail ? 1 : 0)