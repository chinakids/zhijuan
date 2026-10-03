// 织卷无头冒烟 · Agent 输入区 textarea HIG 走查落地——体验层 2026-10-03（04-体验层.md 五候选 1）
// 背景：输入区近十余轮密集加交互后从未按 HIG Text fields / Text views 整体体检；实抓两页
//       （developer.apple.com/design/human-interface-guidelines/text-fields?text-views，2026-10-03 CDP 实抓 /tmp/hig-*.txt）
//       + 同类范式 frontendpatterns.dev/prompt-input（auto-grow composer + Enter 发送 + IME 守卫 + 
//       field-sizing:content CSS 方案）+ Claude Code 官方 terminal-config（Enter 提交/Shift+Enter 换行）。
// 落地点：
//   A 多行输入自动增高（field-sizing:content，min 64px → max 160px 后滚动）=HIG Text views「any height and allow scrolling」
//      + Text fields「match the size…to the quantity of anticipated text」；
//   B 发送/停止导演按钮补 aria-label（icon-only 必须 aria-label，title 不算，2026-09-13 2 用途规范）；
//   C 用法 title 补「↑ 回取草稿」（2026-09-29 新能力，title=完整用法提示面）。
// 断言语义：
//   A 空态高度≈min（64-70px）且 field-sizing=content；输入 3 行 → 高度增长；输入 12 行 → 高度=160 且可滚动（scrollHeight>clientHeight）；
//      清空 → 高度回落；输入 1 行 → 高度介于 min 与 160；聚焦焦点环 ring 存在。
//   B 发送按钮 aria-label=发送；disabled 当空（disabled 属性+aria-disabled）；有内容后可点。
//   C title 含「↑ 回取草稿」「Shift+Enter 换行」。
//   零 JS 异常。
// 用法：node scripts/input-textarea-ui-smoke.mjs（先 npm run build + out/renderer SPA server + CDP 9224）
const base = 'http://127.0.0.1:9224'
const APP = 'http://127.0.0.1:8123'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
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
  const setTa = (text) =>
    ev(`(() => {
      const ta = document.querySelector('textarea[role="combobox"]')
      if (!ta) return false
      ta.focus()
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
      setter.call(ta, ${JSON.stringify(text)})
      ta.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`)
  const taInfo = () =>
    ev(`JSON.stringify((() => {
      const ta = document.querySelector('textarea[role="combobox"]')
      if (!ta) return null
      const cs = getComputedStyle(ta)
      const r = ta.getBoundingClientRect()
      return { h: Math.round(r.height), minH: parseFloat(cs.minHeight), maxH: parseFloat(cs.maxHeight),
        fs: cs.fieldSizing, sh: ta.scrollHeight, clientH: ta.clientHeight,
        ph: ta.placeholder, title: ta.getAttribute('title'), ring: cs.boxShadow }
    })())`)
  const sendBtnInfo = () =>
    ev(`JSON.stringify((() => {
      const b = Array.from(document.querySelectorAll('button')).find((x) => x.getAttribute('aria-label') === '发送')
      if (!b) return null
      return { aria: b.getAttribute('aria-label'), title: b.title, disabled: b.disabled, ariaDisabled: b.getAttribute('aria-disabled') }
    })())`)

  // 等应用挂载
  for (let i = 0; i < 30; i++) {
    await sleep(1000)
    if (await ev(`!!document.querySelector('#zj-agent-panel')`)) break
  }
  await sleep(1200)
  // 选章（Novel 页默认不挂编辑器/输入区随面板常驻；选章只为贴近真机路径）
  await ev(`(() => {
    const els = Array.from(document.querySelectorAll('button')).filter((b) => (b.textContent || '').includes('第1章'))
    if (els.length) els[0].click()
    return els.length
  })()`)
  await sleep(800)

  const fail = []
  const ok = (cond, msg) => { console.log((cond ? 'PASS' : 'FAIL') + ' ' + msg); if (!cond) fail.push(msg) }

  // A1 空态：field-sizing=content、高度≈min
  const a1 = JSON.parse(await taInfo())
  ok(!!a1, 'A1 textarea 存在')
  ok(a1?.fs === 'content', `A1 field-sizing=content (got ${a1?.fs})`)
  ok(a1?.minH === 64 && a1?.maxH === 160, `A1 min64/max160 (${a1?.minH}/${a1?.maxH})`)
  ok(a1?.h >= 64 && a1?.h <= 75, `A1 空态高度≈min (${a1?.h})`)

  // A2 输入 3 行 → 高度增长（介于 min+30 与 160）
  await setTa('第一行\n第二行\n第三行')
  await sleep(400)
  const a2 = JSON.parse(await taInfo())
  ok(a2.h > a1.h && a2.h < 160, `A2 三行高度增长 (${a1.h}→${a2.h})`)

  // A3 输入 12 行 → 高度=160 且内容滚动
  const twelve = Array.from({ length: 12 }, (_, i) => `第${i + 1}行内容测试`).join('\n')
  await setTa(twelve)
  await sleep(400)
  const a3 = JSON.parse(await taInfo())
  ok(a3.h === 160, `A3 超长高度=160 (${a3.h})`)
  ok(a3.sh > a3.clientH, `A3 超长可滚动 (sh=${a3.sh} client=${a3.clientH})`)

  // A4 清空 → 高度回落
  await setTa('')
  await sleep(400)
  const a4 = JSON.parse(await taInfo())
  ok(a4.h >= 64 && a4.h <= 75, `A4 清空回落 (${a4.h})`)

  // A5 聚焦焦点环（focus ring accent：Tailwind v4 ring 渲染为 oklab，含 2px 非零层）
  await ev(`(() => { const ta = document.querySelector('textarea[role="combobox"]'); ta.focus(); return true })()`)
  await sleep(300)
  const a5 = JSON.parse(await taInfo())
  const ringShadows = (a5.ring || '').split(',').filter((s) => !/^rgba\(0, 0, 0, 0\)/.test(s.trim().split(' ')[0]) && /oklab|rgba/.test(s))
  const activeTa = await ev(`document.activeElement === document.querySelector('textarea[role="combobox"]')`)
  ok(activeTa === true, `A5 焦点在 textarea`)
  ok(ringShadows.length >= 1 && /2px/.test(String(a5.ring)), `A5 焦点环 2px 存在 (${String(a5.ring).slice(0, 80)})`)

  // B 发送按钮 aria
  const b = JSON.parse(await sendBtnInfo())
  ok(!!b, 'B 发送按钮存在')
  ok(b?.aria === '发送', `B aria-label=发送 (got ${b?.aria})`)
  ok(b?.disabled === true, 'B 空输入 disabled')
  await setTa('你好')
  await sleep(300)
  const b2 = JSON.parse(await sendBtnInfo())
  ok(b2?.disabled === false, 'B 有内容可点')

  // C title 用法提示
  const c = JSON.parse(await taInfo())
  ok(c.title.includes('↑ 回取草稿'), `C title 含↑ 回取草稿 (${c.title})`)
  ok(c.title.includes('Shift+Enter 换行'), `C title 含 Shift+Enter 换行`)
  ok(c.ph === '让 agent 做什么…', `C placeholder=${c.ph}`)

  // 零 JS 异常
  await sleep(800)
  ok(exceptions.length === 0, `零 JS 异常 (${exceptions.join('; ').slice(0, 200)})`)

  console.log(fail.length ? `\n${fail.length} FAILED` : '\nALL PASS')
  return fail.length === 0
}

const tab = await newTab(`${APP}/#/project/demo-aseya/novel?cb=${Date.now()}`)
let pass = false
try {
  pass = await drive(tab)
} finally {
  await fetch(`${base}/json/close/${tab.id}`).catch(() => {})
}
process.exit(pass ? 0 : 1)
