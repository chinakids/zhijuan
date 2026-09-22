// 织卷无头冒烟 · 写作习惯学习 UI（体验层 2026-09-22 08:15 轮）
// 用法：node scripts/insights-ui-smoke.mjs
// 前置：npm run build && node scripts/serve-renderer.mjs 8123；本机专用无头 Chrome CDP 127.0.0.1:9224
// 验收：设置页「外观与数据」开关（默认关/开→持久化）+ 技能包管理「写作习惯草稿」区
//       （草稿/报告标注、转正→技能列表、删除两击→空态）+ 截图 + 零 JS 异常。
import fs from 'node:fs'

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
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m)
      pending.delete(m.id)
    } else if (m.method === 'Runtime.exceptionThrown') {
      errors.push('EXC: ' + (m.params?.exceptionDetails?.text ?? ''))
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') {
      errors.push('CONSOLE: ' + JSON.stringify(m.params?.args ?? []).slice(0, 200))
    }
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

function ok(name, cond, extra = '') {
  if (!cond) {
    console.error('  ✗ ' + name + (extra ? ' | ' + extra : ''))
    process.exit(1)
  }
  console.log('  ✓ ' + name)
}

async function clickEl(page, expr) {
  return page.eval(`(() => { const el = ${expr}; if (!el) return false; el.click(); return true })()`)
}

async function pointerClick(page, expr) {
  return page.eval(`(() => {
    const el = ${expr}
    if (!el) return false
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }))
    el.click()
    return true
  })()`)
}

async function shot(page, selector, name, pad = 12) {
  await page.eval(`(() => { const el = ${selector}; if (el) el.scrollIntoView({ block: 'center' }); return true })()`)
  await sleep(400)
  const clip = await page.eval(`(() => {
    const el = ${selector}
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: Math.max(0, r.x - ${pad}), y: Math.max(0, r.y - ${pad}), w: Math.min(r.width + ${pad * 2}, window.innerWidth), h: Math.min(r.height + ${pad * 2}, window.innerHeight), dw: window.innerWidth, dh: window.innerHeight }
  })()`)
  if (!clip) return null
  const shotR = await page.cmd('Page.captureScreenshot', { format: 'png', clip: { x: clip.x, y: clip.y, width: Math.min(clip.w, clip.dw), height: Math.min(clip.h, clip.dh), scale: 2 } })
  const ts = new Date().toISOString().slice(11, 16).replace(':', '')
  const p = `/Users/USER/Pictures/zhijuan/${name}-${ts}.png`
  fs.writeFileSync(p, Buffer.from(shotR.data, 'base64'))
  console.log('SHOT ' + p)
  return p
}

