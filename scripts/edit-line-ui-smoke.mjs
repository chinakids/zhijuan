// 织卷无头冒烟 · 章节「修改时间线」（store.editChapterLine + 右键菜单 + Dialog + 多线引用面收口）
// 用法：node scripts/edit-line-ui-smoke.mjs
// 前置：npm run build；node scripts/serve-renderer.mjs 8123；本机无头 Chrome CDP 127.0.0.1:9224
// 验收点：① 右键菜单出现「修改时间线」；② Dialog 预填当前线、含「已有时间线」chips（>1 线）；
//         ③ 改回主线（留空）→ 正文约定头「时间线」字段移除、大纲副产物 fm 同步、行徽标变主线；
//         ④ 主线章改入新线（回忆线）→ 字段写入；⑤ 全程无 JS 异常 + 截图存档。
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const fs = await import('node:fs')

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
        cmd,
        errors,
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
    } catch {}
    if (Date.now() - t0 > timeoutMs) throw new Error('TIMEOUT waiting: ' + label)
    await sleep(250)
  }
}

const clickBtn = (text, inDialog = false) => `(() => {
  const roots = ${inDialog ? "[...document.querySelectorAll('[role=dialog]')]" : '[document]'}
  const el = roots.flatMap(r => [...r.querySelectorAll('button')]).find(b => (b.innerText || '').trim() === ${JSON.stringify(text)})
  if (!el || el.disabled) return false
  el.click()
  return true
})()`

// Radix 菜单项是 [role=menuitem] 而非 button，且程序化 click 不触发 onSelect——须 pointer 三连
const menuItemClick = (text) => `(() => {
  const el = [...document.querySelectorAll('[role=menuitem]')].find(b => (b.innerText || '').trim() === ${JSON.stringify(text)})
  if (!el) return false
  for (const t of ['pointerdown', 'pointerup', 'click']) {
    el.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, pointerType: 'mouse' }))
  }
  return true
})()`

