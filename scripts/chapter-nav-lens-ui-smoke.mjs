// 织卷无头冒烟 · 筛选态章导航（时间线镜头 = 导航域；封版目标① 双线中篇连写动线）
// 用法：node scripts/chapter-nav-lens-ui-smoke.mjs
// 前置：npm run build；node scripts/serve-renderer.mjs 8123（或 ZJ_SMOKE_BASE 指向已起服务）；本机无头 Chrome CDP 127.0.0.1:9224
// 断言面：① 全部镜头：第1章 next=第2章（阅读序，零变化）；② 切「过去线」后当前章（第1章）被镜头挡住 →
//   章列出现一行说明（当前章 … 不在「过去线」内）且不溢出；③ 镜头内第2章 next=第4章（跳过主线第3章，不跳到看不见的章）；
//   ④ 点「下一章」落到第4章、章列高亮同步；⑤ 键盘 ⌥⌘→ 到第6章、再按到底不再跨线（next 禁用「已是最后一章」）；
//   ⑥ 回「全部」→ 说明消失、next 恢复阅读序（第4章→第5章）；⑦ 单线项目零 chips 且导航照常；⑧ 全程零 JS 异常。
import { writeFileSync, mkdirSync } from 'node:fs'
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
const OUT = process.env.HOME + '/Pictures/zhijuan'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const cb = Date.now()
let fails = 0
function ok(name, cond, detail = '') {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail ? ' | ' + String(detail).slice(0, 220) : ''))
  if (!cond) fails++
}
async function openTab(url) {
  const r = await fetch(CDP + '/json/new?' + encodeURIComponent(url), { method: 'PUT' })
  return r.json()
}
function attach(wsUrl) {
  const ws = new WebSocket(wsUrl); let seq = 0; const pending = new Map(); const errors = []
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.method === 'Runtime.exceptionThrown') errors.push((m.params.exceptionDetails?.exception?.description ?? '').slice(0, 200))
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push((m.params.args?.map((a) => a.value ?? a.description ?? '').join(' ') ?? '').slice(0, 200))
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  }
  const cmd = (method, params = {}) => new Promise((res, rej) => {
    const id = ++seq; pending.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)))
    ws.send(JSON.stringify({ id, method, params }))
  })
  return new Promise((res) => {
    ws.onopen = async () => {
      await cmd('Runtime.enable')
      res({
        cmd, errors,
        eval: async (expression) => {
          const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
          if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 250))
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
    await sleep(300)
  }
}
async function shot(page, name) {
  mkdirSync(OUT, { recursive: true })
  const hh = String(new Date().getHours()).padStart(2, '0')
  const mm = String(new Date().getMinutes()).padStart(2, '0')
  const s = await page.cmd('Page.captureScreenshot', { format: 'png' })
  const p = OUT + '/' + name + '-' + hh + mm + '.png'
  writeFileSync(p, Buffer.from(s.data, 'base64'))
  console.log('SCREENSHOT:', p)
}
// 导航 + 镜头状态快照：底部上一章/下一章（title/disabled/aria）+ 章列选中行 + 镜头说明 + chip 选中
const snap = `(() => {
  const navq = (t) => { const b = document.querySelector('[data-testid="' + t + '"]'); return b ? { title: b.getAttribute('title'), aria: b.getAttribute('aria-label'), disabled: !!b.disabled } : null }
  const rows = [...document.querySelectorAll('[data-testid="chapter-sidebar"] button')]
  const selRow = rows.find((x) => (x.className || '').includes('accent-soft'))
  const chip = document.querySelector('[data-testid="chapter-line-filter"] [aria-selected="true"]')
  const note = document.querySelector('[data-testid="chapter-lens-outside-note"]')
  const noteBox = note ? note.getBoundingClientRect() : null
  const colBox = document.querySelector('[data-testid="chapter-sidebar"]')?.getBoundingClientRect() ?? null
  const chs = rows.map((b) => (b.innerText || '').replace(/\\s+/g, ' ').trim()).filter((t) => /第\\d+章 ·/.test(t)).map((t) => t.match(/第\\d+章 · [^\\s·]+/)[0])
  return {
    prev: navq('chapter-prev'), next: navq('chapter-next'),
    sel: selRow ? ((selRow.innerText || '').replace(/\\s+/g, ' ').trim().match(/第\\d+章 · [^\\s·]+/) || [''])[0] : null,
    chip: chip ? chip.getAttribute('data-line') : null,
    note: note ? (note.innerText || '').trim() : null,
    noteOverflow: note && noteBox && colBox ? noteBox.right > colBox.right + 1 : null,
    chs, editor: !!document.querySelector('.ProseMirror')
  }
})()`
const clickChap = (t) => `(() => {
  const b = [...document.querySelectorAll('[data-testid="chapter-sidebar"] button')].find((x) => (x.innerText || '').includes(${JSON.stringify(t)}))
  if (!b) return false
  b.click(); return true
})()`
const clickTab = (line) => `(() => {
  const t = [...document.querySelectorAll('[data-testid="chapter-line-filter"] [role=tab]')].find((x) => x.getAttribute('data-line') === ${JSON.stringify(line)})
  if (!t) return false
  t.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
  t.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }))
  t.click(); return true
})()`
const clickNav = (t) => `(() => {
  const b = document.querySelector('[data-testid="' + ${JSON.stringify(t)} + '"]')
  if (!b || b.disabled) return false
  b.click(); return true
})()`

// 原生键事件（⌥⌘→）：modifiers 1=Alt 4=Meta
async function keyAltMeta(page, key, vk, macVk) {
  for (const type of ['keyDown', 'keyUp']) {
    await page.cmd('Input.dispatchKeyEvent', {
      type, key, code: key, windowsVirtualKeyCode: vk, nativesVirtualKeyCode: macVk, modifiers: 1 | 4
    })
  }
}

// ---------- ① 多线项目 demo-order（潮汐的岔路） ----------
const tab = await openTab(BASE + '/#/project/demo-order/novel?cb=' + cb)
const p = await attach(tab.webSocketDebuggerUrl)
try {
  await evalUntil(p, `document.body.innerText.includes('第1章')`, (v) => v === true, 25000, '正文页就绪')
  ok('点开第1章', (await p.eval(clickChap('第1章'))) === true)
  await evalUntil(p, `!!document.querySelector('.ProseMirror')`, (v) => v === true, 20000, '编辑器挂载')

  let s = await evalUntil(p, snap, (v) => v && v.next && v.next.title, 15000, '底部章导航')
  ok('全部镜头：第1章 next=第2章（阅读序，零变化）', s.next?.title === '下一章：第2章 · 旧港', JSON.stringify(s.next))
  ok('全部镜头：第1章 prev 禁用「已是第一章」', s.prev?.title === '已是第一章' && s.prev?.disabled === true, JSON.stringify(s.prev))
  ok('全部镜头：无「不在镜头内」说明', s.note === null, String(s.note))

  // ---------- ② 切「过去线」：当前章被镜头挡住 ----------
  ok('点击「过去线」chip', (await p.eval(clickTab('过去线'))) === true)
  await sleep(400)
  s = await p.eval(snap)
  ok('过去线镜头=第2/4/6章', JSON.stringify(s.chs) === JSON.stringify(['第2章 · 旧港', '第4章 · 长堤', '第6章 · 旧港之二']), JSON.stringify(s.chs))
  ok('当前章（第1章）被镜头挡住 → 出现一行说明', s.note === '当前章《第1章 · 晨港》不在「过去线」内', String(s.note))
  ok('说明不越出章列右缘（窄列 truncate）', s.noteOverflow === false, String(s.noteOverflow))
  ok('镜头外选中：下一章=第2章（就近安置镜头内首章，不判死）', s.next?.title === '下一章：第2章 · 旧港' && s.next?.disabled === false, JSON.stringify(s.next))
  await shot(p, 'chapter-nav-lens-outside')

  // ---------- ③ 镜头内第2章：下一章=第4章（跳过主线第3章） ----------
  ok('点开第2章', (await p.eval(clickChap('第2章'))) === true)
  await evalUntil(p, snap, (v) => v && v.sel && v.sel.startsWith('第2章'), 15000, '第2章选中')
  s = await p.eval(snap)
  ok('镜头内第2章 next=第4章（不跳到列表里看不见的第3章）', s.next?.title === '下一章：第4章 · 长堤', JSON.stringify(s.next))
  ok('镜头内第2章 prev 禁用（线内首章，不退化为跨线第1章）', s.prev?.title === '已是第一章' && s.prev?.disabled === true, JSON.stringify(s.prev))
  ok('选中章在镜头内 → 说明消失', s.note === null, String(s.note))

  // ---------- ④ 点「下一章」→ 第4章 ----------
  ok('点击「下一章」', (await p.eval(clickNav('chapter-next'))) === true)
  s = await evalUntil(p, snap, (v) => v && v.sel && v.sel.startsWith('第4章'), 15000, '第4章打开')
  ok('点「下一章」落到第4章（镜头内，章列高亮同步）', s.sel === '第4章 · 长堤' && s.editor === true, JSON.stringify({ sel: s.sel, editor: s.editor }))
  await shot(p, 'chapter-nav-lens-next')

  // ---------- ⑤ 键盘 ⌥⌘→ 到第6章，再按到底 ----------
  await keyAltMeta(p, 'ArrowRight', 39, 124)
  s = await evalUntil(p, snap, (v) => v && v.sel && v.sel.startsWith('第6章'), 15000, '⌥⌘→ 到第6章')
  ok('键盘 ⌥⌘→ 到第6章（镜头内末章）', s.sel === '第6章 · 旧港之二', JSON.stringify(s.sel))
  ok('镜头末章 next 禁用「已是最后一章」（不跨线回主线）', s.next?.title === '已是最后一章' && s.next?.disabled === true, JSON.stringify(s.next))
  await keyAltMeta(p, 'ArrowRight', 39, 124)
  await sleep(500)
  s = await p.eval(snap)
  ok('镜头末章再按 ⌥⌘→ 不动（仍第6章）', s.sel === '第6章 · 旧港之二', String(s.sel))
  await keyAltMeta(p, 'ArrowLeft', 37, 123)
  s = await evalUntil(p, snap, (v) => v && v.sel && v.sel.startsWith('第4章'), 15000, '⌥⌘← 回第4章')
  ok('键盘 ⌥⌘← 回第4章（镜头内上一章）', s.sel === '第4章 · 长堤', String(s.sel))

  // ---------- ⑥ 回「全部」：说明消失、恢复阅读序 ----------
  ok('点「全部」chip', (await p.eval(clickTab('__all__'))) === true)
  await sleep(400)
  s = await p.eval(snap)
  ok('回「全部」→ 6 章恢复、镜头说明消失', s.chs.length === 6 && s.note === null, JSON.stringify({ chs: s.chs.length, note: s.note }))
  ok('回「全部」→ next 恢复阅读序（第4章→第5章）', s.next?.title === '下一章：第5章 · 归航', JSON.stringify(s.next))

  // ---------- ⑦ 单线项目：零 chips、导航照常 ----------
  await p.eval(`window.location.hash = '#/project/demo-aseya/novel'`)
  await sleep(1300)
  await evalUntil(p, `document.querySelector('[data-testid="chapter-sidebar"]') !== null`, (v) => v === true, 20000, '单线项目章列')
  const singleChips = await p.eval(`document.querySelector('[data-testid="chapter-line-filter"]') !== null`)
  ok('单线项目：无镜头 chips（零打扰）', singleChips === false, String(singleChips))
  const firstChap = await p.eval(`(() => { const b = [...document.querySelectorAll('[data-testid="chapter-sidebar"] button')].find((x) => /第1章 ·/.test(x.innerText || '')); if (b) b.click(); return !!b })()`)
  if (firstChap) {
    await evalUntil(p, `!!document.querySelector('.ProseMirror')`, (v) => v === true, 20000, '单线项目编辑器')
    const sn = await evalUntil(p, snap, (v) => v && v.next && v.next.title, 15000, '单线项目章导航')
    ok('单线项目：第1章 next=第2章（阅读序照常）', sn.next?.title?.startsWith('下一章：第2章'), JSON.stringify(sn.next))
  } else {
    ok('单线项目：找到第1章', false)
  }

  ok('全程无 JS 异常', p.errors.length === 0, String(p.errors.slice(0, 2)))
} catch (e) {
  console.log('FATAL', String(e).slice(0, 400))
  fails++
}
console.log(fails === 0 ? 'ALL PASS' : 'FAIL: ' + fails)
p.close()
process.exit(fails === 0 ? 0 : 1)