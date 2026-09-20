// 织卷无头走查 · 时间线页窄窗体检（W38 增量 #5 交付面加固，2026-09-18 02:15 体验层轮）
// 用法：node scripts/timeline-narrow-ui-smoke.mjs
// 前置：npm run build；out/renderer 由 http.server(8123/8899) 服务；本机无头 Chrome CDP 127.0.0.1:9224
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8899'
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
async function setSize(page, w, h) {
  await page.cmd('Emulation.clearDeviceMetricsOverride')
  await page.cmd('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
  await sleep(500)
}
async function shot(page, name) {
  const s = await page.cmd('Page.captureScreenshot', { format: 'png' })
  if (s?.data) {
    const fs = await import('node:fs')
    fs.mkdirSync(OUT, { recursive: true })
    const hh = String(new Date().getHours()).padStart(2, '0')
    const mm = String(new Date().getMinutes()).padStart(2, '0')
    const p = `${OUT}/${name}-${hh}${mm}.png`
    fs.writeFileSync(p, Buffer.from(s.data, 'base64'))
    console.log('SCREENSHOT:', p)
  }
}

// 时间线页布局快照：溢出/chips 行数/条目卡主行换行/组头/头部按钮/行内溢出
const snapExpr = `(() => {
  const doc = document.documentElement
  const content = [...document.querySelectorAll('div')].find((d) => {
    const cls = d.className || ''
    return cls.includes('max-w-3xl') && cls.includes('p-6') && d.querySelector('h2')
  }) || null
  const chips = [...document.querySelectorAll('[role="tab"]')]
  const chipRows = chips.length ? new Set(chips.map((c) => Math.round(c.getBoundingClientRect().top))).size : 0
  const cards = [...document.querySelectorAll('section[aria-label^="时间线："] li > div')]
  const cardInfo = cards.map((card) => {
    const lineP = card.querySelector('p.flex')
    const mainLine = lineP ? lineP.querySelector('span.truncate') : null
    const badge = lineP ? [...lineP.querySelectorAll('span')].find((s) => s.className.includes('shrink-0')) : null
    const link = card.querySelector('a[href*="/novel"]')
    const meta = card.querySelector('div.mt-3')
    return {
      h: Math.round(card.getBoundingClientRect().height),
      lineH: lineP ? Math.round(lineP.getBoundingClientRect().height) : null,
      lineOverflow: lineP ? lineP.scrollWidth > lineP.clientWidth + 1 : false,
      badgeH: badge ? Math.round(badge.getBoundingClientRect().height) : null,
      linkH: link ? Math.round(link.getBoundingClientRect().height) : null,
      metaH: meta ? Math.round(meta.getBoundingClientRect().height) : null,
      cardW: Math.round(card.getBoundingClientRect().width),
      cardRight: Math.round(card.getBoundingClientRect().right),
      cardOverflow: card.scrollWidth > card.clientWidth + 1
    }
  })
  const head = content ? content.querySelector('div.mb-6') : null
  const headH = head ? Math.round(head.getBoundingClientRect().height) : null
  const btn = head ? head.querySelector('[data-testid="sync-log-open"]') : null
  const btnRight = btn ? Math.round(btn.getBoundingClientRect().right) : null
  const contentRight = content ? Math.round(content.getBoundingClientRect().right) : null
  const lineHead = [...document.querySelectorAll('[data-testid="timeline-line-head"]')].map((e) => Math.round(e.getBoundingClientRect().height))
  return {
    winW: window.innerWidth,
    contentW: content ? Math.round(content.getBoundingClientRect().width) : null,
    overflowX: doc.scrollWidth > doc.clientWidth + 1,
    chipRows, chipCount: chips.length,
    cards: cardInfo,
    headH, btnRight, contentRight,
    lineHeadHeights: lineHead,
    hasTimeline: !!content
  }
})()`

const URLS = [
  { key: 'multiline', url: '#/project/demo-multiline/timeline' },
  { key: 'single', url: '#/project/demo-aseya/timeline' }
]

let fails = 0
const ok = (name, cond, extra = '') => {
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : ''))
  if (!cond) fails++
}

