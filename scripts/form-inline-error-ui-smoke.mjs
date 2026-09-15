// 织卷无头冒烟 · 表单字段级错误 inline（HIG Entering data「provide feedback as soon as you detect a problem」）
// 体验层 2026-09-15。配合 devShim ?zj-fail-x= 持续 reject 模拟主进程异常。
// 用法：node scripts/form-inline-error-ui-smoke.mjs
// 前置：node scripts/serve-renderer.mjs；本机专用无头 Chrome CDP 127.0.0.1:9224
// 验收点：
// ① 章节重命名失败（IPC reject）→ 对话框内 [data-testid=rename-field-error] role=alert 可见 + 输入框 aria-invalid + 对话框未关
// ② 同错误修改输入即清（aria-invalid 回 false、alert 消失）
// ③ 重命名正常路径回归（无注入）：改名成功、对话框关闭、列表出现新题名
// ④ 素材库新建类别失败（reject）→ [data-testid=cat-field-error] 可见 → 修改输入清
// ⑤ 素材库新建素材失败（reject）→ [data-testid=mat-field-error] 可见
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function openTab(url) {
  const r = await fetch(CDP + '/json/new?' + encodeURIComponent(url), { method: 'PUT' })
  return r.json()
}

function attach(wsUrl) {
  const ws = new WebSocket(wsUrl)
  let seq = 0
  const pending = new Map()
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  }
  const cmd = (method, params = {}) =>
    new Promise((res, rej) => {
      const id = ++seq
      pending.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)))
      ws.send(JSON.stringify({ id, method, params }))
    })
  return new Promise((res) => {
    ws.onopen = () =>
      res({
        cmd,
        eval: async (expression) => {
          const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
          if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 300))
          return r.result?.value
        },
        close: () => ws.close()
      })
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
    await sleep(300)
  }
}

const bodyHas = (t) => `document.body.innerText.includes(${JSON.stringify(t)})`

