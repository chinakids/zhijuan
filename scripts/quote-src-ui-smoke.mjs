// 织卷无头冒烟 · 划词引用来源（体验层 2026-09-23 候选1收口）
// 用法：node scripts/quote-src-ui-smoke.mjs
// 前置：npm run build；node scripts/serve-renderer.mjs 8899；本机无头 Chrome CDP 127.0.0.1:9224
// 验收点：① 正文划词「添加到对话」→ 输入区提示条显示来源「第1章 · 雾港」（章题名，非文件结构名）；
//         ② 划词后切到另一章再发送 → 用户气泡来源仍是原章（修跨章节标注错）；
//         ③ 人物档案页划词 → 回正文发送 → 来源为「人物·阿七」（修跨文档标注错）；
//         ④ 发送后引用被消费清空；⑤ 全程无 JS 异常。
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://127.0.0.1:8899'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function openTab(url) {
  const r = await fetch(CDP + '/json/new?' + encodeURIComponent(url), { method: 'PUT' })
  return r.json()
}

function attach(wsUrl) {
  const ws = new WebSocket(wsUrl)
  let seq = 0
  const pending = new Map()
  const errors = []
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.method === 'Runtime.exceptionThrown') errors.push((m.params.exceptionDetails?.exception?.description ?? '').slice(0, 200))
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push((m.params.args?.map((a) => a.value ?? a.description ?? '').join(' ') ?? '').slice(0, 200))
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  }
  const cmd = (method, params = {}) =>
    new Promise((res, rej) => {
      const id = ++seq
      pending.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)))
      ws.send(JSON.stringify({ id, method, params }))
    })
  return new Promise((res) => {
    ws.onopen = async () => {
      await cmd('Runtime.enable')
      res({
        cmd, errors,
        eval: async (expression) => {
          const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
          if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 300))
          return r.result?.value
        },
        close: () => ws.close()
      })
    }
  })
}

async function evalUntil(page, expr, pred, timeoutMs = 20000, label = expr) {
  const t0 = Date.now()
  for (;;) {
    try {
      const v = await page.eval(expr)
      if (pred(v)) return v
    } catch {}
    if (Date.now() - t0 > timeoutMs) throw new Error('TIMEOUT waiting: ' + label)
    await sleep(300)
  }
}

let fails = 0
const ok = (name, cond, extra = '') => {
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : ''))
  if (!cond) fails++
}

/** 选正文章节：章节列表按钮（文本 includes 标题） */
const clickChapter = (title) => `(() => {
  const btns = [...document.querySelectorAll('button')]
  const b = btns.find((x) => (x.textContent || '').includes(${JSON.stringify(title)}))
  if (!b) return 'NOT_FOUND'
  b.click()
  return 'OK'
})()`

/** 程序化选中 .ProseMirror 中首个出现 needle 的文本节点 */
const selExpr = (needle) => `(() => {
  const pm = document.querySelector('.ProseMirror')
  if (!pm) return 'NO_PM'
  const walker = document.createTreeWalker(pm, NodeFilter.SHOW_TEXT)
  let n
  while ((n = walker.nextNode())) {
    const i = n.nodeValue.indexOf(${JSON.stringify(needle)})
    if (i >= 0) {
      const r = document.createRange()
      r.setStart(n, i)
      r.setEnd(n, i + ${JSON.stringify(needle)}.length)
      const s = window.getSelection()
      s.removeAllRanges()
      s.addRange(r)
      pm.dispatchEvent(new Event('selectionchange', { bubbles: true }))
      return 'OK:' + ${JSON.stringify(needle)}
    }
  }
  return 'NOT_FOUND'
})()`

const sendAndWait = async (page, text) => {
  await page.eval(`(() => { const t = document.querySelector('textarea'); if (t) t.focus(); return !!t })()`)
  await page.cmd('Input.insertText', { text })
  await sleep(150)
  await page.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', windowsVirtualKeyCode: 13 })
  await page.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  for (let i = 0; i < 120; i++) {
    await sleep(500)
    const idle = await page.eval(`!document.querySelector('button[title="停止生成"]')`)
    if (idle && i > 2) return true
  }
  return false
}

const lastUserMsg = (page) => page.eval(`(() => {
  const els = [...document.querySelectorAll('[class*="justify-end"]')]
  for (let i = els.length - 1; i >= 0; i--) {
    const t = (els[i].innerText || '').trim()
    if (t && !t.includes('停止生成')) return t
  }
  return ''
})()`)

