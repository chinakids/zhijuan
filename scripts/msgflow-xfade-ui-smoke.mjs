// 织卷无头冒烟 · 横向可滚动渐隐提示（data-xfade）——体验层 2026-10-19（04-体验层.md 五候选 1）
// 背景：代码块/宽表在 .prose 语境出横向滚动（overflow-x:auto，2026-10-05/06 已做宽表防护）时，macOS overlay
//       滚动条无可视提示——作者见内容「截断」又不知可横滚。本轮落地 HIG Scroll views「Make it apparent when
//       content is scrollable」：lib/xfade.ts 按需给滚动容器写 data-xfade，CSS 最右 28px 渐隐提示可横滚。
// 种子：devShim「长码演示」（超长单行代码→pre 出横滚）/「宽表演示」（4 列长表→table 出横滚）/「排版演示」
//       （3 列表与短代码块不出横滚=零影响对照）。
// 断言语义：A「长码演示」pre 出横滚且带 data-xfade + computed mask-image（渐隐生效）；滚到最右端 data-xfade 移除；
//           B「宽表演示」table 出横滚带 data-xfade；C「排版演示」3 列表/短代码块不出横滚且无 data-xfade（零影响）；
//           零 JS 异常。
// 用法：node scripts/msgflow-xfade-ui-smoke.mjs（先 npm run build + serve out/renderer + CDP 9224）
const base = 'http://127.0.0.1:9224'
const APP = process.env.ZJ_APP || 'http://127.0.0.1:8123'
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
  // 最后一个 assistant 消息正文容器
  const lastBody = `[...document.querySelectorAll('div.prose.agent-prose')].pop()`
  const readPre = () => ev(`(() => {
    const b = ${lastBody}; if (!b) return { err: 'no agent-prose' }
    const pre = b.querySelector('pre'); if (!pre) return { err: 'no pre' }
    const cs = getComputedStyle(pre)
    return { dataXfade: pre.hasAttribute('data-xfade'), mask: (cs.maskImage || cs.webkitMaskImage || ''),
      scrollW: pre.scrollWidth, clientW: pre.clientWidth, scrollLeft: pre.scrollLeft }
  })()`)
  const readTable = () => ev(`(() => {
    const b = ${lastBody}; if (!b) return { err: 'no agent-prose' }
    const tbl = [...b.querySelectorAll('table')].find((x) => x.scrollWidth > x.clientWidth) || b.querySelector('table')
    if (!tbl) return { err: 'no table' }
    return { dataXfade: tbl.hasAttribute('data-xfade'), scrollW: tbl.scrollWidth, clientW: tbl.clientWidth }
  })()`)

  console.log('场景 A：长码演示 → pre 出横滚带渐隐')
  await sendMsg('长码演示')
  await waitIdle()
  let a = await readPre()
  ok('pre 存在', !a.err, JSON.stringify(a))
  if (!a.err) {
    ok('pre 出横滚 scrollWidth>clientWidth', a.scrollW > a.clientW, `${a.scrollW}/${a.clientW}`)
    ok('pre 带 data-xfade（渐隐信号）', a.dataXfade === true, JSON.stringify(a))
    ok('mask-image 渐隐生效', /linear-gradient/.test(a.mask), a.mask)
    // 滚到最右端 → data-xfade 移除
    await ev(`${lastBody}?.querySelector('pre')?.scrollTo({ left: 99999 })`)
    await sleep(300)
    const aEnd = await readPre()
    ok('滚到最右端后 data-xfade 移除', aEnd.dataXfade === false, JSON.stringify(aEnd))
  }

  console.log('场景 B：宽表演示 → table 出横滚带渐隐')
  await sendMsg('宽表演示')
  await waitIdle()
  let bt = await readTable()
  ok('table 存在', !bt.err, JSON.stringify(bt))
  if (!bt.err) {
    ok('宽表出横滚 scrollWidth>clientWidth', bt.scrollW > bt.clientW, `${bt.scrollW}/${bt.clientW}`)
    ok('宽表带 data-xfade', bt.dataXfade === true, JSON.stringify(bt))
  }

  console.log('场景 C：排版演示 → 3 列表零影响（无 data-xfade）· 代码块出横滚则正确带渐隐')
  // 注：agent 面板 max=560（uiPrefs AGENT_PANEL_MAX_WIDTH），排版演示的代码行 ~614px 恒出横滚=正确带 data-xfade；
  //     真正「不出横滚」的零影响对照=3 列表（内容短，fit 于面板，应无 data-xfade）。
  await sendMsg('排版演示')
  await waitIdle()
  const c = await ev(`(() => {
    const b = ${lastBody}; if (!b) return { err: 'no agent-prose' }
    const pre = b.querySelector('pre')
    const shortTable = b.querySelector('table')
    const probe = (el) => el ? { over: el.scrollWidth > el.clientWidth, xfade: el.hasAttribute('data-xfade') } : null
    return { pre: probe(pre), table: probe(shortTable) }
  })()`)
  ok('agent-prose 渲染', !c.err, JSON.stringify(c))
  if (!c.err) {
    ok('代码块出横滚则正确带 data-xfade', c.pre && (c.pre.over === false ? c.pre.xfade === false : c.pre.xfade === true), JSON.stringify(c.pre))
    ok('3 列表不出横滚（零影响）', c.table && c.table.over === false, JSON.stringify(c.table))
    ok('3 列表无 data-xfade', c.table && c.table.xfade === false, JSON.stringify(c.table))
  }

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
