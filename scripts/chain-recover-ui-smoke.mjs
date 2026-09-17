// 织卷无头冒烟 · 工具链组头「已恢复」终态（体验层 2026-09-17 晚）
// 用法：node scripts/chain-recover-ui-smoke.mjs
// 前置：node scripts/serve-renderer.mjs（8123）；本机专用无头 Chrome CDP 127.0.0.1:9224
// 链路：devShim「链恢复」演示（3 步 zj_read_doc 链：第 1 步失败、第 2/3 步成功）→ 折叠组头=
//       绿勾终态+「已恢复」中性徽标（无「失败」徽标、无「让 agent 处理」）；展开态失败步单卡
//       保留红色失败态+按钮（历史细节层不消失）→ 回归：devShim「链失败」演示（尾步失败）组头仍红。
import { writeFileSync } from 'node:fs'

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
      errors.push('exc:' + String(m.params?.exceptionDetails?.text ?? '').slice(0, 120))
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') {
      errors.push('console:' + String(m.params?.args?.[0]?.value ?? '').slice(0, 120))
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
async function typeText(page, text) {
  for (const ch of text) {
    await page.eval(`(() => {
      const ta = document.querySelector('textarea')
      if (!ta) return 'NO_TA'
      ta.focus()
      const proto = Object.getPrototypeOf(ta)
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
      setter.call(ta, ta.value + ${JSON.stringify(ch)})
      const pos = ta.value.length
      ta.setSelectionRange(pos, pos)
      const ev = new Event('input', { bubbles: true })
      ev.isComposing = false
      ta.dispatchEvent(ev)
      ta.dispatchEvent(new Event('change', { bubbles: true }))
      return ta.value
    })()`)
    await sleep(60)
  }
  return 'OK'
}
async function pressEnter(page) {
  await page.eval(`(() => {
    const ta = document.querySelector('textarea')
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    return true
  })()`)
}
async function clickEl(page, expr) {
  return page.eval(`(() => { const el = ${expr}; if (!el) return false; el.click(); return true })()`)
}

let pass = 0
let fail = 0
function ok(name, cond, extra = '') {
  if (cond) {
    pass++
    console.log('PASS ' + name)
  } else {
    fail++
    console.log('FAIL ' + name + (extra ? ' | ' + extra : ''))
  }
}

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel')
console.log('TAB:', tab.id)
const page = await attach(tab.webSocketDebuggerUrl)

