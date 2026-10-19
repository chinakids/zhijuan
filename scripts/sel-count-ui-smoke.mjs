// 织卷无头冒烟 · 编辑器「已选 N 字」选中字数（创作层 2026-10-19）
// 用法：node scripts/sel-count-ui-smoke.mjs
// 前置：npm run build；node scripts/serve-renderer.mjs 8123；本机无头 Chrome CDP 127.0.0.1:9224
// 验收：① 载入第1章后状态栏无「已选」（选区为空）② 程序化全选正文 →「已选 N 字」出现且
//   N === countWords(选区文本)（与「约 N 字」同口径）③ 取消选区 →「已选」消失 ④ 全程无 JS 异常。
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
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
    } catch { /* 重试 */ }
    if (Date.now() - t0 > timeoutMs) throw new Error('TIMEOUT waiting: ' + label)
    await sleep(300)
  }
}
async function setSize(page, w, h) {
  await page.cmd('Emulation.clearDeviceMetricsOverride')
  await page.cmd('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: false })
  await sleep(600)
}
const bodyHas = (t) => `document.body.innerText.includes(${JSON.stringify(t)})`
const clickBtn = (text, exact = true) => `(() => {
  const els = [...document.querySelectorAll('button')]
  const el = els.find((b) => ${exact ? `(b.innerText || '').trim() === ${JSON.stringify(text)}` : `(b.innerText || '').includes(${JSON.stringify(text)})`})
  if (!el) return false
  el.click()
  return true
})()`
const VIEW = { w: 1200, h: 700 }

let pass = 0
let fail = 0
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log('PASS ' + name) }
  else { fail++; console.log('FAIL ' + name + (extra ? ' | ' + extra : '')) }
}

// countWords 口径复刻（与 src/shared/count.ts 一致，供对选区文本期望计数）
function cw(t) {
  t = String(t).replace(/^---\n[\s\S]*?\n---\s*(\n|$)/, '')
  let n = 0
  for (const line of t.split('\n')) {
    let l = line
      .replace(/^\s*#{1,6}\s*/, '')
      .replace(/^\s*>+\s?/, '')
      .replace(/^\s*[-*+]\s+/, '')
      .replace(/^\s*\d+\.\s+/, '')
      .replace(/^\s*```.*/, '')
      .replace(/(^|\s)```.*/, '')
      .replace(/[`*_~]/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    l = l.replace(/[A-Za-z0-9][A-Za-z0-9\-_.]*/g, 'a').replace(/\s+/g, '')
    n += l.length
  }
  return n
}

// —— 准备：开页（demo 项目 novel 直达第1章）→ 载入 ——
const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel?ch=' + encodeURIComponent('第01章_雾港.md'))
const page = await attach(tab.webSocketDebuggerUrl)
await setSize(page, VIEW.w, VIEW.h)
await evalUntil(page, bodyHas('第1章'), Boolean, 20000, '正文页载入')
await page.eval(clickBtn('第1章 · 雾港', false))
await evalUntil(page, `!!document.querySelector('.ProseMirror')`, Boolean, 20000, '编辑器挂载')
await sleep(800)

// ① 初始（无选区）：状态栏无「已选」
const init = await page.eval(`document.body.innerText.includes('已选')`)
ok('载入后无选区时状态栏不显示「已选」', init === false, String(init))

// ② 程序化全选正文 →「已选 N 字」出现且 N === countWords(选区)
const selInfo = await page.eval(`(() => {
  const pm = document.querySelector('.ProseMirror')
  if (!pm) return null
  const r = document.createRange()
  r.selectNodeContents(pm)
  const s = window.getSelection()
  s.removeAllRanges()
  s.addRange(r)
  return s.toString()
})()`)
await sleep(400)
const shown = await page.eval(`(() => {
  const m = document.body.innerText.match(/已选 ([0-9]+) 字/)
  return m ? Number(m[1]) : -1
})()`)
ok('全选后显示「已选 N 字」且 N>0', shown > 0, String(shown))
ok('「已选 N 字」计数与 countWords(选区) 一致', shown === cw(selInfo || ''), `${shown} vs ${cw(selInfo || '')}`)

// ③ 取消选区 →「已选」消失
await page.eval(`(() => { const s = window.getSelection(); s.removeAllRanges(); return true })()`)
await sleep(400)
const gone = await page.eval(`document.body.innerText.includes('已选')`)
ok('取消选区后「已选」消失', gone === false, String(gone))

// 截图（选中态）
try {
  await page.eval(`(() => {
    const pm = document.querySelector('.ProseMirror')
    if (pm) { const r = document.createRange(); r.selectNodeContents(pm); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r) }
    return true
  })()`)
  await sleep(300)
  const shot = await page.cmd('Page.captureScreenshot', { format: 'png' })
  const fs = await import('fs')
  fs.writeFileSync(OUT + '/sel-count-' + new Date().toTimeString().slice(0, 5).replace(':', '') + '.png', Buffer.from(shot.data, 'base64'))
  console.log('SCREENSHOT saved to ' + OUT)
} catch (e) { console.log('shot skip', String(e)) }

// ④ 无 JS 异常
ok('全程无 JS 异常', page.errors.length === 0, page.errors.join(' | '))

console.log((fail === 0 ? 'ALL PASS' : 'FAILED') + `  ${pass}/${pass + fail}`)
try { await page.close() } catch {}
if (fail > 0) process.exit(1)
