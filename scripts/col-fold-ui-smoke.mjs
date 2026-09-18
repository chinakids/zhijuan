// 织卷无头冒烟 · 三页导航列宽窗手动折叠统一（DocSection/Outline/Library；HIG Sidebars show/hide）
// 用法：node scripts/col-fold-ui-smoke.mjs
// 前置：npm run build；node scripts/serve-renderer.mjs 8123；本机无头 Chrome CDP 127.0.0.1:9224
// 验收点：① 人物/世界观（DocSection）列头折叠钮→折叠→入口条→恢复 ② 大纲章卡列同环
//         ③ 素材库类别树同环 ④ 折叠态选中态保持（编辑器仍挂载）⑤ 默认展开（HIG 不默认隐藏）
//         ⑥ 全程无 JS 异常 ⑦ 截图
const CDP = 'http://127.0.0.1:9224'
import fs from 'node:fs'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const OUT = process.env.HOME + '/Pictures/zhijuan'
const watchdog = setTimeout(() => { console.log('!! WATCHDOG 150s'); process.exit(2) }, 150000)

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

/** 页面快照：列/入口条/隐藏钮 三个 testid+aria 判据 */
const snap = (colTestId, hideAria, showTestId) => `(() => {
  const col = document.querySelector('[data-testid="${colTestId}"]')
  const show = document.querySelector('[data-testid="${showTestId}"]')
  const hideBtn = document.querySelector('[aria-label="${hideAria}"]')
  const pm = document.querySelector('.zj-md .ProseMirror') ?? document.querySelector('.ProseMirror')
  return {
    col: !!col,
    show: !!show,
    hideBtn: !!hideBtn,
    // 入口条标签在按钮父容器内（按钮本身为纯 icon，文字是「显示X列表」的 title/aria）
    showLabel: show ? ((show.parentElement?.textContent || '').trim()) : null,
    editors: window.__ZJ_EDITORS ? Object.keys(window.__ZJ_EDITORS).length : 0,
    pmW: pm ? Math.round(pm.getBoundingClientRect().width) : null
  }
})()`

const tab = await openTab('about:blank')
const page = await attach(tab.webSocketDebuggerUrl)
await page.cmd('Page.enable')
await page.cmd('Page.bringToFront')
await setSize(page, 1400, 800)

// ① 人物页（DocSection 共用组件）
await page.cmd('Page.navigate', { url: `${BASE}/?cb=colfold${Date.now()}#/project/demo-aseya/characters` })
await evalUntil(page, `!!window.__ZJ_TEST`, (v) => v, 30000, '__ZJ_TEST')
await evalUntil(page, `!!document.querySelector('[data-testid="doc-col"]')`, (v) => v, 30000, '人物列')
let s = await page.eval(snap('doc-col', '隐藏人物档案列表', 'doc-col-show'))
check('人物：默认展开（HIG 不默认隐藏）', s.col === true && s.show === false && s.hideBtn === true)
check('人物：默认选中总览 → 编辑器在', s.editors > 0, `editors=${s.editors}`)
const pmWOpen = s.pmW
await shot(page, 'col-fold-char-open')
await page.eval(`document.querySelector('[aria-label="隐藏人物档案列表"]').click()`)
await sleep(400)
s = await page.eval(snap('doc-col', '隐藏人物档案列表', 'doc-col-show'))
check('人物：点折叠 → 列隐藏+入口条出现', s.col === false && s.show === true)
check('人物：入口条标签=人物档案', s.showLabel === '人物档案', String(s.showLabel))
check('人物：折叠后编辑器仍挂载（选中态保持）', s.editors > 0, `editors=${s.editors}`)
check('人物：折叠使正文可用宽变大', s.pmW !== null && pmWOpen !== null && s.pmW > pmWOpen, `open=${pmWOpen} folded=${s.pmW}`)
await shot(page, 'col-fold-char-folded')
await page.eval(`document.querySelector('[data-testid="doc-col-show"]').click()`)
await sleep(400)
s = await page.eval(snap('doc-col', '隐藏人物档案列表', 'doc-col-show'))
check('人物：点入口条 → 列恢复+入口条消失', s.col === true && s.show === false)

