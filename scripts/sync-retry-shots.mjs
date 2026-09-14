// 织卷无头截图 · 切片同步失败可感知可重试（收口三入口，2026-09-14 创作层）
// 产物：~/Pictures/zhijuan/sync-retry-<tab>-<HHMM>.png（EditCard/HistoryDrawer/toast 三态）
// 用法：node scripts/sync-retry-shots.mjs
// 前置：python3 http.server 8123 --directory out/renderer；CDP 9224；先跑 npm run build
import { writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'

const CDP = 'http://127.0.0.1:9224'
const BASE = 'http://localhost:8123'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const PICS = `${homedir()}/Pictures/zhijuan`
mkdirSync(PICS, { recursive: true })

async function openTab(url) {
  const r = await fetch(CDP + '/json/new?' + encodeURIComponent(url), { method: 'PUT' })
  return r.json()
}
function attach(wsUrl) {
  const ws = new WebSocket(wsUrl)
  let seq = 0
  const pending = new Map()
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  }
  const cmd = (method, params = {}) =>
    new Promise((res, rej) => {
      const id = ++seq
      pending.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)))
      ws.send(JSON.stringify({ id, method, params }))
    })
  return new Promise((res) => {
    ws.onopen = () =>
      res({
        cmd,
        eval: async (expression) => {
          const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
          if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 300))
          return r.result?.value
        },
        shot: async (file) => {
          const r = await cmd('Page.captureScreenshot', { format: 'png' })
          writeFileSync(file, Buffer.from(r.data, 'base64'))
          console.log('SHOT:', file)
        },
        close: () => ws.close()
      })
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
const pageHas = (t) => `document.body.innerText.includes(${JSON.stringify(t)})`
const clickText = (text, exact = false) => `(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => ${exact ? `(b.innerText || '').trim() === ${JSON.stringify(text)}` : `(b.innerText || '').includes(${JSON.stringify(text)})`})
  if (!btn || btn.disabled) return false
  btn.click()
  return true
})()`

const hhmm = new Date().toTimeString().slice(0, 5).replace(':', '')

// ── Tab C：EditCard 采纳失败态 ──
const tabC = await openTab(BASE + '/?cb=' + Date.now() + '&zj-fail-x=agentSync#/project/demo-aseya/novel')
const pageC = await attach(tabC.webSocketDebuggerUrl)
await evalUntil(pageC, `document.body.innerText.includes('Agent') && !!document.querySelector('textarea')`, (v) => v === true, 20000, 'Agent 输入框')
await pageC.eval(`(() => {
  const ta = document.querySelector('textarea')
  ta.focus()
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(ta), 'value').set
  setter.call(ta, '把这段改一下')
  ta.setSelectionRange(ta.value.length, ta.value.length)
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  return true
})()`)
await evalUntil(pageC, pageHas('采纳并写入'), (v) => v === true, 20000, 'EditCard')
await pageC.eval(clickText('采纳并写入'))
await evalUntil(pageC, pageHas('✗ 切片同步失败'), (v) => v === true, 15000, '失败提示')
await sleep(400)
await pageC.shot(`${PICS}/sync-retry-editcard-${hhmm}.png`)
pageC.close()

// ── Tab D：HistoryDrawer 恢复失败态 ──
const tabD = await openTab(BASE + '/?cb=' + Date.now() + '&zj-fail-x=agentSync#/project/demo-aseya/novel')
const pageD = await attach(tabD.webSocketDebuggerUrl)
await evalUntil(pageD, pageHas('第1章 · 雾港'), (v) => v === true, 20000, '章节列表')
await pageD.eval(clickText('第1章 · 雾港'))
await evalUntil(pageD, `window.__ZJ_EDITORS && window.__ZJ_EDITORS.length > 0`, (v) => v === true, 20000, '编辑器')
const curMd = await pageD.eval(`window.zhijuan.readDoc('demo-aseya', '正文/第01章_雾港.md')`)
await pageD.eval(`window.zhijuan.writeDoc('demo-aseya', '正文/第01章_雾港.md', ${JSON.stringify((curMd || '') + '\n\n> 冒烟：造一版历史。')}).then(() => true)`)
await sleep(800)
await pageD.eval(clickText('历史', true))
await evalUntil(pageD, pageHas('版本历史'), (v) => v === true, 10000, '抽屉')
await pageD.eval(clickText('恢复此版本'))
await evalUntil(pageD, pageHas('再次点击确认恢复'), (v) => v === true, 6000, '确认')
await pageD.eval(clickText('再次点击确认恢复'))
await evalUntil(pageD, pageHas('✓ 已恢复；切片同步失败'), (v) => v === true, 15000, '失败提示')
await sleep(400)
await pageD.shot(`${PICS}/sync-retry-history-${hhmm}.png`)
pageD.close()

// ── Tab E：批注提案接受失败 toast 态 ──
const tabE = await openTab(BASE + '/?cb=' + Date.now() + '&zj-fail-x=agentSync#/project/demo-aseya/settings')
const pageE = await attach(tabE.webSocketDebuggerUrl)
await evalUntil(pageE, pageHas('外观与数据'), (v) => v === true, 20000, '设置页')
await pageE.eval(clickText('外观与数据'))
await evalUntil(pageE, pageHas('批注定时优化'), (v) => v === true, 10000, '批注开关')
await pageE.eval(`(() => {
  const rows = [...document.querySelectorAll('div')].filter((d) => d.textContent && d.textContent.includes('批注定时优化') && d.querySelector('button[role="switch"]'))
  const row = rows[rows.length - 1]
  const s = row && row.querySelector('button[role="switch"]')
  if (!s) return 'NO_SWITCH'
  if (s.getAttribute('aria-checked') !== 'true') s.click()
  return 'OK'
})()`)
await pageE.eval(clickText('保存设置', true))
await sleep(600)
await pageE.eval(`(() => { location.hash = '#/project/demo-aseya/novel'; return 1 })()`)
await evalUntil(pageE, pageHas('第1章 · 雾港'), (v) => v === true, 20000, '正文载入')
await evalUntil(pageE, pageHas('待确认提案'), (v) => v === true, 25000, '提案入口')
await pageE.eval(clickText('待确认提案'))
await evalUntil(pageE, pageHas('来自：批注同步'), (v) => v === true, 10000, '抽屉')
await pageE.eval(clickText('接受'))
await evalUntil(
  pageE,
  `[...document.querySelectorAll('.zj-toast button')].some((b) => (b.innerText || '').trim() === '重试同步')`,
  (v) => v === true,
  15000,
  'toast action'
)
await sleep(400)
await pageE.shot(`${PICS}/sync-retry-toast-${hhmm}.png`)
pageE.close()

console.log('SHOTS DONE')
