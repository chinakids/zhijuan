// 织卷无头冒烟 · 失败步处置引导（体验层 2026-09-17）
// 用法：node scripts/fail-guide-ui-smoke.mjs
// 前置：node scripts/serve-renderer.mjs（8123）；本机专用无头 Chrome CDP 127.0.0.1:9224
// 链路：devShim「链失败」演示（3 步 zj_read_doc 链第 3 步失败）→ 折叠组头失败态出现
//       「让 agent 处理」按钮（zj-tool-fail-guide）→ 点击 → 预写指引填入输入框但**不自动发送**
//       → 展开链第 3 步失败卡同样有按钮、点击再注入 → 发送该指引链路正常
//       → 「模拟中断」取消态不提供该按钮（失败=工具报错，取消=人被中止，语义分层）。
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
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m)
      pending.delete(m.id)
    }
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
async function setInput(page, text) {
  await page.eval(`(() => {
    const ta = document.querySelector('textarea')
    const proto = Object.getPrototypeOf(ta)
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
    setter.call(ta, ${JSON.stringify(text)})
    ta.setSelectionRange(${JSON.stringify(text)}.length, ${JSON.stringify(text)}.length)
    const ev = new Event('input', { bubbles: true })
    ev.isComposing = false
    ta.dispatchEvent(ev)
    ta.dispatchEvent(new Event('change', { bubbles: true }))
    return ta.value
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

  // ① 链失败演示：3 步链第 3 步失败
  await typeText(page, '链失败演示')
  await pressEnter(page)
  await evalUntil(
    page,
    `document.body.innerText.includes('×3 展开') && document.body.innerText.includes('第 3 段读取失败')`,
    (v) => v === true,
    25000,
    '链失败演示结束'
  )
  await sleep(400)

  // ② 组头失败态：「失败」徽标 + 「让 agent 处理」按钮（zj-tool-fail-guide）同时存在
  const head = await page.eval(`(() => {
    const chain = document.querySelector('[data-testid="zj-tool-chain"]')
    if (!chain) return { found: false }
    const failedRow = chain.querySelector('[data-failed="true"]')
    const btn = chain.querySelector('[data-testid="zj-tool-fail-guide"]')
    return { found: true, hasFailBadge: !!failedRow, hasGuideBtn: !!btn }
  })()`)
  ok('链失败：折叠组头呈失败态（红色文字行 data-failed）', head.found && head.hasFailBadge === true, JSON.stringify(head))
  ok('链失败：折叠组头提供「让 agent 处理」按钮', head.found && head.hasGuideBtn === true, JSON.stringify(head))

  // ②b 防溢出回归（F-20260917-03 主人：工具链文本溢出）：链内任何可见元素不得越出卡片右边界
  const overflow = await page.eval(`(() => {
    const chain = document.querySelector('[data-testid="zj-tool-chain"]')
    if (!chain) return { ok: false, bad: ['no-chain'] }
    const cr = chain.getBoundingClientRect()
    const bad = [...chain.querySelectorAll('*')]
      .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > cr.right + 1 })
      .slice(0, 3)
      .map((el) => (el.tagName + '.' + String(el.className || '').slice(0, 40)))
    return { ok: bad.length === 0, bad }
  })()`)
  ok('工具链卡片内无元素越界溢出', overflow.ok === true, JSON.stringify(overflow.bad))

  // ③ 点击组头按钮 → 预写指引填入输入框、不自动发送（消息区无新 user 气泡、无 streaming）
  await clickEl(page, `document.querySelector('[data-testid="zj-tool-chain"] [data-testid="zj-tool-fail-guide"]')`)
  await sleep(400)
  const afterClick = await page.eval(`(() => {
    const ta = document.querySelector('textarea')
    const v = ta ? ta.value : ''
    const body = document.body.innerText
    return {
      input: v,
      hasPrompt: v.includes('上一步「zj_read_doc」调用失败') && v.includes('重试该步'),
      userBubbles: (body.match(/链失败演示/g) || []).length,
      streaming: !!document.querySelector('button[title="停止生成"]')
    }
  })()`)
  ok('点击后输入框含预写指引（工具名+重试语义）', afterClick.hasPrompt === true, JSON.stringify(afterClick))
  ok('点击不自动发送（无新 user 消息、无生成中）', afterClick.userBubbles <= 1 && afterClick.streaming === false, JSON.stringify(afterClick))

  // ④ 展开链：第 3 步失败卡也有该按钮，点击再注入一次
  await setInput(page, '')
  await clickEl(page, `([...document.querySelectorAll('button')].find((b) => b.textContent.includes('×3')))`)
  await sleep(400)
  const exp = await page.eval(`(() => {
    const btns = [...document.querySelectorAll('[data-testid="zj-tool-fail-guide"]')]
    const chain = document.querySelector('[data-testid="zj-tool-chain"]')
    return { count: btns.length, inChain: chain ? chain.querySelectorAll('[data-testid="zj-tool-fail-guide"]').length : 0 }
  })()`)
  ok('展开后组头+失败步共 2 个「让 agent 处理」按钮', exp.count >= 2 && exp.inChain >= 2, JSON.stringify(exp))
  await clickEl(page, `([...document.querySelectorAll('[data-testid="zj-tool-fail-guide"]')].at(-1))`)
  await sleep(400)
  const again = await page.eval(`document.querySelector('textarea').value`)
  ok('失败步按钮同样注入指引（与组头同一函数）', again.includes('上一步「zj_read_doc」调用失败'), JSON.stringify(again))

  // ⑤ 发送该指引：链路正常（devShim 命中「失败」触发词 → 独立失败演示卡落地、输入框清空）
  await pressEnter(page)
  await evalUntil(
    page,
    `(() => {
      const ta = document.querySelector('textarea')
      const streaming = !!document.querySelector('button[title="停止生成"]')
      return (ta && ta.value.trim() === '') && !streaming && document.body.innerText.includes('未找到匹配（ENOENT）')
    })()`,
    (v) => v === true,
    25000,
    '重试链路正常'
  )
  ok('发送指引后链路正常（新工具卡出现）', true)

  // ⑥ 回归：失败与取消语义分层——「模拟中断」取消态不提供「让 agent 处理」
  await evalUntil(
    page,
    `(!document.querySelector('button[title="停止生成"]')) && !!document.querySelector('textarea')`,
    (v) => v === true,
    20000,
    '上一轮结束'
  )
  await sleep(600)
  await typeText(page, '模拟中断测试')
  await pressEnter(page)
  await evalUntil(
    page,
    `document.body.innerText.includes('已取消') && !document.querySelector('button[title="停止生成"]')`,
    (v) => v === true,
    25000,
    '取消演示结束'
  )
  await sleep(400)
  const cancel = await page.eval(`(() => {
    const badge = document.querySelector('[data-testid="zj-tool-cancelled"]')
    if (!badge) return { found: false }
    let el = badge
    for (let i = 0; i < 4 && el.parentElement; i++) {
      el = el.parentElement
      if (String(el.className ?? '').includes('rounded-lg')) {
        return { found: true, guideInCancelCard: !!el.querySelector('[data-testid="zj-tool-fail-guide"]') }
      }
    }
    return { found: true, guideInCancelCard: false }
  })()`)
  ok('取消态（非失败）卡片内不提供「让 agent 处理」', cancel.found === true && cancel.guideInCancelCard === false, JSON.stringify(cancel))

  // ⑦ 截图留档（失败步处置引导：组头失败态+按钮；展开态按钮+输入框预写指引）
  await sleep(500)
  const shot = await page.cmd('Page.captureScreenshot', { format: 'png' })
  if (shot?.data) {
    writeFileSync(process.env.ZJ_SHOT_DIR ? `${process.env.ZJ_SHOT_DIR}/fail-guide.png` : '/tmp/fail-guide-ui.png', Buffer.from(shot.data, 'base64'))
    console.log('SHOT saved')
  }
} catch (e) {
  fail++
  console.log('FATAL ' + String(e?.message ?? e).slice(0, 300))
} finally {
  console.log(`RESULT ${pass} pass / ${fail} fail`)
  process.exit(fail > 0 ? 1 : 0)
}