try {
  await evalUntil(
    page,
    `document.body.innerText.includes('Agent') && !!document.querySelector('textarea')`,
    (v) => v === true,
    20000,
    '正文页就绪'
  )
  console.log('OK 正文页就绪')

  // ① 链恢复演示：第 1 步失败 + 第 2/3 步成功
  await typeText(page, '链恢复演示')
  await pressEnter(page)
  await evalUntil(
    page,
    `document.body.innerText.includes('×3 展开') && document.body.innerText.includes('首段读取失败已重试恢复') && !document.querySelector('button[title="停止生成"]')`,
    (v) => v === true,
    25000,
    '链恢复演示结束'
  )
  await sleep(400)

  // ② 折叠组头终态：绿勾 + 「已恢复」徽标；无「失败」徽标、无「让 agent 处理」按钮
  const head = await page.eval(`(() => {
    const chain = document.querySelector('[data-testid="zj-tool-chain"]')
    if (!chain) return { found: false }
    const rec = chain.querySelector('[data-testid="zj-chain-recovered"]')
    const failBadge = [...chain.querySelectorAll('span')].find((s) => s.textContent === '失败')
    const guide = chain.querySelector('[data-testid="zj-tool-fail-guide"]')
    // 链组头主图标=成功绿勾（lucide-check + text-success；方式线/详情箭头/续读除外）
    const hasOkIcon = [...chain.querySelectorAll('svg')].some((s) => {
      const cls = (s.getAttribute('class') || '')
      return cls.includes('lucide-check') && cls.includes('text-success')
    })
    const inner = chain.innerText
    return { found: true, hasRecovered: !!rec, hasFailBadge: !!failBadge, hasGuide: !!guide, hasOkIcon, inner }
  })()`)
  ok('链恢复：折叠组头显示「已恢复」徽标', head.found && head.hasRecovered === true, JSON.stringify({ ...head, inner: undefined }))
  ok('链恢复：折叠组头无「失败」徽标（终态=成功不误导）', head.found && head.hasFailBadge === false, JSON.stringify({ ...head, inner: undefined }))
  ok('链恢复：折叠组头无「让 agent 处理」按钮（已自愈无需干预）', head.found && head.hasGuide === false, JSON.stringify({ ...head, inner: undefined }))
  ok('链恢复：折叠组头主体为成功图标（绿勾终态）', head.hasOkIcon === true, JSON.stringify({ ...head, inner: undefined }))
  ok('链恢复：失败步摘要仍保留（中性小字+title 全量）', head.inner.includes('读取失败：文件已被外部修改'), 'inner=' + head.inner.slice(0, 200))
  const overflow1 = await page.eval(`(() => {
    const chain = document.querySelector('[data-testid="zj-tool-chain"]')
    if (!chain) return { ok: false, bad: ['no-chain'] }
    const cr = chain.getBoundingClientRect()
    const bad = [...chain.querySelectorAll('*')]
      .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > cr.right + 1 })
      .slice(0, 3)
      .map((el) => (el.tagName + '.' + String(el.className || '').slice(0, 40)))
    return { ok: bad.length === 0, bad }
  })()`)
  ok('链恢复：组头卡片内无元素越界溢出', overflow1.ok === true, JSON.stringify(overflow1.bad))

  // 截图①：恢复态折叠组头（主人附证）
  const shotFold = await page.cmd('Page.captureScreenshot', { format: 'png' })
  if (shotFold?.data) {
    const dir = process.env.ZJ_SHOT_DIR || '/tmp'
    writeFileSync(dir + '/chain-recover-fold.png', Buffer.from(shotFold.data, 'base64'))
    console.log('SHOT fold saved')
  }

  // ③ 失败详情可追溯：组头「展开」显示失败步完整参数/结果（失败步=组头本体，被聚合态覆盖）
  await clickEl(page, `document.querySelector('[data-testid="zj-tool-chain"] [data-testid="zj-tool-detail-toggle"]')`)
  await sleep(400)
  const det = await page.eval(`(() => {
    const chain = document.querySelector('[data-testid="zj-tool-chain"]')
    if (!chain) return { found: false }
    const body = chain.querySelector('[data-testid="zj-tool-detail-body"]')
    return { found: true, hasBody: !!body, hasErr: body ? body.innerText.includes('ENOENT') : false }
  })()`)
  ok('链恢复：展开详情可见失败步完整结果（Error: ENOENT）', det.found && det.hasBody === true && det.hasErr === true, JSON.stringify(det))

  // 截图②：失败详情展开态（失败信息可追溯）
  const shotDet = await page.cmd('Page.captureScreenshot', { format: 'png' })
  if (shotDet?.data) {
    const dir = process.env.ZJ_SHOT_DIR || '/tmp'
    writeFileSync(dir + '/chain-recover-detail.png', Buffer.from(shotDet.data, 'base64'))
    console.log('SHOT detail saved')
  }
  await clickEl(page, `document.querySelector('[data-testid="zj-tool-chain"] [data-testid="zj-tool-detail-toggle"]')`)

  // ④ 回归：链失败演示（尾步失败）组头仍红失败+按钮
  await page.eval(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('×3 收起')); if (b) b.click(); return true })()`)
  await sleep(300)
  await typeText(page, '链失败演示')
  await pressEnter(page)
  await evalUntil(
    page,
    `document.body.innerText.includes('第 3 段读取失败') && !document.querySelector('button[title="停止生成"]')`,
    (v) => v === true,
    25000,
    '链失败演示结束'
  )
  await sleep(400)
  // 取最末一条工具链（消息区可能有多条链：先展开态也有一条；取 body 最后一个 zj-tool-chain）
  const reg = await page.eval(`(() => {
    const chains = [...document.querySelectorAll('[data-testid="zj-tool-chain"]')]
    const chain = chains.at(-1)
    if (!chain) return { found: false }
    const failBadge = [...chain.querySelectorAll('span')].find((s) => s.textContent === '失败')
    const guide = chain.querySelector('[data-testid="zj-tool-fail-guide"]')
    return { found: true, hasFailBadge: !!failBadge, hasGuide: !!guide, hasRecovered: !!chain.querySelector('[data-testid="zj-chain-recovered"]') }
  })()`)
  ok('回归：链失败（尾步失败）组头仍显示「失败」徽标', reg.found && reg.hasFailBadge === true, JSON.stringify(reg))
  ok('回归：链失败组头仍有「让 agent 处理」按钮', reg.found && reg.hasGuide === true, JSON.stringify(reg))

  // ⑤ 无 JS 异常断言（双通道收集）
  await sleep(600)
  ok('无 JS 异常（exceptionThrown/console.error 双通道）', page.errors.length === 0, JSON.stringify(page.errors.slice(0, 5)))

  // ⑥ 截图留档：恢复态组头（折叠）+ 展开态细节
  const shot1 = await page.cmd('Page.captureScreenshot', { format: 'png' })
  if (shot1?.data) {
    const dir = process.env.ZJ_SHOT_DIR || '/tmp'
    writeFileSync(dir + '/chain-recover.png', Buffer.from(shot1.data, 'base64'))
    console.log('SHOT saved')
  }
} catch (e) {
  fail++
  console.log('FATAL ' + String(e?.message ?? e).slice(0, 300))
} finally {
  console.log(`RESULT ${pass} pass / ${fail} fail`)
  process.exit(fail > 0 ? 1 : 0)
}
