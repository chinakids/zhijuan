// 织卷无头冒烟 · 提案卡「属于哪条时间线」+ 检查类提案元信息（2026-10-28 体验层，封版① 双线中篇验收）
// 背景：跨线重名切片（R7）下两张提案卡 target/切片/理由可完全相同，作者接受前必须能分辨是哪条线的状态；
//       检查类提案（source=audit，chapter/slice 皆空）此前整行元信息（含「生成于」）都不渲染，理由还漏内部 id。
// 覆盖：
//   A 多线项目（demo-order 潮汐的岔路）：主线段卡显「主线」、过去线段卡显「过去线」；章名不带「正文/」与 .md
//   B 检查类提案：元信息行常显（有「生成于」）、理由为「检查 · 在场」（不含英文 id presence）
//   C 单线项目（demo-aseya）：无任何线徽标（零打扰）
//   D 全程无 JS 异常
// 用法：node scripts/proposal-line-badge-ui-smoke.mjs   （需 out/renderer 已 build + SPA server + CDP 9224）
import { writeFileSync } from 'node:fs'
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function openTab(url) { const r = await fetch(CDP + '/json/new?' + encodeURIComponent(url), { method: 'PUT' }); return r.json() }
function attach(wsUrl) {
  const ws = new WebSocket(wsUrl); let seq = 0; const p = new Map(); const errors = []
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.id && p.has(m.id)) { p.get(m.id)(m); p.delete(m.id); return }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params?.exceptionDetails?.exception?.description || JSON.stringify(m.params?.exceptionDetails || {}).slice(0, 200))
    if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') errors.push((m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200))
  }
  const cmd = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; p.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result))); ws.send(JSON.stringify({ id, method, params })) })
  return new Promise((res) => {
    ws.onopen = async () => {
      const page = { cmd, errors, eval: async (expression) => { const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error('EVAL ' + JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result?.value } }
      try { await cmd('Runtime.enable') } catch {}
      res(page)
    }
  })
}
async function evalUntil(page, expr, pred, timeoutMs = 15000, label = expr) {
  const t0 = Date.now()
  for (;;) { try { const v = await page.eval(expr); if (pred(v)) return v } catch {} if (Date.now() - t0 > timeoutMs) throw new Error('TIMEOUT ' + label); await sleep(250) }
}
let fail = 0
const ok = (n, c, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' | ' + x : '')); if (!c) fail++ }
const openDrawer = `(() => { const b = [...document.querySelectorAll('button')].find(x => (x.getAttribute('title')||'').includes('待确认') || (x.innerText||'').includes('待确认提案')); if (b) { b.click(); return true } return false })()`
const cardsJson = `(() => [...document.querySelectorAll('[data-pid]')].map(c => ({ meta: c.querySelector('[data-testid="proposal-meta"]')?.innerText || '', line: c.querySelector('[data-testid="proposal-line"]')?.innerText || '', all: c.innerText })))()`

async function run(projectId, seedFn, checks) {
  const tab = await openTab(BASE)
  const page = await attach(tab.webSocketDebuggerUrl)
  try {
    await evalUntil(page, `typeof window.zhijuan?.listChapters === 'function'`, (v) => v === true, 20000, 'zhijuan 就绪')
    await page.eval(`window.zhijuan.setSettings({ guideEnabled: false })`)
    await page.eval(`(location.hash = '#/project/${projectId}/novel', 1)`)
    await sleep(1600)
    if (seedFn) { await page.eval(seedFn); await sleep(1400) }
    const opened = await page.eval(openDrawer)
    await sleep(1200)
    ok('提案抽屉打开', opened === true)
    const cards = await evalUntil(page, cardsJson, (v) => Array.isArray(v) && v.length > 0, 10000, '提案卡出现')
    await checks(page, cards)
    // 全程无 JS 异常（编辑器域模板：Runtime.exceptionThrown + console error 双通道）
    ok('无 JS 异常', page.errors.length === 0, page.errors.slice(0, 2).join(' / '))
  } catch (e) {
    console.error('FATAL ' + projectId + ': ' + e.message)
    if (page.errors?.length) console.error('JS ERRORS: ' + page.errors.slice(0, 3).join(' / '))
    fail++
  } finally {
    try { await fetch(CDP + '/json/close/' + tab.id) } catch {}
  }
}

