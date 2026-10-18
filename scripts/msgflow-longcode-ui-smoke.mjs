// 织卷无头冒烟 · 消息流代码块/行内代码/引用块窄窗与长码走查——体验层 2026-10-18（04-体验层.md 五候选 1）
// 背景：消息流排版（10-04 msgflow-layout）已管 h1-h3/段距/引用行距与 pre 双重缩小，但 pre>code 长单行代码、
//       行内 code 长 token、blockquote 长段落三者未单独做过窄窗（320/280）与超长内容走查——模型常给代码片段/
//       格式示例，超长单行代码或窄面板是否被压成竖排/水平裁切/越界未见实测。
// 调研：HIG Scroll views「overflow」+ Typography 长代码呈现；对照实验判定（无需文档层改动）。
// 种子：devShim「长码演示」触发词（2026-10-18 新增：超长无空格单行 base64 代码、超长单 token 行内代码、长段落引用）。
// 断言语义：
//   A 默认宽 320：pre 存在且 computed overflowX=auto、长单行代码 scrollWidth>clientWidth（出横向滚动不破气泡）、
//     pre 不越出气泡右缘；长行内 code 在气泡内换行不水平裁切（码父段无横向溢出）；
//     blockquote 不越出气泡右缘且文本换行；回复体整体无元素越出气泡右缘；零 JS 异常。
//   B 窄面板 280：同 A 四项。
// 用法：node scripts/msgflow-longcode-ui-smoke.mjs（先 npm run build + serve-renderer + CDP 9224）
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
  const probe = () =>
    ev(`(() => {
      const cs = (el) => getComputedStyle(el)
      const b = [...document.querySelectorAll('div.prose.agent-prose')].pop()
      if (!b) return { err: 'no agent-prose' }
      const bubble = b.closest('.rounded-xl')
      if (!bubble) return { err: 'no bubble' }
      const br = bubble.getBoundingClientRect()
      const pre = b.querySelector('pre')
      const preCode = pre ? pre.querySelector('code') : null
      // 长行内 code：非 pre 内 code，且父段落含超长 URL token
      const codeEls = [...b.querySelectorAll('code')].filter((x) => !x.closest('pre'))
      const inline = codeEls.pop() || null
      const inlPar = inline ? inline.closest('p') : null
      const bq = b.querySelector('blockquote')
      const over = (el) => { const r = el.getBoundingClientRect(); return { over: r.right - br.right, right: r.right, bubbleR: br.right, w: r.width } }
      return {
        pre: pre ? {
          fs: parseFloat(cs(pre).fontSize),
          overflowX: cs(pre).overflowX,
          scrollW: pre.scrollWidth,
          clientW: pre.clientWidth,
          elem: over(pre)
        } : null,
        preCodeFs: preCode ? parseFloat(cs(preCode).fontSize) : null,
        inline: inline ? ({
          fs: parseFloat(cs(inline).fontSize),
          elemScrollW: inline.scrollWidth,
          elemClientW: inline.clientWidth,
          elemW: inline.getBoundingClientRect().width,
          scrollW: inlPar ? inlPar.scrollWidth : null,
          clientW: inlPar ? inlPar.clientWidth : null,
          parW: inlPar ? inlPar.getBoundingClientRect().width : null
        }) : null,
        bq: bq ? ({ elem: over(bq), scrollW: bq.scrollWidth, clientW: bq.clientWidth }) : null,
        bodyOver: (() => { const r = [...b.children].reduce((m, c) => Math.max(m, c.getBoundingClientRect().right), 0); return r - br.right })(),
        bubbleW: br.width
      }
    })()`)
  console.log('场景 A：默认面板宽（320）· 长码/行内码/引用块')
  await sendMsg('长码演示')
  await waitIdle()
  const a = await probe()
  ok('agent-prose 渲染', !a.err, JSON.stringify(a))
  if (a.err) return { exceptions, final: fails }
  ok('pre 存在且 overflow-x=auto', a.pre && a.pre.overflowX === 'auto', a.pre?.overflowX)
  ok('长单行代码 scrollWidth>clientWidth（出横滚）', a.pre && a.pre.scrollW > a.pre.clientW, `${a.pre?.scrollW}/${a.pre?.clientW}`)
  ok('pre 不越出气泡右缘', a.pre && a.pre.elem.over <= 1, a.pre?.elem)
  ok('长行内 code 断行不水平裁切（父段无横向溢出）', a.inline && a.inline.scrollW <= a.inline.clientW + 1, `${a.inline?.scrollW}/${a.inline?.clientW}`)
  ok('长行内 code 元素自身换行不超宽（scrollW<=clientW）', a.inline && a.inline.elemScrollW <= a.inline.elemClientW + 1, `${a.inline?.elemScrollW}/${a.inline?.elemClientW}`)
  ok('blockquote 不越出气泡右缘', a.bq && a.bq.elem.over <= 1, a.bq?.elem)
  ok('blockquote 文本换行无横向溢出', a.bq && a.bq.scrollW <= a.bq.clientW + 1, `${a.bq?.scrollW}/${a.bq?.clientW}`)
  ok('回复体无元素越出气泡右缘', a.bodyOver <= 1, a.bodyOver)
  // ---------- 场景 B：窄面板 280 ----------
  console.log('场景 B：窄面板（280 = min）')
  await ev(`window.zhijuan?.setSettings?.({ agentPanelWidth: 280 })`)
  await sleep(300)
  await cmd('Page.reload', { ignoreCache: true })
  await sleep(3500)
  await sendMsg('长码演示')
  await waitIdle()
  const b = await probe()
  ok('窄面板 pre 存在且 overflow-x=auto', b.pre && b.pre.overflowX === 'auto', b.pre?.overflowX)
  ok('窄面板长单行代码 scrollWidth>clientWidth', b.pre && b.pre.scrollW > b.pre.clientW, `${b.pre?.scrollW}/${b.pre?.clientW}`)
  ok('窄面板 pre 不越出气泡右缘', b.pre && b.pre.elem.over <= 1, b.pre?.elem)
  ok('窄面板长行内 code 断行不裁切', b.inline && b.inline.scrollW <= b.inline.clientW + 1, `${b.inline?.scrollW}/${b.inline?.clientW}`)
  ok('窄面板 blockquote 不越出气泡右缘', b.bq && b.bq.elem.over <= 1, b.bq?.elem)
  ok('窄面板 blockquote 文本换行', b.bq && b.bq.scrollW <= b.bq.clientW + 1, `${b.bq?.scrollW}/${b.bq?.clientW}`)
  ok('窄面板回复体无元素越出气泡', b.bodyOver <= 1, b.bodyOver)
  ok('零 JS 异常', exceptions.length === 0, exceptions.slice(0, 3).join(' | '))
  // ---------- 场景 C：深色主题 · 语义色 ----------
  console.log('场景 C：深色主题 · pre/code/blockquote 语义色')
  // 深色经 html.dark 类生效（app.ts load/update 均 toggle .dark）；直接切类读 computed 色=验证 CSS 语义 var 深色覆盖
  await ev(`document.documentElement.classList.add('dark')`)
  await sleep(400)
  const c = await ev(`(() => {
    const cs = (el) => getComputedStyle(el)
    const b = [...document.querySelectorAll('div.prose.agent-prose')].pop()
    if (!b) return { err: 'no agent-prose' }
    const pre = b.querySelector('pre')
    const code = [...b.querySelectorAll('code')].find((x) => !x.closest('pre'))
    const bq = b.querySelector('blockquote')
    const rgb = (v) => { const m = v.match(/\\d+/g); return m ? m.map(Number) : null }
    const lum = (v) => { const r = rgb(v); return r ? 0.2126*r[0]+0.7152*r[1]+0.0722*r[2] : null }
    return {
      dark: document.documentElement.classList.contains('dark'),
      preBg: pre ? cs(pre).backgroundColor : null,
      preBorder: pre ? cs(pre).borderTopColor : null,
      codeBg: code ? cs(code).backgroundColor : null,
      bqColor: bq ? cs(bq).color : null,
      bqBorder: bq ? cs(bq).borderLeftColor : null,
      preLum: pre ? lum(cs(pre).backgroundColor) : null,
      bqLum: bq ? lum(cs(bq).color) : null
    }
  })()`)
  ok('深色主题生效（html.dark）', c && c.dark === true, JSON.stringify(c))
  ok('pre 背景为深色（lum<60）', c && c.preBg && c.preLum < 60, `${c?.preBg}/${c?.preLum}`)
  ok('blockquote 深色前景为浅灰可读（lum>100，暗底可读）', c && c.bqColor && c.bqLum > 100, `${c?.bqColor}/${c?.bqLum}`)
  ok('blockquote 深色前景非纯黑（主题敏感）', c && c.bqColor && c.bqColor !== 'rgb(0, 0, 0)' && c.bqColor !== 'rgb(109, 103, 92)', `${c?.bqColor}`)
  ok('deep 语义色非纯白/纯黑占位', c && c.preBg && c.preBg !== 'rgb(255, 255, 255)' && c.preBg !== 'rgb(0, 0, 0)', c?.preBg)
  await ev(`document.documentElement.classList.remove('dark')`)
  ws.close()
  return { exceptions, final: fails }
}
const tab = await newTab(`${APP}/?cb=${Date.now()}&zj-agent-delay=60#/project/demo-aseya/novel`)
await sleep(3500)
await drive(tab)
await fetch(`${base}/json/close/${tab.id}`)
console.log(fails === 0 ? '\nALL PASS' : `\nFAILS: ${fails}`)
process.exit(fails === 0 ? 0 : 1)
