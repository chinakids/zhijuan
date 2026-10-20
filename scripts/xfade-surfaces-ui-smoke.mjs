// 织卷无头冒烟 · 共享 `.prose` 其余两面横滚渐隐（data-xfade）走查——体验层 2026-10-20（04-体验层.md 五候选 1）
// 背景：2026-10-19 落地 lib/xfade.ts + tokens.css `.prose pre/table[data-xfade]` 最右 28px 渐隐，
//       仅消息流（.agent-prose 继承）已实测（msgflow-xfade-ui-smoke）。CollectionBar（素材预览/任务卡
//       正文）与 ProposalDrawer（前后对照 diff）两面同为 `.prose` 语境，机制上应继承，但从未实测确认。
//       本轮针对这两面做 data-xfade 实测：确可横滚 且 未滚到右端 → 写 data-xfade + mask 渐隐生效；
//       滚到最右端 → data-xfade 移除；无横滚表 → 无 data-xfade（零影响）。
// 种子：devShim 采集池「任务_宽表演示.md」+ 素材库/环境「采集_宽表演示.md」（5 列/3 列宽表）+
//       createProposals 注入 before/after 各含 5 列宽表（与 proposal-wide-table-ui-smoke 同源）。
// 断言语义：
//   A CollectionBar 任务卡正文宽表：出横滚（sw>cw）+ 带 data-xfade + computed mask 渐隐；滚到最右端移除；
//   B CollectionBar 素材预览宽表（5 列与 3 列 URL 表）：出横滚 + 带 data-xfade；
//   C ProposalDrawer 前后对照区 after「将写入」/before「原状」宽表：出横滚 + 带 data-xfade；滚到端移除；
//   D 全部场景零 JS 异常。
// 用法：node scripts/xfade-surfaces-ui-smoke.mjs（先 npm run build + serve out/renderer + CDP 9224）
const base = 'http://127.0.0.1:9224'
const APP = process.env.ZJ_SMOKE_BASE || 'http://127.0.0.1:8899'
const PID = 'demo-aseya'
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
  return { ws, cmd, ev, exceptions }
}
// 探查一个表格：是否出横滚 + 是否带 data-xfade + computed mask
const probeTable = (t) =>
  `(() => { const t = ${t}; if (!t) return null; const cs = getComputedStyle(t); return {
    xfade: t.hasAttribute('data-xfade'), mask: (cs.maskImage || cs.webkitMaskImage || ''),
    sw: t.scrollWidth, cw: t.clientWidth, cols: t.rows[0] ? t.rows[0].cells.length : 0 } })()`

// ─────────────────────── Tab 1：CollectionBar 两面 ───────────────────────
const tab1 = await newTab(`${APP}/?cb=${Date.now()}#/project/${PID}/library`)
const s1 = await drive(tab1)
await sleep(1800)

