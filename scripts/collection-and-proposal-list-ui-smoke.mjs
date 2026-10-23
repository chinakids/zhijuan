// 织卷无头冒烟 · CollectionBar 任务卡/素材预览 与 ProposalDrawer 提案 diff 的列表标记走查确认——
// 体验层 2026-10-23（04-体验层.md 五候选 1）
// 背景：10-22 在共享 `.prose` 基座恢复 ol/ul list-style（disc/decimal）+ gfm 任务清单规则后，
//       实测与验证均只在消息流（.agent-prose 经继承生效）——共享 `.prose` 的 CollectionBar
//       （任务卡正文 max-h-[30vh] + 素材只读预览）与 ProposalDrawer（before/after diff）同为
//       ReactMarkdown+remarkGfm 产物，populate 同一 gfm/有序/嵌套列表时是否同样呈现圆点/序号
//       标记、checkbox 间距、嵌套缩进，尚未实测确认（与 2026-10-20 xfade-surfaces 同先例）。
// 种子：devShim demo-aseya 采集池「任务_清单演示.md」+ 素材库/环境/采集_清单演示.md（含 gfm 任务清单
//       嵌套/有序列表/普通圆点列表/超长列表项+块引用）；提案 diff 由本冒烟运行时注入列表内容。
// 断言语义：
//   A 任务卡详情正文：ul.contains-task-list list-style=none（checkbox 取代圆点）、checkbox 右边距>0、
//     有序 ol list-style=decimal（序号恢复）、存在嵌套列表且嵌套缩进≥8px、不越出对话框；
//   B 素材只读预览：普通圆点 ul list-style=disc、嵌套缩进≥8px、有序 ol decimal、任务清单 checkbox 有间距、
//     不越出预览容器；
//   C 提案 before/after diff：after「将写入」列表标记正确（ol decimal / ul disc / 任务清单 checkbox 间距）、
//     嵌套缩进、不越出卡片；
//   D 全场景零 JS 异常（双通道）。
// 用法：node scripts/collection-and-proposal-list-ui-smoke.mjs（先 npm run build + serve-renderer + CDP 9224）
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

const tab = await newTab(`${APP}/?cb=${Date.now()}#/project/${PID}/library`)
const { ws, cmd, ev, exceptions } = await drive(tab)
await sleep(1800)

// 列表标记核对的通用读法
const listProbe = `(proseRoot) => {
  const cs = (el) => el ? getComputedStyle(el).listStyleType : null
  const ulTask = [...proseRoot.querySelectorAll('ul.contains-task-list')][0]
  const cb = [...proseRoot.querySelectorAll('input[type=checkbox]')][0]
  const olOuter = [...proseRoot.querySelectorAll('ol')].find((o) => !o.closest('li'))
  const plainUl = [...proseRoot.querySelectorAll('ul')].find((u) => !u.classList.contains('contains-task-list'))
  const nestedLi = [...proseRoot.querySelectorAll('li')].find((li) => li.querySelector(':scope > ul, :scope > ol'))
  let nestedIndent = null
  if (nestedLi) {
    let child = nestedLi.querySelector(':scope > ul, :scope > ol')
    let top = child
    while (top.parentElement?.closest('ul,ol')) top = top.parentElement.closest('ul,ol')
    nestedIndent = Math.round(child.getBoundingClientRect().left - top.getBoundingClientRect().left)
  }
  const out = proseRoot.getBoundingClientRect()
  let maxRight = 0
  proseRoot.querySelectorAll('*').forEach((el) => { const r = el.getBoundingClientRect(); if (r.right > maxRight) maxRight = r.right })
  return {
    ulTaskListStyle: cs(ulTask), cbMR: cb ? Math.round(parseFloat(getComputedStyle(cb).marginRight) * 100) / 100 : null,
    olListStyle: cs(olOuter), olCount: proseRoot.querySelectorAll('ol').length,
    plainUlListStyle: cs(plainUl), hasNested: !!nestedLi, nestedIndent,
    over: Math.round(maxRight - out.right)
  }
}`

