// 织卷无头冒烟 · 正文「粘贴为纯文本」（创作层 2026-09-23 00:45 轮：自发现主题「粘贴即毁格式」）
// 用法：node scripts/paste-plain-ui-smoke.mjs
// 前置：npm run build && node scripts/serve-renderer.mjs（8123）；本机无头 Chrome CDP 127.0.0.1:9224
// 链路（devShim demo-aseya 第01章）：清空正文 → 注入 Shift+粘贴（ClipboardEvent，
//   text/plain 含行首 `# 标题` 字面 + 双段落 + 段内硬换行）→ 断言：
//   ① 编辑器 DOM:行首 `#` 仍为段落文本（无 h1），字面原文保留；
//   ② 段落结构=空行分两段；段内换行为 hardbreak（不丢行）；
//   ③ getMarkdown 序列化=字面文本（remark 序列化自动转义/或原样），roundtrip 不产标题结构；
//   ④ 右键菜单出现「粘贴为纯文本」菜单项；点它无 JS 异常；
//   ⑤ 全程无 JS 异常；截图存档。
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
      res({ cmd, errors, eval: async (expression) => {
        const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
        if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 300))
        return r.result?.value
      }, close: () => ws.close() })
    }
  })
}
async function evalUntil(page, expr, pred, timeoutMs = 15000, label = expr) {
  const t0 = Date.now()
  for (;;) {
    try { const v = await page.eval(expr); if (pred(v)) return v } catch {}
    if (Date.now() - t0 > timeoutMs) throw new Error('TIMEOUT: ' + label)
    await sleep(300)
  }
}
let pass = 0
let fail = 0
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log('PASS ' + name) }
  else { fail++; console.log('FAIL ' + name + (extra ? ' | ' + extra : '')) }
}

const MIX = `# 标题字面

这是第一段正文。
这一行应与上一行同段（硬换行）。

> 引用字面`

const P1 = '这是第一段正文。'
const P2 = '> 引用字面'