const fill = (selector, value) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)})
  if (!el) return false
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)})
  el.dispatchEvent(new Event('input', { bubbles: true }))
  return true
})()`

const pageHas = (t) => `document.body.innerText.includes(${JSON.stringify(t)})`
const ctxMenuOn = (label) => `(() => {
  const btn = [...document.querySelectorAll('aside button')].find(b => (b.innerText || '').includes(${JSON.stringify(label)}))
  if (!btn) return false
  btn.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 200, button: 2 }))
  return true
})()`
const readDoc = (rel) => `window.zhijuan.readDoc('demo-order', ${JSON.stringify(rel)})`

async function shot(page, name) {
  try {
    const r = await page.cmd('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync('/tmp/' + name, Buffer.from(r.data, 'base64'))
    console.log('SHOT /tmp/' + name)
  } catch (e) {
    console.log('SHOT WARN', String(e).slice(0, 100))
  }
}

let fails = 0
const ok = (name, cond, extra = '') => {
  console.log((cond ? 'OK ' : 'NG ') + name + (extra ? ' | ' + extra : ''))
  if (!cond) fails++
}

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-order')
console.log('TAB:', tab.id)
const page = await attach(tab.webSocketDebuggerUrl)
try {
  // ① 进入项目正文页：多线项目章节列表就绪（第2章 旧港=过去线）
  await evalUntil(page, pageHas('第2章 · 旧港'), (v) => v === true, 20000, '章节列表就绪')
  ok('列表展示了 6 章', (await page.eval(pageHas('第6章 · 旧港之二'))) === true)
  ok('过去线章徽标可见（多线项目）', (await page.eval(`[...document.querySelectorAll('aside button')].some(b => (b.innerText||'').includes('第2章 · 旧港') && (b.innerText||'').includes('过去线'))`) ) === true)

  // 预置大纲副产物（demo-order 无种子，用 writeDoc 造章卡/导演板，验证改线同步）
  await page.eval(`(async () => {
    await window.zhijuan.writeDoc('demo-order', '大纲/第02章_旧港.md', ['---','章号: 2','题名: 旧港','切片: 第一幕_潮起','时间线: 过去线','---','','# 章卡 第2章 旧港','','> 对应正文：正文/第02章_旧港.md',''].join('\\n'))
    await window.zhijuan.writeDoc('demo-order', '大纲/第02章_旧港_导演.md', ['---','章号: 2','题名: 旧港','切片: 第一幕_潮起','时间线: 过去线','---','','# 导演板 · 第2章 旧港','','> 对应正文：正文/第02章_旧港.md',''].join('\\n'))
    return true
  })()`)

  // ② 右键第 2 章 → 菜单含「修改时间线」
  ok('右键已触发', (await page.eval(ctxMenuOn('第2章 · 旧港'))) === true)
  await evalUntil(page, pageHas('修改时间线'), (v) => v === true, 8000, '菜单出现')
  await shot(page, 'zj-line-menu.png')

  // ③ 点「修改时间线」→ Dialog 预填当前线（过去线）+ 已有线 chips
  await page.eval(menuItemClick('修改时间线'))
  await evalUntil(page, `document.querySelector('[data-testid="edit-line-input"]') !== null`, (v) => v === true, 8000, '修改时间线对话框')
  const prefill = await page.eval(`document.querySelector('[data-testid="edit-line-input"]')?.value ?? ''`)
  ok('Dialog 预填当前线', prefill === '过去线', 'prefill=' + prefill)
  await sleep(300)
  const chipCount = await page.eval(`document.querySelectorAll('[data-testid^="edit-line-chip-"]').length`)
  ok('已有时间线 chips 出现（>1 线）', chipCount >= 2, 'chips=' + chipCount)

  // ④ 留空（=主线）→ 保存：字段移除 + 副产物同步
  await page.eval(fill('[data-testid="edit-line-input"]', ''))
  await sleep(200)
  await page.eval(clickBtn('保存', true))
  await evalUntil(page, pageHas('已更新时间线'), (v) => v === true, 10000, 'toast 出现')
  await evalUntil(page, `(async () => { const d = await window.zhijuan.readDoc('demo-order', '正文/第02章_旧港.md'); return d && !d.includes('时间线:') })()`, (v) => v === true, 10000, '正文约定头移除字段')
  const doc2 = await page.eval(readDoc('正文/第02章_旧港.md'))
  ok('正文约定头时间线字段已移除（主线=缺省）', !!doc2 && !doc2.includes('时间线:'))
  ok('正文内容不动', !!doc2 && doc2.includes('三十年前的今天'))
  const card = await page.eval(readDoc('大纲/第02章_旧港.md'))
  ok('章卡 fm 时间线移除（同口径）', !!card && !card.includes('时间线:'), card ? '' : '章卡为空')
  const dirm = await page.eval(readDoc('大纲/第02章_旧港_导演.md'))
  ok('导演板 fm 时间线移除（同口径）', !!dirm && !dirm.includes('时间线:'))
  ok('该行徽标变主线', (await page.eval(`[...document.querySelectorAll('aside button')].some(b => (b.innerText||'').includes('第2章 · 旧港') && (b.innerText||'').includes('主线'))`)) === true)

  // ⑤ 主线章（第1章）改入新线「回忆线」：字段写入 + 行徽标
  ok('右键第1章', (await page.eval(ctxMenuOn('第1章 · 晨港'))) === true)
  await evalUntil(page, pageHas('修改时间线'), (v) => v === true, 8000, '菜单再次出现')
  await page.eval(menuItemClick('修改时间线'))
  await evalUntil(page, `document.querySelector('[data-testid="edit-line-input"]') !== null`, (v) => v === true, 8000, '对话框再次出现')
  const prefill2 = await page.eval(`document.querySelector('[data-testid="edit-line-input"]')?.value ?? ''`)
  ok('主线章预填空（缺省=主线）', prefill2 === '', 'prefill=' + prefill2)
  await page.eval(fill('[data-testid="edit-line-input"]', '回忆线'))
  await sleep(200)
  await page.eval(clickBtn('保存', true))
  await evalUntil(page, `(async () => { const d = await window.zhijuan.readDoc('demo-order', '正文/第01章_晨港.md'); return d && d.includes('时间线: 回忆线') })()`, (v) => v === true, 10000, '新线字段写入')
  ok('第1章约定头写入新线', (await page.eval(readDoc('正文/第01章_晨港.md'))).includes('时间线: 回忆线'))
  ok('新线徽标出现', (await page.eval(`[...document.querySelectorAll('aside button')].some(b => (b.innerText||'').includes('第1章 · 晨港') && (b.innerText||'').includes('回忆线'))`)) === true)

  // ⑥ 全程无 JS 异常
  await sleep(600)
  ok('无 JS 异常', page.errors.length === 0, page.errors.slice(0, 2).join(' | '))
  await shot(page, 'zj-line-done.png')
} catch (e) {
  console.log('FATAL', String(e).slice(0, 300))
  fails++
}
console.log(fails === 0 ? 'ALL PASS' : `FAILED ${fails}`)
try { await page.eval('window.close()') } catch {}
process.exit(fails === 0 ? 0 : 1)
