// 无头验证 HistoryDrawer 空态新文案（2026-09-15 智能层 06:00 轮）
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
const ID = 'demo-aseya'
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
    try { const v = await page.eval(expr); if (pred(v)) return v } catch {}
    if (Date.now() - t0 > timeoutMs) throw new Error('TIMEOUT: ' + label)
    await sleep(250)
  }
}

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/' + ID + '/outline')
const page = await attach(tab.webSocketDebuggerUrl)
let fails = 0
const ok = (name, cond, extra = '') => {
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : ''))
  if (!cond) fails++
}
try {
  await evalUntil(page, `document.body.innerText.includes('章卡索引')`, (v) => v === true, 25000, '大纲页就绪')
  // 打开章卡历史抽屉 → 空态
  await page.eval(`(() => { const b = document.querySelector('[data-testid="card-history"]'); if (b) { b.click(); return true } return false })()`)
  await evalUntil(page, `document.body.innerText.includes('版本历史')`, (v) => v === true, 8000, '抽屉打开')
  const p = await page.eval(`(() => {
    const ps = [...document.querySelectorAll('p')].filter((x) => (x.textContent || '').includes('还没有历史版本'))
    return ps.length ? ps[0].textContent : ''
  })()`)
  console.log('TEXT:', p)
  ok('空态文案为新通用措辞', p.includes('正文、审读、章卡、导演板或分幕内容有变化时'), '')
  ok('旧文案已移除', !p.includes('保存正文 / 重跑审读'), '')
  // 截图
  const shot = await page.cmd('Page.captureScreenshot', { format: 'png' })
  if (shot && shot.data) {
    const fs = await import('node:fs')
    fs.writeFileSync('/Users/USER/Pictures/zhijuan/history-empty-0613.png', Buffer.from(shot.data, 'base64'))
    console.log('SCREENSHOT: /Users/USER/Pictures/zhijuan/history-empty-0613.png')
  }
  ok('无 JS 异常', page.errors.length === 0, page.errors.join(' | ').slice(0, 200))
} catch (e) {
  console.log('ERROR:', e.message)
  fails++
}
await page.close()
console.log(fails === 0 ? 'SMOKE PASS' : 'SMOKE FAIL ' + fails)
process.exit(fails === 0 ? 0 : 1)
