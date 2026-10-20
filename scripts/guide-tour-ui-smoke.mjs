// 织卷无头冒烟 · 用户动线功能引导（体验层 2026-09-23，F-20260923-02）
// 链路：devShim demo-aseya novel -> 选章 -> 引导 step1(agent) 自动弹出 -> 下一步 -> save -> 下一步 -> health -> 完成 -> 消失
//       -> 设置页「首次使用引导」开关 + 「重新查看」按钮存在
// 用法：node scripts/guide-tour-ui-smoke.mjs
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

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel')
const page = await attach(tab.webSocketDebuggerUrl)
try {
    await evalUntil(page, `typeof window.zhijuan?.setSettings === 'function'`, (v) => v === true, 20000, 'zhijuan 就绪')
    // 预置 seen 排除 Agent 检查/提案/批注等旁支引导，只留 novel-first 主线
    await page.eval(`window.zhijuan.setSettings({ guideSeen: ['agent-check', 'proposal-guide', 'quote-annotate'] })`)
  await evalUntil(page, `document.body.innerText.includes('正文创作')`, (v) => v === true, 20000, 'novel 就绪')
  // 选一章（保证 保存/体检 目标存在）
  await page.eval(`(() => { const b = [...document.querySelectorAll('aside button, [data-testid="chapter-sidebar"] button')].find((x) => (x.innerText || '').includes('第1章')); if (b) { b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'mouse'})); b.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerType:'mouse'})); b.click(); return true } return false })()`)
  await sleep(1500)

  // ① 引导 step1 自动弹出
  await evalUntil(page, `!!document.querySelector('[data-testid="tour-tip"]')`, (v) => v === true, 15000, 'tour-tip 出现')
  const s1 = await page.eval(`document.querySelector('[data-testid="tour-tip"]')?.innerText || ''`)
  ok('引导 step1 弹出（创作 Agent）', /与创作 Agent 协作/.test(s1) && /agent/.test(s1), s1.slice(0, 60))

  // ② 下一步 -> save
  await page.eval(`document.querySelector('[data-testid="tour-next"]').click()`)
  await sleep(300)
  const s2 = await page.eval(`document.querySelector('[data-testid="tour-tip"]')?.innerText || ''`)
  ok('下一步 → 保存与切片同步', /保存与切片同步/.test(s2), s2.slice(0, 60))

  // ③ 下一步 -> health
  await page.eval(`document.querySelector('[data-testid="tour-next"]').click()`)
  await sleep(300)
  const s3 = await page.eval(`document.querySelector('[data-testid="tour-tip"]')?.innerText || ''`)
  ok('下一步 → 规则体检状态栏', /规则体检状态栏/.test(s3), s3.slice(0, 60))

  // ④ 完成 → 引导消失（seen 已写，不再重弹）
  await page.eval(`document.querySelector('[data-testid="tour-next"]').click()`)
  await sleep(500)
  const gone = await page.eval(`!document.querySelector('[data-testid="tour-tip"]')`)
  ok('完成后引导消失', gone === true)

  // 截图
  try { const shot = await page.cmd('Page.captureScreenshot', { format: 'png' }); const out = process.env.HOME + '/Pictures/zhijuan/guide-tour-' + new Date().toTimeString().slice(0, 5).replace(':', '') + '.png'; writeFileSync(out, Buffer.from(shot.data, 'base64')); console.log('SHOT ' + out) } catch {}

  // ⑤ 设置页：引导开关 + 重新查看（直接置 look pane 后进入，规避导航匹配）
  await page.eval(`window.zhijuan.setSettings({ settingsPane: 'look' }).then(() => (location.hash = '#/project/demo-aseya/settings', 1))`)
  await sleep(1500)
  await evalUntil(page, `document.body.innerText.includes('首次使用引导')`, (v) => v === true, 15000, '引导开关出现')
  const setopts = await page.eval(`(() => { const t = document.body.innerText; return { sw: t.includes('首次使用引导'), replay: !!document.querySelector('[data-testid="guide-replay"]') } })()`)
  ok('设置页含「首次使用引导」开关', setopts.sw === true, JSON.stringify(setopts))
  ok('设置页含「重新查看」按钮', setopts.replay === true)
} catch (e) {
  console.error('FATAL', e.message)
  fail++
} finally {
  try { await fetch(CDP + '/json/close/' + tab.id) } catch {}
}
console.log('RESULT ' + (fail ? fail + ' FAIL' : 'ALL OK'))
process.exit(fail ? 1 : 0)
