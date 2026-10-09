// 织卷无头冒烟 · 章节「上移/下移」重排（创作层 2026-10-09）——与相邻章交换章号，写完改序不再盲改文件。
// 前置：npm run build；python3 /tmp/spa_server.py 8899 out/renderer；本机无头 Chrome CDP 127.0.0.1:9224
// 用法：ZJ_SMOKE_BASE=http://127.0.0.1:8899 node scripts/chapter-reorder-ui-smoke.mjs
// 验收点：① 行菜单含「上移/下移」（7 项，row-menu 冒烟另验）
//         ② 第2章「上移」→ 与第1章交换（列表序与行标签变化 + toast）
//         ③ 交换后第1章「上移」禁用（已是第一章）、「下移」可用
//         ④ dirty（未保存）且波及选中章 → 拦截 toast「当前章节有未保存的改动」
//         ⑤ 全程无 JS 异常；截图。
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const fs = await import('node:fs')
const OUT = process.env.HOME + '/Pictures/zhijuan'
setTimeout(() => { console.log('!! WATCHDOG 150s'); process.exit(2) }, 150000)

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

// 行菜单触发（Radix 需 pointer 三连）：rowText=行内文本；返回菜单项文本数组
const openRowMenu = (rowText) => `(() => {
  const row = [...document.querySelectorAll('aside button')].find(b => (b.innerText || '').includes(${JSON.stringify(rowText)}));
  if (!row) return false;
  const btn = row.parentElement.querySelector('[aria-label="章节操作"]');
  if (!btn) return false;
  btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }));
  btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }));
  btn.click();
  return true;
})()`
const menuItems = `[...document.querySelectorAll('[role=menuitem]')].map(b => (b.innerText || '').trim())`
const menuItemState = (t) => `(() => {
  const b = [...document.querySelectorAll('[role=menuitem]')].find(x => (x.innerText || '').trim() === ${JSON.stringify(t)});
  if (!b) return null;
  return { disabled: b.getAttribute('data-disabled') !== null || b.getAttribute('aria-disabled') === 'true' };
})()`
const clickMenuItem = (t) => `(() => {
  const b = [...document.querySelectorAll('[role=menuitem]')].find(x => (x.innerText || '').trim() === ${JSON.stringify(t)});
  if (!b) return false;
  b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }));
  b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }));
  b.click();
  return true;
})()`
const rowTitles = `[...document.querySelectorAll('aside button')].map(b => (b.innerText || '').split('\\n')[0]).filter(Boolean)`
const clickRow = (t) => `(() => { const b = [...document.querySelectorAll('aside button')].find(x => (x.innerText || '').includes(${JSON.stringify(t)})); if (!b) return false; b.click(); return true })()`

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel')
console.log('TAB:', tab.id)
const page = await attach(tab.webSocketDebuggerUrl)

// ① 等侧栏章节加载（≥4 章）
await evalUntil(page, `document.querySelectorAll('aside button').length >= 4`, (v) => v === true, 20000, '侧栏章节 ≥4')
const t0 = await page.eval(rowTitles)
ok('侧栏已加载（首项=第1章 · 雾港）', Array.isArray(t0) && t0[0] === '第1章 · 雾港', JSON.stringify(t0.slice(0, 3)))

// ② 第2章（灯塔）行菜单 → 含 上移/下移，上移可用 → 点上移
ok('打开第2章行菜单', (await page.eval(openRowMenu('第2章 · 灯塔'))) === true)
await evalUntil(page, menuItems + '.length', (v) => v >= 7, 8000, '行菜单 ≥7 项')
let items = await page.eval(menuItems)
ok('菜单含「上移」「下移」', items.includes('上移') && items.includes('下移'), JSON.stringify(items))
const moveUpState = await page.eval(menuItemState('上移'))
ok('第2章「上移」可用', !!moveUpState && moveUpState.disabled === false)
await shot(page, 'chapter-reorder-menu-' + new Date().toTimeString().slice(0, 5).replace(':', ''))
ok('点上移', (await page.eval(clickMenuItem('上移'))) === true)
await evalUntil(page, `(document.body.innerText || '').includes('已上移')`, (v) => v === true, 15000, 'toast 已上移')
const t1 = await page.eval(rowTitles)
ok('顺序变为 第1章 · 灯塔 / 第2章 · 雾港', t1[0] === '第1章 · 灯塔' && t1[1] === '第2章 · 雾港', JSON.stringify(t1.slice(0, 3)))
await shot(page, 'chapter-reorder-done-' + new Date().toTimeString().slice(0, 5).replace(':', ''))

// ③ 交换后首章「上移」禁用、「下移」可用
ok('打开第1章（灯塔）行菜单', (await page.eval(openRowMenu('第1章 · 灯塔'))) === true)
await evalUntil(page, menuItems + '.length', (v) => v >= 7, 8000, '行菜单 ≥7 项')
const upState = await page.eval(menuItemState('上移'))
const downState = await page.eval(menuItemState('下移'))
ok('首章「上移」禁用', !!upState && upState.disabled === true)
ok('首章「下移」可用', !!downState && downState.disabled === false)
// 关闭菜单（点外部）
await page.eval(`document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse', clientX: 5, clientY: 5 }))`)

// ④ dirty（未保存）且重排波及选中章 → 拦截
ok('选中第2章（雾港）', (await page.eval(clickRow('第2章 · 雾港'))) === true)
await evalUntil(page, `(document.querySelector('.ProseMirror') ? document.querySelector('.ProseMirror').innerText.length : 0) > 0`, (v) => v === true, 15000, '编辑器就绪')
ok('聚焦编辑器', (await page.eval(`(() => { const p = document.querySelector('.ProseMirror'); if (!p) return false; p.focus(); return true })()`)) === true)
await page.cmd('Input.insertText', { text: '未保存重排测试A。' })
const unsavedEl = `[...document.querySelectorAll('[role=status]')].some(e => (e.innerText || '').includes('未保存'))`
await evalUntil(page, unsavedEl, (v) => v === true, 15000, '状态条出现未保存')
ok('状态条出现「未保存」', true)
ok('对第1章（灯塔）行菜单', (await page.eval(openRowMenu('第1章 · 灯塔'))) === true)
await evalUntil(page, menuItems + '.length', (v) => v >= 7, 8000, '行菜单 ≥7 项')
ok('点下移（与选中第2章交换=波及选中章）', (await page.eval(clickMenuItem('下移'))) === true)
await evalUntil(page, `(document.body.innerText || '').includes('当前章节有未保存的改动')`, (v) => v === true, 15000, '拦截 toast')
ok('dirty 拦截出现「当前章节有未保存的改动」', true)
await shot(page, 'chapter-reorder-dirty-hold-' + new Date().toTimeString().slice(0, 5).replace(':', ''))

// ⑤ 无 JS 异常
ok('无 JS 异常', page.errors.length === 0, page.errors.slice(0, 3).join(' ; '))

console.log(fail === 0 ? '\n=== chapter-reorder-ui-smoke 全部通过 ===' : `\n=== 失败 ${fail} 项 ===`)
process.exit(fail === 0 ? 0 : 1)
