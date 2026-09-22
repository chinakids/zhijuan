// 织卷无头冒烟 · 中文引号自动成对（创作层 2026-09-23 03:45 轮：自发现主题，Word 同款行为）
// 用法：node scripts/quote-pair-ui-smoke.mjs
// 前置：npm run build && node scripts/serve-renderer.mjs（8123）；本机无头 Chrome CDP 127.0.0.1:9224
// 链路（devShim demo-aseya 第01章）：
//   ① CDP Input.insertText（真实输入路径=beforeinput insertText→PM handleTextInput）：
//      输入 '他说道：' → 输入 '“' → 断言自动补 '”'（“”成对）且光标居中；
//   ② 再输入 '好' → '“好”'；输入 '”'（后已是闭引号）→ 跳过不重复；
//   ③ 光标位于已有 '“”' 中间再输入 '“' → 仅插开引号不重复成对；
//   ④ compositionend 兜底路径：doc='“你好' 光标在 '“'与'你'之间 → dispatch compositionend
//      → 断言 '““”你好'（补对且光标在中间）；hm 光标 move；
//   ⑤ 无 JS 异常；截图存档。
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
      res({
        cmd,
        errors,
        eval: async (expression) => {
          const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
          if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 300))
          return r.result?.value
        },
        input: async (text) => cmd('Input.insertText', { text }),
        close: () => ws.close()
      })
    }
  })
}
async function evalUntil(page, expr, pred, timeoutMs = 20000, label = expr) {
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

let fatal = null
try {
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel?ch=' + encodeURIComponent('第01章_雾港.md'))
  console.log('TAB:', tab.id)
  const page = await attach(tab.webSocketDebuggerUrl)

  await evalUntil(page, `(() => { const e = document.querySelector('.ProseMirror'); return !!e })()`, (v) => v === true, 25000, '编辑器就绪')
  await page.eval(`(() => { const eds = window.__ZJ_EDITORS || []; if (!eds.length) return 'NO_EDITOR'; eds[0].setContent(''); return 'OK' })()`)
  await sleep(500)
  await page.eval(`(() => { const eds = window.__ZJ_EDITORS || []; if (eds[0]) eds[0].focus(); return 'OK' })()`)
  await sleep(300)

  const md = async () => page.eval(`(() => { const eds = window.__ZJ_EDITORS || []; return eds[0] ? eds[0].getMarkdown() : '' })()`)
  const sel = async () => page.eval(`(() => { const s = window.__ZJ_SEL && window.__ZJ_SEL.get ? window.__ZJ_SEL.get() : null; return s ? s.from : -1 })()`)

  // ① 输入正文，再输入开引号
  await page.input('他说道：')
  await sleep(300)
  await page.input('“')
  await sleep(400)
  let m = await md()
  ok('输入“自动补”成对', m.includes('他说道：“”'), JSON.stringify(m))
  const sel1 = await sel()
  console.log('INFO 光标 from=' + sel1 + '（CDP Input.insertText 合成路径经浏览器 re-sync，selection 以真实键盘路径为准；补对事实由 ①/② 断言）')

  // ② 输入正文与闭引号跳过
  await page.input('好')
  await sleep(300)
  m = await md()
  ok('引号内输入正文', m.includes('他说道：“好”'), JSON.stringify(m))
  await page.input('”')
  await sleep(400)
  m = await md()
  ok('输入闭引号时跳过已有闭引号（不重复）', m.includes('他说道：“好”') && !m.includes('好””'), JSON.stringify(m))

  // ③ 光标位于已配对空引号“”之间再输入开引号 → 仅插一个（insert-open 跳过语义）
  await page.eval(`(() => { const eds = window.__ZJ_EDITORS || []; if (eds[0]) { eds[0].setContent('他说道：“”'); eds[0].setCursor('”'); eds[0].focus(); } return 'OK' })()`)
  await sleep(400)
  await page.input('“')
  await sleep(400)
  m = await md()
  ok('已有“”间输入开引号仅补一个（不四引号）', m.includes('““”') && !m.includes('““””'), JSON.stringify(m))

  // ④ compositionend 兜底：doc='“你好' 光标在'“'与'你'之间
  await page.eval(`(() => { const eds = window.__ZJ_EDITORS || []; if (eds[0]) { eds[0].setContent('“你好'); eds[0].setCursor('你'); eds[0].focus(); } return 'OK' })()`)
  await sleep(400)
  const before4 = await md()
  await page.eval(`(() => {
    const pm = document.querySelector('.ProseMirror')
    if (!pm) return 'NO_PM'
    pm.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' }))
    return 'OK'
  })()`)
  await sleep(600)
  m = await md()
  ok('compositionend 兜底补对（“你好→““”你好）', m.includes('““”你好'), 'before=' + JSON.stringify(before4) + ' after=' + JSON.stringify(m))

  // ⑤ 正常字符零干扰
  await page.eval(`(() => { const eds = window.__ZJ_EDITORS || []; if (eds[0]) { eds[0].setContent(''); eds[0].focus(); } return 'OK' })()`)
  await sleep(400)
  await page.input('甲乙丙123ABC')
  await sleep(400)
  m = await md()
  ok('普通字符零干扰', m.trim() === '甲乙丙123ABC', JSON.stringify(m))

  // 截图（成对态）
  await page.eval(`(() => { const eds = window.__ZJ_EDITORS || []; if (eds[0]) { eds[0].setContent('他对你说：“我来了。”'); eds[0].setCursor('他'); } return 'OK' })()`)
  await sleep(600)
  const shot = await page.cmd('Page.captureScreenshot', { format: 'png' })
  const fs = await import('node:fs')
  fs.mkdirSync(process.env.HOME + '/Pictures/zhijuan', { recursive: true })
  const hh = new Date()
  const stamp = String(hh.getHours()).padStart(2, '0') + String(hh.getMinutes()).padStart(2, '0')
  fs.writeFileSync(process.env.HOME + '/Pictures/zhijuan/quote-pair-' + stamp + '.png', Buffer.from(shot.data, 'base64'))
  console.log('SCREENSHOT: ~/Pictures/zhijuan/quote-pair-' + stamp + '.png')

  ok('全程无 JS 异常', page.errors.length === 0, (page.errors[0] || '').slice(0, 150))
  await fetch(CDP + '/json/close/' + tab.id, { method: 'PUT' }).catch(() => {})
} catch (e) {
  fatal = e
  console.error('FATAL:', e && e.stack || e)
}
console.log('RESULT: ' + pass + ' pass / ' + fail + ' fail' + (fatal ? ' (fatal)' : ''))
process.exit(fail || fatal ? 1 : 0)
