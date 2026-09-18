// 织卷无头冒烟 · 导航列折叠态持久化（AppSettings.foldedCols；HIG Sidebars/macOS 惯例记住侧栏跨重启）
// 用法：node scripts/col-fold-persist-ui-smoke.mjs
// 前置：npm run build；node scripts/serve-renderer.mjs 8123；本机无头 Chrome CDP 127.0.0.1:9224
// 验收点：① 五页（Novel/人物/世界观/Outline/Library）折叠→devShim getSettings 写读一致（foldedCols=true）
//         ② 同 tab 切页后折叠态保持（页面重挂载从设置读回——跨页持久化真实路径）
//         ③ 恢复动作写回 false；全程无 JS 异常；截图
const CDP = 'http://127.0.0.1:9224'
import fs from 'node:fs'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const OUT = process.env.HOME + '/Pictures/zhijuan'
const watchdog = setTimeout(() => { console.log('!! WATCHDOG 180s'); process.exit(2) }, 180000)

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
    await sleep(300)
  }
}
async function setSize(page, w, h) {
  await page.cmd('Emulation.clearDeviceMetricsOverride')
  await page.cmd('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
  await sleep(500)
}
async function shot(page, name) {
  try {
    const { data } = await page.cmd('Page.captureScreenshot', { format: 'png' })
    fs.mkdirSync(OUT, { recursive: true })
    const p = `${OUT}/${name}.png`
    fs.writeFileSync(p, Buffer.from(data, 'base64'))
    console.log('截图 →', p)
  } catch (e) { console.log('截图失败', e.message || e) }
}

let pass = 0
let fail = 0
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log('  ✓', name, extra) }
  else { fail++; console.log('  ✗', name, extra) }
}

/** 折叠键的写读（devShim getSettings 直读，异步写后轮询） */
const settingsFold = (key) => `window.zhijuan.getSettings().then((s) => !!s.foldedCols['${key}'])`

const tab = await openTab('about:blank')
const page = await attach(tab.webSocketDebuggerUrl)
await page.cmd('Page.enable')
await page.cmd('Page.bringToFront')
await setSize(page, 1400, 800)

// ⓪ 首页进入 Novel（宽窗默认展开）
await page.cmd('Page.navigate', { url: `${BASE}/?cb=colfoldpersist${Date.now()}#/project/demo-aseya/novel` })
await evalUntil(page, `!!window.__ZJ_TEST`, (v) => v, 30000, '__ZJ_TEST')
await evalUntil(page, `!!document.querySelector('[data-testid="chapter-sidebar"]')`, (v) => v, 30000, '章列默认展开')
check('⓪ Novel：默认展开（chapter-sidebar 在 / chapter-toggle 无）',
  (await page.eval(`(() => { return !!document.querySelector('[data-testid="chapter-sidebar"]') && !document.querySelector('[data-testid="chapter-toggle"]') })()`)) === true)

// ① Novel 折叠 + 写读一致
await page.eval(`document.querySelector('[aria-label="隐藏章节列表"]').click()`)
await sleep(300)
await evalUntil(page, `!!document.querySelector('[data-testid="chapter-toggle"]') && !document.querySelector('[data-testid="chapter-sidebar"]')`, (v) => v, 10000, 'Novel 折叠态')
check('① Novel：折叠→入口条出现+列隐藏', true)
await evalUntil(page, settingsFold('novel'), (v) => v === true, 8000, 'foldedCols.novel 写读一致')
check('① Novel：devShim 设置写读一致（foldedCols.novel=true）', true)
await shot(page, `col-fold-persist-novel-${new Date().toTimeString().slice(0, 5).replace(':', '')}`)

// ② 人物页（DocSection）折叠
await page.eval(`location.hash = '#/project/demo-aseya/characters'`)
await evalUntil(page, `!!document.querySelector('[data-testid="doc-col"]')`, (v) => v, 30000, '人物列')
await page.eval(`document.querySelector('[aria-label="隐藏人物档案列表"]').click()`)
await sleep(300)
await evalUntil(page, `!!document.querySelector('[data-testid="doc-col-show"]') && !document.querySelector('[data-testid="doc-col"]')`, (v) => v, 10000, '人物折叠态')
check('② 人物：折叠→入口条出现+列隐藏', true)
await evalUntil(page, settingsFold('characters'), (v) => v === true, 8000, 'foldedCols.characters 写读一致')
check('② 人物：devShim 设置写读一致（foldedCols.characters=true）', true)

