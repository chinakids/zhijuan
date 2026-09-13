// 织卷无头冒烟 · 编辑器工具栏格式激活态（HIG Buttons：符号按钮的 toggled 状态；Pages/TextEdit 先例）
// 用法：node scripts/toolbar-active-ui-smoke.mjs
// 前置：npm run build；node scripts/serve-renderer.mjs 8123；本机无头 Chrome CDP 127.0.0.1:9224
// 验收点：① 光标点入加粗文本→加粗按钮 aria-pressed=true + zj-tb-on + accent-soft 底/accent 图标；
//         ② 点普通段落→加粗复位（无 zj-tb-on、aria-pressed=false）；③ 斜体/行内码同理；
//         ④ 标题/引用/无序/有序块：对应块工具激活；⑤ 撤销等非 toggle 无 aria-pressed 属性；
//         ⑥ 深色主题激活态颜色跟随 tokens；⑦ 全程无 JS 异常；⑧ 截图（亮色激活/深色激活）存 ~/Pictures/zhijuan/。
const CDP = 'http://127.0.0.1:9224'
const BASE = 'http://localhost:8123'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const OUT = process.env.HOME + '/Pictures/zhijuan'

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
    await sleep(300)
  }
}

async function clickXY(page, x, y) {
  await page.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await sleep(60)
  await page.cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await sleep(60)
  await page.cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
}

// 正文中精确文本的屏幕坐标（每个目标词独占一个 TextNode，中点即词中心）
const rectExpr = (needleB64) => `(() => {
  const root = document.querySelector('.ProseMirror')
  if (!root) return null
  const needle = new TextDecoder().decode(Uint8Array.from(atob('${needleB64}'), (c) => c.charCodeAt(0)))
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let n
  while ((n = walker.nextNode())) {
    if (!n.textContent || !n.textContent.includes(needle)) continue
    const r = document.createRange()
    r.selectNodeContents(n)
    const rect = r.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, text: n.textContent }
  }
  return null
})()`

// 工具栏按钮状态快照（排除测量层）
const tbExpr = `(() => {
  const bar = [...document.querySelectorAll('.zj-md-toolbar')].find((b) => !b.hasAttribute('data-zj-tb-measure'))
  const pick = (title) => [...(bar?.querySelectorAll('.zj-tb-item') ?? [])].find((b) => b.getAttribute('title') === title)
  const st = (b) => b ? {
    pressed: b.getAttribute('aria-pressed'),
    on: b.classList.contains('zj-tb-on'),
    color: getComputedStyle(b).color,
    bg: getComputedStyle(b).backgroundColor,
    hover: b.matches(':hover')
  } : null
  return { ready: !!bar, bold: st(pick('加粗')), italic: st(pick('斜体')), code: st(pick('行内代码')),
    h1: st(pick('一级标题')), quote: st(pick('引用块')), ul: st(pick('无序列表')), ol: st(pick('有序列表')),
    para: st(pick('正文段落')), undo: st(pick('撤销')) }
})()`

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel?ch=' + encodeURIComponent('第01章_雾港.md'))
console.log('TAB:', tab.id, tab.url)
const page = await attach(tab.webSocketDebuggerUrl)

let fails = 0
const ok = (name, cond, extra = '') => {
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : ''))
  if (!cond) fails++
}

// ① 编辑器就绪后写入多格式测试正文（每行一个目标词，保证词在独立 TextNode）
const v0 = await evalUntil(page, tbExpr, (x) => x && x.ready && x.bold && x.h1, 25000, '工具栏就绪')
console.log('INIT:', JSON.stringify(v0))
ok('初始：加粗按钮无激活（无 zj-tb-on、aria-pressed=false）', v0.bold.on === false && v0.bold.pressed === 'false')

const mdDoc = `# 标题一

这是**加粗文字**和*斜体文字*和\`行内码\`混排。

> 引用之语

- 无序甲

1. 有序乙

普通段落正文内容。
`
const b64Doc = Buffer.from(mdDoc, 'utf8').toString('base64')
await page.eval(`(() => {
  const eds = window.__ZJ_EDITORS || []; if (!eds.length) return 'NO_ED'
  const text = new TextDecoder().decode(Uint8Array.from(atob('${b64Doc}'), (c) => c.charCodeAt(0)))
  eds[0].setContent(text); return 'OK'
})()`)
await sleep(800)

// 点击 helper：点文本并等待工具栏表现
async function clickAndRead(needle, label) {
  const rect = await page.eval(rectExpr(Buffer.from(needle, 'utf8').toString('base64')))
  if (!rect) throw new Error('找不到文本: ' + needle)
  await clickXY(page, rect.x, rect.y)
  await sleep(600) // PM dispatch → plugin.update → setState → React 渲染落定
  return page.eval(tbExpr)
}

