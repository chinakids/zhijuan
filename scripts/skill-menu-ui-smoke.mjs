// 织卷无头冒烟 · skill 运行层（/ 菜单技能项 + 技能激活演示）
// 用法：node scripts/skill-menu-ui-smoke.mjs
// 前置：node scripts/serve-renderer.mjs 8123；本机专用无头 Chrome CDP 127.0.0.1:9224
// 验收点（设计基线 §7 无头 UI）：① / 菜单出现「倒叙开篇法」技能项且带「技能」标注，禁用示例不出现；
//          ② 过滤「倒叙」只剩技能项；③ 选中插入 `/倒叙开篇法 `；④ 发送后消息流含技能激活指示；
//          ⑤ 全程无 JS 异常（exceptionThrown + consoleAPICalled type=error）。
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

  // ① / 菜单出现技能项（带「技能」标注）；禁用示例不出现
  await typeText(page, '/')
  await evalUntil(page, `!!document.querySelector('.zj-cmd-menu')`, (v) => v === true, 8000, '/ 浮层出现')
  const menu1 = await page.eval(`document.querySelector('.zj-cmd-menu')?.innerText || ''`)
  if (!menu1.includes('/倒叙开篇法')) throw new Error('菜单缺技能项：' + menu1.slice(0, 160))
  if (!menu1.includes('技能')) throw new Error('技能项缺「技能」标注：' + menu1.slice(0, 160))
  if (menu1.includes('/禁用示例')) throw new Error('禁用技能不应出现在菜单：' + menu1.slice(0, 160))
  console.log('OK ① / 菜单含倒叙开篇法（技能标注）；禁用示例未出现')

  // ② 过滤「倒叙」只剩技能项
  await typeText(page, '倒叙')
  await evalUntil(
    page,
    `document.querySelector('.zj-cmd-menu')?.innerText || ''`,
    (v) => v.includes('/倒叙开篇法') && !v.includes('/润色'),
    8000,
    '过滤后技能项'
  )
  console.log('OK ② 过滤「倒叙」只剩技能项（内置命令被过滤掉）')

  // ③ 回车选择 → 输入框 /倒叙开篇法
  await pressEnter(page)
  await sleep(400)
  const val = await page.eval(`document.querySelector('textarea')?.value || ''`)
  if (!val.startsWith('/倒叙开篇法')) throw new Error('未插入技能命令：' + JSON.stringify(val))
  console.log('OK ③ 选中插入 /倒叙开篇法')

  // ④ 加参数发送 → 消息流含技能激活指示（devShim 演示分支）
  await typeText(page, ' 要点：用高光时刻开篇')
  await pressEnter(page)
  await evalUntil(
    page,
    `document.body.innerText`,
    (v) => v.includes('已按《倒叙开篇法》激活'),
    25000,
    '技能激活指示'
  )
  await sleep(600)
  console.log('OK ④ 发送后消息流含技能激活指示')

  // ⑤ 无 JS 异常
  if (page.errors.length) throw new Error('JS 异常: ' + page.errors.join(' | ').slice(0, 400))
  console.log('OK ⑤ 全程无 JS 异常')

  console.log('ALL OK ✅')
} catch (err) {
  console.error('FAIL:', err.message)
  process.exitCode = 1
} finally {
  page.close()
}