// ② 世界观页（同 DocSection）
await page.eval(`location.hash = '#/project/demo-aseya/worldview'`)
await evalUntil(page, `!!document.querySelector('[aria-label="隐藏世界观设定列表"]')`, (v) => v, 30000, '世界观列')
s = await page.eval(snap('doc-col', '隐藏世界观设定列表', 'doc-col-show'))
check('世界观：列在+折叠钮在', s.col === true && s.hideBtn === true)
await page.eval(`document.querySelector('[aria-label="隐藏世界观设定列表"]').click()`)
await sleep(400)
s = await page.eval(snap('doc-col', '隐藏世界观设定列表', 'doc-col-show'))
check('世界观：折叠→入口条（标签=世界观设定）', s.col === false && s.show === true && s.showLabel === '世界观设定', String(s.showLabel))

// ③ 大纲页
await page.eval(`location.hash = '#/project/demo-aseya/outline'`)
await evalUntil(page, `!!document.querySelector('[data-testid="outline-col"]')`, (v) => v, 30000, '大纲列')
s = await page.eval(snap('outline-col', '隐藏章卡列表', 'outline-col-show'))
check('大纲：默认展开+折叠钮在', s.col === true && s.hideBtn === true && s.show === false)
await page.eval(`document.querySelector('[aria-label="隐藏章卡列表"]').click()`)
await sleep(400)
s = await page.eval(snap('outline-col', '隐藏章卡列表', 'outline-col-show'))
check('大纲：折叠→列隐藏+入口条（标签=章卡）', s.col === false && s.show === true && s.showLabel === '章卡', String(s.showLabel))
await shot(page, 'col-fold-outline-folded')
await page.eval(`document.querySelector('[data-testid="outline-col-show"]').click()`)
await sleep(400)
s = await page.eval(snap('outline-col', '隐藏章卡列表', 'outline-col-show'))
check('大纲：点入口条 → 恢复', s.col === true && s.show === false)

// ④ 素材库页
await page.eval(`location.hash = '#/project/demo-aseya/library'`)
await evalUntil(page, `!!document.querySelector('[data-testid="lib-col"]')`, (v) => v, 30000, '素材库列')
s = await page.eval(snap('lib-col', '隐藏素材库列表', 'lib-col-show'))
check('素材库：默认展开+折叠钮在', s.col === true && s.hideBtn === true && s.show === false)
await page.eval(`document.querySelector('[aria-label="隐藏素材库列表"]').click()`)
await sleep(400)
s = await page.eval(snap('lib-col', '隐藏素材库列表', 'lib-col-show'))
check('素材库：折叠→列隐藏+入口条（标签=素材库）', s.col === false && s.show === true && s.showLabel === '素材库', String(s.showLabel))
await shot(page, 'col-fold-lib-folded')
await page.eval(`document.querySelector('[data-testid="lib-col-show"]').click()`)
await sleep(400)
s = await page.eval(snap('lib-col', '隐藏素材库列表', 'lib-col-show'))
check('素材库：点入口条 → 恢复', s.col === true && s.show === false)

// ⑤ 默认域（1000）三页列仍在（无自动折叠逻辑，仅手动——与5a0c008窄窗实测结论一致）
await setSize(page, 1000, 700)
await sleep(500)
await page.eval(`location.hash = '#/project/demo-aseya/characters'`)
await evalUntil(page, `!!document.querySelector('[data-testid="doc-col"]')`, (v) => v, 30000, '人物列1000')
s = await page.eval(snap('doc-col', '隐藏人物档案列表', 'doc-col-show'))
check('1000：人物列仍在（默认展开）', s.col === true && s.show === false)

// 零 JS 异常
const errs = page.errors.filter((e) => !e.includes('target closed'))
check('零 JS 异常', errs.length === 0, errs.slice(0, 2).join(' | '))

console.log(`\ncol-fold-ui-smoke: ${pass} pass / ${fail} fail`)
clearTimeout(watchdog)
if (fail) process.exit(1)
process.exit(0)
