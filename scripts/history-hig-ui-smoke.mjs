// 织卷无头冒烟 · 版本历史抽屉 HIG 走查（体验层 2026-09-21 17:15 轮）
// 用法：node scripts/history-hig-ui-smoke.mjs
// 前置：node scripts/serve-renderer.mjs 8123；本机专用无头 Chrome CDP 127.0.0.1:9224
// 验收：
//  场景A 行式版本列表（HIG Lists row-based）：行含时间/「N 字节」、aria-pressed 选中态、点 v1 切换 diff、两击恢复后历史 +1
//  场景B 读取失败不再假空态：?zj-fail=listHistory → 「读取历史失败」错误卡 + 重试 → 重试恢复（空态/列表出现）
//  场景C 窄窗 800 零溢出 + dark 主题下列表正常
// 注册截图：~/Pictures/zhijuan/history-hig-<state>-<HHMM>.png
import { writeFileSync, mkdirSync } from 'node:fs'

const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
const REL = '正文/第01章_雾港.md'
const SHOT_DIR = '/Users/USER/Pictures/zhijuan'
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
    try { const v = await page.eval(expr); if (pred(v)) return v } catch {}
    if (Date.now() - t0 > timeoutMs) throw new Error('TIMEOUT waiting: ' + label)
    await sleep(250)
  }
}
function shotName(state) {
  const d = new Date()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `history-hig-${state}-${hh}${mm}.png`
}
async function snap(page, state) {
  try {
    const shot = await page.cmd('Page.captureScreenshot', { format: 'png' })
    mkdirSync(SHOT_DIR, { recursive: true })
    const name = shotName(state)
    writeFileSync(`${SHOT_DIR}/${name}`, Buffer.from(shot.data, 'base64'))
    console.log('SCREENSHOT: ' + name)
  } catch (e) {
    console.log('SCREENSHOT-FAIL: ' + e.message)
  }
}
const clickHistory = `(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '历史'); if (b) { b.click(); return !!b } return false })()`

let fails = 0
const ok = (name, cond, extra = '') => {
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : ''))
  if (!cond) fails++
}

/* ============ 场景 A：行式列表 / aria / 选中切换 / 恢复 ============ */
{
  console.log('--- 场景A 行式列表与恢复 ---')
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel?ch=' + encodeURIComponent('第01章_雾港.md'))
  const page = await attach(tab.webSocketDebuggerUrl)
  try {
    await evalUntil(page, `(() => { const el = document.querySelector('.ProseMirror'); return el && el.textContent.length > 10 })()`, (x) => x === true, 25000, 'ProseMirror 带正文')
    await page.eval(`(async () => {
      const id = 'demo-aseya'
      const base = (await window.zhijuan.readDoc(id, ${JSON.stringify(REL)})) || ''
      await window.zhijuan.writeDoc(id, ${JSON.stringify(REL)}, base + '\\n\\n走查第一版。')
      await window.zhijuan.writeDoc(id, ${JSON.stringify(REL)}, base + '\\n\\n走查第一版。\\n走查第二版。')
      return base.length
    })()`)
    await page.eval(clickHistory)
    await evalUntil(page, `document.body.innerText.includes('共 2 版')`, (x) => x === true, 15000, '抽屉打开且两版')
    const listState = await page.eval(`(() => {
      const rows = [...document.querySelectorAll('[data-version]')]
      return {
        count: rows.length,
        rowIsButton: rows.every((r) => r.tagName === 'BUTTON'),
        rowHasSize: rows.every((r) => (r.innerText || '').includes('字节')),
        rowHasTime: rows.every((r) => /\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}/.test(r.innerText || '')),
        latestPressed: rows.find((r) => r.getAttribute('data-version') === 'latest')?.getAttribute('aria-pressed'),
        v1Pressed: rows.find((r) => r.getAttribute('data-version') === 'v1')?.getAttribute('aria-pressed'),
        hasCounts: document.body.innerText.includes('当前正文约')
      }
    })()`)
    ok('A① 版本列表为行式（button 行、时间+字节信息）', listState.count === 2 && listState.rowIsButton && listState.rowHasSize && listState.rowHasTime, JSON.stringify(listState))
    ok('A② 默认选中最新（aria-pressed=true）', listState.latestPressed === 'true' && listState.v1Pressed === 'false', JSON.stringify(listState))

    // 选 v1 → aria 切换 + diff 更新
    await page.eval(`(() => { const el = document.querySelector('[data-version="v1"]'); if (el) el.click(); return !!el })()`)
    await sleep(500)
    const pickState = await page.eval(`(() => {
      const rows = [...document.querySelectorAll('[data-version]')]
      return {
        latestPressed: rows.find((r) => r.getAttribute('data-version') === 'latest')?.getAttribute('aria-pressed'),
        v1Pressed: rows.find((r) => r.getAttribute('data-version') === 'v1')?.getAttribute('aria-pressed'),
        diffRows: document.querySelectorAll('[class*="bg-danger-soft"], [class*="bg-accent-soft"]').length
      }
    })()`)
    ok('A③ 点 v1 行：aria-pressed 交换且 diff 重渲染', pickState.latestPressed === 'false' && pickState.v1Pressed === 'true' && pickState.diffRows > 0, JSON.stringify(pickState))
    await snap(page, 'list')

    // 两击恢复 → 历史 +1
    await page.eval(`(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('恢复此版本')); if (b) b.click(); return !!b })()`)
    await evalUntil(page, `document.body.innerText.includes('再次点击确认恢复')`, (x) => x === true, 5000, '确认态')
    await page.eval(`(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('再次点击确认恢复')); if (b) b.click(); return !!b })()`)
    await evalUntil(page, `document.body.innerText.includes('已恢复')`, (x) => x === true, 15000, '恢复成功提示')
    const after = await page.eval(`(async () => {
      const m = document.body.innerText.match(/共 (\\d+) 版/)
      return { count: m ? Number(m[1]) : -1 }
    })()`)
    ok('A④ 恢复后历史新增一版（共 3 版）', after.count >= 3, JSON.stringify(after))
    ok('A⑤ 无 JS 异常', page.errors.length === 0, page.errors.slice(0, 3).join(' | '))
  } finally {
    page.close()
  }
}

