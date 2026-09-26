// 终态标记特写取证（体验层 2026-09-26）：重放「模拟截断」→ 截状态行元素特写 + getComputedStyle 客观值
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function openTab(url) {
  const r = await fetch(CDP + '/json/new?' + encodeURIComponent(url), { method: 'PUT' })
  return r.json()
}
function attach(wsUrl) {
  const ws = new WebSocket(wsUrl)
  let seq = 0
  const pending = new Map()
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
  const cmd = (method, params = {}) =>
    new Promise((res, rej) => { const id = ++seq; pending.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result))); ws.send(JSON.stringify({ id, method, params })) })
  return new Promise((res) => {
    ws.onopen = async () => {
      await cmd('Runtime.enable').catch(() => {})
      res({
        cmd,
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
    try { const v = await page.eval(expr); if (pred(v)) return v } catch {}
    if (Date.now() - t0 > timeoutMs) throw new Error('TIMEOUT: ' + label)
    await sleep(250)
  }
}

let tab = null
try {
  tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel')
  const page = await attach(tab.webSocketDebuggerUrl)
  await evalUntil(page, `document.body.innerText.includes('Agent') && !!document.querySelector('textarea')`, (v) => v === true, 20000, '就绪')
  await evalUntil(page, `[...document.querySelectorAll('button')].some(b => (b.textContent||'').includes('第1章 · 雾港'))`, (v) => v === true, 10000, '章项')
  await page.eval(`(() => { const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').includes('第1章 · 雾港')); b.click(); return true })()`)
  await sleep(800)
  await page.eval(`(() => { const ta = document.querySelector('textarea'); ta.focus(); const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(ta), 'value').set; setter.call(ta, '模拟截断'); ta.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
  await sleep(400)
  await page.eval(`(() => { const ta = document.querySelector('textarea'); ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); return true })()`)
  await evalUntil(page, `document.body.innerText`, (v) => v.includes('（输出已截断）'), 25000, '截断标记')
  await sleep(600)
  // 客观样式取证：状态行 color/fontSize + 所在消息气泡背景 + 正文段字号对比
  const styles = await page.eval(`(() => {
    const el = document.querySelector('[data-testid="zj-terminal-truncated"]')
    if (!el) return null
    const cs = getComputedStyle(el)
    const bubble = el.closest('.rounded-xl')
    const csb = bubble ? getComputedStyle(bubble) : null
    const p = el.parentElement.querySelector('p')
    const csp = p ? getComputedStyle(p) : null
    return { color: cs.color, fontSize: cs.fontSize, bubbleBg: csb ? csb.backgroundColor : null, bubbleBorder: csb ? csb.borderColor : null, paraColor: csp ? csp.color : null, paraFontSize: csp ? csp.fontSize : null }
  })()`)
  console.log('STYLES:', JSON.stringify(styles))
  // 元素特写（状态行所在气泡，含一行正文作对比）
  const rect = await page.eval(`(() => { const el = document.querySelector('[data-testid="zj-terminal-truncated"]'); const b = el.closest('.rounded-xl'); const r = b.getBoundingClientRect(); return { x: r.x - 8, y: r.y - 8, w: r.width + 16, h: Math.min(260, r.height + 16) } })()`)
  const shot = await page.cmd('Page.captureScreenshot', { format: 'png', clip: { x: Math.max(0, rect.x), y: Math.max(0, rect.y), width: rect.w, height: rect.h, scale: 2 } })
  if (shot?.data) {
    const fs = await import('node:fs')
    fs.mkdirSync(process.env.HOME + '/Pictures/zhijuan', { recursive: true })
    const p = process.env.HOME + '/Pictures/zhijuan/terminal-zoom-' + String(new Date().getHours()).padStart(2, '0') + String(new Date().getMinutes()).padStart(2, '0') + '.png'
    fs.writeFileSync(p, Buffer.from(shot.data, 'base64'))
    console.log('ZOOM:', p)
  }
  console.log('TERMINAL-ZOOM OK')
} catch (e) {
  console.error('FAILED:', e.message)
  process.exitCode = 1
} finally {
  tab && fetch(CDP + '/json/close/' + tab.id).catch(() => {})
}
