// 织卷无头冒烟 · 大纲区行操作菜单（HIG Context menus / Outline views）：章卡/导演板/分幕草稿行「⋯」下拉 + 右键 ContextMenu 共源
// 用法：node scripts/outline-row-menu-ui-smoke.mjs
// 前置：npm run build；node scripts/serve-renderer.mjs 8123；本机无头 Chrome CDP 127.0.0.1:9224
// 验收点：① 每章章卡行有「章卡操作」菜单；已回建行=「重新回建本章+版本历史」、待回建行=仅「回建本章」（不可用项隐藏）
//         ② 导演板行菜单=「重新导演本章+版本历史」；③ 右键行 → 同菜单；④ 「回建本章」走通单章通道（toast+状态变化+缺失计数下降）
//         ⑤ 索引分隔线渲染；⑥ 全程无 JS 异常；截图两态。
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
const ID = 'demo-aseya'
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
      await cmd('Page.enable')
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

const pointerSeq = (selExpr) => `(() => {
  const el = ${selExpr}
  if (!el) return false
  for (const t of ['pointerdown', 'pointerup', 'click']) {
    el.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, pointerType: 'mouse' }))
  }
  return true
})()`

// 按行标题文本定位该行的行操作菜单按钮（card-row-menu / board-row-menu / acts-row-menu）
const menuBtnFor = (titleText, kind) => `(() => {
  const row = [...document.querySelectorAll('aside button')].find((b) => (b.innerText || '').includes(${JSON.stringify(titleText)}))
  if (!row) return null
  return row.closest('.group')?.querySelector('[data-testid="${kind}-row-menu"]') ?? null
})()`

