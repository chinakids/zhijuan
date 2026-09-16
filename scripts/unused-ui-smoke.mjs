// 织卷无头冒烟 · 人物档案腐坏核查：审计抽屉「档案」Tab（devShim 演示数据真实计算）
// 用法：node scripts/unused-ui-smoke.mjs
// 前置：node scripts/serve-renderer.mjs 8123；本机专用无头 Chrome CDP 127.0.0.1:9224
// 验收点：① Agent 面板出现「人物档案腐坏核查」入口按钮；② 点击后抽屉标题=人物档案腐坏核查；
//         ③ 状态行显示「本地规则核查：共列 1 条」；④ 演示条目（沈老爹 = 登记但全卷未出现的别名）渲染且带「让 agent 改」；
//         ⑤ 抽屉内「档案」Tab 高亮，切「在场」再切回「档案」标题随切。
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

const clickByText = (text) => `(() => {
  const btns = [...document.querySelectorAll('button')]
  const hit = btns.find((b) => (b.textContent || '').trim() === ${JSON.stringify(text)})
  if (!hit) return 'NOT_FOUND'
  hit.click()
  return 'CLICKED'
})()`

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel')
console.log('TAB:', tab.id, tab.url)
const page = await attach(tab.webSocketDebuggerUrl)

try {
  await evalUntil(page, `document.body.innerText.includes('Agent') && document.body.innerText.includes('第1章')`, (v) => v === true, 20000, '正文页就绪')
  console.log('OK 正文页就绪')

  // ① 次级检查项已收进「检查」折叠菜单（3e0ec55）：先开菜单，断言菜单项存在（title 含「人物档案腐坏核查」）
  console.log('打开检查菜单:', await page.eval(openCheckMenu()))
  await sleep(350)
  const hasEntry = await page.eval(`[...document.querySelectorAll('[role="menuitem"]')].some((b) => (b.title || '').includes('人物档案腐坏核查'))`)
  if (!hasEntry) throw new Error('未找到「人物档案腐坏核查」菜单项')
  console.log('OK 「人物档案腐坏核查」菜单项存在')

  // ② 点击菜单项 → 抽屉出现（标题 = 人物档案腐坏核查）
  console.log('点击菜单项:', await page.eval(clickByTitle('人物档案腐坏核查（本地规则·秒级）')))
  await evalUntil(page, `document.body.innerText.includes('人物档案腐坏核查')`, (v) => v === true, 10000, '抽屉标题出现')
  console.log('OK 抽屉打开（标题=人物档案腐坏核查）')

  // ③ 状态行：本地规则核查：共列 1 条（零模型·秒级）
  await evalUntil(page, `document.body.innerText.includes('本地规则核查：共列 1 条')`, (v) => v === true, 10000, '本地规则状态行')
  console.log('OK 状态行「本地规则核查：共列 1 条」')

  // ④ 演示条目（沈老爹 = 登记但全卷未出现的冗余别名）渲染 + 「让 agent 改」入口
  await evalUntil(page, `document.body.innerText.includes('沈老爹')`, (v) => v === true, 10000, '条目渲染')
  const hasItems = await page.eval(`document.body.innerText.includes('从未出现') && document.body.innerText.includes('让 agent 改')`)
  if (!hasItems) throw new Error('条目未渲染（缺 从未出现/让 agent 改）')
  console.log('OK 演示条目渲染（冗余别名 沈老爹，含「让 agent 改」入口）')

  // ⑤ 抽屉内「档案」Tab 高亮，切到「在场」再切回「档案」标题随切
  const tabState = await page.eval(`(() => {
    const btns = [...document.querySelectorAll('button')]
    const on = btns.find((b) => (b.textContent || '').trim() === '档案')
    return on ? on.className : 'NOT_FOUND'
  })()`)
  if (!String(tabState).includes('bg-accent-soft')) throw new Error('「档案」Tab 未高亮: ' + tabState)
  console.log('OK 「档案」Tab 高亮')
  console.log('切到「在场」:', await page.eval(clickByText('在场')))
  await evalUntil(page, `document.body.innerText.includes('人物在场核查')`, (v) => v === true, 10000, '切到在场')
  console.log('OK 切成「在场」')
  console.log('切回「档案」:', await page.eval(clickByText('档案')))
  await evalUntil(page, `document.body.innerText.includes('人物档案腐坏核查')`, (v) => v === true, 10000, '切回档案')
  console.log('OK 切回「档案」')

  console.log('\nPASS: 人物档案腐坏核查（入口 → 抽屉 → 本地规则状态 → 冗余别名条目 → Tab 切换）链路 OK')
} finally {
  await fetch(CDP + '/json/close/' + tab.id)
  page.close()
}