// A/B 多线项目
let shot = false
await run('demo-order', `
  (async () => {
    await window.zhijuan.createProposals('demo-order','slice-sync','正文/第01章_晨港.md','第一幕_潮起',[{target:'世界观/潮汐.md',anchor:'潮汐',kind:'append',before:'',after:'主线小节内容',reason:'主线：潮水记得'}])
    await window.zhijuan.createProposals('demo-order','slice-sync','正文/第02章_旧港.md','第一幕_潮起',[{target:'世界观/潮汐.md',anchor:'潮汐',kind:'append',before:'',after:'过去线小节内容',reason:'过去线：三十年前'}])
    await window.zhijuan.createProposals('demo-order','audit','','',[{target:'人物/苏晚.md',anchor:'',kind:'append',before:'',after:'补记：本章未出场说明',reason:'检查 · 在场'}],{note:'presence'})
    return true
  })()
`, async (page, cards) => {
  const main = cards.find((c) => c.all.includes('主线：潮水记得'))
  const past = cards.find((c) => c.all.includes('过去线：三十年前'))
  const audit = cards.find((c) => c.all.includes('检查 · 在场'))
  ok('多线：主线段卡有「主线」线徽标', !!main && main.line === '主线', main ? `line=${main.line}` : 'card 缺失')
  ok('多线：过去线段卡有「过去线」线徽标（同切片名可分辨）', !!past && past.line === '过去线', past ? `line=${past.line}` : 'card 缺失')
  ok('多线：同切片名两卡切片标签一致（演示前提成立）', !!main && !!past && main.meta.includes('第一幕_潮起') && past.meta.includes('第一幕_潮起'))
  ok('章名剥「正文/」与 .md', !!past && past.meta.includes('章：第02章_旧港') && !past.meta.includes('正文/') && !past.meta.includes('.md'), past ? past.meta.replace(/\n/g, ' / ') : '')
  ok('检查类提案：元信息行常显（含「生成于」）', !!audit && audit.meta.includes('生成于'), audit ? audit.meta.replace(/\n/g, ' / ') : 'card 缺失')
  ok('检查类提案：理由为中文短名，不含内部 id', !!audit && audit.all.includes('检查 · 在场') && !/检查 · presence/.test(audit.all))
  // 防溢出（HIG：元信息行不得撑破卡片）——多线项目多了一个线徽标，窄面板下最容易挤出去
  const overflow = await page.eval(`[...document.querySelectorAll('[data-pid]')].filter(c => c.scrollWidth > c.clientWidth + 1).length`)
  ok('卡片无横向溢出（含线徽标后）', overflow === 0, '溢出卡=' + overflow)
  const s = await page.cmd('Page.captureScreenshot', { format: 'png' })
  writeFileSync(process.env.HOME + '/Pictures/zhijuan/proposal-line-badge-2020.png', Buffer.from(s.data, 'base64'))
  shot = true
})

// C 单线项目零打扰
await run('demo-aseya', `
  window.zhijuan.createProposals('demo-aseya','slice-sync','正文/第01章_雾港.md','第一幕_雾港之夜',[{target:'世界观/雾港.md',anchor:'雾港',kind:'append',before:'',after:'单线小节内容',reason:'单线：无徽标'}])
`, async (_page, cards) => {
  const cardsWithLine = cards.filter((c) => c.line)
  ok('单线项目：卡片不显示线徽标（零打扰）', cardsWithLine.length === 0, '带线徽标卡=' + cardsWithLine.length)
  const one = cards.find((c) => c.all.includes('单线：无徽标'))
  ok('单线项目：元信息行仍完整（章/切片/生成于）', !!one && one.meta.includes('章：第01章_雾港') && one.meta.includes('生成于'), one ? one.meta.replace(/\n/g, ' / ') : 'card 缺失')
})

if (shot) console.log('SHOT ' + process.env.HOME + '/Pictures/zhijuan/proposal-line-badge-2020.png')
console.log('RESULT ' + (fail ? fail + ' FAIL' : 'ALL OK'))
process.exit(fail ? 1 : 0)