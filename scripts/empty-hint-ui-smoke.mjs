// 织卷无头冒烟 · 正文空文档占位（HIG Text Fields「placeholder 描述预期输入」）
// 用法：node scripts/empty-hint-ui-smoke.mjs
// 前置：npm run build；python3 -m http.server 8123 --directory out/renderer（或 scripts/serve-renderer.mjs 8123）；
//       本机专用无头 Chrome CDP 127.0.0.1:9224
// 验收点：① 有内容文档无 .zj-empty（不误显）；② setContent('') → .zj-empty + ::before「开始写作…」+ ink-3 色 + 与首行对齐；
//         ③ 聚焦后占位仍在、真实输入首字符后消失；④ 清空→占位复现（双向切换不卡死）；⑤ 恢复原文无残留；
//         ⑥ dark 同口径；⑦ 零 JS 异常；⑧ ~/Pictures/zhijuan/ 截图（light/dark）。
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
const ok = (cond, msg) => {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + msg)
  if (!cond) failures++
}
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
          if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 600))
          return r.result?.value
        },
        close: () => ws.close()
      })
    }
  })
}
async function evalUntil(page, expr, pred, timeout, label) {
  const t0 = Date.now()
  for (;;) {
    const v = await page.eval(expr)
    if (pred(v)) return v
    if (Date.now() - t0 > timeout) throw new Error('evalUntil timeout: ' + label)
    await sleep(300)
  }
}

// ::before 画像（content/color/position）
const BEFORE = `(() => {
  const pm = document.querySelector('.zj-md .ProseMirror')
  if (!pm) return null
  const cs = getComputedStyle(pm, '::before')
  const rect = (() => { const r = pm.getBoundingClientRect(); return { t: r.top, l: r.left } })()
  return {
    hasClass: pm.classList.contains('zj-empty'),
    content: cs.content,
    color: cs.color,
    pos: cs.position,
    top: cs.top,
    left: cs.left
  }
})()`

async function shot(page, name, w = 1200, h = 800) {
  await page.cmd('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
  const s = await page.cmd('Page.captureScreenshot', { format: 'png' })
  const fs = await import('node:fs')
  fs.mkdirSync(process.env.HOME + '/Pictures/zhijuan', { recursive: true })
  fs.writeFileSync(process.env.HOME + '/Pictures/zhijuan/' + name, Buffer.from(s.data, 'base64'))
  console.log('SHOT ' + name)
}

async function run() {
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel?ch=' + encodeURIComponent('第01章_雾港.md'))
  const page = await attach(tab.webSocketDebuggerUrl)
  await page.cmd('Page.enable')
  await evalUntil(page, `window.__ZJ_EDITORS && window.__ZJ_EDITORS.length > 0`, Boolean, 20000, '编辑器挂载')
  await sleep(900)

  // ① 有内容文档：无占位
  const b0 = await page.eval(BEFORE)
  ok(b0 && b0.hasClass === false, `① 有内容文档无 .zj-empty (hasClass=${b0?.hasClass})`)
  const md0 = await page.eval(`window.__ZJ_EDITORS[0].getMarkdown()`)

  // ② 清空 → 占位出现
  await page.eval(`window.__ZJ_EDITORS[0].setContent('')`)
  await sleep(400)
  const b1 = await page.eval(BEFORE)
  ok(b1 && b1.hasClass === true, `② 清空后 .zj-empty 出现`)
  ok(b1 && b1.content.includes('开始写作'), `② ::before 内容=「开始写作…」 (${b1?.content})`)
  ok(b1 && b1.pos === 'absolute' && b1.top === '16px' && b1.left === '22.4px', `② 与首行书写位置对齐 (top=${b1?.top},left=${b1?.left},pos=${b1?.pos})`)
  // ink-3 色（light：ruby 计算值应含 134,126,110）
  ok(b1 && b1.color.includes('134, 126, 110'), `② 占位色=ink-3 (${b1?.color})`)
  await shot(page, 'empty-placeholder-' + new Date().toTimeString().slice(0, 5).replace(':', '') + '.png')

  // ③ 聚焦仍显示；真实输入首字符 → 消失
  await page.eval(`window.__ZJ_EDITORS[0].focus()`)
  await sleep(300)
  const b2 = await page.eval(BEFORE)
  ok(b2 && b2.hasClass === true, `③ 聚焦后占位仍在（等待输入）`)
  await page.cmd('Input.insertText', { text: '好' })
  await sleep(400)
  const b3 = await page.eval(BEFORE)
  ok(b3 && b3.hasClass === false, `③ 输入首字符后占位消失 (hasClass=${b3?.hasClass})`)
  const typed = await page.eval(`window.__ZJ_EDITORS[0].getMarkdown().slice(0, 10)`)
  ok(typed.includes('好'), `③ 输入真实生效 (${JSON.stringify(typed)})`)

  // ④ 再次清空 → 占位复现；恢复原文 → 无残留
  await page.eval(`window.__ZJ_EDITORS[0].setContent('')`)
  await sleep(400)
  const b4 = await page.eval(BEFORE)
  ok(b4 && b4.hasClass === true, `④ 清空→占位复现（双向切换正常）`)
  await page.eval(`window.__ZJ_EDITORS[0].setContent(${JSON.stringify(md0)})`)
  await sleep(400)
  const b5 = await page.eval(BEFORE)
  ok(b5 && b5.hasClass === false, `⑤ 恢复原文无残留`)
  const mdRest = await page.eval(`window.__ZJ_EDITORS[0].getMarkdown()`)
  ok(mdRest === md0, `⑤ 原文完整恢复 (len=${mdRest.length})`)

  // ⑥ dark 同口径
  await page.eval(`document.documentElement.classList.add('dark')`)
  await sleep(300)
  await page.eval(`window.__ZJ_EDITORS[0].setContent('')`)
  await sleep(400)
  const b6 = await page.eval(BEFORE)
  ok(b6 && b6.hasClass === true && b6.content.includes('开始写作'), `⑥ dark: 占位出现`)
  ok(b6 && b6.color.includes('133, 128, 112'), `⑥ dark: 占位色=ink-3 dark (${b6?.color})`)
  await shot(page, 'empty-placeholder-dark-' + new Date().toTimeString().slice(0, 5).replace(':', '') + '.png')
  await page.eval(`document.documentElement.classList.remove('dark')`)
  await page.eval(`window.__ZJ_EDITORS[0].setContent(${JSON.stringify(md0)})`)
  await sleep(300)

  // ⑦ 零 JS 异常
  ok(page.errors.length === 0, `⑦ 零 JS 异常 (${page.errors.slice(0, 2).join(' | ') || 'none'})`)

  page.close()
  await fetch(CDP + '/json/close/' + tab.id).catch(() => {})
  console.log(failures === 0 ? 'ALL PASS' : failures + ' FAIL')
  process.exit(failures === 0 ? 0 : 1)
}
run().catch((e) => { console.error('SMOKE_FAIL', e.message); process.exit(1) })