const menuItemCount = `document.querySelectorAll('[role=menuitem]').length`
const menuHas = (t) => `[...document.querySelectorAll('[role=menuitem]')].some((b) => (b.innerText || '').trim() === ${JSON.stringify(t)})`
const clickMenuItem = (t) => pointerSeq(`[...document.querySelectorAll('[role=menuitem]')].find((b) => (b.innerText || '').trim() === ${JSON.stringify(t)})`)
const closeMenu = `(() => { document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse', clientX: 5, clientY: 5 })); return true })()`

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/' + ID + '/outline')
console.log('TAB:', tab.id)
const page = await attach(tab.webSocketDebuggerUrl)
try {
  await evalUntil(page, `document.body.innerText.includes('章卡索引') && !!document.querySelector('[data-testid="outline-col"]')`, (v) => v === true, 25000, '大纲页就绪')

  // ① 入口存在性与行菜单数量：5 章章卡行 + 1 导演板行（ch01），无 acts 行
  ok('章卡行菜单 ×5（5 章）', (await page.eval(`document.querySelectorAll('[data-testid="card-row-menu"]').length`)) === 5)
  ok('导演板行菜单 ×1（seed ch01）', (await page.eval(`document.querySelectorAll('[data-testid="board-row-menu"]').length`)) === 1)
  ok('无分幕草稿行菜单', (await page.eval(`document.querySelectorAll('[data-testid="acts-row-menu"]').length`)) === 0)
  ok('索引分隔线渲染', (await page.eval(`!!document.querySelector('[data-testid="outline-col"] .mx-2\\.mb-1\\.border-t')`)) === true)

  // ② 待回建行（第2章）：菜单仅「回建本章」（无「版本历史」——不可用项隐藏）
  await page.eval(pointerSeq(`(() => { const row = [...document.querySelectorAll('aside button')].find((b) => (b.innerText || '').includes('第2章')); const btn = row?.closest('.group')?.querySelector('[data-testid="card-row-menu"]'); return btn })()`))
  await evalUntil(page, `${menuItemCount}`, (v) => v >= 1, 8000, '待回建行菜单打开')
  ok('待回建行菜单含「回建本章」', (await page.eval(menuHas('回建本章'))) === true)
  ok('待回建行菜单不含「版本历史」（隐藏不可用项）', (await page.eval(menuHas('版本历史'))) === false)
  await shot(page, 'outline-row-menu-pending-0830')
  await page.eval(`(() => { document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse', clientX: 5, clientY: 5 })); return true })()`)
  await evalUntil(page, `${menuItemCount}`, (v) => v === 0, 8000, '菜单1关闭')

  // ③ 已回建行（第1章）菜单：重新回建本章 + 版本历史
  await page.eval(pointerSeq(`(() => { const row = [...document.querySelectorAll('aside button')].find((b) => (b.innerText || '').includes('第1章')); const btn = row?.closest('.group')?.querySelector('[data-testid="card-row-menu"]'); return btn })()`))
  await evalUntil(page, `${menuItemCount}`, (v) => v >= 2, 8000, '已回建行菜单打开')
  ok('已回建行菜单含「重新回建本章」', (await page.eval(menuHas('重新回建本章'))) === true)
  ok('已回建行菜单含「版本历史」', (await page.eval(menuHas('版本历史'))) === true)
  await page.eval(closeMenu)
  await evalUntil(page, `${menuItemCount}`, (v) => v === 0, 8000, '菜单2关闭')

  // ④ 导演板行菜单：重新导演本章 + 版本历史
  await page.eval(pointerSeq(`(() => { const row = [...document.querySelectorAll('aside button')].find((b) => (b.innerText || '').trim().startsWith('导演板')); const btn = row?.closest('.group')?.querySelector('[data-testid="board-row-menu"]'); return btn })()`))
  await evalUntil(page, `${menuItemCount}`, (v) => v >= 2, 8000, '行菜单打开')
  ok('导演板行菜单含「重新导演本章」', (await page.eval(menuHas('重新导演本章'))) === true)
  ok('导演板行菜单含「版本历史」', (await page.eval(menuHas('版本历史'))) === true)
  await page.eval(closeMenu)
  await evalUntil(page, `${menuItemCount}`, (v) => v === 0, 8000, '菜单3关闭')

  // ⑤ 右键第3章行 → ContextMenu（同「回建本章」单动作）
  await page.eval(`(() => {
    const btn = [...document.querySelectorAll('aside button')].find((b) => (b.innerText || '').includes('第3章'))
    if (!btn) return false
    btn.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 260, button: 2 }))
    return true
  })()`)
  await evalUntil(page, `${menuItemCount}`, (v) => v >= 1, 8000, '右键菜单打开')
  ok('右键菜单含「回建本章」', (await page.eval(menuHas('回建本章'))) === true)
  await shot(page, 'outline-row-menu-context-0830')
  await page.eval(closeMenu)
  await evalUntil(page, `${menuItemCount}`, (v) => v === 0, 8000, '右键菜单关闭')

  // ⑥ 「回建本章」走通单章通道：第2章回建 → toast + 缺失计数 4→3 + 第2章行变已回建
  await page.eval(pointerSeq(`(() => { const row = [...document.querySelectorAll('aside button')].find((b) => (b.innerText || '').includes('第2章')); const btn = row?.closest('.group')?.querySelector('[data-testid="card-row-menu"]'); return btn })()`))
  await evalUntil(page, `${menuItemCount}`, (v) => v >= 1, 8000, '待回建行菜单再开')
  const before = await page.eval(`(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') || '').startsWith('回建缺失')); return b ? b.getAttribute('aria-label') : null })()`)
  await page.eval(clickMenuItem('回建本章'))
  await evalUntil(page, `[...document.querySelectorAll('.zj-toast')].some((t) => t.innerText.includes('章卡回建完成'))`, (v) => v === true, 15000, '单章回建 toast')
  ok('单章回建成功 toast', true)
  await evalUntil(page, `(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') || '').startsWith('回建缺失')); return b ? b.getAttribute('aria-label') : null })()`, (v) => v === before?.replace('4 张章卡', '3 张章卡'), 15000, '缺失计数下降')
  ok('「回建缺失」计数 4→3（单章通道生效）', true, before)
  const ch2Done = await page.eval(`(() => { const row = [...document.querySelectorAll('aside button')].find((b) => (b.innerText || '').includes('第2章')); return row ? row.closest('.group').querySelectorAll('.text-success').length > 0 : false })()`)
  ok('第2章行已回建（绿勾）', ch2Done === true)
  await shot(page, 'outline-row-menu-after-rebuild-0830')

  // ⑦ 零 JS 异常
  const errs = page.errors.filter((e) => !e.includes('favicon')).slice(0, 5)
  ok('无 JS 异常', errs.length === 0, errs.join(' ; '))
} catch (e) {
  ok('脚本异常', false, String(e).slice(0, 300))
}

page.close()
clearTimeout(watchdog)
console.log(fail === 0 ? 'ALL PASS' : `FAILS: ${fail}`)
process.exit(fail === 0 ? 0 : 1)
