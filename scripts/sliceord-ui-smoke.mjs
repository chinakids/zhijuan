// 织卷无头冒烟 · 档案切片核查（devShim 空态路径）：Agent 面板新按钮 → 抽屉打开 → 标题/结果渲染
// 命中路径由 scripts/sliceord-data-smoke.mjs（主进程真实现 + 临时库）覆盖，此处验证 UI 接线（按钮/标题/空态/无 JS 异常）。
// 用法：node scripts/sliceord-ui-smoke.mjs
// 前置：node scripts/serve-renderer.mjs 8123；本机专用无头 Chrome CDP 127.0.0.1:9224
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

const clickByTitle = (title) => `(() => {
  const els = [...document.querySelectorAll('button, [role="menuitem"]')]
  const hit = els.find((b) => b.title === ${JSON.stringify(title)})
  if (!hit) return 'NOT_FOUND'
  // Radix 菜单 trigger/menuitem 需要 pointer 事件序列（程序化 click 不打开）——F-20260912-08 检查菜单（3e0ec55）
  hit.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
  hit.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }))
  hit.click()
  return 'CLICKED'
})()`

// 次级检查项已收进「检查」折叠菜单（3e0ec55）：先开菜单再点项
const openCheckMenu = () => `(() => {
  const els = [...document.querySelectorAll('button')]
  const hit = els.find((b) => b.title === '检查阵容：一致性/冷读/多视角/本地核查')
  if (!hit) return 'NOT_FOUND'
  hit.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
  hit.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }))
  hit.click()
  return 'CLICKED'
})()`

let pass = 0
let failed = false
const check = (name, cond) => {
  if (!cond) { failed = true; throw new Error('断言失败: ' + name) }
  pass++
  console.log('  ✓ ' + name)
}

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel')
console.log('TAB:', tab.id, tab.url)
const page = await attach(tab.webSocketDebuggerUrl)

try {
  await evalUntil(page, `document.body.innerText.includes('Agent') && document.body.innerText.includes('第1章')`, (v) => v === true, 20000, '正文页就绪')
  console.log('OK 正文页就绪')

  // ① 次级检查项已收进「检查」折叠菜单（3e0ec55）：先开菜单，断言菜单项存在（title=label）
  console.log('打开检查菜单:', await page.eval(openCheckMenu()))
  await sleep(350)
  const btn = await page.eval(`(() => {
    const b = [...document.querySelectorAll('[role="menuitem"]')].find((x) => (x.title || '').startsWith('档案切片核查'))
    return b ? { title: b.title } : null
  })()`)
  check('菜单项存在（title=「档案切片核查…」）', !!btn)

  // ② 点击菜单项 → 抽屉打开并出现标题（K_TITLE 接线）
  console.log('点击菜单项:', await page.eval(clickByTitle('档案切片核查（本地规则·秒级）')))
  await evalUntil(page, `document.body.innerText.includes('档案切片核查')`, (v) => v === true, 8000, '抽屉标题出现')
  // 演示项目人物档无「## 切片：」小节 → 空态 summary
  await evalUntil(page, `document.body.innerText.includes('都没有「切片」小节')`, (v) => v === true, 15000, '结果 summary 渲染')
  console.log('OK 抽屉显示结果（演示项目人物档无切片小节 → 空态）')

  // ③ 摘要内容与「本地规则」语义都在
  const txt = await page.eval(`document.body.innerText`)
  check('抽屉渲染 summary（本地规则·零模型）', txt.includes('档案切片核查（本地规则·零模型）') && txt.includes('都没有「切片」小节'))
  check('抽屉标题取 K_TITLE（不是「人物档案腐坏核查」）', txt.includes('档案切片核查') && !txt.includes('人物档案腐坏核查'))

  console.log(`\n全部通过：${pass} 断言`)
} finally {
  page.close()
}
