// 织卷无头冒烟 · 采集栏（CollectionBar）宽表防护——体验层 2026-10-06（04-体验层.md 五候选 1）
// 背景：10-05 消息流宽表防护作用域仅 .agent-prose；共享 .prose 的 CollectionBar（任务卡正文
//       max-h-[30vh] 容器 + 素材只读预览）渲染同一 ReactMarkdown+remarkGfm 产物，5 列宽表
//       被压到容器宽（改动前实测：任务卡正文列宽 [57,53,67,32,227]/行高 43，素材预览
//       [29,66,117,64,159]/行高 60——列压缩成多行不可读，scrollWidth==clientWidth 无横滚）。
// 调研：GitHub 官方 markdown CSS 先例（sindresorhus/github-markdown-css L335-341，api.github.com
//       raw 实抓：display:block+width:max-content+max-width:100%+overflow:auto）+ Chromium 对照
//       实验补证（中文长文本须叠加 td/th white-space:nowrap 锁列宽才出横向滚动）。
// 落地：tokens.css 同款规则提升为共享 `.prose`（消息流经 .agent-prose 继承零变化；10-05 的
//       `.agent-prose table` 独立声明去重）——三面（消息流/采集预览与任务正文/提案 before/after）
//       同机制同处置；12px 预览语境 5 列压到 29-67px 不可读，滚动态保持列宽单行。
// 种子：devShim demo-aseya 采集池「任务_宽表演示.md」+ 素材库/环境/采集_宽表演示.md（5 列对照表
//       + 3 列 URL 表；既存种子不动）。
// 断言语义：
//   A 任务卡详情正文宽表：display=block/overflow-x=auto/max-width=100%、scrollWidth>clientWidth
//     （可横滚）、行高单行（<40px，不再 43-60px 多行）、td/th nowrap、不越出对话框；
//   B 点结果出素材预览：5 列表与 3 列 URL 表均可不压缩（sw>cw）、行高单行；
//   C 全场景零 JS 异常；采集栏任务卡「宽表演示」种子存在。
// 用法：node scripts/collection-wide-table-ui-smoke.mjs（先 npm run build + serve-renderer + CDP 9224）
const base = 'http://127.0.0.1:9224'
const APP = 'http://127.0.0.1:8899'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let fails = 0
function ok(name, cond, extra) {
  if (cond) console.log('  ✓', name)
  else { console.log('  ✗', name, extra ?? ''); fails++ }
}
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
  return { ws, ev, exceptions }
}

const tab = await newTab(`${APP}/?cb=${Date.now()}#/project/demo-aseya/library`)
const { ws, ev, exceptions } = await drive(tab)
await sleep(1800)

console.log('场景 A：任务卡详情正文宽表可横滚不压缩')
const chip = await ev(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('宽表演示'))
  if (!b) return 'no-chip'
  b.click()
  return 'ok'
})()`)
ok('采集栏存在「宽表演示」任务卡', chip === 'ok', chip)
await sleep(900)
const a = await ev(`(() => {
  const dlg = document.querySelector('[role="dialog"]')
  const t = [...document.querySelectorAll('div.prose table')][0]
  if (!dlg || !t) return { err: 'no dlg/table' }
  const r = t.getBoundingClientRect(); const dr = dlg.getBoundingClientRect()
  const cs = getComputedStyle(t)
  const row1 = t.rows[1] || t.rows[0]
  const cells = [...row1.cells]
  const tdCs = getComputedStyle(t.querySelector('td,th'))
  return {
    display: cs.display, overflowX: cs.overflowX, maxWidth: cs.maxWidth,
    w: Math.round(r.width), sw: t.scrollWidth, cw: t.clientWidth,
    over: Math.round(r.right - dr.right),
    cellWs: cells.map((c) => Math.round(c.getBoundingClientRect().width)),
    rowH: Math.round(row1.getBoundingClientRect().height),
    tdWhiteSpace: tdCs.whiteSpace, cols: t.rows[0].cells.length
  }
})()`)
ok('正文宽表渲染（5 列）', a.cols === 5, JSON.stringify(a))
ok('正文宽表 display=block', a.display === 'block', a.display)
ok('正文宽表 overflow-x=auto', a.overflowX === 'auto', a.overflowX)
ok('正文宽表 max-width=100%', a.maxWidth === '100%', a.maxWidth)
ok('正文宽表可横向滚动（sw>cw）', a.sw > a.cw, `sw=${a.sw} cw=${a.cw}`)
ok('正文宽表不越出对话框', a.over <= 1, a.over)
ok('正文宽表行高单行（<40px，不再压缩多行）', a.rowH < 40, a.rowH)
ok('正文宽表 td/th white-space=nowrap', a.tdWhiteSpace === 'nowrap', a.tdWhiteSpace)

console.log('场景 B：素材预览宽表可横滚不压缩')
const pv = await ev(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('采集_宽表演示.md'))
  if (!b) return 'no-btn'
  b.click()
  return 'ok'
})()`)
ok('详情「结果」预览入口可点', pv === 'ok', pv)
await sleep(1000)
const bInfo = await ev(`(() => {
  const dlg = document.querySelector('[role="dialog"]')
  const ts = [...document.querySelectorAll('div.prose table')]
  const rows = ts.map((t, i) => {
    const r = t.getBoundingClientRect(); const dr = dlg.getBoundingClientRect()
    const row1 = t.rows[1] || t.rows[0]
    return {
      i, cols: t.rows[0].cells.length,
      sw: t.scrollWidth, cw: t.clientWidth,
      rowH: Math.round(row1.getBoundingClientRect().height),
      over: Math.round(r.right - dr.right)
    }
  })
  return { count: ts.length, rows }
})()`)
ok('预览含正文表 + 素材两表（3 张）', bInfo.count === 3, JSON.stringify(bInfo.rows))
const five = bInfo.rows.find((x) => x.cols === 5 && x.i !== 0)
const three = bInfo.rows.find((x) => x.cols === 3)
ok('素材 5 列宽表可横向滚动', !!five && five.sw > five.cw, JSON.stringify(five))
ok('素材 5 列宽表行高单行', !!five && five.rowH < 40, JSON.stringify(five))
ok('素材 3 列 URL 表可横向滚动', !!three && three.sw > three.cw, JSON.stringify(three))
ok('素材 3 列 URL 表行高单行', !!three && three.rowH < 40, JSON.stringify(three))
ok('预览宽表不越出对话框', bInfo.rows.every((x) => x.over <= 1), JSON.stringify(bInfo.rows))

console.log('场景 C：零 JS 异常')
ok('全场景零 JS 异常', exceptions.length === 0, JSON.stringify(exceptions.slice(0, 5)))

ws.close()
if (fails) { console.log(`FAIL (${fails})`); process.exit(1) }
console.log('ALL PASS')
process.exit(0)
