// 织卷无头冒烟 · 写盘安全/CRUD 增量（2026-10-27）
// 覆盖：素材卡「⋯」菜单存在 / 项目「重命名·改简介」对话框可保存 / 素材编辑器重命名·删除入口
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function openTab(url) { const r = await fetch(CDP + '/json/new?' + encodeURIComponent(url), { method: 'PUT' }); return r.json() }
function attach(wsUrl) {
  const ws = new WebSocket(wsUrl); let seq = 0; const p = new Map()
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { p.get(m.id)(m); p.delete(m.id) } }
  const cmd = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; p.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result))); ws.send(JSON.stringify({ id, method, params })) })
  return new Promise((res) => { ws.onopen = () => res({ cmd, eval: async (expression) => { const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error('EVAL ' + JSON.stringify(r.exceptionDetails).slice(0, 200)); return r.result?.value } }) })
}
async function evalUntil(page, expr, pred, timeoutMs = 15000, label = expr) {
  const t0 = Date.now()
  for (;;) { try { const v = await page.eval(expr); if (pred(v)) return v } catch {} if (Date.now() - t0 > timeoutMs) throw new Error('TIMEOUT ' + label); await sleep(250) }
}
let fail = 0
const ok = (n, c, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' | ' + x : '')); if (!c) fail++ }
// Radix 菜单：pointerdown/up + click
const clickByText = (sel, text) => `(() => { const el = [...document.querySelectorAll('${sel}')].find((x) => (x.innerText || '').trim().includes('${text}')); if (!el) return false; el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'mouse'})); el.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerType:'mouse'})); el.click(); return true })()`

const tab = await openTab(BASE + '/?cb=' + Date.now())
const page = await attach(tab.webSocketDebuggerUrl)
try {
  await evalUntil(page, `typeof window.zhijuan?.setSettings === 'function'`, (v) => v === true, 20000, 'zhijuan 就绪')

  // ① 项目「重命名/改简介」对话框
  await page.eval(`(location.hash = '#/', 1)`)
  await sleep(1200)
  await evalUntil(page, `document.body.innerText.includes('余烬的灯')`, (v) => v === true, 15000, '首页项目卡')
  // 打开项目卡菜单（MoreHorizontal 触发按钮）
  await page.eval(`(() => { const b = [...document.querySelectorAll('button')].filter((x) => x.querySelector('svg') && (x.getAttribute('aria-label')||'').match(/更多|菜单|more/i)); if (b[0]) { b[0].dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'mouse'})); b[0].dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerType:'mouse'})); b[0].click(); return true } return false })()`)
  await sleep(600)
  const opened = await page.eval(clickByText('[role="menuitem"]', '重命名'))
  await sleep(700)
  const hasDialog = await page.eval(`!!document.querySelector('[data-testid="home-edit-save"]')`)
  ok('项目菜单「重命名/改简介」打开对话框', opened === true && hasDialog === true, 'opened=' + opened + ' dialog=' + hasDialog)
  if (hasDialog) {
    await page.eval(`(() => { const i = [...document.querySelectorAll('textarea, input')].find((x) => (x.value || '').includes('示例')); if (!i) return false; const proto = i.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; const set = Object.getOwnPropertyDescriptor(proto,'value').set; set.call(i, i.value + '（已核对）'); i.dispatchEvent(new Event('input',{bubbles:true})); return true })()`)
    await sleep(300)
    await page.eval(`document.querySelector('[data-testid="home-edit-save"]').click()`)
    await sleep(1000)
    const saved = await page.eval(`document.body.innerText.includes('已核对')`)
    ok('项目简介保存后可见', saved === true)
  }

  // ② 素材页「⋯」菜单
  await page.eval(`(location.hash = '#/project/demo-aseya/library', 1)`)
  await sleep(1500)
  const hasMatMenu = await page.eval(`!!document.querySelector('[data-testid="material-menu"]')`)
  ok('素材卡「⋯」菜单存在', hasMatMenu === true)

  // ③ 打开素材 → 编辑器重命名/删除入口
  await page.eval(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /追忆型开头|采集_演示/.test(x.innerText || '')); if (b) { b.click(); return true } return false })()`)
  await sleep(900)
  const hasEditActs = await page.eval(`!!document.querySelector('[data-testid="material-rename"]') || !!document.querySelector('[data-testid="material-delete"]')`)
  ok('素材编辑器含重命名/删除入口', hasEditActs === true)
} catch (e) {
  console.error('FATAL', e.message)
  fail++
} finally {
  try { await fetch(CDP + '/json/close/' + tab.id) } catch {}
}
console.log('RESULT ' + (fail ? fail + ' FAIL' : 'ALL OK'))
process.exit(fail ? 1 : 0)