console.log('场景 A：CollectionBar 任务卡正文宽表 → 出横滚带渐隐')
let a = await s1.ev(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('宽表演示'))
  if (!b) return { err: 'no-chip' }
  b.click(); return { ok: true }
})()`)
ok('采集栏存在「宽表演示」任务卡', a.ok === true, JSON.stringify(a))
await sleep(1000)
// 任务卡详情对话框里的正文宽表
let td = await s1.ev(`(() => {
  const dlg = document.querySelector('[role="dialog"]')
  const t = [...(dlg ? dlg.querySelectorAll('div.prose table') : [])].find((x) => x.scrollWidth > x.clientWidth)
  if (!t) return { err: 'no-scrollable-table' }
  const cs = getComputedStyle(t)
  return { xfade: t.hasAttribute('data-xfade'), mask: (cs.maskImage || cs.webkitMaskImage || ''),
    sw: t.scrollWidth, cw: t.clientWidth, cols: t.rows[0] ? t.rows[0].cells.length : 0 }
})()`)
ok('任务卡正文宽表出横滚（sw>cw）', td.err !== true && td.sw > td.cw, JSON.stringify(td))
ok('任务卡正文宽表带 data-xfade（渐隐信号）', td.xfade === true, JSON.stringify(td))
ok('任务卡正文宽表 mask 渐隐生效', /linear-gradient/.test(td.mask), td.mask)
// 滚到最右端 → data-xfade 移除
await s1.ev(`(() => { const dlg = document.querySelector('[role="dialog"]'); const t = [...(dlg ? dlg.querySelectorAll('div.prose table') : [])].find((x) => x.scrollWidth > x.clientWidth); if (t) t.scrollLeft = 999999; return !!t })()`)
await sleep(400)
let tdEnd = await s1.ev(`(() => { const dlg = document.querySelector('[role="dialog"]'); const t = [...(dlg ? [...dlg.querySelectorAll('div.prose table')] : [])].find((x) => x.scrollWidth > x.clientWidth); return t ? { xfade: t.hasAttribute('data-xfade'), atEnd: t.scrollLeft + t.clientWidth >= t.scrollWidth - 6 } : null })()`)
ok('滚到最右端后 data-xfade 移除', tdEnd && tdEnd.atEnd === true && tdEnd.xfade === false, JSON.stringify(tdEnd))

console.log('场景 B：CollectionBar 素材预览宽表 → 出横滚带渐隐')
let pv = await s1.ev(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('采集_宽表演示.md'))
  if (!b) return { err: 'no-btn' }
  b.click(); return { ok: true }
})()`)
ok('详情「结果」预览入口可点', pv.ok === true, JSON.stringify(pv))
await sleep(1000)
let b1 = await s1.ev(`(() => {
  const dlg = document.querySelector('[role="dialog"]')
  const ts = [...(dlg ? dlg.querySelectorAll('div.prose table') : [])]
  const rows = ts.map((t, i) => { const cs = getComputedStyle(t); return { i, cols: t.rows[0] ? t.rows[0].cells.length : 0,
    sw: t.scrollWidth, cw: t.clientWidth, xfade: t.hasAttribute('data-xfade'), mask: cs.maskImage || cs.webkitMaskImage || '' } })
  return rows
})()`)
ok('预览含正文表 + 素材两表（3 张）', b1.length === 3, JSON.stringify(b1.length))
const scrollables = b1.filter((x) => x.sw > x.cw)
ok('素材/正文宽表均出横滚', scrollables.length >= 2, JSON.stringify(scrollables))
ok('预览宽表均带 data-xfade', scrollables.every((x) => x.xfade === true), JSON.stringify(scrollables))
ok('预览宽表 mask 渐隐生效', scrollables.every((x) => /linear-gradient/.test(x.mask)), JSON.stringify(scrollables))
await fetch(`${base}/json/close/${tab1.id}`, { method: 'PUT' }).catch(() => {})
s1.ws.close()

// ─────────────────────── Tab 2：ProposalDrawer 前后对照 ───────────────────────
const tab2 = await newTab(`${APP}/?cb=${Date.now()}#/project/${PID}/novel`)
const s2 = await drive(tab2)
await sleep(2000)