async function setInput(page, selector, value) {
  const r = await page.eval(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (!el) return 'NO_INPUT'
    el.focus()
    const proto = Object.getPrototypeOf(el)
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
    setter.call(el, ${JSON.stringify(value)})
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    return el.value
  })()`)
  if (r !== value) throw new Error('setInput failed on ' + selector + ': ' + r)
}

async function clickText(page, text, scope) {
  const r = await page.eval(`(() => {
    const roots = ${scope ? `[...document.querySelectorAll(${JSON.stringify(scope)})]` : '[document]'}
    const el = roots.flatMap((root) => [...root.querySelectorAll('button')]).find((b) => b.textContent.includes(${JSON.stringify(text)}))
    if (!el) return 'NO_BTN'
    el.click()
    return 'OK'
  })()`)
  if (r !== 'OK') throw new Error('clickText failed: ' + r + ' for ' + text)
}

let pass = 0
let fail = 0
async function step(name, fn) {
  try {
    await fn()
    pass++
    console.log('PASS', name)
  } catch (e) {
    fail++
    console.log('FAIL', name, '-', e.message)
  }
}

/** 打开第一章的右键菜单并点「重命名」→ 返回页句柄（对话框应已开） */
async function openRenameDialog(page) {
  await page.eval(`(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('第01章') || b.textContent.includes('雾港'))
    if (!btn) return 'NO_CHAPTER'
    const r = btn.getBoundingClientRect()
    btn.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.x + 40, clientY: r.y + 10 }))
    return 'OK'
  })()`)
  await evalUntil(page, bodyHas('重命名'), Boolean, 10000, 'context menu')
  await clickText(page, '重命名')
  await evalUntil(page, bodyHas('新题名'), Boolean, 10000, 'rename dialog')
}

// ① 重命名失败 → inline 错误 + aria-invalid + 对话框未关
await step('① 重命名失败：字段内 inline 错误可见且对话框未关', async () => {
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '&zj-fail-x=renameChapter#/project/demo-aseya/novel')
  const page = await attach(tab.webSocketDebuggerUrl)
  await evalUntil(page, bodyHas('雾港'), Boolean, 20000, 'novel page')
  await openRenameDialog(page)
  await setInput(page, '[role="dialog"] input', '新题名xyz')
  await clickText(page, '重命名', '[role="dialog"]')
  await evalUntil(page, `document.querySelector('[data-testid="rename-field-error"]')?.textContent || ''`, (v) => v.includes('重命名失败'), 10000, 'inline error')
  const s = await page.eval(`(() => {
    const err = document.querySelector('[data-testid="rename-field-error"]')
    const input = document.querySelector('[role="dialog"] input')
    return {
      text: err?.textContent ?? '',
      alert: err?.getAttribute('role') ?? '',
      invalid: input?.getAttribute('aria-invalid') ?? '',
      dialogOpen: !!document.querySelector('[role="dialog"]')
    }
  })()`)
  if (!s.alert) throw new Error('FieldError 缺 role=alert')
  if (s.invalid !== 'true') throw new Error('输入框缺 aria-invalid=true: ' + s.invalid)
  if (!s.dialogOpen) throw new Error('对话框意外关闭')
  if (!s.text.includes('模拟失败')) throw new Error('错误文案缺原因: ' + s.text)
  page.close()
})

// ② 修改输入即清错误
await step('② 修改输入：错误消失、aria-invalid 回 false', async () => {
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '&zj-fail-x=renameChapter#/project/demo-aseya/novel')
  const page = await attach(tab.webSocketDebuggerUrl)
  await evalUntil(page, bodyHas('雾港'), Boolean, 20000, 'novel page')
  await openRenameDialog(page)
  await setInput(page, '[role="dialog"] input', '再试一次')
  await clickText(page, '重命名', '[role="dialog"]')
  await evalUntil(page, `!!document.querySelector('[data-testid="rename-field-error"]')`, Boolean, 10000, 'error shown')
  await setInput(page, '[role="dialog"] input', '再试一次改')
  await sleep(200)
  const s = await page.eval(`(() => ({
    err: !!document.querySelector('[data-testid="rename-field-error"]'),
    invalid: document.querySelector('[role="dialog"] input')?.getAttribute('aria-invalid') ?? ''
  }))()`)
  if (s.err) throw new Error('改输入后错误未清')
  if (s.invalid !== 'false') throw new Error('aria-invalid 未回 false: ' + s.invalid)
  page.close()
})

// ③ 正常路径回归：无注入时改名成功、对话框关闭
await step('③ 重命名正常路径回归：改名成功', async () => {
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel')
  const page = await attach(tab.webSocketDebuggerUrl)
  await evalUntil(page, bodyHas('雾港'), Boolean, 20000, 'novel page')
  await openRenameDialog(page)
  await setInput(page, '[role="dialog"] input', '雾港之夜改')
  await clickText(page, '重命名', '[role="dialog"]')
  await evalUntil(
    page,
    `(() => { const d = document.querySelector('[role="dialog"]'); return d ? 'OPEN' : 'CLOSED' })()`,
    (v) => v === 'CLOSED',
    10000,
    'dialog closed'
  )
  await evalUntil(page, bodyHas('雾港之夜改'), Boolean, 10000, 'renamed visible')
  page.close()
})

// ④ 素材库新建类别失败 → inline
await step('④ 新建类别失败：cat-field-error 可见且修改输入清', async () => {
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '&zj-fail-x=createLibraryCategory#/project/demo-aseya/library')
  const page = await attach(tab.webSocketDebuggerUrl)
  await evalUntil(page, bodyHas('新类别'), Boolean, 20000, 'library page')
  await clickText(page, '新类别')
  await evalUntil(page, bodyHas('类别名'), Boolean, 10000, 'cat dialog')
  await setInput(page, '[role="dialog"] input', '测试类别')
  await clickText(page, '创建', '[role="dialog"]')
  await evalUntil(page, `document.querySelector('[data-testid="cat-field-error"]')?.textContent || ''`, (v) => v.includes('新建类别失败'), 10000, 'cat inline error')
  await setInput(page, '[role="dialog"] input', '测试类别2')
  await sleep(200)
  const still = await page.eval(`!!document.querySelector('[data-testid="cat-field-error"]')`)
  if (still) throw new Error('改输入后类别错误未清')
  page.close()
})

// ⑤ 素材库新建素材失败 → inline
await step('⑤ 新建素材失败：mat-field-error 可见', async () => {
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '&zj-fail-x=writeDoc#/project/demo-aseya/library')
  const page = await attach(tab.webSocketDebuggerUrl)
  await evalUntil(page, bodyHas('新建素材'), Boolean, 20000, 'library page')
  await clickText(page, '新建素材')
  await evalUntil(page, bodyHas('名字'), Boolean, 10000, 'mat dialog')
  await setInput(page, '[role="dialog"] input', '测试素材')
  await clickText(page, '创建', '[role="dialog"]')
  await evalUntil(page, `document.querySelector('[data-testid="mat-field-error"]')?.textContent || ''`, (v) => v.includes('新建素材失败'), 10000, 'mat inline error')
  page.close()
})

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
