// 织卷无头冒烟 · 下拉菜单（DropdownMenu）一致性走查——HIG Menus / Pull-down buttons
// 用法：node scripts/dropdown-menu-ui-smoke.mjs
// 前置：npm run build；node scripts/serve-renderer.mjs 8123（SPA fallback）；CDP 127.0.0.1:9224
// 验收点：A 首页项目卡菜单（icon/省略号/红字/触发器 open 态/Esc）；B Agent「检查」菜单（3 项全卷巡读——本地规则 7 项已迁「规则体检」状态栏 F-20260916-05；每项 icon、触发器 open 态、键盘导航、Esc、dark 复测）；C 编辑器 More 菜单（disabled 置灰、分隔线、触发器 open 态回归 4392ae5）；截图两张。
import { writeFileSync, mkdirSync } from 'node:fs'
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
const OUT = process.env.ZJ_SHOT_DIR || process.env.HOME + '/Pictures/zhijuan'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
mkdirSync(OUT, { recursive: true })

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
        eval: async (expression, timeoutMs = 8000) => {
          let timer
          const p = cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
          const t = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('EVAL TIMEOUT: ' + expression.slice(0, 50))), timeoutMs) })
          const r = await Promise.race([p, t])
          clearTimeout(timer)
          if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 300))
          return r.result?.value
        }
      })
    }
  })
}

let fails = 0
const ok = (name, cond, extra = '') => {
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : ''))
  if (!cond) fails++
}
const openMenuBySel = (page, sel) => page.eval(`(() => {
  const b = (${sel})
  if (!b) return 'NOBTN'
  b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
  b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }))
  b.click()
  return 'OK'
})()`)
const esc = (page) => page.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
const triggerState = (page, sel) => page.eval(`(() => {
  const b = (${sel}); if (!b) return null
  const s = getComputedStyle(b)
  return { bg: s.backgroundColor, ds: b.getAttribute('data-state') }
})()`)

const MENU_ITEMS = `[...document.querySelectorAll('[role="menu"]')].map(m => ({
  items: [...m.querySelectorAll('[role="menuitem"]')].map(i => ({ t: i.textContent.trim(), icon: !!i.querySelector('svg'), dis: i.getAttribute('aria-disabled'), op: getComputedStyle(i).opacity, sub: i.getAttribute('aria-haspopup') || null })),
  seps: m.querySelectorAll('[role="separator"]').length,
  bg: getComputedStyle(m).backgroundColor
}))`
const shot = async (page, name) => {
  try {
    const r = await page.cmd('Page.captureScreenshot', { format: 'png' })
    writeFileSync(OUT + '/' + name, Buffer.from(r.data, 'base64'))
    console.log('SHOT | ' + name)
  } catch (e) { console.log('SHOT FAIL | ' + name + ' | ' + e.message) }
}

// ────────── A. 首页项目卡菜单 ──────────
const tabA = await openTab(BASE + '/#/?cb=dm1')
const A = await attach(tabA.webSocketDebuggerUrl)
await sleep(2600)
ok('A0 首页有项目卡（devShim）', await A.eval(`!![...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === '更多操作')`))
const aOpen = await openMenuBySel(A, `[...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === '更多操作')`)
ok('A1 菜单可打开', aOpen === 'OK', aOpen)
await sleep(700)
const aMenu = (await A.eval(MENU_ITEMS))[0]
ok('A2 菜单 4 项且每项带 icon（HIG 组内 icon 统一）', !!aMenu && aMenu.items.length === 4 && aMenu.items.every((i) => i.icon), JSON.stringify(aMenu?.items?.map((i) => i.t)))
ok('A2b 「导出作品」为子菜单触发器（作品编译三格式收敛，aria-haspopup=menu）', !!aMenu && aMenu.items.some((i) => i.t.includes('导出作品') && i.sub === 'menu'), JSON.stringify(aMenu?.items?.filter((i) => i.sub)))
ok('A3 「导出到…」带省略号（需要更多信息才完成）', !!aMenu && aMenu.items.some((i) => i.t.includes('导出到…')))
const aColors = await A.eval(`(() => [...document.querySelectorAll('[role="menuitem"]')].map(i => ({ t: i.textContent.trim(), color: getComputedStyle(i).color })))()`)
const delItem = aColors.find((i) => i.t.includes('废纸篓'))
const otherItem = aColors.find((i) => i.t.includes('打开所在'))
ok('A4 destructive 项红字（Pull-down buttons 红字提示）', !!delItem && !!otherItem && delItem.color !== otherItem.color, JSON.stringify({ del: delItem?.color, other: otherItem?.color }))
const aTrig = await triggerState(A, `[...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === '更多操作')`)
ok('A5 触发器 open 态保持高亮（open 时 bg=well 非透明）', !!aTrig && aTrig.ds === 'open' && aTrig.bg !== 'rgba(0, 0, 0, 0)', JSON.stringify(aTrig))
await shot(A, 'dropdown-home-open-' + new Date().toTimeString().slice(0, 5).replace(':', '') + '.png')
await esc(A); await sleep(400)
ok('A6 Esc 关闭菜单', (await A.eval(`document.querySelectorAll('[role="menu"]').length`)) === 0)