// ②b 世界观页：与人物分键——人物折叠不影响世界观（独立键回归；DocSection 共用组件）
await page.eval(`location.hash = '#/project/demo-aseya/worldview'`)
await evalUntil(page, `!!document.querySelector('[data-testid="doc-col"]')`, (v) => v, 30000, '世界观列默认展开')
check('②b 世界观：人物已折叠但世界观默认展开（分键独立）', (await page.eval(`!!document.querySelector('[data-testid="doc-col"]') && !document.querySelector('[data-testid="doc-col-show"]')`)) === true)
await page.eval(`document.querySelector('[aria-label="隐藏世界观设定列表"]').click()`)
await sleep(300)
await evalUntil(page, `!!document.querySelector('[data-testid="doc-col-show"]') && !document.querySelector('[data-testid="doc-col"]')`, (v) => v, 10000, '世界观折叠态')
check('②b 世界观：折叠→入口条出现+列隐藏', true)
await evalUntil(page, settingsFold('worldview'), (v) => v === true, 8000, 'foldedCols.worldview 写读一致')
check('②b 世界观：devShim 设置写读一致（foldedCols.worldview=true）', true)
await shot(page, `col-fold-persist-worldview-${new Date().toTimeString().slice(0, 5).replace(':', '')}`)

// ③ 大纲页折叠
await page.eval(`location.hash = '#/project/demo-aseya/outline'`)
await evalUntil(page, `!!document.querySelector('[data-testid="outline-col"]')`, (v) => v, 30000, '大纲列')
await page.eval(`document.querySelector('[aria-label="隐藏章卡列表"]').click()`)
await sleep(300)
await evalUntil(page, `!!document.querySelector('[data-testid="outline-col-show"]') && !document.querySelector('[data-testid="outline-col"]')`, (v) => v, 10000, '大纲折叠态')
check('③ 大纲：折叠→入口条出现+列隐藏', true)
await evalUntil(page, settingsFold('outline'), (v) => v === true, 8000, 'foldedCols.outline 写读一致')
check('③ 大纲：devShim 设置写读一致（foldedCols.outline=true）', true)

// ④ 素材库页折叠
await page.eval(`location.hash = '#/project/demo-aseya/library'`)
await evalUntil(page, `!!document.querySelector('[data-testid="lib-col"]')`, (v) => v, 30000, '素材库列')
await page.eval(`document.querySelector('[aria-label="隐藏素材库列表"]').click()`)
await sleep(300)
await evalUntil(page, `!!document.querySelector('[data-testid="lib-col-show"]') && !document.querySelector('[data-testid="lib-col"]')`, (v) => v, 10000, '素材库折叠态')
check('④ 素材库：折叠→入口条出现+列隐藏', true)
await evalUntil(page, settingsFold('library'), (v) => v === true, 8000, 'foldedCols.library 写读一致')
check('④ 素材库：devShim 设置写读一致（foldedCols.library=true）', true)

