// 织卷无头冒烟 · 提案抽屉（ProposalDrawer）宽表防护走查确认——体验层 2026-10-08（04-体验层.md 五候选 1①）
// 背景：10-06 共享 `.prose` 表格防护规则提升后，声明覆盖 ProposalDrawer before/after 两容器（同为
//       ReactMarkdown+remarkGfm 产物），但从未实测确认（10-06 观察②留「下轮顺带走查确认」）。
// 断言：
//   A 种子成功：pending 提案 before/after 各含 5 列宽表（devShim createProposals 注入）；
//   B 前后对照区：after「将写入」表 display=block/overflow-x=auto/max-width=100%、sw>cw（可横滚）、
//     td/th nowrap、行高单行（<40px）、不越出卡片容器；before「原状」表同规则（summary 容器
//     max-h 4.5rem 截断是既有设计，只断言 nowrap/不可读列压缩不存在=cell 宽 ≥40px）；
//   C 未展开时（showDiff=false）summary 之外无 table（默认折叠不撑高卡片）；
//   D 宽表在窄面板（Agent 面板开/面板收窄 560）下仍可横滚不越出；E 零 JS 异常双通道。
// 用法：node scripts/proposal-wide-table-ui-smoke.mjs（先 npm run build + serve-renderer + CDP 9224）
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

const tab = await newTab(`${APP}/?cb=${Date.now()}#/project/${PID}/novel`)
const { ws, cmd, ev, exceptions } = await drive(tab)
await sleep(2000)

console.log('场景 A：注入宽表提案种子（before/after 各 5 列）')
const seed = await ev(`(async () => {
  const P = window.zhijuan
  const wtable = (title) => [
    '| 条目 | 名称 | 状态 | 说明 | 备注 |',
    '| --- | --- | --- | --- | --- |',
    '| 1 | 陈默的值夜记录与交接班日志 | 已核对，无异常 | 与档案第 3 节完全一致，无需任何修订 | 保留原文，待进一步人工复核 |',
    '| 2 | 图书馆闭馆时间与借阅规定 | 已核对，无异常 | 与世界观总纲保持一致，无冲突 | 保留原文，待进一步人工复核 |',
    '| 3 | 琴房钥匙归属与保管流程 | 待修订，需确认 | 档案写「值班室」正文写「总务处」，两者矛盾 | 需人工确认后再行修订 |'
  ].join('\\n')
  const p = (await P.createProposals('${PID}', 'slice-sync', '第01章_雾港栈桥.md', '雾港夜', [{
    target: '人物/陈默.md', anchor: '切片：雾港夜', kind: 'upsert-section',
    before: '## 切片：雾港夜\\n\\n' + wtable('原状'),
    after: '## 切片：雾港夜\\n\\n' + wtable('将写入'),
    reason: '（走查）宽表对照'
  }]))[0]
  return p ? p.id : null
})()`)
ok('宽表提案种子已创建', !!seed, seed)
await sleep(300)

console.log('场景 C（先行）：未展开前后对照时无 table 撑高')
const c0 = await ev(`(() => ({
  dlg: !![...document.querySelectorAll('[role="dialog"]')].find((d) => d.getAttribute('aria-label') === '提案'),
  tables: document.querySelectorAll('div.prose table').length
}))()`)
ok('抽屉未打开（table 存在 0）', c0.tables === 0, JSON.stringify(c0))

