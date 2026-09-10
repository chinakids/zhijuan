// 织卷无头冒烟 · 编辑器字排（Apple HIG Typography 第一批）
// 用法：node scripts/typography-ui-smoke.mjs
// 前置：python3 -m http.server 8123 --directory out/renderer；本机专用无头 Chrome CDP 127.0.0.1:9224
// 验收点：① .ProseMirror 正文 16px / line-height 1.85（computed 29.6px）；
//         ② 段落下间距 0.85em（computed 13.6px）；③ 标题层级字号（h1 1.6em=25.6px / 600）；
//         ④ 两主题（paper/dark）句柄一致、无 JS 异常；⑤ 截图存档。
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
    } catch {}
    if (Date.now() - t0 > timeoutMs) throw new Error('TIMEOUT waiting: ' + label)
    await sleep(300)
  }
}

const EXPR = `(() => {
  const el = document.querySelector('.ProseMirror')
  if (!el || el.textContent.length < 20) return null
  const cs = getComputedStyle(el)
  const p = el.querySelector('p')
  const h1 = el.querySelector('h1')
  const h2 = el.querySelector('h2')
  return {
    dark: document.documentElement.classList.contains('dark'),
    fontSize: cs.fontSize,
    lineHeight: cs.lineHeight,
    fontFamily: cs.fontFamily.slice(0, 50),
    background: cs.backgroundColor,
    pMarginBottom: p ? getComputedStyle(p).marginBottom : null,
    h1Size: h1 ? getComputedStyle(h1).fontSize : null,
    h1Weight: h1 ? getComputedStyle(h1).fontWeight : null,
    h2Size: h2 ? getComputedStyle(h2).fontSize : null,
    textLen: el.textContent.length
  }
})()`

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel?ch=' + encodeURIComponent('第01章_雾港.md'))
console.log('TAB:', tab.id, tab.url)
const page = await attach(tab.webSocketDebuggerUrl)

let fails = 0
const ok = (name, cond, extra = '') => {
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : ''))
  if (!cond) fails++
}

const v = await evalUntil(page, EXPR, (x) => x !== null, 25000, '.ProseMirror 带正文')
console.log('RESULT:', JSON.stringify(v, null, 2))

ok('正文 16px', v.fontSize === '16px', v.fontSize)
ok('行距 1.85 (29.6px)', v.lineHeight === '29.6px', v.lineHeight)
ok('段落间距 0.85em (13.6px)', v.pMarginBottom === '13.6px', String(v.pMarginBottom))
ok('标题 h1 1.6em (25.6px)', v.h1Size === '25.6px', String(v.h1Size))
ok('标题 h1 权重 600', v.h1Weight === '600', String(v.h1Weight))
// 原文档可能无 h2（示例章内容不定），h2/h3 用注入文档断言（见下）
ok('默认 paper 主题', v.dark === false, String(v.dark))
ok('正文背景为纸面 surface', /255|254|251/.test(v.background), v.background)
ok('衬线字体（宋体系）', /Songti|Noto Serif|SimSun|serif/i.test(v.fontFamily), v.fontFamily)

// 注入含 h2/h3/列表/引用的文档，验证全套字排（base64 防 CDP 换行打平）
const MD_SAMPLE = '# 标题一\n\n## 标题二\n\n### 标题三\n\n正文第一段，用于校验段落间距与行距。\n\n- 列表项甲\n- 列表项乙\n\n> 引用一句话，校验引用块行距。\n\n正文第二段结尾。\n'
const b64 = Buffer.from(MD_SAMPLE).toString('base64')
const inj = await page.eval(`(() => { const eds = window.__ZJ_EDITORS || []; if (!eds.length) return 'NO_EDITOR'; eds[0].setContent(atob('${b64}')); return 'OK' })()`)
console.log('INJECT:', inj)
await sleep(900)
const v2 = await page.eval(`(() => {
  const q = (s) => { const el = document.querySelector('.ProseMirror ' + s); return el ? getComputedStyle(el) : null }
  const p = document.querySelector('.ProseMirror')
  if (!p || p.textContent.length < 30) return null
  const cs = (el) => el ? { size: el.fontSize, lh: el.lineHeight, mb: el.marginBottom, mt: el.marginTop, fw: el.fontWeight } : null
  return {
    h1: cs(q('h1')), h2: cs(q('h2')), h3: cs(q('h3')),
    p: cs(q('p')), li: cs(q('li')), bq: cs(q('blockquote')),
    bqColor: q('blockquote') ? q('blockquote').color : null,
    bodySize: getComputedStyle(p).fontSize
  }
})()`)
console.log('V2:', JSON.stringify(v2, null, 2))
ok('注入后正文仍 16px', v2 && v2.bodySize === '16px', v2 && v2.bodySize)
ok('标题 h2 1.3em (20.8px)', v2 && v2.h2 && v2.h2.size === '20.8px', v2 && v2.h2 && v2.h2.size)
ok('标题 h3 1.12em (17.92px)', v2 && v2.h3 && v2.h3.size === '17.92px', v2 && v2.h3 && v2.h3.size)
ok('标题 h2 权重 600', v2 && v2.h2 && v2.h2.fw === '600', v2 && v2.h2 && String(v2.h2.fw))
ok('段落间距 0.85em (13.6px)', v2 && v2.p && v2.p.mb === '13.6px', v2 && v2.p && v2.p.mb)
ok('列表行距 1.8 (28.8px)', v2 && v2.li && parseFloat(v2.li.lh) === 28.8, v2 && v2.li && v2.li.lh)
ok('引用块行距 1.8 (28.8px)', v2 && v2.bq && parseFloat(v2.bq.lh) === 28.8, v2 && v2.bq && v2.bq.lh)
ok('引用块二次色', v2 && v2.bqColor && v2.bqColor !== 'rgb(50, 46, 39)', v2 && v2.bqColor)

// 深色主题核对：切 .dark 后断言字体参数不变（tokens 只换色，不换字排）
await page.eval(`document.documentElement.classList.add('dark')`)
await sleep(400)
const vd = await page.eval(EXPR)
ok('dark 主题字排一致', vd && vd.fontSize === '16px' && vd.lineHeight === '29.6px' && vd.dark === true, vd ? vd.fontSize + '/' + vd.lineHeight : 'null')
await page.eval(`document.documentElement.classList.remove('dark')`)

// 截图存档（light/dark 各一张，给主人过目）
for (const mode of ['light', 'dark']) {
  if (mode === 'dark') await page.eval(`document.documentElement.classList.add('dark')`)
  await sleep(300)
  const shot = await page.cmd('Page.captureScreenshot', { format: 'png' })
  const { writeFileSync } = await import('node:fs')
  writeFileSync('/tmp/typography-' + mode + '.png', Buffer.from(shot.data, 'base64'))
  if (mode === 'dark') await page.eval(`document.documentElement.classList.remove('dark')`)
}
console.log('SCREENSHOTS: /tmp/typography-light.png /tmp/typography-dark.png')

if (page.errors.length) { console.log('JS ERRORS:', page.errors.slice(0, 5)); fails++ }
console.log(fails === 0 ? 'ALL PASS' : ('FAILS: ' + fails))
await page.close()
process.exit(fails === 0 ? 0 : 1)
