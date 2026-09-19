// 织卷无头冒烟 · DocSection 初始选中修正（2026-09-19 17:15 体验层轮，候选 1「DocSection 初始空编辑器」）
// 用法：node scripts/docsection-overview-ui-smoke.mjs
// 前置：npm run build；out/renderer 由 http.server(8123) 服务；本机无头 Chrome CDP 127.0.0.1:9224
// 验收点：
//  A. demo-aseya 人物页（有总览 seed）→ 自动选中「人物 · 总览」，无「开始写作…」空占位，列表含总览项
//  B. demo-aseya 世界观页（有总纲）→ 自动选中总纲（回归）
//  C. 防御态：demo-multiline（无总览/总纲 seed）人物页/世界观页 → 「选择左侧一个文档开始」，不挂空编辑器
//  D. 动态防御：demo-aseya 人物页删除总览（fs 事件）→ 页面转「选择左侧一个文档开始」
//  E. 回归：demo-aseya 人物页点「阿七」→ 编辑器显示「基础档案」
//  F. 全程零 JS 异常 + 截图
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const OUT = process.env.HOME + '/Pictures/zhijuan'

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
    await sleep(250)
  }
}
async function shot(page, name) {
  const s = await page.cmd('Page.captureScreenshot', { format: 'png' })
  if (s?.data) {
    const fs = await import('node:fs')
    fs.mkdirSync(OUT, { recursive: true })
    const hh = String(new Date().getHours()).padStart(2, '0')
    const mm = String(new Date().getMinutes()).padStart(2, '0')
    const p = `${OUT}/${name}-${hh}${mm}.png`
    fs.writeFileSync(p, Buffer.from(s.data, 'base64'))
    console.log('SCREENSHOT:', p)
  }
}

let fails = 0
const ok = (name, cond, extra = '') => {
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : ''))
  if (!cond) fails++
}

// 编辑器态快照：PM 挂载? / PM 文本 / 空占位 / 主区提示
const snapExpr = `(() => {
  const pm = document.querySelector('.ProseMirror')
  const empty = document.querySelector('.zj-empty')
  const hint = [...document.querySelectorAll('div')].find((d) => (d.textContent || '').trim() === '选择左侧一个文档开始')
  return { pm: !!pm, pmText: pm ? pm.textContent : '', empty: !!empty, hint: !!hint }
})()`

async function nav(page, route) {
  await page.cmd('Page.navigate', { url: BASE + '/?cb=' + Date.now() + route })
}

// ===== A. demo-aseya 人物页：自动选中总览 =====
{
  const tab = await openTab('about:blank')
  const page = await attach(tab.webSocketDebuggerUrl)
  await nav(page, '#/project/demo-aseya/characters')
  await evalUntil(page, snapExpr, (s) => s && s.pm, 20000, 'A 人物页编辑器挂载')
  await evalUntil(page, snapExpr, (s) => s && (s.pmText || '').includes('人物 · 总览'), 15000, 'A 总览内容')
  const s = await page.eval(snapExpr)
  ok('A1 人物页自动打开「人物 · 总览」', (s.pmText || '').includes('人物 · 总览'), JSON.stringify(s.pmText.slice(0, 40)))
  ok('A2 无「开始写作…」空占位', s.empty === false)
  const listHasOverview = await page.eval(`[...document.querySelectorAll('[data-testid="doc-col"] button')].some((b) => (b.textContent || '').includes('总览'))`)
  ok('A3 人物档案列表含「总览」项', listHasOverview === true)
  await shot(page, 'docsection-overview-char')
  ok('A 无 JS 异常', page.errors.length === 0, String(page.errors.slice(0, 2)))
  page.close()
}