console.log('场景 C：ProposalDrawer 前后对照宽表 → 出横滚带渐隐')
const seed = await s2.ev(`(async () => {
  const P = window.zhijuan
  const NL = String.fromCharCode(10)
  const wtable = () => [
    '| 条目 | 名称 | 状态 | 说明 | 备注 |',
    '| --- | --- | --- | --- | --- |',
    '| 1 | 陈默的值夜记录与交接班日志 | 已核对，无异常 | 与档案第 3 节完全一致，无需任何修订 | 保留原文，待进一步人工复核 |',
    '| 2 | 图书馆闭馆时间与借阅规定 | 已核对，无异常 | 与世界观总纲保持一致，无冲突 | 保留原文，待进一步人工复核 |',
    '| 3 | 琴房钥匙归属与保管流程 | 待修订，需确认 | 档案写「值班室」正文写「总务处」，两者矛盾 | 需人工确认后再行修订 |'
  ].join(NL)
  const p = (await P.createProposals('${PID}', 'slice-sync', '第01章_雾港栈桥.md', '雾港夜', [{
    target: '人物/陈默.md', anchor: '切片：雾港夜', kind: 'upsert-section',
    before: '## 切片：雾港夜' + NL + NL + wtable(),
    after: '## 切片：雾港夜' + NL + NL + wtable(),
    reason: '（走查）宽表对照'
  }]))[0]
  return p ? p.id : null
})()`)
ok('宽表提案种子已创建', !!seed, seed)
await sleep(300)
// 打开抽屉 + 展开前后对照
await s2.ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.title && x.title.includes('查看/处理待确认')); if (b) b.click(); return !!b })()`)
await sleep(900)
await s2.ev(`(() => { const dlg = [...document.querySelectorAll('[role="dialog"]')].find((d) => d.getAttribute('aria-label') === '提案'); const b = [...(dlg ? dlg.querySelectorAll('button') : [])].find((x) => (x.textContent || '').includes('前后对照')); if (b) b.click(); return !!b })()`)
await sleep(800)
let c1 = await s2.ev(`(() => {
  const dlg = [...document.querySelectorAll('[role="dialog"]')].find((d) => d.getAttribute('aria-label') === '提案')
  const prose = [...(dlg ? dlg.querySelectorAll('div.prose') : [])]
  const beforeT = prose[0]?.querySelector('table')
  const afterT = prose[1]?.querySelector('table')
  const info = (t) => { if (!t) return null; const cs = getComputedStyle(t); return { xfade: t.hasAttribute('data-xfade'),
    mask: cs.maskImage || cs.webkitMaskImage || '', sw: t.scrollWidth, cw: t.clientWidth, cols: t.rows[0] ? t.rows[0].cells.length : 0 } }
  return { after: info(afterT), before: info(beforeT) }
})()`)
ok('before「原状」宽表出横滚', c1.before && c1.before.sw > c1.before.cw, JSON.stringify(c1.before))
ok('before 宽表带 data-xfade', c1.before && c1.before.xfade === true, JSON.stringify(c1.before))
ok('before 宽表 mask 渐隐生效', c1.before && /linear-gradient/.test(c1.before.mask), c1.before && c1.before.mask)
ok('after「将写入」宽表出横滚', c1.after && c1.after.sw > c1.after.cw, JSON.stringify(c1.after))
ok('after 宽表带 data-xfade', c1.after && c1.after.xfade === true, JSON.stringify(c1.after))
ok('after 宽表 mask 渐隐生效', c1.after && /linear-gradient/.test(c1.after.mask), c1.after && c1.after.mask)
// 滚到最右端 → data-xfade 移除（after 表）
await s2.ev(`(() => { const dlg = [...document.querySelectorAll('[role="dialog"]')].find((d) => d.getAttribute('aria-label') === '提案'); const prose = [...(dlg ? dlg.querySelectorAll('div.prose') : [])]; const t = prose[1]?.querySelector('table'); if (t) t.scrollLeft = 999999; return !!t })()`)
await sleep(400)
let cEnd = await s2.ev(`(() => { const dlg = [...document.querySelectorAll('[role="dialog"]')].find((d) => d.getAttribute('aria-label') === '提案'); const prose = [...(dlg ? dlg.querySelectorAll('div.prose') : [])]; const t = prose[1]?.querySelector('table'); return t ? { xfade: t.hasAttribute('data-xfade'), atEnd: t.scrollLeft + t.clientWidth >= t.scrollWidth - 6 } : null })()`)
ok('after 滚到最右端后 data-xfade 移除', cEnd && cEnd.atEnd === true && cEnd.xfade === false, JSON.stringify(cEnd))

// 截图留存
try {
  const shot = await s2.cmd('Page.captureScreenshot', { format: 'png' })
  const fs = await import('node:fs')
  fs.writeFileSync('/Users/chinakids/Pictures/zhijuan/xfade-surfaces-' + new Date().toTimeString().slice(0, 5).replace(':', '') + '.png', Buffer.from(shot.data, 'base64'))
  console.log('  📸 截图已存')
} catch (e) { console.log('  (截图失败)', e.message) }

console.log('场景 D：零 JS 异常')
ok('全场景零 JS 异常', s1.exceptions.length === 0 && s2.exceptions.length === 0,
  JSON.stringify([...s1.exceptions, ...s2.exceptions].slice(0, 5)))

await fetch(`${base}/json/close/${tab2.id}`, { method: 'PUT' }).catch(() => {})
s2.ws.close()
console.log(fails === 0 ? '\nALL PASS' : `\nFAILS: ${fails}`)
process.exit(fails === 0 ? 0 : 1)