async function main() {
  const tab = await openTab(BASE + '/#/settings?cb=' + Date.now())
  await tab // 等 tab 创建完成
  const page = await attach(tab.webSocketDebuggerUrl)
  await page.cmd('Page.enable')
  let pass = 0
  try {
    // —— A. 设置页「外观与数据」开关 ——
    await evalUntil(page, `[...document.querySelectorAll('button')].some(b => b.innerText.includes('外观与数据'))`, (v) => v === true, 15000, '设置页加载')
    await clickEl(page, `[...document.querySelectorAll('button')].find(b => b.innerText.includes('外观与数据'))`)
    await evalUntil(page, `document.querySelector('[aria-label="写作习惯学习"]') !== null`, (v) => v === true, 10000, '写作习惯学习开关渲染')
    const rowText = await page.eval(`document.querySelector('[aria-label="写作习惯学习"]')?.closest('div.flex.items-center.justify-between')?.innerText ?? ''`)
    ok('A1 外观与数据区含「写作习惯学习」开关行（Label+说明）', rowText.includes('写作习惯学习') && rowText.includes('草稿'), rowText.slice(0, 60))
    const checked0 = await page.eval(`document.querySelector('[aria-label="写作习惯学习"]')?.getAttribute('aria-checked')`)
    ok('A2 默认关闭（aria-checked=false）', checked0 === 'false', String(checked0))
    await pointerClick(page, `document.querySelector('[aria-label="写作习惯学习"]')`)
    await evalUntil(page, `document.querySelector('[aria-label="写作习惯学习"]')?.getAttribute('aria-checked') === 'true'`, (v) => v === true, 8000, '开关开启')
    const persisted = await page.eval(`window.zhijuan.getSettings().then(s => s.writingInsightsEnabled)`)
    ok('A3 开启即写盘（writingInsightsEnabled=true 持久化）', persisted === true, String(persisted))
    await shot(page, `document.querySelector('[aria-label="写作习惯学习"]')?.closest('div.flex.items-center.justify-between')`, 'insights-switch', 14)
    pass += 3

    // —— B. 技能包管理「写作习惯草稿」区 ——
    await clickEl(page, `[...document.querySelectorAll('button')].find(b => b.innerText.includes('写作引擎'))`)
    await evalUntil(page, `document.querySelector('[data-testid="skill-settings-card"]') !== null`, (v) => v === true, 10000, '技能卡渲染')
    await evalUntil(page, `document.querySelectorAll('[data-testid="draft-row"]').length === 2`, (v) => v === true, 10000, '草稿区 2 条')
    const rows = await page.eval(`[...document.querySelectorAll('[data-testid="draft-row"]')].map(r => r.innerText)`)
    const draftRow = rows.find((t) => t.includes('写作习惯.md'))
    const reportRow = rows.find((t) => t.includes('写作习惯-报告.md'))
    ok('B1 草稿区列出草稿+报告各 1 条', !!draftRow && !!reportRow, JSON.stringify(rows.map((t) => t.slice(0, 30))))
    ok('B2 草稿行标「草稿」徽标、报告行标「报告」徽标', (draftRow ?? '').includes('草稿') && (reportRow ?? '').includes('报告'))
    const draftHasPromote = await page.eval(`[...document.querySelectorAll('[data-testid="draft-row"]')].some(r => r.innerText.includes('写作习惯.md') && r.querySelector('button[aria-label^="转正草稿"]'))`)
    const reportHasPromote = await page.eval(`[...document.querySelectorAll('[data-testid="draft-row"]')].some(r => r.innerText.includes('写作习惯-报告.md') && r.querySelector('button[aria-label^="转正草稿"]'))`)
    ok('B3 仅草稿行有「转正」入口（报告行无）', draftHasPromote === true && reportHasPromote === false)
    const dateShown = await page.eval(`[...document.querySelectorAll('[data-testid="draft-row"]')].some(r => /\\d{4}\\/\\d{1,2}\\/\\d{1,2}/.test(r.innerText))`)
    ok('B4 条目显示短日期', dateShown === true)
    await shot(page, `document.querySelector('[data-testid="insights-drafts-section"]')`, 'insights-drafts', 10)
    pass += 5

    // —— C. 转正（草稿→技能列表） ——
    await clickEl(page, `document.querySelector('button[aria-label="转正草稿 2026-09-22-写作习惯.md"]')`)
    await evalUntil(page, `document.querySelectorAll('[data-testid="draft-row"]').length === 1`, (v) => v === true, 10000, '转正后草稿区剩 1 条')
    const skillNames = await evalUntil(page, `[...document.querySelectorAll('[data-testid="skill-row"] span[title]')].map(s => s.getAttribute('title'))`, (v) => Array.isArray(v) && v.includes('writing-habits'), 10000, '技能列表出现 writing-habits')
    ok('C1 转正后技能列表出现 writing-habits（草稿进技能包）', skillNames.includes('writing-habits'))
    const msgC = await page.eval(`[...document.querySelectorAll('[data-testid="skill-settings-card"] p[role="status"]')].map(p => p.innerText).join(' | ')`)
    ok('C2 转正反馈消息', msgC.includes('已转正草稿') && msgC.includes('写作习惯.md'), msgC)
    pass += 2

    // —— D. 删除报告（两击确认）→ 空态 ——
    await clickEl(page, `document.querySelector('button[aria-label="删除草稿 2026-09-22-写作习惯-报告.md"]')`)
    await evalUntil(page, `[...document.querySelectorAll('button')].some(b => b.innerText.trim() === '确认删除')`, (v) => v === true, 8000, '确认删除按钮')
    await clickEl(page, `[...document.querySelectorAll('button')].find(b => b.innerText.trim() === '确认删除')`)
    await evalUntil(page, `document.querySelectorAll('[data-testid="draft-row"]').length === 0`, (v) => v === true, 8000, '草稿区清空')
    const emptyText = await page.eval(`document.querySelector('[data-testid="skill-settings-card"]')?.innerText ?? ''`)
    ok('D1 删除报告后草稿区空态提示', emptyText.includes('还没有草稿'), '')
    const msgD = await page.eval(`[...document.querySelectorAll('[data-testid="skill-settings-card"] p[role="status"]')].map(p => p.innerText).join(' | ')`)
    ok('D2 删除反馈消息', msgD.includes('已删除草稿') && msgD.includes('报告.md'), msgD)
    pass += 2

    // —— H. 零 JS 异常 ——
    ok('H1 全程无 JS 异常（exceptionThrown + console error）', page.errors.length === 0, page.errors.slice(0, 3).join(' ; '))

    console.log(`\n=== 结果: ${pass + 1} 断言全过（写作习惯学习 UI 冒烟）===`)
    page.close()
    process.exit(0)
  } catch (e) {
    console.error('  ✗ 冒烟失败: ' + e.message)
    console.error('  JS errors so far: ' + page.errors.slice(0, 5).join(' ; '))
    page.close()
    process.exit(1)
  }
}

main()
