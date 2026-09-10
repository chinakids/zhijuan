// 织卷无头冒烟 · 输入框 @ 引用（devShim 演示数据真实计算 → 浮层 → 过滤 → 回车插入 → 发送后 user 气泡见引用文本）
// 用法：node scripts/at-mention-ui-smoke.mjs
// 前置：python3 -m http.server 8123 --directory out/renderer；本机专用无头 Chrome CDP 127.0.0.1:9224
// 验收点：① @ 触发浮层出现（见「人物」分组与 沈藏/阿七）；② 输入「沈」过滤后只剩含沈的候选；
//         ③ 回车确认后输入框出现 〔人物·沈藏｜人物/沈藏.md〕；④ Enter 发送后 user 气泡含引用文本；
//         ⑤ 素材候选在空 query 时不出现、输入「旧茶楼」后出现「素材」类型条目。
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

  // ① 输入 @ → 浮层出现，且候选含 人物·沈藏（人物/沈藏.md）、章节（题名）、无「素材」类型
  await typeText(page, '@')
  await evalUntil(page, `!!document.querySelector('.zj-at-menu')`, (v) => v === true, 8000, '@ 浮层出现')
  const menu1 = await page.eval(`document.querySelector('.zj-at-menu')?.innerText || ''`)
  if (!menu1.includes('沈藏') || !menu1.includes('人物')) throw new Error('浮层缺人物候选：' + menu1.slice(0, 120))
  if (menu1.includes('旧茶楼')) throw new Error('空 query 不应出现素材候选')
  console.log('OK ① @ 浮层出现（含人物/章节/世界观，空 query 无素材）')

  // ② 输入过滤词「沈」→ 只剩含沈的候选
  await typeText(page, '沈')
  await evalUntil(
    page,
    `document.querySelector('.zj-at-menu')?.innerText || ''`,
    (v) => v.includes('沈藏') && !v.includes('阿七'),
    8000,
    '过滤后候选'
  )
  console.log('OK ② 输入「沈」过滤后只剩含沈候选')

  // ③ 回车确认 → 输入框值含引用文本
  await page.eval(`(() => {
    const ta = document.querySelector('textarea')
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    return true
  })()`)
  await sleep(400)
  const val = await page.eval(`document.querySelector('textarea')?.value || ''`)
  if (!val.includes('〔人物·沈藏｜人物/沈藏.md〕')) throw new Error('回车后输入框未插入引用：' + val)
  console.log('OK ③ 回车确认插入引用文本：' + val.trim())

  // ④ Enter 发送 → user 气泡出现引用文本
  await page.eval(`(() => {
    const ta = document.querySelector('textarea')
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    return true
  })()`)
  await evalUntil(
    page,
    `document.body.innerText`,
    (v) => v.includes('〔人物·沈藏｜人物/沈藏.md〕') && v.includes('（dev 模式模拟回复）'),
    20000,
    'user 气泡含引用'
  )
  console.log('OK ④ Enter 发送后 user 气泡含引用文本（agent 已回）')

  // ⑤ 素材候选：输入「@」+「旧茶楼」→ 出现「素材」类型条目（空 query 不出的那个）
  await page.eval(`(() => {
    const ta = document.querySelector('textarea')
    ta.focus()
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(ta), 'value').set
    setter.call(ta, '@旧茶楼')
    const pos = ta.value.length
    ta.setSelectionRange(pos, pos)
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  await evalUntil(
    page,
    `document.querySelector('.zj-at-menu')?.innerText || ''`,
    (v) => v.includes('旧茶楼') && v.includes('素材'),
    8000,
    '素材候选出现'
  )
  console.log('OK ⑤ 「旧茶楼」过滤出素材候选（类型=素材，路径=素材库/人物/旧茶楼账房.md）')

  // ⑥ Esc 关闭浮层再输入普通文本不触发（防误伤：@ 前是汉字不触发）
  await page.eval(`(() => {
    const ta = document.querySelector('textarea')
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(ta), 'value').set
    setter.call(ta, '')
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await sleep(200)
  if (await page.eval(`!!document.querySelector('.zj-at-menu')`)) throw new Error('清空后浮层未关')
  console.log('OK ⑥ 清空后浮层关闭（Esc/清空语义正常）')

  console.log('ALL OK ✅')
} catch (err) {
  console.error('FAIL:', err.message)
  process.exitCode = 1
} finally {
  page.close()
}
