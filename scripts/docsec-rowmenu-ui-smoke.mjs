// 织卷无头冒烟 · 人物/世界观设定页（DocSection 作者设定面）HIG 走查收口——文档列「⋯」+右键共源「删除」行操作 + 文案清理
// 用法：node scripts/docsec-rowmenu-ui-smoke.mjs
// 前置：npm run build；node scripts/serve-renderer.mjs 8123；本机无头 Chrome CDP 127.0.0.1:9224
// 验收点：① 人物页文档列 3 行均有「文档操作」菜单；选中行菜单常显、未选行 hover 显
//         ② 菜单仅「删除」单动作（HIG 破坏性项）；③ 删除→确认 Dialog（标题/描述/移入废纸篓按钮）
//         ④ 取消不删；⑤ 删当前选中项→列表移除+主区回「选择左侧一个文档开始」+toast
//         ⑥ 右键行→ContextMenu 同「删除」；⑦ 世界观页同机制；⑧ 头部文案去 S4/⌘S 精简
//         ⑨ 全程零 JS 异常；截图：行菜单/确认框/删除后。
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

// 按文档列行文本定位该行「文档操作」菜单按钮（doc-row-menu）
const menuBtnFor = (titleText) => `(() => {
  const row = [...document.querySelectorAll('[data-testid="doc-col"] button')].find((b) => (b.innerText || '').includes(${JSON.stringify(titleText)}))
  if (!row) return null
  return row.closest('.group')?.querySelector('[data-testid="doc-row-menu"]') ?? null
})()`

const menuItemCount = `document.querySelectorAll('[role=menuitem]').length`
const menuHas = (t) => `[...document.querySelectorAll('[role=menuitem]')].some((b) => (b.innerText || '').trim() === ${JSON.stringify(t)})`
const clickMenuItem = (t) => pointerSeq(`[...document.querySelectorAll('[role=menuitem]')].find((b) => (b.innerText || '').trim() === ${JSON.stringify(t)})`)
const closeMenu = `(() => { document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse', clientX: 5, clientY: 5 })); return true })()`

