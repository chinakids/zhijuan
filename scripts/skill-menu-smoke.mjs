// 织卷无头冒烟 · 输入框 / 命令（skill 槽位：触发浮层 → 过滤 → 回车插入 → 发送展开为模板 prompt）
// 用法：node scripts/skill-menu-smoke.mjs
// 前置：node scripts/serve-renderer.mjs 8123；本机专用无头 Chrome CDP 127.0.0.1:9224
// 验收点：① / 触发浮层出现（续写/润色/延伸）；② 输入「续」过滤只剩续写；③ 回车确认后输入框出现 /续写 ；
//         ④ Enter 发送后 user 气泡为展开模板（含《题名》、zj_edit_doc、参数）；⑤ 无匹配命令出现空态；⑥ /延伸 正常展开。
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
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
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

// 用真实键盘事件驱动输入（React 受控组件必须走原生事件，直接改 value 会被 React 覆盖）
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
    await sleep(80)
  }
  return 'OK'
}

async function clearText(page) {
  await page.eval(`(() => {
    const ta = document.querySelector('textarea')
    if (!ta) return
    ta.focus()
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(ta), 'value').set
    setter.call(ta, '')
    ta.setSelectionRange(0, 0)
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await sleep(250)
}

async function pressEnter(page) {
  await page.eval(`(() => {
    const ta = document.querySelector('textarea')
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    return true
  })()`)
}

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel')
console.log('TAB:', tab.id, tab.url)
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

  // ① 输入 / → 命令浮层出现，含 续写/润色/延伸
  await typeText(page, '/')
  await evalUntil(page, `!!document.querySelector('.zj-cmd-menu')`, (v) => v === true, 8000, '/ 浮层出现')
  const menu1 = await page.eval(`document.querySelector('.zj-cmd-menu')?.innerText || ''`)
  if (!menu1.includes('/续写') || !menu1.includes('/润色') || !menu1.includes('/延伸')) throw new Error('浮层缺命令：' + menu1.slice(0, 120))
  console.log('OK ① / 浮层出现（续写/润色/延伸）')

  // ② 输入「续」→ 只剩续写
  await typeText(page, '续')
  await evalUntil(
    page,
    `document.querySelector('.zj-cmd-menu')?.innerText || ''`,
    (v) => v.includes('/续写') && !v.includes('/润色'),
    8000,
    '过滤后命令'
  )
  console.log('OK ② 输入「续」过滤后只剩续写')

  // ③ 回车确认 → 输入框值含 /续写
  await pressEnter(page)
  await sleep(400)
  const val = await page.eval(`document.querySelector('textarea')?.value || ''`)
  if (!val.startsWith('/续写')) throw new Error('回车后输入框未插入命令：' + JSON.stringify(val))
  console.log('OK ③ 回车确认后输入框为 /续写')

  // ④ 输入参数后 Enter 发送 → user 气泡为展开模板（含题名/zj_edit_doc/参数），agent 已回
  await typeText(page, '三百字，带出沈藏')
  await pressEnter(page)
  await evalUntil(
    page,
    `document.body.innerText`,
    (v) => v.includes('创作任务：续写《') && v.includes('zj_edit_doc') && v.includes('具体要求：三百字，带出沈藏') && v.includes('（dev 模式模拟回复）'),
    25000,
    '命令展开为模板'
  )
  await sleep(600)
  console.log('OK ④ 发送后 user 气泡为展开模板（传入参数已拼入；agent 流结束）')

  // ⑤ 无匹配命令空态：输入 /不存在
  await clearText(page)
  await typeText(page, '/不存在')
  await evalUntil(
    page,
    `document.querySelector('.zj-cmd-menu')?.innerText || ''`,
    (v) => v.includes('没有匹配的命令'),
    8000,
    '无匹配空态'
  )
  console.log('OK ⑤ 无匹配命令显示空态')

  // ⑥ /延伸 正向：过滤→选择→发送展开
  await clearText(page)
  await typeText(page, '/延伸')
  await evalUntil(page, `!!document.querySelector('.zj-cmd-menu')`, (v) => v === true, 8000, '延伸浮层')
  await pressEnter(page)
  await sleep(400)
  const val6 = await page.eval(`document.querySelector('textarea')?.value || ''`)
  if (!val6.startsWith('/延伸')) throw new Error('延伸未插入：' + JSON.stringify(val6))
  await pressEnter(page)
  await evalUntil(
    page,
    `document.body.innerText`,
    (v) => v.includes('3 个可发展的走向'),
    20000,
    '延伸展开'
  )
  console.log('OK ⑥ /延伸 选择后发送，模板正常展开（不写正文口径）')

  console.log('ALL OK ✅')
} catch (err) {
  console.error('FAIL:', err.message)
  process.exitCode = 1
} finally {
  page.close()
}