// ═══ 场景 A：正文划词 → 提示条来源 → 切章发送来源仍原章 ═══
const tabA = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel?ch=' + encodeURIComponent('第01章_雾港.md'))
const A = await attach(tabA.webSocketDebuggerUrl)
await evalUntil(A, `document.body.innerText.includes('第1章')`, Boolean, 20000, '正文页载入')
ok('场景A 载入（选第1章）', (await A.eval(clickChapter('第1章 · 雾港'))) === 'OK')
await evalUntil(A, `!!document.querySelector('.ProseMirror')`, Boolean, 20000, '编辑器挂载')
await sleep(600)
// 真实划词（与 float-* 同法）
await A.eval(`window.__ZJ_EDITORS?.[0]?.focus?.()`)
await sleep(250)
await A.eval(`window.__ZJ_EDITORS?.[0]?.setCursor?.('阿七')`)
await sleep(250)
await A.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', modifiers: 8, windowsVirtualKeyCode: 40 })
await evalUntil(A, `!!document.querySelector('.zj-sel-bubble')`, Boolean, 8000, '划词浮层出现')
await A.eval(`document.querySelector('.zj-sel-bubble button[aria-label="添加到对话"]')?.click()`)
await sleep(300)
ok('场景A 提示条显示引用来源（第1章 · 雾港）', (await A.eval(`document.body.innerText`)).includes('引用自 第1章 · 雾港'))
const hintA = await A.eval(`(() => {
  const el = [...document.querySelectorAll('div')].find((d) => (d.textContent || '').includes('引用自 第1章 · 雾港') && d.children.length <= 1)
  return el ? el.textContent.trim() : ''
})()`)
ok('场景A 提示条含节选文本', hintA.length > 0 && hintA.includes('阿七'), hintA.slice(0, 40))
// 切到第2章再发送
ok('场景A 切第2章', (await A.eval(clickChapter('第2章 · 灯塔'))) === 'OK')
await evalUntil(A, `!!document.querySelector('.ProseMirror')`, Boolean, 20000, '第2章编辑器')
await sleep(500)
await sendAndWait(A, '请就引用内容给建议')
const msgA = await lastUserMsg(A)
ok('场景A 用户气泡来源=原章（第1章 · 雾港）', msgA.includes('（引用自《第1章 · 雾港》') && !msgA.includes('第02章'), msgA.slice(0, 120).replace(/\n/g, '⏎'))
ok('场景A 提示条已随发送清空', !(await A.eval(`document.body.innerText`)).includes('取消引用'))
ok('场景A 无 JS 异常', A.errors.length === 0, A.errors.slice(0, 2).join(' | '))
await A.eval(`(() => { location.hash = '#/project/demo-aseya/home'; return true })()`).catch(() => {})
A.close()

// ═══ 场景 B：人物档案页划词 → 回正文发送 → 来源=人物·阿七 ═══
const tabB = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/characters')
const B = await attach(tabB.webSocketDebuggerUrl)
await evalUntil(B, `document.body.innerText.includes('人物档案')`, Boolean, 20000, '人物页载入')
const picked = await B.eval(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /阿七/.test(x.textContent || ''))
  if (!b) return 'NOT_FOUND'
  b.click()
  return 'OK'
})()`)
ok('场景B 选中阿七档案', picked === 'OK')
await evalUntil(B, `(() => { const e = document.querySelector('.ProseMirror'); return !!e && e.textContent.includes('基础档案') })()`, (v) => v === true, 20000, '人物档案编辑器就绪')
await evalUntil(B, `!!document.querySelector('.ProseMirror')`, Boolean, 8000, '编辑器就绪')
await sleep(500)
ok('场景B 划词', (await B.eval(selExpr('基础档案'))) === 'OK:基础档案')
await evalUntil(B, `!!document.querySelector('.zj-sel-bubble')`, Boolean, 8000, '人物页浮层出现')
await B.eval(`document.querySelector('.zj-sel-bubble button[aria-label="添加到对话"]')?.click()`)
await sleep(300)
// 回正文页（同 tab，store 内存保留）
await B.eval(`(() => { location.hash = '#/project/demo-aseya/novel?ch=' + encodeURIComponent('第01章_雾港.md'); return true })()`)
await evalUntil(B, `document.body.innerText.includes('第1章')`, Boolean, 20000, '回正文页')
ok('场景B 选第1章', (await B.eval(clickChapter('第1章 · 雾港'))) === 'OK')
await evalUntil(B, `!!document.querySelector('.ProseMirror')`, Boolean, 20000, '正文编辑器')
await sleep(500)
ok('场景B 提示条来源=人物·阿七', (await B.eval(`document.body.innerText`)).includes('引用自 人物·阿七'))
await sendAndWait(B, '这段引用来自哪里')
const msgB = await lastUserMsg(B)
ok('场景B 用户气泡来源=人物·阿七', msgB.includes('（引用自《人物·阿七'), msgB.slice(0, 120).replace(/\n/g, '⏎'))
ok('场景B 无 JS 异常', B.errors.length === 0, B.errors.slice(0, 2).join(' | '))
B.close()

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAIL`)
process.exit(fails === 0 ? 0 : 1)