const rowCount = `document.querySelectorAll('[data-testid="doc-col"] [data-testid="doc-row-menu"]').length`
const rowNames = `[...document.querySelectorAll('[data-testid="doc-col"] button')].map((b) => (b.innerText || '').trim()).filter(Boolean)`

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/' + ID + '/characters')
console.log('TAB:', tab.id)
const page = await attach(tab.webSocketDebuggerUrl)
try {
  await evalUntil(page, `!!document.querySelector('[data-testid="doc-col"]') && document.querySelectorAll('[data-testid="doc-row-menu"]').length >= 3`, (v) => v === true, 25000, '人物页就绪')

  // ① 行菜单入口×3（总览/阿七/沈藏）
  ok('人物文档列行菜单 ×3', (await page.eval(rowCount)) === 3)
  const names = await page.eval(rowNames)
  ok('列含 总览/阿七/沈藏', names.some((n) => n.includes('总览')) && names.some((n) => n.includes('阿七')) && names.some((n) => n.includes('沈藏')), JSON.stringify(names))

  // ② 选中行（总览，初始选中）菜单常显 opacity-100；未选行 hover 前 opacity-0
  const selOp = await page.eval(`(() => { const b = document.querySelector('[data-testid="doc-row-menu"]'); return getComputedStyle(b).opacity })()`)
  const unselOp = await page.eval(`(() => { const bs = [...document.querySelectorAll('[data-testid="doc-row-menu"]')]; return getComputedStyle(bs[1]).opacity })()`)
  ok('选中行菜单常显', selOp === '1', selOp)
  ok('未选行菜单默认隐藏（hover 显）', unselOp === '0', unselOp)

  // 头部文案：精简后无 S4 / 无 ⌘S 重复
  const headTxt = await page.eval(`(() => { const s = [...document.querySelectorAll('span')].find((x) => x.textContent === '设定由正文保存时的切片同步维护'); return s ? s.textContent : null })()`)
  ok('头部说明=「设定由正文保存时的切片同步维护」', headTxt !== null)
  ok('头部无 S4/⌘S 残留', await page.eval(`!document.body.innerText.includes('S4）') && !document.querySelector('[data-testid="doc-col"]')?.parentElement?.innerText.includes('⌘S 保存')`))

  // ③ 阿七行菜单：仅「删除」单动作
  await page.eval(pointerSeq(menuBtnFor('阿七')))
  await evalUntil(page, `${menuItemCount}`, (v) => v >= 1, 8000, '阿七行菜单打开')
  ok('菜单仅 1 项', (await page.eval(menuItemCount)) === 1)
  ok('菜单项=「删除」', (await page.eval(menuHas('删除'))) === true)
  await shot(page, 'docsec-rowmenu-2040')
  await page.eval(closeMenu)
  await evalUntil(page, `${menuItemCount}`, (v) => v === 0, 8000, '菜单1关闭')

  // ④ 删除阿七 → 确认 Dialog
  await page.eval(pointerSeq(menuBtnFor('阿七')))
  await evalUntil(page, `${menuItemCount}`, (v) => v >= 1, 8000, '阿七行菜单再开')
  await page.eval(clickMenuItem('删除'))
  await evalUntil(page, `!!document.querySelector('[role=dialog]') && document.body.innerText.includes('删除文档')`, (v) => v === true, 8000, '删除确认 Dialog')
  ok('确认框描述含文档名', (await page.eval(`document.body.innerText.includes('阿七将移入系统废纸篓')`)) === true)
  ok('确认框含「移入废纸篓」主按钮', (await page.eval(`[...document.querySelectorAll('[role=dialog] button')].some((b) => (b.innerText || '').trim() === '移入废纸篓')`)) === true)
  await shot(page, 'docsec-rowmenu-delete-2040')

  // ⑤ 取消 → 列表仍在
  await page.eval(pointerSeq(`[...document.querySelectorAll('[role=dialog] button')].find((b) => (b.innerText || '').trim() === '取消')`))
  await evalUntil(page, `!document.querySelector('[role=dialog]')`, (v) => v === true, 8000, '取消关闭')
  ok('取消后阿七仍在列表', (await page.eval(rowNames)).some((n) => n.includes('阿七')))

  // ⑥ 删除当前选中项（总览）→ 列表移除 + 主区回「选择左侧一个文档开始」+ toast
  await page.eval(pointerSeq(menuBtnFor('总览')))
  await evalUntil(page, `${menuItemCount}`, (v) => v >= 1, 8000, '总览行菜单打开')
  await page.eval(clickMenuItem('删除'))
  await evalUntil(page, `!!document.querySelector('[role=dialog]') && document.body.innerText.includes('总览将移入系统废纸篓')`, (v) => v === true, 8000, '总览确认 Dialog')
  await page.eval(pointerSeq(`[...document.querySelectorAll('[role=dialog] button')].find((b) => (b.innerText || '').trim() === '移入废纸篓')`))
  await evalUntil(page, `[...document.querySelectorAll('.zj-toast')].some((t) => t.innerText.includes('已移入废纸篓'))`, (v) => v === true, 10000, '删除 toast')
  ok('删除成功 toast 出现', true)
  await evalUntil(page, rowNames, (v) => Array.isArray(v) && !v.some((n) => n.includes('总览')), 10000, '总览从列表移除')
  ok('总览已从列表移除', true)
  ok('主区回「选择左侧一个文档开始」', (await page.eval(`document.body.innerText.includes('选择左侧一个文档开始')`)) === true)
  await shot(page, 'docsec-rowmenu-after-delete-2040')

  // ⑦ 右键沈藏行 → ContextMenu 同「删除」
  await page.eval(`(() => {
    const row = [...document.querySelectorAll('[data-testid="doc-col"] button')].find((b) => (b.innerText || '').includes('沈藏'))
    if (!row) return false
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 200, button: 2 }))
    return true
  })()`)
  await evalUntil(page, `${menuItemCount}`, (v) => v >= 1, 8000, '右键菜单打开')
  ok('右键菜单含「删除」', (await page.eval(menuHas('删除'))) === true)
  await page.eval(closeMenu)
  await evalUntil(page, `${menuItemCount}`, (v) => v === 0, 8000, '右键菜单关闭')

  // ⑧ 世界观页同机制（2 行）+ 删除走通
  await page.eval(`window.location.hash = '#/project/${ID}/worldview'`)
  await evalUntil(page, `!!document.querySelector('[data-testid="doc-col"]') && document.querySelectorAll('[data-testid="doc-row-menu"]').length >= 2`, (v) => v === true, 20000, '世界观页就绪')
  ok('世界观文档列行菜单 ×2', (await page.eval(rowCount)) === 2)
  await page.eval(pointerSeq(menuBtnFor('第一幕')))
  await evalUntil(page, `${menuItemCount}`, (v) => v >= 1, 8000, '世界观行菜单打开')
  ok('世界观行菜单仅「删除」', (await page.eval(menuItemCount)) === 1 && (await page.eval(menuHas('删除'))) === true)
  await page.eval(clickMenuItem('删除'))
  await evalUntil(page, `!!document.querySelector('[role=dialog]') && document.body.innerText.includes('第一幕_雾港之夜将移入系统废纸篓')`, (v) => v === true, 8000, '世界观确认 Dialog')
  ok('世界观确认框描述含文档名', true)
  await page.eval(pointerSeq(`[...document.querySelectorAll('[role=dialog] button')].find((b) => (b.innerText || '').trim() === '移入废纸篓')`))
  await evalUntil(page, rowNames, (v) => Array.isArray(v) && !v.some((n) => n.includes('第一幕_雾港之夜')), 10000, '世界观文档移除')
  ok('世界观文档删除走通', true)

  // ⑨ 空态文案无 S4（人物页删光总览后仍剩阿七/沈藏，直接查 chars 空态不适用，改查代码级：demo 空态兜底用 worldview 空态不触发）
  // 简化：直接断言当前页面无「S4）」
  ok('页面无 S4）残留', (await page.eval(`!document.body.innerText.includes('S4）')`)) === true)

  // ⑩ 零 JS 异常
  const errs = page.errors.filter((e) => !e.includes('favicon')).slice(0, 5)
  ok('无 JS 异常', errs.length === 0, errs.join(' ; '))
} catch (e) {
  ok('脚本异常', false, String(e).slice(0, 300))
}

page.close()
clearTimeout(watchdog)
console.log(fail === 0 ? 'ALL PASS' : `FAILS: ${fail}`)
process.exit(fail === 0 ? 0 : 1)