// ────────── B. Agent「检查」菜单 ──────────
await A.eval(`location.hash = '#/project/demo-aseya/novel'`)
await sleep(2600)
await A.eval(`(() => {
  const pick = () => [...document.querySelectorAll('button')].find((b) => /第.{1,6}章/.test(b.innerText))
  const cand = pick(); if (cand) cand.click()
  return !!cand
})()`)
await sleep(2600)
ok('B0 编辑器与 Agent 面板就绪', await A.eval(`!!document.querySelector('.ProseMirror') && !![...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === '检查')`))
const CHKBTN = `[...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === '检查')`
ok('B1 检查菜单可打开', (await openMenuBySel(A, CHKBTN)) === 'OK')
await sleep(700)
const bMenu = (await A.eval(MENU_ITEMS))[0]
ok('B2 检查菜单 3 项全卷巡读（F-20260916-05 本地规则已迁状态栏，无分组分隔线）', !!bMenu && bMenu.items.length === 3 && bMenu.seps === 0, JSON.stringify({ items: bMenu?.items?.length, seps: bMenu?.seps }))
const b0 = await A.eval(`[...document.querySelectorAll('[role="menuitem"]')].map(i => i.textContent.trim())`)
ok('B3 顺序=一致性巡查/冷读报告/多视角审视（本地规则已迁状态栏）', b0.length === 3 && b0[0].includes('一致性') && b0[1].includes('冷读报告') && b0[2].includes('多视角'), b0.join(' | '))
ok('B4 每项带 icon（组内统一）', !!bMenu && bMenu.items.every((i) => i.icon))
const bTrig = await triggerState(A, CHKBTN)
ok('B5 触发器 open 态保持高亮', !!bTrig && bTrig.ds === 'open' && bTrig.bg !== 'rgba(0, 0, 0, 0)', JSON.stringify(bTrig))
// 键盘导航：第一个 item 高亮（Radix arrow key）
const kbd = await A.eval(`(async () => {
  const content = document.querySelector('[role="menu"]'); if (!content) return 'NO MENU'
  content.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
  await new Promise(r => setTimeout(r, 250))
  const hl = content.querySelector('[data-highlighted]')
  const first = content.querySelector('[role="menuitem"]')
  return JSON.stringify({ hl: hl ? hl.textContent.trim().slice(0, 12) : null, activeRole: document.activeElement ? document.activeElement.getAttribute('role') : null })
})()`)
const kbdJ = JSON.parse(kbd)
ok('B6 键盘 ArrowDown 高亮菜单项（Radix 键盘导航）', !!kbdJ.hl || kbdJ.activeRole === 'menuitem', kbd)
await shot(A, 'dropdown-checks-open-' + new Date().toTimeString().slice(0, 5).replace(':', '') + '.png')
await esc(A); await sleep(400)
ok('B7 Esc 关闭检查菜单', (await A.eval(`document.querySelectorAll('[role="menu"]').length`)) === 0)
// dark 复测
await A.eval(`document.documentElement.classList.add('dark')`)
await sleep(300)
await openMenuBySel(A, CHKBTN); await sleep(700)
const bDark = (await A.eval(MENU_ITEMS))[0]
const bTrigDark = await triggerState(A, CHKBTN)
ok('B8 dark 菜单背景为深色（跟随主题）', !!bDark && !/^rgb\(2[0-9]{2},/.test(bDark.bg), JSON.stringify(bDark?.bg))
ok('B9 dark 触发器 open 态保持高亮', !!bTrigDark && bTrigDark.ds === 'open' && bTrigDark.bg !== 'rgba(0, 0, 0, 0)', JSON.stringify(bTrigDark))
await shot(A, 'dropdown-checks-dark-' + new Date().toTimeString().slice(0, 5).replace(':', '') + '.png')
await esc(A); await sleep(300)
await A.eval(`document.documentElement.classList.remove('dark')`)

// ────────── C. 编辑器 More 菜单（窄窗 tab：先交互后 resize）──────────
const tabC = await openTab(BASE + '/#/?cb=dm2')
const C = await attach(tabC.webSocketDebuggerUrl)
await sleep(2600)
await C.eval(`location.hash = '#/project/demo-aseya/novel'`)
await sleep(2600)
await C.eval(`(() => {
  const cand = [...document.querySelectorAll('button')].find((b) => /第.{1,6}章/.test(b.innerText)); if (cand) cand.click()
  return !!cand
})()`)
await sleep(2600)
await C.cmd('Emulation.setDeviceMetricsOverride', { width: 700, height: 800, deviceScaleFactor: 1, mobile: false })
await sleep(500)
const MOREBTN = `[...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === '更多格式')`
ok('C0 窄窗出现 More 菜单', await C.eval(`!!(${MOREBTN})`))
ok('C1 More 菜单可打开', (await openMenuBySel(C, MOREBTN)) === 'OK')
await sleep(800)
const cMenu = (await C.eval(MENU_ITEMS))[0]
ok('C2 More 菜单分组分隔线存在', !!cMenu && cMenu.seps >= 1, JSON.stringify(cMenu?.seps))
const undo = cMenu?.items?.find((i) => i.t.startsWith('撤销'))
const others = cMenu?.items?.filter((i) => !i.t.startsWith('撤销') && !i.t.startsWith('重做'))
ok('C3 不可用项置灰（撤销/重做 aria-disabled + opacity 0.5；其余可用）', !!undo && undo.dis === 'true' && undo.op === '0.5' && others?.every((i) => i.op === '1'), JSON.stringify(cMenu?.items?.map((i) => ({ t: i.t, dis: i.dis, op: i.op }))))
const cTrig = await triggerState(C, MOREBTN)
ok('C4 More 触发器 open 态保持高亮（回归 4392ae5）', !!cTrig && cTrig.ds === 'open' && cTrig.bg !== 'rgba(0, 0, 0, 0)', JSON.stringify(cTrig))
await esc(C); await sleep(300)

ok('全程无 JS 异常', A.errors.length === 0 && C.errors.length === 0, JSON.stringify([...A.errors, ...C.errors].slice(0, 3)))
console.log(fails === 0 ? 'ALL PASS' : 'FAILS=' + fails)
process.exit(fails === 0 ? 0 : 1)
