// 织卷无头冒烟 · 消息流宽表溢出防护——体验层 2026-10-05（04-体验层.md 五候选 1）
// 背景：模型回复的 4+ 列对比/结构表在窄面板被压到容器宽——实测 320 面板「人物」列仅 28px、
//       长单元格 72 字挤 8 行竖排（computedStyle 取证 cellWs [28,40,38,139]/rowH 141），
//       表格信息完全不可读（对比「排版演示」3 列表在容器内本就不溢出——非溢出问题，是压缩问题）。
// 调研：GitHub 官方 markdown CSS 先例（sindresorhus/github-markdown-css L333，gh api 实抓
//       raw：display:block+width:max-content+max-width:100%+overflow:auto），但本环境 Chromium
//       对照实验（4 列中文内容 ×5 组宽度组合）实锤：max-width:100% 触发列压缩使该组合失效，
//       必须叠加 td/th white-space:nowrap 锁列宽才出现横向滚动（scrollWidth 1084>clientWidth 245）。
// 落地：tokens.css `.agent-prose table`（display:block+width:max-content+max-width:100%+overflow-x:auto）
//       + `.agent-prose th,.agent-prose td { white-space:nowrap }`——宽表出横向滚动、列单行可读，
//       3 列表内容短则自然宽<容器、零滚动零影响；作用域仅消息流（.agent-prose），共享 .prose 零影响。
// 种子：devShim「宽表演示」触发词（4 列人物对照表 + 长 URL 表）；「排版演示」3 列表种子保持不动。
// 断言语义：
//   A 默认宽（320）：宽表 display=block/overflow-x=auto/max-width=100%、scrollWidth>clientWidth（可横滚）、
//     不破气泡、列宽恢复（首列≥34px）+行高单行（<40px，不再 141px 竖排）、td/th nowrap；
//   B 窄面板（280 min）：同上核心断言（可横滚+不破气泡+列宽保持）；
//   C 宽表之后发「排版演示」：3 列表零滚动（sw<=cw+1）零越界（over<=1）、行高单行；
//   全场景零 JS 异常。
// 用法：node scripts/msgflow-wide-table-ui-smoke.mjs（先 npm run build + serve-renderer + CDP 9224）
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
  const sendMsg = async (text) => {
    await ev(`(() => { const t = document.querySelector('textarea'); if (t) { t.focus(); return true } return false })()`)
    await cmd('Input.insertText', { text })
    await ev(`(() => { const t = document.querySelector('textarea'); if (!t) return false; t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); return true })()`)
  }
  const waitIdle = async () => {
    for (let i = 0; i < 200; i++) {
      await sleep(300)
      const busy = await ev(
        `!!document.querySelector('button[title="停止生成"]') || !!document.querySelector('button[title^="停止导演任务"]')`
      )
      if (!busy && i > 1) break
    }
    await sleep(600)
  }
  const tableInfo = (idx) =>
    ev(`(() => {
      const b = [...document.querySelectorAll('div.prose.agent-prose')].pop()
      if (!b) return { err: 'no agent-prose' }
      const ts = [...b.querySelectorAll('table')]
      const t = ts[${idx}]
      if (!t) return { err: 'no table ' + ${idx} + ' (count=' + ts.length + ')' }
      const bubble = b.closest('.rounded-xl')
      const br = bubble.getBoundingClientRect()
      const r = t.getBoundingClientRect()
      const cs = getComputedStyle(t)
      const firstRowCells = t.rows[1] ? [...t.rows[1].cells] : [...t.rows[0].cells]
      const tdCs = t.querySelector('td,th') ? getComputedStyle(t.querySelector('td,th')) : null
      return {
        display: cs.display, overflowX: cs.overflowX, maxWidth: cs.maxWidth,
        w: Math.round(r.width), sw: t.scrollWidth, cw: t.clientWidth,
        over: Math.round(r.right - br.right), bubbleW: Math.round(br.width),
        cellWs: firstRowCells.map((c) => Math.round(c.getBoundingClientRect().width)),
        rowH: Math.round((t.rows[1] || t.rows[0]).getBoundingClientRect().height),
        tdWhiteSpace: tdCs ? tdCs.whiteSpace : null,
        cols: t.rows[0].cells.length
      }
    })()`)
  // ---------- 场景 A：默认宽 320 · 宽表演示 ----------
  console.log('场景 A：默认面板宽（320）· 宽表可横滚不压缩')
  await sendMsg('宽表演示')
  await waitIdle()
  const a1 = await tableInfo(0)
  const a2 = await tableInfo(1)
  ok('宽表1 渲染（4 列）', a1.cols === 4, JSON.stringify(a1))
  ok('宽表1 display=block', a1.display === 'block', a1.display)
  ok('宽表1 overflow-x=auto', a1.overflowX === 'auto', a1.overflowX)
  ok('宽表1 max-width=100%', a1.maxWidth === '100%', a1.maxWidth)
  ok('宽表1 可横向滚动（sw>cw）', a1.sw > a1.cw, `sw=${a1.sw} cw=${a1.cw}`)
  ok('宽表1 不破气泡', a1.over <= 1, a1.over)
  ok('宽表1 列宽恢复（首列≥34px，不再 28px 竖排）', Math.min(...a1.cellWs) >= 34, JSON.stringify(a1.cellWs))
  ok('宽表1 行高单行（<40px，不再 141px 竖排）', a1.rowH < 40, a1.rowH)
  ok('宽表1 td/th white-space=nowrap', a1.tdWhiteSpace === 'nowrap', a1.tdWhiteSpace)
  ok('宽表2（URL）可横向滚动', a2.sw > a2.cw, `sw=${a2.sw} cw=${a2.cw}`)
  ok('宽表2 不破气泡', a2.over <= 1, a2.over)
  // ---------- 场景 B：窄面板 280 ----------
  console.log('场景 B：窄面板（280 = min）')
  await ev(`window.zhijuan?.setSettings?.({ agentPanelWidth: 280 })`)
  await sleep(300)
  await cmd('Page.reload', { ignoreCache: true })
  await sleep(3500)
  await sendMsg('宽表演示')
  await waitIdle()
  const b1 = await tableInfo(0)
  ok('窄面板宽表可横向滚动', b1.sw > b1.cw, `sw=${b1.sw} cw=${b1.cw}`)
  ok('窄面板宽表不破气泡', b1.over <= 1, b1.over)
  ok('窄面板宽表列宽保持（首列≥34px）', Math.min(...b1.cellWs) >= 34, JSON.stringify(b1.cellWs))
  ok('窄面板宽表行高单行', b1.rowH < 40, b1.rowH)
  // ---------- 场景 C：宽表后发「排版演示」3 列表零回归 ----------
  console.log('场景 C：3 列表（既有「排版演示」种子）零回归')
  await sendMsg('排版演示')
  await waitIdle()
  const c = await tableInfo(0)
  ok('3 列表渲染', c.cols === 3, JSON.stringify(c))
  ok('3 列表零滚动（sw<=cw+1）', c.sw <= c.cw + 1, `sw=${c.sw} cw=${c.cw}`)
  ok('3 列表不破气泡', c.over <= 1, c.over)
  ok('3 列表行高单行', c.rowH < 40, c.rowH)
  ok('零 JS 异常', exceptions.length === 0, exceptions.slice(0, 3).join(' | '))
  ws.close()
  return { exceptions, final: fails }
}
const tab = await newTab(`${APP}/?cb=${Date.now()}&zj-agent-delay=60#/project/demo-aseya/novel`)
await sleep(3500)
await drive(tab)
await fetch(`${base}/json/close/${tab.id}`)
console.log(fails === 0 ? '\nALL PASS' : `\nFAILS: ${fails}`)
process.exit(fails === 0 ? 0 : 1)
