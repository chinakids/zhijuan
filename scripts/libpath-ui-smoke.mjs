// 织卷无头冒烟 · 设置页「项目库·当前生效库根」只读行（平台层 2026-09-11）
// 用法：node scripts/libpath-ui-smoke.mjs
// 前置：node scripts/serve-renderer.mjs；本机专用无头 Chrome CDP 127.0.0.1:9224
// 验收点：
// ① 设置页默认显示「当前：~/Documents/织卷工作区/项目库」（devShim getPaths 与真机同口径）
// ② 填库根 /tmp/zj-lib-test → 保存 → 「当前：/tmp/zj-lib-test」（保存后刷新生效值）
// ③ 清空库根 → 保存 → 「当前：~/Documents/织卷工作区/项目库」（留空回默认位）
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
const bodyHas = (t) => `document.body.innerText.includes(${JSON.stringify(t)})`

async function clickText(page, text) {
  const r = await page.eval(`(() => {
    const el = [...document.querySelectorAll('button')].find((b) => b.textContent.includes(${JSON.stringify(text)}))
    if (!el) return 'NO_BTN'
    el.click()
    return 'OK'
  })()`)
  if (r !== 'OK') throw new Error('clickText failed: ' + text)
}

let pass = 0
let fail = 0
async function step(name, fn) {
  try {
    await fn()
    pass++
    console.log('PASS', name)
  } catch (e) {
    fail++
    console.log('FAIL', name, '-', e.message)
  }
}

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/settings')
const page = await attach(tab.webSocketDebuggerUrl)
// 找以「当前：」开头且包含目标路径的 p（工作区与项目库各有一行，必须按目标串区分）
const curHas = (target) => `(() => { const els = [...document.querySelectorAll('p')]; return els.some((e) => e.textContent.startsWith('当前：') && e.textContent.includes(${JSON.stringify(target)})) })()`

await step('① 默认生效库根展示', async () => {
  await evalUntil(page, bodyHas('项目库'), Boolean, 20000, '项目库卡出现')
  await evalUntil(page, curHas('~/Documents/织卷工作区/项目库'), Boolean, 20000, '默认当前库根')
})

await step('② 改库根并保存 → 当前值刷新', async () => {
  const r = await page.eval(`(() => {
    const input = document.querySelector('input[placeholder*="织卷工作区/项目库"]')
    if (!input) return 'NO_INPUT'
    const proto = Object.getPrototypeOf(input)
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, '/tmp/zj-lib-test')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return input.value
  })()`)
  if (r === 'NO_INPUT') throw new Error('library input not found')
  await clickText(page, '保存设置')
  await evalUntil(page, curHas('/tmp/zj-lib-test'), Boolean, 20000, '保存后当前库根')
})

await step('③ 清空库根并保存 → 回默认位', async () => {
  await page.eval(`(() => {
    const input = document.querySelector('input[placeholder*="织卷工作区/项目库"]')
    if (input) {
      const proto = Object.getPrototypeOf(input)
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, '')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    return input ? input.value : 'NO_INPUT'
  })()`)
  await clickText(page, '保存设置')
  await evalUntil(page, curHas('~/Documents/织卷工作区/项目库'), Boolean, 20000, '清空后当前库根')
})

page.close()
console.log(`RESULT: pass=${pass} fail=${fail}`)
process.exit(fail === 0 ? 0 : 1)