for (const route of URLS) {
  for (const W of [1000, 800, 700]) {
    const tab = await openTab('about:blank')
    const page = await attach(tab.webSocketDebuggerUrl)
    await setSize(page, W, 700)
    await page.cmd('Page.navigate', { url: BASE + '/?cb=' + Date.now() + route.url })
    await evalUntil(page, snapExpr, (x) => x && x.hasTimeline === true && x.winW === W, 20000, route.key + ' ' + W + ' 时间线加载')
    await sleep(600)
    const s = await page.eval(snapExpr)
    console.log('SNAP', route.key, W + ':', JSON.stringify(s))
    ok(`${route.key} @${W}：无横向溢出`, s.overflowX === false)
    ok(`${route.key} @${W}：头部按钮不越出内容右缘`, s.btnRight !== null && s.contentRight !== null && s.btnRight <= s.contentRight + 1, `${s.btnRight}/${s.contentRight}`)
    ok(`${route.key} @${W}：条目卡可见`, s.cards.length > 0, String(s.cards.length))
    if (route.key === 'multiline') ok(`multiline @${W}：条目卡 5 张`, s.cards.length === 5, String(s.cards.length))
    if (route.key === 'multiline') {
      ok(`${route.key} @${W}：筛选 chips 可见（3 个）`, s.chipCount === 3, String(s.chipCount))
      // chips 换行后仍在容器内（由溢出断言覆盖）；组头徽标单行
      ok(`${route.key} @${W}：线组头单行`, s.lineHeadHeights.length === 2 && s.lineHeadHeights.every((h) => h <= 24), JSON.stringify(s.lineHeadHeights))
    }
    // 条目卡主行不换行（单行高阈值 22px 文本行）、卡片无内部溢出、打开正文按钮在位
    ok(`${route.key} @${W}：条目卡主行单行`, s.cards.every((c) => c.lineH !== null && c.lineH <= 24), JSON.stringify(s.cards.map((c) => c.lineH).join(',')))
    ok(`${route.key} @${W}：条目卡无内部溢出`, s.cards.every((c) => c.cardOverflow === false))
    ok(`${route.key} @${W}：条目卡含「打开正文」链接`, s.cards.every((c) => c.linkH !== null && c.linkH > 0))
    if (W === 1000) {
      await shot(page, route.key === 'multiline' ? 'timeline-narrow-multi' : 'timeline-narrow-single')
      if (route.key === 'multiline') {
        // 长文本压力：超长章名+切片名灌入主行 span.truncate → 单行省略、卡片/徽标/打开正文不位移（flex min-width 由 overflow hidden 归零）
        const stress = await page.eval(`(() => {
          const cards = [...document.querySelectorAll('section[aria-label^="时间线："] li > div')]
          const p = cards[0].querySelector('p.flex')
          const span = p.querySelector('span.truncate')
          span.textContent = '第1章 · 今_夜航与灯塔守望者的最后一次对望发生在台风过境前的黄昏时分'.repeat(2)
          const lineH = p.getBoundingClientRect().height
          const pOverflow = p.scrollWidth > p.clientWidth + 1
          const cardOverflow = cards[0].scrollWidth > cards[0].clientWidth + 1
          const badge = [...p.querySelectorAll('span')].find((s) => s.className.includes('shrink-0') && s.className.includes('rounded'))
          const badgeRight = badge ? Math.round(badge.getBoundingClientRect().right) : null
          const linkLeft = Math.round(cards[0].querySelector('a').getBoundingClientRect().left)
          const docOverflow = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
          return { lineH, pOverflow, cardOverflow, badgeRight, linkLeft, docOverflow, spanW: Math.round(span.getBoundingClientRect().width), pW: Math.round(p.getBoundingClientRect().width) }
        })()`)
        console.log('STRESS:', JSON.stringify(stress))
        ok('multiline @1000：长文本单行省略（lineH≤24）', stress.lineH <= 24, String(stress.lineH))
        ok('multiline @1000：长文本无行内溢出', stress.pOverflow === false && stress.cardOverflow === false && stress.docOverflow === false)
        ok('multiline @1000：长文本徽标在打开正文左侧（不叠）', stress.badgeRight !== null && stress.badgeRight <= stress.linkLeft, `${stress.badgeRight}/${stress.linkLeft}`)
        // dark 核对 + 截图
        await page.eval(`document.documentElement.classList.add('dark')`)
        await sleep(400)
        const darkSnap = await page.eval(`(() => {
          const st = getComputedStyle(document.documentElement)
          const card = document.querySelector('section[aria-label^="时间线："] li > div')
          const cs = getComputedStyle(card)
          return { darkOn: document.documentElement.classList.contains('dark'), cardBg: cs.backgroundColor, ink: getComputedStyle(card.querySelector('p.flex')).color }
        })()`)
        console.log('DARK:', JSON.stringify(darkSnap))
        ok('multiline dark：主题类生效且卡片背景非白（dark 语义色）', darkSnap.darkOn === true && darkSnap.cardBg !== 'rgb(255, 255, 255)', String(darkSnap.cardBg))
        await shot(page, 'timeline-narrow-multi-dark')
        await page.eval(`document.documentElement.classList.remove('dark')`)
        await sleep(200)
      }
    }
    console.log('ERRORS:', route.key, W, page.errors.length ? page.errors.slice(0, 3) : 'none')
    ok(`${route.key} @${W}：无 JS 异常`, page.errors.length === 0, String(page.errors.slice(0, 2)))
    page.close()
  }
}

