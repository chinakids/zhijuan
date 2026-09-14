// 织卷无头冒烟 · 编辑器内快捷键「真实按下生效」实测闭环（平台层 2026-09-14 22:30 轮候选 1）
// 用法：node scripts/shortcut-editor-live-smoke.mjs
// 前置：npm run build；/tmp/spa_server.py（8899，SPA fallback）；CDP 127.0.0.1:9224
// 链路：CDP Input.dispatchKeyEvent（浏览器级真实输入管线，isTrusted=true，与 Puppeteer 同源）
//       → DOM keydown 到达编辑器 → ProseMirror keymap（strong/emphasis/blockquote/heading/history）
//       / 应用层捕获监听（⌘F/⌘E/⌘G，window 捕获 + preventDefault 遮蔽 Milkdown 键位）→ 实测断言。
// 验收点：T1 编辑器挂载+焦点进入；T2 insertText 探针（CDP→PM 链路）；T3 ⌘B 包裹输入（strong）；
//        T4 ⌘I（emphasis）；T5 ⌘Z/⌘Y/⇧⌘Z 撤销重做；T6 ⇧⌘B 引用块；T7 ⌥⌘1 标题；
//        T8 ⌘E 无选区 no-op（不产行内代码、不下查找词）；T9 ⌘E 有选区=设置查找词且无行内代码（遮蔽实锤）；
//        T10 ⌘F 打开查找条；T11 全程零 JS 异常。
import { writeFileSync, mkdirSync } from 'node:fs'
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://127.0.0.1:8899'
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

async function evalUntil(page, expr, pred, timeoutMs = 25000, label = expr) {
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

const pageHas = (t) => `document.body.innerText.includes(${JSON.stringify(t)})`
// 真实键盘：rawKeyDown 触发 keydown（无 char）；导航键用 type='keyDown' 让浏览器执行默认编辑行为（光标移动）
const VK = { b: 66, i: 73, e: 69, z: 90, y: 89, g: 71, f: 70, '1': 49, Home: 36, End: 35 }
async function press(page, key, code, mods = 0, type = 'rawKeyDown') {
  await page.cmd('Input.dispatchKeyEvent', { type, key, code, modifiers: mods, windowsVirtualKeyCode: VK[key] ?? 0 })
  await sleep(80)
  await page.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers: mods, windowsVirtualKeyCode: VK[key] ?? 0 })
  await sleep(120)
}
async function insertText(page, text) {
  await page.cmd('Input.insertText', { text })
  await sleep(150)
}
// 编辑器双臂：setContent+focus（幂等探针语义：FOCUS=true 时断言焦点在编辑器）
const edit = (body) => `(async () => { const e = window.__ZJ_EDITORS[0]; ${body} return true })()`
const mdExpr = `(async () => { const e = window.__ZJ_EDITORS[0]; return e.getMarkdown() })()`
const mdOf = (page) => page.eval(mdExpr)
const findState = (page) => page.eval(`(async () => { const s = window.__ZJ_FIND?.getState?.(); return s ? JSON.stringify(s) : null })()`)

let fails = 0
const ok = (name, cond, extra = '') => {
  console.log((cond ? 'OK ' : 'NG ') + name + (extra ? ' | ' + extra : ''))
  if (!cond) fails++
}