console.log('场景 A：任务卡详情正文列表标记')
const chip = await ev(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('清单演示'))
  if (!b) return 'no-chip'
  b.click(); return 'ok'
})()`)
ok('采集栏存在「清单演示」任务卡', chip === 'ok', chip)
await sleep(900)
const a = await ev(`(() => {
  const dlg = [...document.querySelectorAll('[role="dialog"]')].find((d) => (d.textContent || '').includes('采集任务：清单演示'))
  const body = dlg && [...dlg.querySelectorAll('div.prose')].find((p) => (p.textContent || '').includes('采集任务：清单演示'))
  if (!body) return { err: 'no-task-body', dlg: !!dlg }
  const probe = ${listProbe}
  return probe(body)
})()`)
ok('任务卡 gfm 任务清单 ul list-style=none', a.ulTaskListStyle === 'none', JSON.stringify(a))
ok('任务卡 checkbox 有右边距（>0）', a.cbMR !== null && a.cbMR > 0, a.cbMR)
ok('任务卡有序 ol list-style=decimal（序号恢复）', a.olListStyle === 'decimal', a.olListStyle)
ok('任务卡存在嵌套列表', a.hasNested === true)
ok('任务卡嵌套缩进 ≥8px', a.nestedIndent !== null && a.nestedIndent >= 8, a.nestedIndent)
ok('任务卡正文不越出对话框', a.over !== undefined && a.over <= 2, a.over)

console.log('场景 B：素材只读预览列表标记')
const pv = await ev(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('采集_清单演示.md'))
  if (!b) return 'no-btn'
  b.click(); return 'ok'
})()`)
ok('详情「结果」预览入口可点', pv === 'ok', pv)
await sleep(1000)
const bInfo = await ev(`(() => {
  const dlg = [...document.querySelectorAll('[role="dialog"]')].find((d) => (d.textContent || '').includes('清单演示素材'))
  const prev = dlg && [...dlg.querySelectorAll('div.prose')].find((p) => (p.textContent || '').includes('清单演示素材'))
  if (!prev) return { err: 'no-preview', dlg: !!dlg }
  const probe = ${listProbe}
  return probe(prev)
})()`)
ok('素材预览普通圆点 ul list-style=disc', bInfo.plainUlListStyle === 'disc', JSON.stringify(bInfo))
ok('素材预览存在嵌套列表', bInfo.hasNested === true)
ok('素材预览嵌套缩进 ≥8px', bInfo.nestedIndent !== null && bInfo.nestedIndent >= 8, bInfo.nestedIndent)
ok('素材预览有序 ol decimal', bInfo.olListStyle === 'decimal', bInfo.olListStyle)
ok('素材预览任务清单 checkbox 有间距', bInfo.cbMR !== null && bInfo.cbMR > 0, bInfo.cbMR)
ok('素材预览不越出容器', bInfo.over !== undefined && bInfo.over <= 2, bInfo.over)

console.log('场景 C：提案 before/after diff 列表标记')
const seed = await ev(`(async () => {
  const P = window.zhijuan
  const lists = '## 核对清单\\n\\n- [x] 检查第01章灯塔灯语\\n- [ ] 核对船票编号 A-077\\n\\n### 待办顺序\\n\\n1. 先重读第03章设定\\n2. 再核对称谓\\n   1. 检查「沈爷」\\n   2. 记录偏差\\n\\n- 圆点：码头\\n  - 次级：修船坞、旧灯塔'
  const p = (await P.createProposals('${PID}', 'slice-sync', '第01章_雾港栈桥.md', '雾港夜', [{
    target: '人物/陈默.md', anchor: '切片：雾港夜', kind: 'upsert-section',
    before: '## 切片：雾港夜\\n\\n旧文本段落。',
    after: '## 切片：雾港夜\\n\\n' + lists,
    reason: '（走查）列表标记对照'
  }]))[0]
  return p ? p.id : null
})()`)
ok('列表提案种子已创建', !!seed, seed)
await sleep(400)
await ev(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.title && x.title.includes('查看/处理待确认'))
  if (!b) return 'NO_BTN'
  b.click(); return 'CLICKED'
})()`)
await sleep(900)
const opened = await ev(`!![...document.querySelectorAll('[role="dialog"]')].find((d) => d.getAttribute('aria-label') === '提案')`)
ok('提案抽屉已打开', opened === true)
await ev(`(() => {
  const dlg = [...document.querySelectorAll('[role="dialog"]')].find((d) => d.getAttribute('aria-label') === '提案')
  const t = [...dlg.querySelectorAll('button')].find((x) => (x.textContent || '').includes('前后对照'))
  if (!t) return 'NO_TOGGLE'
  t.click(); return 'CLICKED'
})()`)
await sleep(700)
const c = await ev(`(() => {
  const dlg = [...document.querySelectorAll('[role="dialog"]')].find((d) => d.getAttribute('aria-label') === '提案')
  const prose = [...dlg.querySelectorAll('div.prose')]
  const after = prose.find((p) => (p.textContent || '').includes('待办顺序'))
  if (!after) return { err: 'no-after', proseN: prose.length }
  const probe = ${listProbe}
  return probe(after)
})()`)
ok('提案 after 列表标记存在（ol decimal）', c.olListStyle === 'decimal', JSON.stringify(c))
ok('提案 after 任务清单 checkbox 有间距', c.cbMR !== null && c.cbMR > 0, c.cbMR)
ok('提案 after 存在嵌套列表', c.hasNested === true)
ok('提案 after 嵌套缩进 ≥8px', c.nestedIndent !== null && c.nestedIndent >= 8, c.nestedIndent)
ok('提案 after 不越出卡片', c.over !== undefined && c.over <= 2, c.over)

console.log('场景 D：零 JS 异常')
ok('全场景零 JS 异常', exceptions.length === 0, JSON.stringify(exceptions.slice(0, 5)))

// 截图
try {
  const shot = await cmd('Page.captureScreenshot', { format: 'png' })
  const fs = await import('node:fs')
  fs.mkdirSync('/Users/chinakids/Pictures/zhijuan', { recursive: true })
  fs.writeFileSync('/Users/chinakids/Pictures/zhijuan/collection-proposal-list-' + new Date().toTimeString().slice(0, 5).replace(':', '') + '.png', Buffer.from(shot.data, 'base64'))
  console.log('  📸 截图已存')
} catch (e) { console.log('  (截图失败)', e.message) }

await fetch(`${base}/json/close/${tab.id}`, { method: 'PUT' }).catch(() => {})
ws.close()
process.exit(fails === 0 ? 0 : 1)
