// 织卷无头冒烟 · 划词引用跨页反馈（体验层 2026-09-24 候选1收口）
// 背景：人物/世界观/素材/大纲页划词「对话」后引用只在正文输入区提示条可见——作者当场无感知（零确认面）。
// 本轮=非正文页补轻量确认 toast「已添加到对话」（HIG Feedback：无集成式反馈的行为补完成确认），
//       正文页不弹（输入区提示条=集成式反馈，含取消入口，重复确认成噪音）。
// 断言：A① 人物页划词→「对话」→toast「已添加到对话」出现（含「正文创作」指路）
//       A② 同 tab 回正文页→提示条「引用自 人物·阿七」可见（引用确实进入对话，setQuote 未被 toast 旁路）
//       B① 正文页划词→「对话」→无「已添加到对话」toast（提示条即反馈，不重复确认）
//       B② 提示条正常出现（零回归）；C 全程零 JS 异常
// 用法：node scripts/quote-feedback-ui-smoke.mjs（先 npm run build + node scripts/serve-renderer.mjs 8899，CDP 9224 在跑）
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://127.0.0.1:8899'
const OUT = process.env.HOME + '/Pictures/zhijuan'
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
      await cmd('Page.enable')
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

const toastShot = async (page, name) => {
  try {
    const r = await page.cmd('Page.captureScreenshot', { format: 'png' })
    const fs = await import('node:fs')
    fs.mkdirSync(OUT, { recursive: true })
    fs.writeFileSync(OUT + '/' + name, Buffer.from(r.data, 'base64'))
    console.log('SHOT ' + name)
  } catch (e) {
    console.log('SHOT_FAIL ' + e.message)
  }
}

// ═══ 场景 A：人物档案页划词 → toast 确认 → 回正文页引用已在提示条 ═══
const tabA = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/characters')
const A = await attach(tabA.webSocketDebuggerUrl)
await evalUntil(A, `document.body.innerText.includes('人物档案')`, Boolean, 20000, '人物页载入')
const picked = await A.eval(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /阿七/.test(x.textContent || ''))
  if (!b) return 'NOT_FOUND'
  b.click()
  return 'OK'
})()`)
ok('场景A 选中阿七档案', picked === 'OK', String(picked))
await evalUntil(A, `(() => { const e = document.querySelector('.ProseMirror'); return !!e && e.textContent.includes('基础档案') })()`, (v) => v === true, 20000, '人物档案编辑器就绪')
await sleep(400)
ok('场景A 划词', (await A.eval(selExpr('基础档案'))) === 'OK:基础档案')
await evalUntil(A, `!!document.querySelector('.zj-sel-bubble')`, Boolean, 8000, '人物页浮层出现')
await A.eval(`document.querySelector('.zj-sel-bubble button[aria-label="添加到对话"]')?.click()`)
await evalUntil(A, `document.body.innerText.includes('已添加到对话')`, Boolean, 5000, 'toast 出现')
ok('场景A 非正文页出现「已添加到对话」toast', true)
ok('场景A toast 指路「正文创作」', (await A.eval(`document.body.innerText`)).includes('回到「正文创作」页，可在输入区查看或取消'))
const stamp = new Date()
const hhmm = String(stamp.getHours()).padStart(2, '0') + String(stamp.getMinutes()).padStart(2, '0')
await toastShot(A, 'quote-feedback-toast-' + hhmm + '.png')
// 回正文页：引用须已进入对话（setQuote 真实生效）
await A.eval(`(() => { location.hash = '#/project/demo-aseya/novel?ch=' + encodeURIComponent('第01章_雾港.md'); return true })()`)
await evalUntil(A, `document.body.innerText.includes('第1章')`, Boolean, 20000, '回正文页')
ok('场景A 选第1章', (await A.eval(clickChapter('第1章 · 雾港'))) === 'OK')
await evalUntil(A, `!!document.querySelector('.ProseMirror')`, Boolean, 20000, '正文编辑器')
await sleep(500)
ok('场景A 提示条引用来源=人物·阿七', (await A.eval(`document.body.innerText`)).includes('引用自 人物·阿七'))
ok('场景A 无 JS 异常', A.errors.length === 0, A.errors.slice(0, 2).join(' | '))
A.close()

// ═══ 场景 B：正文页划词 → 无 toast（提示条=集成式反馈，不重复确认）═══
const tabB = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel?ch=' + encodeURIComponent('第01章_雾港.md'))
const B = await attach(tabB.webSocketDebuggerUrl)
await evalUntil(B, `document.body.innerText.includes('第1章')`, Boolean, 20000, '正文页载入')
ok('场景B 选第1章', (await B.eval(clickChapter('第1章 · 雾港'))) === 'OK')
await evalUntil(B, `!!document.querySelector('.ProseMirror')`, Boolean, 20000, '编辑器挂载')
await sleep(500)
await B.eval(`window.__ZJ_EDITORS?.[0]?.focus?.()`)
await sleep(250)
await B.eval(`window.__ZJ_EDITORS?.[0]?.setCursor?.('阿七')`)
await sleep(250)
await B.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', modifiers: 8, windowsVirtualKeyCode: 40 })
await evalUntil(B, `!!document.querySelector('.zj-sel-bubble')`, Boolean, 8000, '划词浮层出现')
await B.eval(`document.querySelector('.zj-sel-bubble button[aria-label="添加到对话"]')?.click()`)
await sleep(1200)
ok('场景B 正文页无「已添加到对话」toast', !(await B.eval(`document.body.innerText`)).includes('已添加到对话'))
ok('场景B 提示条出现（引用生效）', (await B.eval(`document.body.innerText`)).includes('引用自 第1章 · 雾港'))
ok('场景B 无 JS 异常', B.errors.length === 0, B.errors.slice(0, 2).join(' | '))
B.close()

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAIL`)
process.exit(fails === 0 ? 0 : 1)
