// 织卷无头冒烟 · 消息流 markdown 排版走查——体验层 2026-10-04（04-体验层.md 五候选 1）
// 背景：Agent 回复区（ReactMarkdown 渲染）的标题层级/段落间距/代码块字排从未按 HIG Typography
//       走查——实测三个实缺口：①pre 内 code 双重缩小（0.85em×0.9em=9.9px，低于可读线）；
//       ②h2/h3 与正文同字号（区分仅靠 600 字重）；③段距 0.4em=5.2px < 行距 21px（HIG 长文 loose leading）。
// 调研：HIG Typography（developer.apple.com/design/human-interface-guidelines/typography，2026-10-04 CDP 实抓）：
//       「when you display text in wide columns or long passages, more space between lines (loose leading)」+
//       「convey an information hierarchy」+「Use font sizes that most people can read easily」。
// 落地：消息流 .prose 追加 .agent-prose 作用域（tokens.css）：h1 1.35em/h2 1.15em/h3 1.05em、
//       p & ul/ol margin 0.65em、li 0.25em、pre code font-size 1em（修双重缩小）；
//       共享 .prose 的 CollectionBar 等零影响（作用域限定）。
// 种子：devShim「排版演示」触发词（长文/列表/代码块/引用/标题/表格/长英文词，2026-10-04 新增）。
// 断言语义：
//   A 默认宽（320）：标题层级单调（h1>h2>h3>正文）、p 段距≥8px、li 间距≥3px、
//     pre code=pre 字号（11.05px，不再双重缩小）、行内 code 保持 0.9em（11.7px）、
//     表格在气泡内无横向溢出、零 JS 异常；
//   B 窄面板（280 min）：气泡不越出面板、pre 代码块可横滚（scrollWidth>clientWidth 且不破气泡）、
//     正文/标题全部断行（无元素超出气泡右缘）、零 JS 异常。
// 用法：node scripts/msgflow-layout-ui-smoke.mjs（先 npm run build + serve-renderer + CDP 9224）
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
  const styles = () =>
    ev(`(() => {
      const cs = (el) => getComputedStyle(el)
      const parse = (v) => parseFloat(v)
      const b = [...document.querySelectorAll('div.prose.agent-prose')].pop()
      if (!b) return { err: 'no agent-prose' }
      const q = (s) => b.querySelector(s)
      const d = (s) => { const el = q(s); return el ? { fs: parse(cs(el).fontSize), lh: parse(cs(el).lineHeight), m: parse(cs(el).marginBottom) } : null }
      const bubble = b.closest('.rounded-xl')
      const inner = (el) => { const r = el.getBoundingClientRect(); const br = bubble.getBoundingClientRect(); return { right: r.right - br.right, w: r.width } }
      return {
        h1: d('h1'), h2: d('h2'), h3: d('h3'), p: d('p'),
        ul: d('ul'), li: d('li'), ol: d('ol'),
        pre: d('pre'), preCode: d('pre code'),
        inlineCode: (() => { const c = [...b.querySelectorAll('code')].find((x) => !x.closest('pre')); return c ? { fs: parse(cs(c).fontSize) } : null })(),
        table: (() => { const t = q('table'); if (!t) return null; const r = t.getBoundingClientRect(); const br = bubble.getBoundingClientRect(); return { w: r.width, over: r.right - br.right, bubbleW: br.width } })(),
        overflowRight: inner(b).right,
        bubbleW: bubble.getBoundingClientRect().width,
        panelW: document.querySelector('[aria-valuenow]') ? null : null
      }
    })()`)
  // ---------- 场景 A：默认宽 320 ----------
  console.log('场景 A：默认面板宽（320）· markdown 元素字排')
  await sendMsg('排版演示')
  await waitIdle()
  const a = await styles()
  ok('agent-prose 渲染', !a.err, JSON.stringify(a))
  if (a.err) return { exceptions, final: fails }
  ok('h1=17.55px(1.35em)', a.h1 && Math.abs(a.h1.fs - 17.55) < 0.5, a.h1?.fs)
  ok('h2=14.95px(1.15em)', a.h2 && Math.abs(a.h2.fs - 14.95) < 0.5, a.h2?.fs)
  ok('h3=13.65px(1.05em)', a.h3 && Math.abs(a.h3.fs - 13.65) < 0.5, a.h3?.fs)
  ok('标题层级单调', a.h1.fs > a.h2.fs && a.h2.fs > a.h3.fs && a.h3.fs > 13)
  ok('p 段距≥8px（0.65em）', a.p && a.p.m >= 8, a.p?.m)
  ok('ul/ol 段距≥8px', a.ul && a.ol && a.ul.m >= 8 && a.ol.m >= 8, `${a.ul?.m}/${a.ol?.m}`)
  ok('li 间距≥3px（0.25em）', a.li && a.li.m >= 3, a.li?.m)
  ok('pre=11.05px(0.85em 保持)', a.pre && Math.abs(a.pre.fs - 11.05) < 0.3, a.pre?.fs)
  ok('pre code 不再双重缩小(=pre)', a.preCode && Math.abs(a.preCode.fs - a.pre.fs) < 0.2, a.preCode?.fs)
  ok('行内 code 保持 0.9em', a.inlineCode && Math.abs(a.inlineCode.fs - 11.7) < 0.3, a.inlineCode?.fs)
  ok('表格在气泡内无横向溢出', a.table && a.table.over <= 1, JSON.stringify(a.table))
  ok('回复体不越出气泡右缘', a.overflowRight <= 1, a.overflowRight)
  // ---------- 场景 B：窄面板 280 ----------
  console.log('场景 B：窄面板（280 = min）')
  await ev(`window.zhijuan?.setSettings?.({ agentPanelWidth: 280 })`)
  await sleep(300)
  await cmd('Page.reload', { ignoreCache: true })
  await sleep(3500)
  await sendMsg('排版演示')
  await waitIdle()
  const b = await styles()
  ok('窄面板回复体不越出气泡右缘', !b.err && b.overflowRight <= 1, b.overflowRight)
  ok('窄面板表格不越出气泡', b.table && b.table.over <= 1, JSON.stringify(b.table))
  ok('窄面板标题层级单调', b.h1 && b.h1.fs > b.h2.fs && b.h2.fs > b.h3.fs)
  ok('窄面板 pre 可横滚不破气泡（scrollWidth>可见宽）', await ev(`(() => {
    const pre = [...document.querySelectorAll('div.prose.agent-prose')].pop()?.querySelector('pre')
    if (!pre) return false
    const br = pre.closest('.rounded-xl').getBoundingClientRect()
    return pre.scrollWidth > pre.clientWidth && pre.getBoundingClientRect().right <= br.right + 1
  })()`))
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
