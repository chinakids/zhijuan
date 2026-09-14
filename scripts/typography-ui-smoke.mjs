// 织卷无头冒烟 · 编辑器字排（Apple HIG Typography 第一批）
// 用法：node scripts/typography-ui-smoke.mjs
// 前置：node scripts/serve-renderer.mjs 8123；本机专用无头 Chrome CDP 127.0.0.1:9224
// 验收点：① .ProseMirror 正文 16px / line-height 1.85（computed 29.6px）；
//         ② 段落下间距 0.85em（computed 13.6px）；③ 标题层级字号（h1 1.6em=25.6px / 600）；
//         ④ 两主题（paper/dark）句柄一致、无 JS 异常；⑤ 截图存档。
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
ok('列表行距 1.85 (29.6px 与正文同体系)', v2 && v2.li && parseFloat(v2.li.lh) === 29.6, v2 && v2.li && v2.li.lh)
ok('引用块行距 1.85 (29.6px 与正文同体系)', v2 && v2.bq && parseFloat(v2.bq.lh) === 29.6, v2 && v2.bq && v2.bq.lh)
ok('引用块二次色', v2 && v2.bqColor && v2.bqColor !== 'rgb(50, 46, 39)', v2 && v2.bqColor)

// —— 波2复核（2026-09-14）：字距/标点/标题比例/对齐，Apple HIG Typography + CSS Text 4 ——
const w2 = await page.eval(`(() => {
  const el = document.querySelector('.ProseMirror')
  const cs = getComputedStyle(el)
  const q = (s) => document.querySelector(s) ? getComputedStyle(document.querySelector(s)) : null
  const qBy = (s) => { const elx = document.querySelector(s); return elx ? elx.getBoundingClientRect() : null }
  return {
    letterSpacing: cs.letterSpacing, wordSpacing: cs.wordSpacing, textAlign: cs.textAlign,
    textIndent: cs.textIndent, fontWeight: cs.fontWeight,
    hangingPunctuation: cs.hangingPunctuation,
    hangingSupported: CSS.supports('hanging-punctuation', 'allow-end'),
    tstSupported: CSS.supports('text-spacing-trim', 'space-all'),
    h1Size: q('.ProseMirror h1')?.fontSize ?? null,
    h2Size: q('.ProseMirror h2')?.fontSize ?? null,
    h3Size: q('.ProseMirror h3')?.fontSize ?? null,
    h1Ratio: q('.ProseMirror h1') ? parseFloat(q('.ProseMirror h1').fontSize) / 16 : null,
    h2Ratio: q('.ProseMirror h2') ? parseFloat(q('.ProseMirror h2').fontSize) / 16 : null,
    h3Ratio: q('.ProseMirror h3') ? parseFloat(q('.ProseMirror h3').fontSize) / 16 : null
  }
})()`)
console.log('W2:', JSON.stringify(w2))
ok('字距 letter-spacing normal（宋体不加字距）', w2.letterSpacing === 'normal', w2.letterSpacing)
ok('字符间距 word-spacing 0px', w2.wordSpacing === '0px', w2.wordSpacing)
ok('正文左对齐 start（HIG Text views 领先边对齐）', w2.textAlign === 'start', w2.textAlign)
ok('无段首缩进 text-indent 0（Markdown 存文不含缩进，呈现与存储一致）', w2.textIndent === '0px', w2.textIndent)
ok('正文粗细 400（HIG 避免过细字重，400/600 达线）', w2.fontWeight === '400', w2.fontWeight)
ok('标题层级比例 h1≈1.6 / h2≈1.3 / h3≈1.12（对 HIG macOS Title1 1.69/Title2 1.31/Title3 1.15 同量级）',
  Math.abs(w2.h1Ratio - 1.6) < 0.01 && Math.abs(w2.h2Ratio - 1.3) < 0.01 && Math.abs(w2.h3Ratio - 1.12) < 0.01,
  w2.h1Ratio + '/' + w2.h2Ratio + '/' + w2.h3Ratio)
// 标点悬挂：Chrome 152 不支持 hanging-punctuation（实测 CSS.supports=false 且 computed 为 undefined——属性未实现），
// text-spacing-trim 对 Songti SC 实测三态等宽无增益 → 均不引入，录档（若未来浏览器支持再评估）
console.log('SUPPORTS: hanging-punctuation=' + w2.hangingSupported + ' text-spacing-trim=' + w2.tstSupported)
ok('标点悬挂无声明可生效（computed 为 none 或属性未实现 undefined）',
  w2.hangingPunctuation === 'none' || w2.hangingPunctuation === undefined || w2.hangingPunctuation === '',
  String(w2.hangingPunctuation))

// 深色主题核对：切 .dark 后断言字体参数不变（tokens 只换色，不换字排）
await page.eval(`document.documentElement.classList.add('dark')`)
await sleep(400)
const vd = await page.eval(EXPR)
ok('dark 主题字排一致', vd && vd.fontSize === '16px' && vd.lineHeight === '29.6px' && vd.dark === true, vd ? vd.fontSize + '/' + vd.lineHeight : 'null')
await page.eval(`document.documentElement.classList.remove('dark')`)

// 截图存档（light/dark 各一张，给主人过目；按主人要求存 ~/Pictures/zhijuan/）
import os from 'node:os'
const outDir = os.homedir() + '/Pictures/zhijuan'
for (const mode of ['light', 'dark']) {
  if (mode === 'dark') await page.eval(`document.documentElement.classList.add('dark')`)
  await sleep(300)
  const shot = await page.cmd('Page.captureScreenshot', { format: 'png' })
  const { writeFileSync, mkdirSync } = await import('node:fs')
  mkdirSync(outDir, { recursive: true })
  writeFileSync(outDir + '/typography-wave2-' + mode + '.png', Buffer.from(shot.data, 'base64'))
  if (mode === 'dark') await page.eval(`document.documentElement.classList.remove('dark')`)
}
console.log('SCREENSHOTS: ~/Pictures/zhijuan/typography-wave2-light.png / typography-wave2-dark.png')

if (page.errors.length) { console.log('JS ERRORS:', page.errors.slice(0, 5)); fails++ }
console.log(fails === 0 ? 'ALL PASS' : ('FAILS: ' + fails))
await page.close()
process.exit(fails === 0 ? 0 : 1)