// ⑤ 跨页保持（真正的持久化路径：页面重挂载 → 从设置读回；同 tab 切页不丢）
await page.eval(`location.hash = '#/project/demo-aseya/novel'`)
await evalUntil(page, `!!document.querySelector('[data-testid="chapter-toggle"]')`, (v) => v, 30000, '回 Novel')
check('⑤ Novel 跨页保持：入口条在+列仍隐藏', (await page.eval(`!!document.querySelector('[data-testid="chapter-toggle"]') && !document.querySelector('[data-testid="chapter-sidebar"]')`)) === true)
await page.eval(`location.hash = '#/project/demo-aseya/characters'`)
await evalUntil(page, `!!document.querySelector('[data-testid="doc-col-show"]')`, (v) => v, 30000, '回人物')
check('⑤ 人物跨页保持：入口条在+列仍隐藏', (await page.eval(`!!document.querySelector('[data-testid="doc-col-show"]') && !document.querySelector('[data-testid="doc-col"]')`)) === true)
await page.eval(`location.hash = '#/project/demo-aseya/worldview'`)
await evalUntil(page, `!!document.querySelector('[data-testid="doc-col-show"]')`, (v) => v, 30000, '回世界观')
check('⑤ 世界观跨页保持：入口条在+列仍隐藏', (await page.eval(`!!document.querySelector('[data-testid="doc-col-show"]') && !document.querySelector('[data-testid="doc-col"]')`)) === true)
await page.eval(`location.hash = '#/project/demo-aseya/outline'`)
await evalUntil(page, `!!document.querySelector('[data-testid="outline-col-show"]')`, (v) => v, 30000, '回大纲')
check('⑤ 大纲跨页保持：入口条在+列仍隐藏', (await page.eval(`!!document.querySelector('[data-testid="outline-col-show"]') && !document.querySelector('[data-testid="outline-col"]')`)) === true)
await page.eval(`location.hash = '#/project/demo-aseya/library'`)
await evalUntil(page, `!!document.querySelector('[data-testid="lib-col-show"]')`, (v) => v, 30000, '回素材库')
check('⑤ 素材库跨页保持：入口条在+列仍隐藏', (await page.eval(`!!document.querySelector('[data-testid="lib-col-show"]') && !document.querySelector('[data-testid="lib-col"]')`)) === true)

// ⑥ 恢复：逐页点入口条展开，写回 false（零副作用收尾 + 写 false 路径验证）
await page.eval(`document.querySelector('[data-testid="lib-col-show"]').click()`)
await sleep(300)
await page.eval(`location.hash = '#/project/demo-aseya/outline'`)
await evalUntil(page, `!!document.querySelector('[data-testid="outline-col-show"]')`, (v) => v, 30000, '回大纲恢复前')
await page.eval(`document.querySelector('[data-testid="outline-col-show"]').click()`)
await sleep(300)
await page.eval(`location.hash = '#/project/demo-aseya/characters'`)
await evalUntil(page, `!!document.querySelector('[data-testid="doc-col-show"]')`, (v) => v, 30000, '回人物恢复前')
await page.eval(`document.querySelector('[data-testid="doc-col-show"]').click()`)
await sleep(300)
await page.eval(`location.hash = '#/project/demo-aseya/worldview'`)
await evalUntil(page, `!!document.querySelector('[data-testid="doc-col-show"]')`, (v) => v, 30000, '回世界观恢复前')
await page.eval(`document.querySelector('[data-testid="doc-col-show"]').click()`)
await sleep(300)
await page.eval(`location.hash = '#/project/demo-aseya/novel'`)
await evalUntil(page, `!!document.querySelector('[data-testid="chapter-toggle"]')`, (v) => v, 30000, '回 Novel 恢复前')
check('⑥ Novel 恢复：入口条在（等待恢复动作）', true)
await page.eval(`document.querySelector('[data-testid="chapter-toggle"]').click()`)
await sleep(300)
await evalUntil(page, `!!document.querySelector('[data-testid="chapter-sidebar"]') && !document.querySelector('[data-testid="chapter-toggle"]')`, (v) => v, 10000, 'Novel 展开恢复')
check('⑥ Novel：点入口条 → 列恢复', true)
await evalUntil(page, `window.zhijuan.getSettings().then((s) => Object.values(s.foldedCols).every((x) => x === false))`, (v) => v === true, 8000, '恢复写回全部 false')
check('⑥ 全部写回 false（零副作用）', true)

// 零 JS 异常
const errs = page.errors.filter((e) => !e.includes('target closed'))
check('零 JS 异常', errs.length === 0, errs.slice(0, 2).join(' | '))

console.log(`\ncol-fold-persist-ui-smoke: ${pass} pass / ${fail} fail`)
clearTimeout(watchdog)
if (fail) process.exit(1)
process.exit(0)
