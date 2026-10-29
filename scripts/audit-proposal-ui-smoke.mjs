// 织卷无头冒烟 · 检查自动化 → 提案箱（2026-10-29 智能层，封版① 中篇验收配套）
// 背景：F-20261028-09「本地 9 项自动跑 → 转提案」落地后，dev/无头世界看到的永远是 0 条
// （devShim auditAuto 写死 mock 返回 0）→ 界面「检查完成：新增 N 条提案」与提案卡从未被真实验证。
// 本轮：presence（约定头「涉及人物」vs 正文）生成按章合并的可执行 replace-text 提案；
//       devShim auditAuto 改为与主进程同算法（共享纯函数），本冒烟即验证它 + 抽屉呈现。
// 覆盖：
//   A devShim auditAuto 真算 → created>0，卡片 target=正文章节、kind=replace-text、理由「检查 · 在场核查」
//   B 重复跑同款 → created=0（pending 去重，保存多次不刷屏）
//   C 提案抽屉里看得到这张卡（来源「检查」+ 涉及人物行可读）
//   D 全程无 JS 异常
// 用法：node scripts/audit-proposal-ui-smoke.mjs   （需 out/renderer 已 build + SPA server + CDP 9224）
import { writeFileSync } from 'node:fs'
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
  const p = new Map()
  const errors = []
  ws.onmessage = (e) => {
      const msg = JSON.parse(e.data)
      if (msg.id && p.has(msg.id)) {
      p.get(msg.id)(msg)
      p.delete(msg.id)
      return
    }
    if (msg.method === 'Runtime.exceptionThrown')
      errors.push(msg.params?.exceptionDetails?.exception?.description || JSON.stringify(msg.params?.exceptionDetails || {}).slice(0, 200))
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error')
      errors.push((msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200))
  }
  const cmd = (method, params = {}) =>
    new Promise((res, rej) => {
      const id = ++seq
      p.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)))
      ws.send(JSON.stringify({ id, method, params }))
    })
  return new Promise((res) => {
    ws.onopen = async () => {
      const page = {
        cmd,
        errors,
        eval: async (expression) => {
          const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
          if (r.exceptionDetails) throw new Error('EVAL ' + JSON.stringify(r.exceptionDetails).slice(0, 300))
          return r.result?.value
        }
      }
      try { await cmd('Runtime.enable') } catch {}
      res(page)
    }
  })
}
async function evalUntil(page, expr, pred, timeoutMs = 15000, label = expr) {
  const t0 = Date.now()
  for (;;) {
    try {
      const v = await page.eval(expr)
      if (pred(v)) return v
    } catch {}
    if (Date.now() - t0 > timeoutMs) throw new Error('TIMEOUT ' + label)
    await sleep(250)
  }
}
let fail = 0
const ok = (n, c, x = '') => {
  console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' | ' + x : ''))
  if (!c) fail++
}
const openDrawer = `(() => { const b = [...document.querySelectorAll('button')].find(x => (x.getAttribute('title')||'').includes('待确认') || (x.innerText||'').includes('待确认提案')); if (b) { b.click(); return true } return false })()`
const cardsJson = `(() => [...document.querySelectorAll('[data-pid]')].map(c => ({ meta: c.querySelector('[data-testid="proposal-meta"]')?.innerText || '', all: c.innerText })))()`

const tab = await openTab(BASE)
const page = await attach(tab.webSocketDebuggerUrl)
try {
  await evalUntil(page, `typeof window.zhijuan?.auditAuto === 'function'`, (v) => v === true, 20000, 'zhijuan 就绪')
  await page.eval(`window.zhijuan.setSettings({ guideEnabled: false })`)
  await page.eval(`(location.hash = '#/project/demo-aseya/novel', 1)`)
  await sleep(1500)

  // A devShim auditAuto 真算（与主进程同算法）
  const r1 = await page.eval(`window.zhijuan.auditAuto('demo-aseya', { kinds: ['presence'] })`)
  ok('A1 auditAuto 出提案（不再写死 0 条）', r1?.created > 0, `created=${r1?.created}`)
  const cards = await page.eval(`(async () => { const ps = await window.zhijuan.listProposals('demo-aseya'); return ps.filter(p => p.source === 'audit' && p.status === 'pending').map(p => ({ it: p.items[0] })) })()`)
  const first = cards?.[0]?.it
  ok('A2 卡片 target=正文章节文件', /^正文\/.*\.md$/.test(first?.target ?? ''), first?.target)
  ok('A3 卡片 kind=replace-text（可执行，非建议文本）', first?.kind === 'replace-text', first?.kind)
  ok('A4 卡片 before/after 都是约定头「涉及人物」行', /^涉及人物: /.test(first?.before ?? '') && (/^涉及人物: /.test(first?.after ?? '') || first?.after === ''), `${first?.before} → ${first?.after}`)
  ok('A5 理由为中文且写明移出/补入', /检查 · 在场核查/.test(first?.reason ?? '') && /(移出|补入)/.test(first?.reason ?? ''), first?.reason)

  // B 重复跑：去重
  const r2 = await page.eval(`window.zhijuan.auditAuto('demo-aseya', { kinds: ['presence'] })`)
  ok('B1 重跑 created=0（pending 去重，保存多次不刷屏）', r2?.created === 0, `created=${r2?.created}`)

  // C 抽屉呈现
  const opened = await page.eval(openDrawer)
  ok('C1 提案抽屉可打开', opened === true)
  const list = await evalUntil(page, cardsJson, (v) => Array.isArray(v) && v.length > 0, 10000, '提案卡出现')
  const auditCard = list.find((c) => c.all.includes('检查 · 在场核查'))
  ok('C2 抽屉里有检查类提案卡', !!auditCard)
  ok('C3 卡片正文可读（含「涉及人物」行，非内部 id）', !!auditCard && auditCard.all.includes('涉及人物') && !auditCard.all.includes('presence'), auditCard ? auditCard.all.slice(0, 80).replace(/\n/g, ' / ') : '')

  // D 无 JS 异常
  ok('D1 无 JS 异常', page.errors.length === 0, page.errors.slice(0, 2).join(' / '))

  const s = await page.cmd('Page.captureScreenshot', { format: 'png' })
  const stamp = new Date().toTimeString().slice(0, 5).replace(':', '')
  writeFileSync(process.env.HOME + `/Pictures/zhijuan/audit-proposal-${stamp}.png`, Buffer.from(s.data, 'base64'))
  console.log('SHOT ' + process.env.HOME + `/Pictures/zhijuan/audit-proposal-${stamp}.png`)
} catch (e) {
  console.error('FATAL: ' + e.message)
  if (page.errors?.length) console.error('JS ERRORS: ' + page.errors.slice(0, 3).join(' / '))
  fail++
} finally {
  try { await fetch(CDP + '/json/close/' + tab.id) } catch {}
}
console.log(`\n结果：${fail === 0 ? 'ALL PASS' : fail + ' 项失败'}`)
process.exit(fail ? 1 : 0)