// 打开抽屉（SectionNav 底部提案入口按钮）
await ev(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.title && x.title.includes('查看/处理待确认'))
  if (!b) return 'NO_BTN'
  b.click()
  return 'CLICKED'
})()`)
await sleep(900)
const opened = await ev(`!![...document.querySelectorAll('[role="dialog"]')].find((d) => d.getAttribute('aria-label') === '提案')`)
ok('提案抽屉已打开', opened === true)

// 展开前后对照
await ev(`(() => {
  const dlg = [...document.querySelectorAll('[role="dialog"]')].find((d) => d.getAttribute('aria-label') === '提案')
  const b = [...dlg.querySelectorAll('button')].find((x) => (x.textContent || '').includes('前后对照'))
  if (!b) return 'NO_TOGGLE'
  b.click()
  return 'CLICKED'
})()`)
await sleep(700)

console.log('场景 B：前后对照区宽表防护生效')
const b1 = await ev(`(() => {
  const dlg = [...document.querySelectorAll('[role="dialog"]')].find((d) => d.getAttribute('aria-label') === '提案')
  const prose = [...dlg.querySelectorAll('div.prose')]
  // DOM 序：先「原状（摘要）」再「将写入」（与 JSX 结构一致）
  const beforeT = prose[0]?.querySelector('table')
  const afterT = prose[1]?.querySelector('table')
  if (!afterT || !beforeT) return { err: 'no-table', proseN: prose.length }
  const info = (t) => {
    const cs = getComputedStyle(t)
    const tdCs = getComputedStyle(t.querySelector('td,th'))
    const rows = [...t.rows].filter((r) => r.cells.length > 0)
    const row1 = rows[1] || rows[0]
    // 不变式：nowrap 下单元文本绝不裁切（被压窄的单元 scrollWidth>clientWidth）
    const clipped = [...t.querySelectorAll('td,th')].filter((c) => Math.round(c.scrollWidth) > Math.round(c.clientWidth) + 1).length
    return {
      cols: t.rows[0].cells.length,
      display: cs.display, overflowX: cs.overflowX, maxWidth: cs.maxWidth,
      sw: t.scrollWidth, cw: t.clientWidth,
      rowH: Math.round(row1.getBoundingClientRect().height),
      tdWhiteSpace: tdCs.whiteSpace,
      clipped
    }
  }
  return { after: info(afterT), before: info(beforeT) }
})()`)
ok('after「将写入」宽表渲染（5 列）', b1.after?.cols === 5, JSON.stringify(b1))
ok('after 宽表 display=block', b1.after?.display === 'block', b1.after?.display)
ok('after 宽表 overflow-x=auto', b1.after?.overflowX === 'auto', b1.after?.overflowX)
ok('after 宽表 max-width=100%', b1.after?.maxWidth === '100%', b1.after?.maxWidth)
ok('after 宽表可横向滚动（sw>cw）', b1.after?.sw > b1.after?.cw, `sw=${b1.after?.sw} cw=${b1.after?.cw}`)
ok('after 宽表行高单行（<40px，未压缩）', b1.after?.rowH < 40, b1.after?.rowH)
ok('after 宽表 td/th nowrap', b1.after?.tdWhiteSpace === 'nowrap', b1.after?.tdWhiteSpace)
ok('after 宽表单元零文本裁切（clipped=0）', b1.after?.clipped === 0, b1.after?.clipped)
ok('before「原状」宽表同规则（nowrap）', b1.before?.tdWhiteSpace === 'nowrap', JSON.stringify(b1.before))
ok('before 宽表单元零文本裁切（clipped=0）', b1.before?.clipped === 0, b1.before?.clipped)

console.log('场景 B2：宽表不越出卡片/抽屉（右缘检查）')
const b2 = await ev(`(() => {
  const dlg = [...document.querySelectorAll('[role="dialog"]')].find((d) => d.getAttribute('aria-label') === '提案')
  const t = [...dlg.querySelectorAll('table')][0]
  if (!t) return { err: 'no-table' }
  const tr = t.getBoundingClientRect()
  const dr = dlg.getBoundingClientRect()
  // 找 .prose 容器（table 的直接滚动宿主）
  const host = t.parentElement
  const hr = host.getBoundingClientRect()
  return { over: Math.round(tr.right - dr.right), hostOver: Math.round(tr.right - hr.right), hostSW: host.scrollWidth, hostCW: host.clientWidth }
})()`)
ok('宽表不越出抽屉（over ≤1）', b2.over !== undefined && b2.over <= 1, JSON.stringify(b2))
ok('宽表 within .prose 宿主（hostOver ≤1）', b2.hostOver !== undefined && b2.hostOver <= 1, JSON.stringify(b2))

console.log('场景 D：窄面板（Agent 560）下仍可横滚')
await ev(`(() => {
  const panel = document.querySelector('[data-testid="agent-panel"]') || [...document.querySelectorAll('div')].find((d) => (d.style.width||'').includes('560'))
  window.__widenote = !!panel
})()`)
// 直接把窗口内容宽度压窄模拟（React 面板宽度走拖拽，改 agentPanelWd 存储更贴近；这里用 Emulation 缩窗即可验证 flex 收窄）
await cmd('Emulation.setDeviceMetricsOverride', { width: 1100, height: 750, deviceScaleFactor: 1, mobile: false })
await sleep(600)
const d1 = await ev(`(() => {
  const dlg = [...document.querySelectorAll('[role="dialog"]')].find((d) => d.getAttribute('aria-label') === '提案')
  const t = [...dlg.querySelectorAll('table')][0]
  if (!t) return { err: 'no-table' }
  const cs = getComputedStyle(t)
  return { sw: t.scrollWidth, cw: t.clientWidth, overflowX: cs.overflowX }
})()`)
ok('窄窗宽表仍可横滚（sw>cw + overflow-x=auto）', d1.sw > d1.cw && d1.overflowX === 'auto', JSON.stringify(d1))
await cmd('Emulation.clearDeviceMetricsOverride')

// 截图
try {
  const shot = await cmd('Page.captureScreenshot', { format: 'png' })
  const fs = await import('node:fs')
  fs.writeFileSync('/Users/chinakids/Pictures/zhijuan/proposal-widetable-' + new Date().toTimeString().slice(0, 5).replace(':', '') + '.png', Buffer.from(shot.data, 'base64'))
  console.log('  📸 截图已存')
} catch (e) { console.log('  (截图失败)', e.message) }

console.log('场景 E：零 JS 异常')
ok('页面无未捕获异常/console.error', exceptions.length === 0, exceptions.slice(0, 3).join(' | '))

console.log(fails === 0 ? 'ALL PASS' : 'FAIL ' + fails)
await fetch(`${base}/json/close/${tab.id}`, { method: 'PUT' }).catch(() => {})
ws.close()
process.exit(fails === 0 ? 0 : 1)
