// 织卷无头冒烟 · devShim 演示项目「种子↔投影」一致性真值验证（2026-09-18 平台层 13:30 轮，观察项 ㊱ 根因修）：
// 断言 listProjects() 各演示项目 stats = 种子现算（与真机 store.summarize 同口径：chapters=正文 md、characters=人物−总览、
// worldviewFiles=世界观−总纲、materials=isMaterialCard 过滤）+ lastChapter=listChapters[0] + demo-yunshan 幻影已移除。
// 价值：home-stats 只断言「UI 与 listProjects 动态一致」，不校验 API 与种子的真值——真机口径再变时两边可同时漂移仍绿；
// 本脚本锁「seed ↔ 项目投影」真值，防 ㉛/㊱ 类失配。种子增删时同步更新本脚本期望值（维护契约）。
// 用法：node scripts/stats-live-probe.mjs
// 前置：node scripts/serve-renderer.mjs 8123；本机专用无头 Chrome CDP 127.0.0.1:9224
// 验收点：ALL PASS（四个演示项目现算值 + lastChapter + yunshan 移除 + 首页统计行）。
// 备注：临时验证脚本（今轮实抓 materials 过滤前缀 bug：真机 listDocs 返回相对素材库路径、isMaterialCard 不拼前缀）——保留为资产。
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
        close: () => ws.close()
      })
  })
}
async function evalUntil(page, expr, pred, timeoutMs = 20000, label = expr) {
  const t0 = Date.now()
  for (;;) {
    try {
      const v = await page.eval(expr)
      if (pred(v)) return v
    } catch {}
    if (Date.now() - t0 > timeoutMs) throw new Error('TIMEOUT: ' + label)
    await sleep(250)
  }
}

let tab, page, done = false, fails = 0
const bad = (m) => { fails++; console.log('FAIL: ' + m) }
const ok = (m) => console.log('OK: ' + m)
try {
  tab = await openTab(BASE + '/?cb=' + Date.now() + '#/')
  page = await attach(tab.webSocketDebuggerUrl)
  await evalUntil(page, `document.body.innerText.includes('织卷') && !!window.zhijuan`, (v) => v === true, 25000, '首页与devShim就绪')

  const projects = await page.eval(`window.zhijuan.listProjects().then((ps) => ps.map((p) => ({ id: p.id, stats: p.stats, lastChapter: p.lastChapter })))`)
  console.log('listProjects =', JSON.stringify(projects, null, 1))

  const byId = Object.fromEntries(projects.map((p) => [p.id, p]))
  const expect = {
    'demo-aseya': { chapters: 5, characters: 2, worldviewFiles: 1, materials: 3 },
    'demo-multiline': { chapters: 5, characters: 2, worldviewFiles: 0, materials: 0 },
    'demo-order': { chapters: 6, characters: 2, worldviewFiles: 0, materials: 0 },
    'demo-blank': { chapters: 0, characters: 0, worldviewFiles: 0, materials: 0 }
  }
  for (const [id, e] of Object.entries(expect)) {
    const s = byId[id]?.stats
    if (!s) { bad(id + ' 缺失'); continue }
    const got = JSON.stringify(s) === JSON.stringify(e)
    got ? ok(id + ' stats=' + JSON.stringify(s)) : bad(id + ' stats=' + JSON.stringify(s) + ' 期望 ' + JSON.stringify(e))
  }
  if (byId['demo-yunshan']) bad('demo-yunshan 仍存在: ' + JSON.stringify(byId['demo-yunshan']))
  else ok('demo-yunshan 已移除')
  if (byId['demo-order']?.lastChapter !== '第01章_晨港') bad('demo-order lastChapter=' + byId['demo-order']?.lastChapter)
  else ok('demo-order lastChapter=第01章_晨港')
  if (byId['demo-aseya']?.lastChapter !== '第01章_雾港') bad('demo-aseya lastChapter=' + byId['demo-aseya']?.lastChapter)
  else ok('demo-aseya lastChapter=第01章_雾港')
  if (byId['demo-multiline']?.lastChapter !== '第01章_夜航') bad('multiline lastChapter=' + byId['demo-multiline']?.lastChapter)
  else ok('demo-multiline lastChapter=第01章_夜航')
  if (byId['demo-blank']?.lastChapter !== undefined) bad('demo-blank lastChapter=' + byId['demo-blank']?.lastChapter)
  else ok('demo-blank 无 lastChapter（与真机空项目同语义）')

  // 页面卡片文本抽查（首页应稳定显示现算值；demo-yunshan 无卡片）
  const text = await page.eval(`document.body.innerText`)
  if (text.includes('云山驿事')) bad('首页仍出现 云山驿事 卡片')
  else ok('首页无 云山驿事 卡片')
  if (text.includes('5 章 · 人物 2 · 素材 3')) ok('首页含 demo-aseya 「5 章 · 人物 2 · 素材 3」')
  else bad('首页缺 demo-aseya 统计行')
  if (text.includes('6 章 · 人物 2')) ok('首页含 demo-order 「6 章 · 人物 2」')
  else bad('首页缺 demo-order 统计行')

  done = true
  console.log(fails ? `\nRESULT: FAIL x${fails}` : '\nRESULT: ALL PASS')
} finally {
  if (tab) { try { await fetch(CDP + '/json/close/' + tab.id) } catch {} }
  page?.close()
}
process.exit(fails ? 1 : 0)