/* ============ 场景 B：读取失败错误卡 + 重试 ============ */
{
  console.log('--- 场景B 错误态（?zj-fail=listHistory） ---')
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '&zj-fail=listHistory#/project/demo-aseya/novel?ch=' + encodeURIComponent('第01章_雾港.md'))
  const page = await attach(tab.webSocketDebuggerUrl)
  try {
    await evalUntil(page, `(() => { const el = document.querySelector('.ProseMirror'); return el && el.textContent.length > 10 })()`, (x) => x === true, 25000, 'ProseMirror')
    await page.eval(clickHistory)
    await evalUntil(page, `document.body.innerText.includes('读取历史失败')`, (x) => x === true, 15000, '错误卡')
    const errState = await page.eval(`(() => {
      const alert = document.querySelector('[role="alert"]')
      const retry = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '重试')
      return { hasAlert: !!alert, alertText: alert?.innerText ?? '', hasRetry: !!retry, noFalseEmpty: !document.body.innerText.includes('还没有历史版本') }
    })()`)
    ok('B① 读取失败显示错误卡（role=alert + 重试按钮），不再假空态', errState.hasAlert && errState.hasRetry && errState.noFalseEmpty, JSON.stringify(errState))
    await snap(page, 'error')
    // 重试（zj-fail 一次性 → 恢复）：数据为空 → 空态
    await page.eval(`(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '重试'); if (b) b.click(); return !!b })()`)
    await evalUntil(page, `document.body.innerText.includes('还没有历史版本')`, (x) => x === true, 15000, '重试后恢复空态')
    ok('B② 重试后恢复（错误卡消失，进入空态）', true)
    ok('B③ 无 JS 异常', page.errors.length === 0, page.errors.slice(0, 3).join(' | '))
  } finally {
    page.close()
  }
}

/* ============ 场景 C：窄窗 800 零溢出 + dark ============ */
{
  console.log('--- 场景C 窄窗/dark ---')
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel?ch=' + encodeURIComponent('第01章_雾港.md'))
  const page = await attach(tab.webSocketDebuggerUrl)
  try {
    await page.cmd('Emulation.setDeviceMetricsOverride', { width: 800, height: 700, deviceScaleFactor: 1, mobile: false })
    await evalUntil(page, `(() => { const el = document.querySelector('.ProseMirror'); return el && el.textContent.length > 10 })()`, (x) => x === true, 25000, 'ProseMirror')
    await page.eval(`(async () => {
      const base = (await window.zhijuan.readDoc('demo-aseya', ${JSON.stringify(REL)})) || ''
      await window.zhijuan.writeDoc('demo-aseya', ${JSON.stringify(REL)}, base + '\\n\\n窄窗版本。')
      return true
    })()`)
    await page.eval(clickHistory)
    await evalUntil(page, `document.body.innerText.includes('共 1 版')`, (x) => x === true, 15000, '抽屉打开')
    const narrow = await page.eval(`(() => {
      const dlg = document.querySelector('[role="dialog"][aria-label="版本历史"]')
      return { dialogW: dlg?.getBoundingClientRect().width ?? -1, scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth }
    })()`)
    ok('C① 窄窗 800：抽屉 600 显示、无横向溢出', narrow.dialogW === 600 && narrow.scrollW <= narrow.innerW, JSON.stringify(narrow))
    await page.eval(`document.documentElement.classList.add('dark')`)
    await sleep(300)
    const dark = await page.eval(`(() => {
      const rows = [...document.querySelectorAll('[data-version]')]
      return { rowCount: rows.length, rowVisible: rows.every((r) => r.offsetHeight > 0) }
    })()`)
    ok('C② dark 下行式列表正常渲染', dark.rowCount >= 1 && dark.rowVisible, JSON.stringify(dark))
    await snap(page, 'dark')
    await page.eval(`document.documentElement.classList.remove('dark')`)
    ok('C③ 无 JS 异常', page.errors.length === 0, page.errors.slice(0, 3).join(' | '))
  } finally {
    page.close()
  }
}

console.log(fails === 0 ? 'SMOKE PASS' : 'SMOKE FAIL: ' + fails)
process.exit(fails === 0 ? 0 : 1)