// ===== B. demo-aseya 世界观页：自动选中总纲（回归） =====
{
  const tab = await openTab('about:blank')
  const page = await attach(tab.webSocketDebuggerUrl)
  await nav(page, '#/project/demo-aseya/worldview')
  await evalUntil(page, snapExpr, (s) => s && s.pm && (s.pmText || '').includes('世界观总纲'), 20000, 'B 总纲内容')
  const s = await page.eval(snapExpr)
  ok('B1 世界观页自动打开总纲', (s.pmText || '').includes('世界观总纲'))
  ok('B2 无「开始写作…」空占位', s.empty === false)
  ok('B 无 JS 异常', page.errors.length === 0, String(page.errors.slice(0, 2)))
  page.close()
}

// ===== C. 防御态：demo-multiline（无总览/总纲）→ 不挂空编辑器 =====
{
  const tab = await openTab('about:blank')
  const page = await attach(tab.webSocketDebuggerUrl)
  await nav(page, '#/project/demo-multiline/characters')
  await evalUntil(page, snapExpr, (s) => s && s.hint, 20000, 'C 人物页选择提示')
  const s = await page.eval(snapExpr)
  ok('C1 缺总览 → 显示「选择左侧一个文档开始」', s.hint === true)
  ok('C2 不挂编辑器（无 .ProseMirror）', s.pm === false)
  ok('C3 无「开始写作…」空占位', s.empty === false)
  await shot(page, 'docsection-overview-fallback')
  ok('C 人物页无 JS 异常', page.errors.length === 0, String(page.errors.slice(0, 2)))
  await nav(page, '#/project/demo-multiline/worldview')
  await evalUntil(page, snapExpr, (s) => s && s.hint, 20000, 'C 世界观页选择提示')
  const s2 = await page.eval(snapExpr)
  ok('C4 缺总纲 → 显示「选择左侧一个文档开始」', s2.hint === true && s2.pm === false && s2.empty === false)
  ok('C 世界观页无 JS 异常', page.errors.length === 0, String(page.errors.slice(0, 2)))
  page.close()
}

// ===== D. 动态防御：删除总览（fs 事件→refresh→置空） =====
{
  const tab = await openTab('about:blank')
  const page = await attach(tab.webSocketDebuggerUrl)
  await nav(page, '#/project/demo-aseya/characters')
  await evalUntil(page, snapExpr, (s) => s && s.pm && (s.pmText || '').includes('人物 · 总览'), 20000, 'D 初始总览')
  const del = await page.eval(`(async () => { const r = await window.zhijuan.deleteDoc('demo-aseya', '人物/总览.md'); return JSON.stringify(r) })()`)
  ok('D1 deleteDoc 成功', typeof del === 'string' && del.includes('"ok":true'), del)
  await evalUntil(page, snapExpr, (s) => s && s.hint && !s.pm, 20000, 'D 删除后转选择提示')
  const s = await page.eval(snapExpr)
  ok('D2 删除总览 → 页面转「选择左侧一个文档开始」，编辑器卸载', s.hint === true && s.pm === false && s.empty === false)
  ok('D 无 JS 异常', page.errors.length === 0, String(page.errors.slice(0, 2)))
  page.close()
}

// ===== E. 回归：点「阿七」正常打开人物档案 =====
{
  const tab = await openTab('about:blank')
  const page = await attach(tab.webSocketDebuggerUrl)
  await nav(page, '#/project/demo-aseya/characters')
  await evalUntil(page, `document.body.innerText.includes('人物档案')`, Boolean, 20000, 'E 人物页就绪')
  const clicked = await page.eval(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /阿七/.test(x.textContent || '')); if (b) { b.click(); return true } return false })()`)
  ok('E1 找到并点击「阿七」', clicked === true)
  await evalUntil(page, `(() => { const e = document.querySelector('.ProseMirror'); return e && e.textContent.includes('基础档案') })()`, (v) => v === true, 15000, 'E 阿七档案')
  ok('E2 阿七档案正常打开（含基础档案）', true)
  ok('E 无 JS 异常', page.errors.length === 0, String(page.errors.slice(0, 2)))
  page.close()
}

console.log(`\nRESULT: ${15 - fails}/${15} passed, ${fails} failed`)
process.exit(fails === 0 ? 0 : 1)
