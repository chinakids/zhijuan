// 织卷无头冒烟 · 功能引导增量2 步骤 4/5/7（F-20260923-02）
// 覆盖：outline-direct(⑤) / agent-check(⑦) / proposal-guide(④)。
// 每步用独立新 tab（干净挂载 + 预置 seen），避免跨步锁/seen 残留。
// 步骤⑥ quote-annotate 依赖真实划词浮层，由 manual 验证。
// 用法：node scripts/guide-steps-ui-smoke.mjs
import { writeFileSync } from 'node:fs'
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function openTab(url) { const r = await fetch(CDP + '/json/new?' + encodeURIComponent(url), { method: 'PUT' }); return r.json() }
function attach(wsUrl) {
  const ws = new WebSocket(wsUrl); let seq = 0; const p = new Map()
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { p.get(m.id)(m); p.delete(m.id) } }
  const cmd = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; p.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result))); ws.send(JSON.stringify({ id, method, params })) })
  return new Promise((res) => { ws.onopen = () => res({ cmd, eval: async (expression) => { const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error('EVAL ' + JSON.stringify(r.exceptionDetails).slice(0, 200)); return r.result?.value } }) })
}
async function evalUntil(page, expr, pred, timeoutMs = 15000, label = expr) {
  const t0 = Date.now()
  for (;;) { try { const v = await page.eval(expr); if (pred(v)) return v } catch {} if (Date.now() - t0 > timeoutMs) throw new Error('TIMEOUT ' + label); await sleep(250) }
}
let fail = 0
const ok = (n, c, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' | ' + x : '')); if (!c) fail++ }
const ALL = ['novel-first', 'proposal-guide', 'outline-direct', 'quote-annotate', 'agent-check']

for (const key of ['outline-direct', 'agent-check', 'proposal-guide']) {
  const tab = await openTab(BASE)
  const page = await attach(tab.webSocketDebuggerUrl)
  try {
    await evalUntil(page, `typeof window.zhijuan?.setSettings === 'function'`, (v) => v === true, 20000, 'zhijuan 就绪')
    const seen = ALL.filter((k) => k !== key) // 只留当前 key 未 seen
    await page.eval(`window.zhijuan.setSettings({ guideSeen: ${JSON.stringify(seen)} })`)
    const route = key === 'outline-direct' ? 'outline' : 'novel'
    await page.eval(`(location.hash = '#/project/demo-aseya/${route}', 1)`)
    await sleep(1600)
    if (key === 'proposal-guide') {
      // demo 冷启动无提案：先经 createProposals 造一条待确认提案，「待确认提案」按钮出现后引导才触发
      await page.eval(`window.zhijuan.createProposals('demo-aseya','agent-chat','正文/第01章_雾港.md','雾港',[{target:'世界观/世界观.md',anchor:'雾港',kind:'append',before:'',after:'演示小节',reason:'演示引导'}]).catch(() => {})`)
      await sleep(1400)
    }
    if (key === 'outline-direct') {
      await page.eval(`(() => { const c = [...document.querySelectorAll('[data-testid="outline-col"] a, [data-testid="outline-col"] button, [data-testid="outline-col"] li')]; if (c[0]) { c[0].click(); return true } return false })()`)
      await sleep(800)
    }
    try {
      await evalUntil(page, `(() => { const t = document.querySelector('[data-testid="tour-tip"]'); return t ? t.innerText : '' })()`, (v) => typeof v === 'string' && v.length > 0, 15000, key + ' 出现')
    } catch {}
    const txt = await page.eval(`document.querySelector('[data-testid="tour-tip"]')?.innerText || ''`)
    const okWord = key === 'outline-direct' ? '导演' : key === 'agent-check' ? '检查' : '提案'
    ok(`步骤触发 ${key}`, txt.includes(okWord) && txt.length > 0, txt.slice(0, 50))
    if (key === 'proposal-guide') { const shot = await page.cmd('Page.captureScreenshot', { format: 'png' }); const out = process.env.HOME + '/Pictures/zhijuan/guide-proposal.png'; writeFileSync(out, Buffer.from(shot.data, 'base64')); console.log('SHOT ' + out) }
  } catch (e) {
    console.error('FATAL ' + key + ': ' + e.message)
    fail++
  } finally {
    try { await fetch(CDP + '/json/close/' + tab.id) } catch {}
  }
}

console.log('RESULT ' + (fail ? fail + ' FAIL' : 'ALL OK'))
process.exit(fail ? 1 : 0)