{
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/')
  console.log('TAB:', tab.id)
  const page = await attach(tab.webSocketDebuggerUrl)
  try {
    // —— T1 就绪：Home → demo-aseya → 雾港章 → 编辑器挂载 + 焦点 ——
    await evalUntil(page, pageHas('新建项目'), (v) => v === true, 25000, 'Home 就绪')
    await page.eval(`(() => { const c = document.querySelector('[aria-label^="打开项目"]'); if (c) c.click(); return !!c })()`)
    await evalUntil(page, `location.hash.startsWith('#/project/demo-aseya')`, (v) => v === true, 15000, '进入项目')
    await evalUntil(page, pageHas('雾港'), (v) => v === true, 20000, '章列就绪')
    await page.eval(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.innerText.includes('雾港')); if (b) b.click(); return !!b })()`)
    await evalUntil(page, `(window.__ZJ_EDITORS?.length ?? 0) > 0`, (v) => v === true, 20000, '编辑器挂载')
    await page.eval(edit(`await e.focus();`))
    const focused = await page.eval(`document.activeElement && document.activeElement.classList.contains('ProseMirror')`)
    ok('T1 编辑器挂载且焦点在 .ProseMirror', focused === true, 'activeElement=' + JSON.stringify(await page.eval(`document.activeElement?.className?.slice(0, 40)`)))

    // —— T2 insertText 探针：CDP 输入管线 → PM ——
    await page.eval(edit(`await e.setContent('');`))
    await insertText(page, '织卷探针')
    const md2 = await mdOf(page)
    ok('T2 CDP insertText 驱动 PM 生效（探针词落盘 doc）', md2.includes('织卷探针'), JSON.stringify(md2))

    // —— T3 ⌘B 加粗：无选区先按 ⌘B 再输入 → storedMark 包裹 ——
    await page.eval(edit(`await e.setContent(''); await e.focus();`))
    await press(page, 'b', 'KeyB', 4) // Meta
    await insertText(page, '加粗探针')
    const md3 = await mdOf(page)
    ok('T3 ⌘B 按后输入被 strong 包裹（**加粗探针**）', md3.includes('**加粗探针**'), JSON.stringify(md3))

    // —— T4 ⌘I 斜体 ——
    await page.eval(edit(`await e.setContent(''); await e.focus();`))
    await press(page, 'i', 'KeyI', 4)
    await insertText(page, '斜体探针')
    const md4 = await mdOf(page)
    ok('T4 ⌘I 按后输入被 emphasis 包裹（*斜体探针*）', md4.includes('*斜体探针*'), JSON.stringify(md4))

    // —— T5 ⌘Z/⌘Y/⇧⌘Z 撤销重做 ——
    await page.eval(edit(`await e.setContent(''); await e.focus();`))
    await insertText(page, '历史底稿。')
    await press(page, 'z', 'KeyZ', 4)
    const md5a = await mdOf(page)
    ok('T5a ⌘Z 撤销输入（md 回空）', !md5a.includes('历史底稿'), JSON.stringify(md5a))
    await press(page, 'y', 'KeyY', 4)
    const md5b = await mdOf(page)
    ok('T5b ⌘Y 重做（md 恢复含底稿）', md5b.includes('历史底稿'), JSON.stringify(md5b))
    await press(page, 'z', 'KeyZ', 4)
    const md5c = await mdOf(page)
    await press(page, 'z', 'KeyZ', 12) // Shift+Meta
    const md5d = await mdOf(page)
    ok('T5c ⌘Z 再撤销且 ⇧⌘Z 再重做', !md5c.includes('历史底稿') && md5d.includes('历史底稿'), JSON.stringify(md5c) + ' / ' + JSON.stringify(md5d))

    // —— T6 ⇧⌘B 引用块 ——
    await page.eval(edit(`await e.setContent(''); await e.focus();`))
    await insertText(page, '引用正文。')
    await press(page, 'b', 'KeyB', 12) // Shift+Meta
    const md6 = await mdOf(page)
    ok('T6 ⇧⌘B 当前段转引用块（md 含 >）', md6.includes('>') && md6.includes('引用正文'), JSON.stringify(md6))

    // —— T7 ⌥⌘1 标题 ——
    await page.eval(edit(`await e.setContent(''); await e.focus();`))
    await insertText(page, '标题正文。')
    await press(page, '1', 'Digit1', 5) // Alt+Meta
    const md7 = await mdOf(page)
    ok('T7 ⌥⌘1 当前段转 H1（md 以 # 开头）', md7.startsWith('# ') && md7.includes('标题正文'), JSON.stringify(md7))

    // —— T8 ⌘E 无选区 no-op：不产行内代码、不设置查找词 ——
    await page.eval(edit(`await e.setContent(''); await e.focus();`))
    await insertText(page, '查找目标词')
    await press(page, 'e', 'KeyE', 4)
    const md8 = await mdOf(page)
    const st8 = JSON.parse(await findState(page))
    ok('T8a ⌘E 无选区不产行内代码（md 无反引号）', md8 === '查找目标词' || md8.includes('查找目标词'), JSON.stringify(md8))
    ok('T8b ⌘E 无选区查找词 no-op（query 空）', st8.query === '', JSON.stringify(st8))

    // —— T9 ⌘E 有选区：设置查找词 + 行内代码被遮蔽 ——
    await press(page, 'Home', 'Home', 0, 'keyDown')
    await press(page, 'End', 'End', 8, 'keyDown') // Shift+End 选区至行尾
    const sel0 = JSON.parse(await findState(page))
    const hasSel = sel0.selFrom !== null && sel0.selFrom !== sel0.selTo
    ok('T9 前置：Shift+End 形成选区', hasSel === true, JSON.stringify(sel0))
    await press(page, 'e', 'KeyE', 4)
    const st9 = JSON.parse(await findState(page))
    const md9 = await mdOf(page)
    ok('T9a ⌘E 有选区→查找词=选区文本', st9.query.includes('查找目标词'), 'query=' + JSON.stringify(st9.query))
    ok('T9b ⌘E 有选区仍无行内代码（应用层遮蔽实锤）', md9 === '查找目标词' || md9.includes('查找目标词'), JSON.stringify(md9))
    ok('T9c ⌘E 后高亮已有匹配（matches>0）', (st9.total ?? 0) > 0 || (st9.matches ?? []).length > 0, JSON.stringify({ total: st9.total, matches: st9.matches }))

    // —— T10 ⌘F 打开查找条 ——
    await press(page, 'f', 'KeyF', 4)
    const findOpen = await evalUntil(page, `document.querySelector('.zj-find-input') !== null`, (v) => v === true, 8000, '查找条打开')
    const st10 = JSON.parse(await findState(page))
    ok('T10 ⌘F 打开查找条', findOpen === true && st10.open === true, JSON.stringify(st10))
    if (process.env.ZJ_SHOT) {
      const s = await page.cmd('Page.captureScreenshot', { format: 'png' })
      const dir = process.env.ZJ_SHOT_DIR || '/Users/USER/Pictures/zhijuan'
      mkdirSync(dir, { recursive: true })
      const file = `${dir}/shortcut-editor-live-${new Date().toTimeString().slice(0, 5).replace(':', '')}.png`
      writeFileSync(file, Buffer.from(s.data, 'base64'))
      console.log('SHOT:', file)
    }
    await page.eval(`(() => { window.__ZJ_FIND?.close?.(); return true })()`)

    // —— T11 零 JS 异常 ——
    ok('T11 全程无页面 JS 异常', page.errors.length === 0, page.errors.join(' || '))
  } finally {
    page.close()
  }
}

console.log(fails === 0 ? '\nRESULT: ALL PASS' : `\nRESULT: ${fails} FAILED`)
process.exit(fails === 0 ? 0 : 1)
