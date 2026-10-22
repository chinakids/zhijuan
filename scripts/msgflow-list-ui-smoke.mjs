// 织卷无头冒烟 · 消息流任务清单/嵌套·有序列表走查——体验层 2026-10-22（04-体验层.md 五候选 1）
// 背景：Agent 回复区（ReactMarkdown + remark-gfm）的 gfm 任务清单（- [ ] / - [x]）、嵌套列表、
//       有序列表从未单独走查。实测发现：Tailwind preflight 默认 ol,ul{list-style:none} 会把 .prose
//       语境的列表标记整体抹掉——普通圆点列表无圆点、有序列表「后续顺序 1.2.3」序号不显示
//       （getComputedStyle listStyleType=none），任务清单 checkbox 无间距（marginRight=0 文字紧贴）。
// 调研：HIG Lists（developer.apple.com/design/human-interface-guidelines/lists）——checklists/steps
//       是文档类产品组织信息的高频形态，列表标记（圆点/序号）是「可读性」的硬线索，被抹掉即失读。
// 落地：tokens.css .prose 基座——ul list-style:disc / ol list-style:decimal（preflight 复原），
//       ul.contains-task-list 与 li.task-list-item list-style:none（checkbox 取代圆点防双标记），
//       input[type=checkbox] margin 0.4em + vertical-align:middle（留距防文字紧贴）；
//       作用域=共享 .prose（与 2026-10-06 宽表先例同层，消息流/素材预览/提案 diff 同获益）。
// 种子：devShim「清单演示」触发词（任务清单/嵌套任务清单/有序+嵌套有序/普通圆点/超长列表项+引用）。
// 断言语义：
//   A 默认宽（320）：任务清单渲染 checkbox 且带右边距、contains-task-list ul 无圆点（防双标记）、
//     普通 ul 圆点恢复（disc）、有序 ol 序号恢复（decimal 非 none）、嵌套列表有额外缩进、
//     有序列表序号与嵌套层级肉眼可辨、回复体不越出气泡右缘、零 JS 异常；
//   B 窄面板（280 min）：回复体与超长列表项/引用不越出气泡右缘、列表仍带标记、零 JS 异常。
// 用法：node scripts/msgflow-list-ui-smoke.mjs（先 npm run build + serve-renderer + CDP 9224）
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
  const check = () =>
    ev(`(() => {
      const cs = (el) => getComputedStyle(el)
      const b = [...document.querySelectorAll('div.prose.agent-prose')].pop()
      if (!b) return { err: 'no agent-prose' }
      const bubble = b.closest('.rounded-xl')
      const br = bubble.getBoundingClientRect()
      const rightOverflow = (el) => { const r = el.getBoundingClientRect(); return r.right - br.right }
      const cb = b.querySelector('input[type=checkbox]')
      const ul = [...b.querySelectorAll('ul')].find((x) => !x.classList.contains('contains-task-list'))
      const ol = b.querySelector('ol')
      const nestedUl = b.querySelector('ul ul')
      const topUl = b.querySelector('ul')
      const left = (e) => (e ? e.getBoundingClientRect().left : null)
      return {
        err: null,
        cb: cb ? { mr: parseFloat(cs(cb).marginRight), va: cs(cb).verticalAlign, w: cb.offsetWidth } : null,
        taskUl: (() => { const t = b.querySelector('ul.contains-task-list'); return t ? cs(t).listStyleType : null })(),
        plainUl: ul ? { ls: cs(ul).listStyleType, pad: parseFloat(cs(ul).paddingLeft) } : null,
        ol: ol ? { ls: cs(ol).listStyleType } : null,
        nestedLeftOffset: nestedUl && topUl ? left(nestedUl) - left(topUl) : null,
        overflowRight: rightOverflow(b),
        bubbleW: br.width
      }
    })()`)
  // ---------- 场景 A：默认宽 320 ----------
  console.log('场景 A：默认面板宽（320）· 任务清单/嵌套/有序列表')
  await sendMsg('清单演示')
  await waitIdle()
  const a = await check()
  ok('agent-prose 渲染', !a.err, JSON.stringify(a))
  if (a.err) return { exceptions, final: fails }
  ok('任务清单 checkbox 渲染', !!a.cb, JSON.stringify(a.cb))
  ok('checkbox 带右边距（≥4px）', a.cb && a.cb.mr >= 4, a.cb?.mr)
  ok('checkbox 垂直居中', a.cb && a.cb.va === 'middle', a.cb?.va)
  ok('任务清单 ul 无圆点（防双标记）', a.taskUl === 'none', a.taskUl)
  ok('普通 ul 圆点恢复（disc）', a.plainUl && a.plainUl.ls === 'disc', a.plainUl?.ls)
  ok('有序 ol 序号恢复（decimal）', a.ol && a.ol.ls === 'decimal', a.ol?.ls)
  ok('嵌套 ul 有额外缩进（相对顶层 ≥8px）', a.nestedLeftOffset != null && a.nestedLeftOffset >= 8, a.nestedLeftOffset)
  ok('回复体不越出气泡右缘', a.overflowRight <= 1, a.overflowRight)
  // ---------- 场景 B：窄面板 280 ----------
  console.log('场景 B：窄面板（280 = min）')
  await ev(`window.zhijuan?.setSettings?.({ agentPanelWidth: 280 })`)
  await sleep(300)
  await cmd('Page.reload', { ignoreCache: true })
  await sleep(3500)
  await sendMsg('清单演示')
  await waitIdle()
  const b = await check()
  ok('窄面板回复体不越出气泡右缘', !b.err && b.overflowRight <= 1, b.overflowRight)
  ok('窄面板任务清单 checkbox 仍有间距', b.cb && b.cb.mr >= 4, b.cb?.mr)
  ok('窄面板有序序号仍恢复', b.ol && b.ol.ls === 'decimal', b.ol?.ls)
  ok('窄面板普通圆点仍恢复', b.plainUl && b.plainUl.ls === 'disc', b.plainUl?.ls)
  ok('零 JS 异常', exceptions.length === 0, exceptions.slice(0, 3).join(' | '))
  ws.close()
  return { exceptions, final: fails }
}
const tab = await newTab(`${APP}/?cb=${Date.now()}&zj-agent-delay=40#/project/demo-aseya/novel`)
await sleep(3500)
await drive(tab)
await fetch(`${base}/json/close/${tab.id}`)
console.log(fails === 0 ? '\nALL PASS' : `\nFAILS: ${fails}`)
process.exit(fails === 0 ? 0 : 1)