const LIGHT_ACCENT = 'rgb(15, 118, 110)' // #0f766e
const LIGHT_SOFT = 'rgb(227, 240, 238)' // #e3f0ee

// ② 点加粗文字 → 加粗激活
let s = await clickAndRead('加粗文字', '加粗')
await sleep(350) // 等 computed 稳定
s = await page.eval(tbExpr)
console.log('BOLD CLICK:', JSON.stringify({ bold: s.bold, para: s.para }))
ok('点加粗：加粗 aria-pressed=true', s.bold.pressed === 'true')
ok('点加粗：加粗 zj-tb-on', s.bold.on === true)
ok('点加粗：激活色 = accent-soft 底 + accent 图标（亮色）', s.bold.bg === LIGHT_SOFT && s.bold.color === LIGHT_ACCENT, `${s.bold.bg} / ${s.bold.color}`)
ok('点加粗：所在段落按钮同激活（mark 与 block 激活可共存，Pages 同款）', s.para.on === true && s.para.pressed === 'true')

// ③ 点普通段落 → 加粗复位、段落激活
s = await clickAndRead('普通段落正文内容', '普通段落')
console.log('PARA CLICK:', JSON.stringify({ bold: s.bold, para: s.para }))
ok('点普通段落：加粗复位（aria-pressed=false 无 zj-tb-on）', s.bold.pressed === 'false' && s.bold.on === false)
ok('点普通段落：正文段落激活', s.para.pressed === 'true' && s.para.on === true)

// ④ 斜体 / 行内码
s = await clickAndRead('斜体文字', '斜体')
ok('点斜体：斜体激活、加粗仍灭', s.italic.pressed === 'true' && s.italic.on === true && s.bold.on === false)
s = await clickAndRead('行内码', '行内码')
ok('点行内码：行内代码激活', s.code.pressed === 'true' && s.code.on === true)

// ⑤ 块级：标题 / 引用 / 无序 / 有序
s = await clickAndRead('标题一', '标题')
ok('点标题一：一级标题激活、正文段落复位', s.h1.pressed === 'true' && s.h1.on === true && s.para.on === false)
s = await clickAndRead('引用之语', '引用')
ok('点引用：引用块激活', s.quote.pressed === 'true' && s.quote.on === true)
s = await clickAndRead('无序甲', '无序')
ok('点无序：无序列表激活、有序未激活', s.ul.pressed === 'true' && s.ul.on === true && s.ol.on === false)
s = await clickAndRead('有序乙', '有序')
ok('点有序：有序列表激活、无序复位', s.ol.pressed === 'true' && s.ol.on === true && s.ul.on === false)

// 角色语义：撤销等非 toggle 按钮无 aria-pressed 属性
ok('撤销（非 toggle）无 aria-pressed 属性', v0.undo.pressed === null, String(v0.undo.pressed))

// 截图①：加粗激活态（亮色）
s = await clickAndRead('加粗文字', '加粗截图')
await sleep(300)
let shot = await page.cmd('Page.captureScreenshot', { format: 'png' })
if (shot?.data) {
  const fs = await import('node:fs')
  const hh = String(new Date().getHours()).padStart(2, '0')
  const mm = String(new Date().getMinutes()).padStart(2, '0')
  fs.mkdirSync(OUT, { recursive: true })
  const path = `${OUT}/toolbar-active-${hh}${mm}.png`
  fs.writeFileSync(path, Buffer.from(shot.data, 'base64'))
  console.log('SCREENSHOT:', path)
}

// ⑥ 深色主题：激活态颜色跟随 tokens（accent #5caea4）
await page.eval(`document.documentElement.classList.add('dark')`)
await sleep(600)
s = await clickAndRead('加粗文字', '深色加粗')
await sleep(300)
console.log('DARK BOLD:', JSON.stringify({ bold: s.bold }))
ok('深色：加粗激活色 = dark accent rgb(92,174,164) 且底色非浅色 soft', s.bold.pressed === 'true' && s.bold.on === true && s.bold.color === 'rgb(92, 174, 164)' && s.bold.bg !== LIGHT_SOFT, `${s.bold.color} / ${s.bold.bg}`)
shot = await page.cmd('Page.captureScreenshot', { format: 'png' })
if (shot?.data) {
  const fs = await import('node:fs')
  const hh = String(new Date().getHours()).padStart(2, '0')
  const mm = String(new Date().getMinutes()).padStart(2, '0')
  const path = `${OUT}/toolbar-active-dark-${hh}${mm}.png`
  fs.writeFileSync(path, Buffer.from(shot.data, 'base64'))
  console.log('SCREENSHOT:', path)
}

console.log('ERRORS:', page.errors.length ? page.errors.slice(0, 5) : 'none')
console.log(fails === 0 ? 'ALL PASS' : `FAIL: ${fails}`)
page.close()
process.exit(fails === 0 ? 0 : 1)