// ===== 空态窄窗（?zj-empty=timeline；真机空态同一套组件）=====
{
  for (const W of [1000, 700]) {
    const tab = await openTab('about:blank')
    const page = await attach(tab.webSocketDebuggerUrl)
    await setSize(page, W, 700)
    await page.cmd('Page.navigate', { url: BASE + '/?cb=' + Date.now() + '&zj-empty=timeline#/project/demo-multiline/timeline' })
    await evalUntil(page, `(() => !!document.querySelector('[data-testid="empty-timeline"]'))()`, (v) => v === true, 20000, 'empty timeline 加载')
    await sleep(400)
    const emptySnap = await page.eval(`(() => {
      const doc = document.documentElement
      const content = [...document.querySelectorAll('div')].find((d) => (d.className||'').includes('max-w-3xl') && (d.className||'').includes('p-6'))
      const btn = document.querySelector('[data-testid="sync-log-open"]')
      return {
        overflowX: doc.scrollWidth > doc.clientWidth + 1,
        emptyVisible: !!document.querySelector('[data-testid="empty-timeline"]'),
        btnIn: btn ? Math.round(btn.getBoundingClientRect().right) <= (content ? Math.round(content.getBoundingClientRect().right) : 1e9) + 1 : false
      }
    })()`)
    console.log('EMPTY', W + ':', JSON.stringify(emptySnap))
    ok(`empty @${W}：空态可见`, emptySnap.emptyVisible === true)
    ok(`empty @${W}：无横向溢出`, emptySnap.overflowX === false)
    ok(`empty @${W}：同步记录按钮在位`, emptySnap.btnIn === true)
    if (W === 1000) await shot(page, 'timeline-empty-narrow')
    console.log('ERRORS: empty', W, page.errors.length ? page.errors.slice(0, 3) : 'none')
    ok(`empty @${W}：无 JS 异常`, page.errors.length === 0, String(page.errors.slice(0, 2)))
    page.close()
  }
}

console.log(fails === 0 ? 'ALL PASS' : `FAIL: ${fails}`)
process.exit(fails === 0 ? 0 : 1)