let fatal = null
try {
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel?ch=' + encodeURIComponent('第01章_雾港.md'))
  console.log('TAB:', tab.id)
  const page = await attach(tab.webSocketDebuggerUrl)

  await evalUntil(page, `(() => { const e = document.querySelector('.ProseMirror'); return !!e })()`, (v) => v === true, 25000, '编辑器就绪')

  // 清空正文（已知原文含独特子串，清掉避免干扰断言）
  await page.eval(`(() => { const eds = window.__ZJ_EDITORS || []; if (!eds.length) return 'NO_EDITOR'; eds[0].setContent(''); return 'OK' })()`)
  await sleep(600)

  // —— 注入 Shift+粘贴（text/plain）——
  // Ctrl/⌘+Shift+V:先 dispatch keydown Shift(PM 在 keydown 里记录 view.input.shiftKey,
  // 与 PM 原生 preferPlain 判定同源),再 dispatch paste 事件。
  const pasteRes = await page.eval(`(() => {
    const pm = document.querySelector('.ProseMirror')
    if (!pm) return 'NO_PM'
    const kd = new KeyboardEvent('keydown', { key: 'Shift', code: 'ShiftLeft', keyCode: 16, which: 16, bubbles: true, cancelable: true, shiftKey: true })
    pm.dispatchEvent(kd)
    const dt = new DataTransfer()
    dt.setData('text/plain', ${JSON.stringify(MIX)})
    const ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(ev, 'clipboardData', { value: dt })
    pm.dispatchEvent(ev)
    return 'OK'
  })()`)
  ok('注入 Shift+粘贴事件', String(pasteRes).includes('OK'), String(pasteRes))
  await sleep(900)

  // ①字形字面：「# 标题字面」必须是文本不是 h1
  const noH1 = await page.eval(`document.querySelectorAll('.ProseMirror h1').length === 0`)
  ok('行首 # 未解析为 h1', noH1 === true)
  const bodyHas = await page.eval(`document.querySelector('.ProseMirror').textContent.includes('# 标题字面')`)
  ok('字面「# 标题字面」保留', bodyHas === true)

  // ②段落结构：两个 block 段落；段内硬换行
  const struct = await page.eval(`(() => {
    const pm = document.querySelector('.ProseMirror')
    const paras = [...pm.querySelectorAll(':scope > div > p, p')].filter((x) => x.parentElement === pm || x.closest('.milkdown'))
    const ps = [...pm.querySelectorAll('p')]
    const first = ps.find((p) => p.textContent.includes('这是第一段正文'))
    return {
      pCount: ps.length,
      firstHasBr: !!first && (!!first.querySelector('br') || !!first.querySelector('[data-type="hardbreak"]')),
      head: pm.textContent.slice(0, 20)
    }
  })()`)
  ok('插入为段落（p 节点 ≥3:标题段+正文段+引用段）', struct.pCount >= 3, JSON.stringify(struct))
  ok('段内换行=hardbreak 节点', struct.firstHasBr === true, JSON.stringify(struct))

  // ③getMarkdown 序列化 roundtrip：字面不产结构
  const md = await page.eval(`(() => { const eds = window.__ZJ_EDITORS || []; return eds.length ? eds[0].getMarkdown() : 'NO_EDITOR' })()`)
  ok('getMarkdown 完整', typeof md === 'string' && md.includes('标题字面') && md.includes(P1) && md.includes(P2), String(md).slice(0, 120))
  // roundtrip 决定性验证：把序列化输出 setContent 回去（走 markdown parse=保存重载等价），
  // 若行首 `#` 未被转义，重载会解析成 h1——「粘贴字面」即不保真（需实现侧行首转义）。
  const rt = await page.eval(`(() => {
    const eds = window.__ZJ_EDITORS || []
    const md = eds[0].getMarkdown()
    eds[0].setContent(md)
    return new Promise((res) => setTimeout(() => {
      const pm = document.querySelector('.ProseMirror')
      res({ h1: pm.querySelectorAll('h1').length, hasLit: pm.textContent.includes('# 标题字面') })
    }, 1000))
  })()`)
  ok('roundtrip 重载后仍无 h1、字面仍在', rt.h1 === 0 && rt.hasLit === true, JSON.stringify(rt))

  // ④右键菜单项存在 + 点击无异常
  const pmRect = await page.eval(`(() => { const pm = document.querySelector('.ProseMirror'); const r = pm.getBoundingClientRect(); return { x: r.left + 40, y: r.top + 40 } })()`)
  await page.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pmRect.x, y: pmRect.y })
  await page.cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x: pmRect.x, y: pmRect.y, button: 'right', buttons: 2, clickCount: 1 })
  await page.cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pmRect.x, y: pmRect.y, button: 'right', buttons: 0, clickCount: 1 })
  await sleep(700)
  const items = await evalUntil(page, `(() => { const m = document.querySelector('[role="menu"]'); return m ? [...m.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent.trim()) : null })()`, (v) => Array.isArray(v) && v.length > 0, 8000, '右键菜单出现')
  ok('右键菜单含「粘贴为纯文本」', Array.isArray(items) && items.some((t) => t.includes('粘贴为纯文本')), JSON.stringify(items))
  // 点击「粘贴为纯文本」（系统剪贴板无权限/空时静默 no-op，不应抛异常）
  const clickRes = await page.eval(`(() => {
    const it = [...document.querySelectorAll('[role="menuitem"]')].find((i) => (i.textContent || '').includes('粘贴为纯文本'))
    if (!it) return 'NO_ITEM'
    it.click()
    return 'CLICKED'
  })()`)
  ok('菜单项可点击', clickRes === 'CLICKED', String(clickRes))
  await sleep(600)

  // ⑤截图
  const shot = await page.cmd('Page.captureScreenshot', { format: 'png' })
  const { writeFileSync, mkdirSync } = await import('node:fs')
  const dir = process.env.HOME + '/Pictures/zhijuan'
  mkdirSync(dir, { recursive: true })
  const f = dir + '/paste-plain-' + new Date().toTimeString().slice(0, 5).replace(':', '') + '.png'
  writeFileSync(f, Buffer.from(shot.data, 'base64'))
  console.log('SCREENSHOT: ' + f)

  // 无 JS 异常
  ok('全程无 JS 异常', page.errors.length === 0, JSON.stringify(page.errors).slice(0, 200))

  page.close()
} catch (e) {
  fatal = e
  fail++
  console.log('FATAL:', String(e).slice(0, 400))
}
console.log('RESULT: ' + pass + ' pass / ' + fail + ' fail' + (fatal ? ' (fatal: ' + String(fatal).slice(0, 80) + ')' : ''))
process.exit(fail > 0 ? 1 : 0)
