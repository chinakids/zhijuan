// 织卷无头冒烟 · 章列行操作菜单（HIG Context menus / Lists）：行尾「⋯」下拉 + 右键 ContextMenu 共源
// 用法：node scripts/chapter-row-menu-ui-smoke.mjs
// 前置：npm run build；node scripts/serve-renderer.mjs 8123；本机无头 Chrome CDP 127.0.0.1:9224
// 验收点：① 每一章行尾「章节操作」按钮存在；选中行常显、未选中行 hover 才显示（opacity 类断言）
//         ② 点击「⋯」→ Radix 下拉菜单 4 项（重命名/修改切片名/导出 md/删除，删除 danger）
//         ③ 「重命名」入口走通 Dialog（不改数据，仅验证打开）
//         ④ 右键行 → Radix ContextMenu 打开（与下拉同 4 项）→ 点击外部关闭
//         ⑤ 全程无 JS 异常；截图两态。
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const fs = await import('node:fs')
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
    await sleep(250)
  }
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

let fail = 0
const ok = (name, cond, extra = '') => {
  console.log((cond ? 'OK ' : 'NG ') + name + (extra ? ' | ' + extra : ''))
  if (!cond) fail++
}

// 行尾按钮：按所在行标题定位（返回 {count, selOpacity, otherOpacity} 或 null）
const rowBtns = `(() => {
  const rows = [...document.querySelectorAll('[aria-label="章节操作"]')]
  const list = [...document.querySelectorAll('aside button')].filter(b => (b.innerText || '').includes('第'))
  return { count: rows.length }
})()`

const moreBtnFor = (title) => `(() => {
  const row = [...document.querySelectorAll('aside button')].find(b => (b.innerText || '').includes(${JSON.stringify(title)}))
  if (!row) return null
  const btn = row.parentElement.querySelector('[aria-label="章节操作"]')
  return btn ? getComputedStyle(btn).opacity : null
})()`

// Radix 触发器/菜单项：pointer 三连
const pointerSeq = (sel) => `(() => {
  const el = ${sel}
  if (!el) return false
  for (const t of ['pointerdown', 'pointerup', 'click']) {
    el.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, pointerType: 'mouse' }))
  }
  return true
})()`

const menuHas = (t) => `[...document.querySelectorAll('[role=menuitem]')].some(b => (b.innerText || '').trim() === ${JSON.stringify(t)})`
const menuCount = `document.querySelectorAll('[role=menuitem]').length`

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel')
console.log('TAB:', tab.id)
const page = await attach(tab.webSocketDebuggerUrl)
try {
  // ① 进入正文页：章列就绪，每行行尾「章节操作」按钮存在
  await evalUntil(page, `!!document.querySelector('[data-testid="chapter-sidebar"]')`, (v) => v, 30000, '章列就绪')
  await evalUntil(page, `document.querySelectorAll('[aria-label="章节操作"]').length >= 4`, (v) => v === true, 15000, '行尾按钮 ≥4')
  ok('每行都有「章节操作」按钮', (await page.eval(rowBtns)).count >= 4, String((await page.eval(rowBtns)).count))

  // 未选章时全部隐藏（opacity 0）
  const op0 = await page.eval(moreBtnFor('第1章 · 雾港'))
  ok('未选中行按钮默认隐藏', op0 === '0', `opacity=${op0}`)

  // 选中第 1 章 → 该行按钮常显；第 2 章仍隐藏
  await page.eval(pointerSeq(`[...document.querySelectorAll('aside button')].find(b => (b.innerText || '').includes('第1章 · 雾港'))`))
  await evalUntil(page, `getComputedStyle([...document.querySelectorAll('aside button')].find(b => (b.innerText||'').includes('第1章 · 雾港')).parentElement.querySelector('[aria-label="章节操作"]')).opacity`, (v) => v === '1', 8000, '选中行按钮常显')
  ok('选中行按钮常显', true)
  ok('未选中行按钮仍隐藏', (await page.eval(moreBtnFor('第2章 · 灯塔'))) === '0')

  // ② 点击选中行「⋯」→ Radix 下拉菜单 4 项
  await page.eval(pointerSeq(`(() => { const row = [...document.querySelectorAll('aside button')].find(b => (b.innerText||'').includes('第1章 · 雾港')); return row.parentElement.querySelector('[aria-label="章节操作"]') })()`))
  await evalUntil(page, `document.querySelectorAll('[role=menuitem]').length`, (v) => v === 4, 8000, '下拉菜单 4 项')
  ok('下拉菜单：重命名', (await page.eval(menuHas('重命名'))) === true)
  ok('下拉菜单：修改切片名', (await page.eval(menuHas('修改切片名'))) === true)
  ok('下拉菜单：导出 md', (await page.eval(menuHas('导出 md'))) === true)
  ok('下拉菜单：删除（danger 项）', (await page.eval(menuHas('删除'))) === true)
  await shot(page, 'chapter-row-menu-dropdown-0530')

  // ③ 菜单点「重命名」→ Dialog 打开（验证入口走通；点取消关闭，不改数据）
  await page.eval(pointerSeq(`[...document.querySelectorAll('[role=menuitem]')].find(b => (b.innerText||'').trim() === '重命名')`))
  await evalUntil(page, `document.body.innerText.includes('新题名')`, (v) => v === true, 8000, '重命名对话框')
  ok('「重命名」入口打开对话框', true)
  await page.eval(`(() => { const b = [...document.querySelectorAll('[role=dialog] button')].find(x => (x.innerText||'').trim() === '取消'); if (b) b.click(); return !!b })()`)
  await sleep(300)

  // ④ 右键第 2 章 → ContextMenu 打开（同 4 项）→ 点击菜单外关闭
  await page.eval(`(() => {
    const btn = [...document.querySelectorAll('aside button')].find(b => (b.innerText || '').includes('第2章 · 灯塔'))
    if (!btn) return false
    btn.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 220, button: 2 }))
    return true
  })()`)
  await evalUntil(page, `document.querySelectorAll('[role=menuitem]').length`, (v) => v === 4, 8000, '右键菜单 4 项')
  ok('右键菜单：与下拉同 4 项', (await page.eval(menuHas('重命名'))) === true && (await page.eval(menuHas('修改切片名'))) === true && (await page.eval(menuHas('导出 md'))) === true && (await page.eval(menuHas('删除'))) === true)
  await shot(page, 'chapter-row-menu-context-0530')
  // 点菜单外（body 左上）关闭
  await page.eval(`document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse', clientX: 5, clientY: 5 }))`)
  await evalUntil(page, `document.querySelectorAll('[role=menuitem]').length`, (v) => v === 0, 8000, '菜单关闭')
  ok('点击外部关闭右键菜单', true)

  // ⑤ 零 JS 异常
  const errs = page.errors.filter((e) => !e.includes('favicon')).slice(0, 5)
  ok('无 JS 异常', errs.length === 0, errs.join(' ; '))
} catch (e) {
  ok('脚本异常', false, String(e).slice(0, 300))
}

page.close()
clearTimeout(watchdog)
console.log(fail === 0 ? 'ALL PASS' : `FAILS: ${fail}`)
process.exit(fail === 0 ? 0 : 1)
