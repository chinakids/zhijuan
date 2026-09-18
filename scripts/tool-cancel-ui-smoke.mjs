// 织卷无头冒烟 · 工具卡「已取消」终态（智能层 2026-09-16 候选2）
// 用法：node scripts/tool-cancel-ui-smoke.mjs
// 前置：node scripts/serve-renderer.mjs（8123）；本机专用无头 Chrome CDP 127.0.0.1:9224（先 npm run build）
// 链路（devShim 触发词）：
//   场景 A「模拟超时」→ meta(zj_edit_doc) 无 meta-done 后 error → 该工具卡必须落「已取消」终态
//   （修复前：永久转圈/无终态；「模拟超时」现有演示就复现此缺口）
//   场景 B「模拟中断」→ meta(zj_search) 无 meta-done 后 aborted → 工具卡「已取消」+「（已停止）」
// 断言：已取消徽标存在、无「失败」徽标（非工具执行错误）、无 spinner([data-zj-ind])、
//       无进行中「已 Ns」耗时徽标、工具名保留
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
async function evalUntil(page, expr, pred, timeoutMs = 20000, label = expr) {
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
    await sleep(50)
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

// 工具卡状态快照：找「已取消」徽标所在卡片，输出其 innerText / 图标 / spinner 数
async function toolCardState(page, toolNameZh) {
  return page.eval(`(() => {
    const badge = document.querySelector('[data-testid="zj-tool-cancelled"]')
    if (!badge) return { found: false }
    const card = badge.closest('[data-testid="zj-tool-detail"], [data-testid="zj-tool-chain"]')
    if (!card) return { found: true, badge: true }
    return {
      found: true,
      text: card.innerText,
      hasCancelIcon: !!card.querySelector('[data-testid="zj-tool-cancelled-icon"]'),
      hasFailBadge: card.innerText.includes('失败'),
      spinnerCount: card.querySelectorAll('[data-zj-ind]').length,
      hasElapsedLive: /已 [0-9.]+[sm]/.test(card.innerText),
      hasToolName: card.innerText.includes(${JSON.stringify(toolNameZh)})
    }
  })()`)
}

// ---- 场景 A：error 终了（触发词「模拟超时」）----
{
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel')
  const page = await attach(tab.webSocketDebuggerUrl)
  try {
    await evalUntil(page, `document.body.innerText.includes('Agent') && !!document.querySelector('textarea')`, (v) => v === true, 20000, '正文页就绪')
    await typeText(page, '模拟超时')
    await pressEnter(page)
    await evalUntil(page, `document.querySelector('[data-testid="zj-tool-cancelled"]') !== null`, (v) => v === true, 20000, '场景A 已取消徽标出现')
    const st = await toolCardState(page, '改正文')
    console.log('A STATE:', JSON.stringify(st))
    ok('A.已取消徽标出现', st.found)
    ok('A.工具卡含「改正文」', st.hasToolName)
    ok('A.有 CircleSlash 图标', st.hasCancelIcon)
    ok('A.无「失败」徽标（非工具执行错误）', !st.hasFailBadge)
    ok('A.无 spinner 转圈', st.spinnerCount === 0, 'spinner=' + st.spinnerCount)
    ok('A.无进行中「已 Ns」耗时徽标', !st.hasElapsedLive)
    ok('A.取消态显示冻结耗时（跑了多久才停）', /\d+\.\ds/.test(st.text || ''), 'text=' + JSON.stringify(st.text))
  } catch (e) {
    console.error('FATAL A', e.message)
    fail++
  } finally {
    try {
      await fetch(CDP + '/json/close/' + tab.id)
    } catch {}
  }
}

// ---- 场景 B：aborted 终了（触发词「模拟中断」）----
{
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel')
  const page = await attach(tab.webSocketDebuggerUrl)
  try {
    await evalUntil(page, `document.body.innerText.includes('Agent') && !!document.querySelector('textarea')`, (v) => v === true, 20000, '正文页就绪')
    await typeText(page, '模拟中断')
    await pressEnter(page)
    await evalUntil(page, `document.querySelector('[data-testid="zj-tool-cancelled"]') !== null`, (v) => v === true, 20000, '场景B 已取消徽标出现')
    const st = await toolCardState(page, '全文搜索')
    console.log('B STATE:', JSON.stringify(st))
    ok('B.已取消徽标出现', st.found)
    ok('B.工具卡含「全文搜索」', st.hasToolName)
    ok('B.有 CircleSlash 图标', st.hasCancelIcon)
    ok('B.无「失败」徽标（非工具执行错误）', !st.hasFailBadge)
    ok('B.无 spinner 转圈', st.spinnerCount === 0, 'spinner=' + st.spinnerCount)
    ok('B.无进行中「已 Ns」耗时徽标', !st.hasElapsedLive)
    ok('B.取消态显示冻结耗时（跑了多久才停）', /\d+\.\ds/.test(st.text || ''), 'text=' + JSON.stringify(st.text))
    const body = await page.eval(`document.body.innerText`)
    ok('B.assistant 气泡「（已停止）」', body.includes('（已停止）'))
    // 截图（场景 B 完整界面）
    try {
      const shot = await page.cmd('Page.captureScreenshot', { format: 'png' })
      const name = 'tool-cancel-' + new Date().toTimeString().slice(0, 5).replace(':', '') + '.png'
      const out = process.env.HOME + '/Pictures/zhijuan/' + name
      writeFileSync(out, Buffer.from(shot.data, 'base64'))
      console.log('SHOT ' + out)
      console.log('MEDIA:' + out)
    } catch (e) {
      console.log('SHOT FAIL', e.message)
    }
  } catch (e) {
    console.error('FATAL B', e.message)
    fail++
  } finally {
    try {
      await fetch(CDP + '/json/close/' + tab.id)
    } catch {}
  }
}

console.log(pass + ' PASS / ' + fail + ' FAIL')
process.exit(fail === 0 ? 0 : 1)
