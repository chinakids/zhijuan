// 织卷无头冒烟 · ⌘K 命令面板「章节状态徽章 + 最近素材键盘到达性」（平台层 2026-09-11）
// 用法：node scripts/cmdk-chapter-state-smoke.mjs
// 前置：python3 -m http.server 8123 --directory out/renderer；本机专用无头 Chrome CDP 127.0.0.1:9224
// 验收点：① 注入无切片章（writeDoc → 正文/第05章_雾堤.md）后，⌘K 打开章节组：
//          有切片章显示「切片：<名>」徽章、无切片章显示「未设切片」；
//         ② 组顺序=页面 → 最近素材 → 打开章节（最近素材前移，键盘可达）；
//         ③ 键盘到达性：打开面板纯 ↓ 键 ≤9 步选中最近素材组条目，回车跳素材库；
//         ④ 无 JS 异常。
const CDP = 'http://127.0.0.1:9224'
const BASE = 'http://localhost:8123'
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
    if (m.method === 'Runtime.exceptionThrown') {
      errors.push((m.params.exceptionDetails?.exception?.description ?? '').slice(0, 200))
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errors.push((m.params.args?.map((a) => a.value ?? a.description ?? '').join(' ') ?? '').slice(0, 200))
    }
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

async function evalUntil(page, expr, pred, timeoutMs = 15000, label = expr) {
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

const keyK = async (page, mod) => {
  await page.cmd('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'k', code: 'KeyK', windowsVirtualKeyCode: 75, nativeVirtualKeyCode: 75, modifiers: mod })
  await page.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', windowsVirtualKeyCode: 75, nativeVirtualKeyCode: 75, modifiers: mod })
}

const pressDown = async (page) => {
  await page.cmd('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40 })
  await page.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40 })
  await sleep(80)
}

const pressEnter = async (page) => {
  await page.cmd('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
  await page.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
}

async function openPalette(page) {
  await keyK(page, 4)
  await evalUntil(page, `!!document.querySelector('[cmdk-root]')`, (v) => v === true, 8000, '面板出现')
  await page.eval(`document.querySelector('[cmdk-input]').focus()`)
}

const selGroup = `(() => { const it = document.querySelector('[cmdk-item][data-selected="true"]'); if (!it) return ''; const grp = it.closest('[cmdk-group]'); return grp?.querySelector('[cmdk-group-heading]')?.innerText ?? '' })()`

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel')
console.log('TAB:', tab.id)
const page = await attach(tab.webSocketDebuggerUrl)
let fails = 0
const ok = (name, cond, extra = '') => {
  console.log((cond ? 'OK ' : 'NG ') + name + (extra ? ' | ' + extra : ''))
  if (!cond) fails++
}

try {
  // ① 正文页就绪
  await evalUntil(page, `document.body.innerText.includes('第1章') && document.body.innerText.includes('Agent')`, (v) => v === true, 20000, '正文页就绪')
  ok('正文页就绪', true)

  // ② 注入无切片章（独立 tab 内存，不影响其他冒烟）
  const inj = await page.eval(`window.zhijuan.writeDoc('demo-aseya', '正文/第05章_雾堤.md', '---\\n章号: 5\\n题名: 雾堤\\n---\\n\\n# 雾堤\\n\\n（本章待写）\\n').then(() => 'OK').catch((e) => 'ERR:' + e.message)`)
  ok('注入无切片章', inj === 'OK', 'inj=' + JSON.stringify(inj))
  await sleep(400)

  // ③ ⌘K 开面板：组顺序 = 页面 → 最近素材 → 打开章节（最近素材前移）
  await openPalette(page)
  await evalUntil(page, `[...document.querySelectorAll('[cmdk-group-heading]')].some((g) => g.innerText.includes('打开章节'))`, (v) => v === true, 10000, '打开章节组出现')
  const groups = await page.eval(`[...document.querySelectorAll('[cmdk-group-heading]')].map((g) => g.innerText)`)
  ok('组顺序 页面→最近素材→打开章节', groups.indexOf('页面') < groups.indexOf('最近素材') && groups.indexOf('最近素材') < groups.indexOf('打开章节'), 'groups=' + JSON.stringify(groups))
  ok('打开项目组仍在', groups.includes('打开项目'), 'groups=' + JSON.stringify(groups))

  // ④ 章节状态徽章：有切片=「切片：第一幕_雾港之夜」；无切片=「未设切片」
  const chItems = await page.eval(`[...document.querySelectorAll('[cmdk-item]')].filter((i) => !i.hasAttribute('hidden') && i.closest('[cmdk-group]')?.querySelector('[cmdk-group-heading]')?.innerText.includes('打开章节')).map((i) => i.innerText)`)
  ok('章节项含切片徽章（第1章）', chItems.some((t) => t.includes('切片：第一幕_雾港之夜')), JSON.stringify(chItems.slice(0, 2)))
  ok('章节项含「未设切片」状态', chItems.some((t) => t.includes('未设切片')), JSON.stringify(chItems))
  ok('章节项仍显字数', chItems.some((t) => /\d+ 字/.test(t)), JSON.stringify(chItems))

  // ⑤ 键盘到达性：关面板重开 → 纯 ↓ 键走到「最近素材」组（≤9 步，页面7+1）
  await keyK(page, 4)
  await evalUntil(page, `!document.querySelector('[cmdk-root]')`, (v) => v === true, 8000, '面板关闭')
  await sleep(300)
  await openPalette(page)
  await evalUntil(page, `[...document.querySelectorAll('[cmdk-group-heading]')].some((g) => g.innerText.includes('最近素材'))`, (v) => v === true, 10000, '最近素材组出现')
  let steps = -1
  for (let i = 0; i < 12; i++) {
    const g = await page.eval(selGroup)
    if (g === '最近素材') { steps = i; break }
    await pressDown(page)
  }
  ok('纯 ↓ 键 ≤9 步达最近素材', steps >= 0 && steps <= 9, 'steps=' + steps)
  const selText = await page.eval(`document.querySelector('[cmdk-item][data-selected="true"]')?.innerText ?? ''`)
  ok('选中为最近素材条目', /^[\u4e00-\u9fa5A-Za-z0-9]+\//.test(selText), 'sel=' + JSON.stringify(selText.slice(0, 40)))
  await pressEnter(page)
  await evalUntil(page, `location.hash.includes('library')`, (v) => v === true, 8000, '跳素材库')
  ok('回车打开最近素材（library?doc=）', true, 'hash=' + (await page.eval(`location.hash`)))

  // ⑥ 无 JS 异常
  await sleep(800)
  const errs = page.errors.filter((e) => !/ResizeObserver/.test(e) && !/Download the React DevTools/.test(e))
  ok('无 JS 异常', errs.length === 0, errs.slice(0, 3).join(' ;; '))
} catch (e) {
  console.error('FATAL ' + e.message)
  fails++
} finally {
  page.close()
  console.log(fails === 0 ? 'CMDK CHAPTER STATE SMOKE PASS' : 'CMDK CHAPTER STATE SMOKE FAIL (' + fails + ')')
  process.exit(fails === 0 ? 0 : 1)
}
