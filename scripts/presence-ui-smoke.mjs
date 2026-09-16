// 织卷无头冒烟 · 人物在场与称谓核查：审计抽屉「在场」Tab（devShim 演示数据）
// 用法：node scripts/presence-ui-smoke.mjs
// 前置：node scripts/serve-renderer.mjs 8123；本机专用无头 Chrome CDP 127.0.0.1:9224
// 验收点：① 正文页 Agent 面板出现「人物在场与称谓核查」入口按钮；② 点击后抽屉标题=人物在场与称谓核查；
//         ③ 状态行显示「本地规则核查：共列 1 条」；④ 演示条目（清单列了却未署名出场）渲染；
//         ⑤ 演示摘要口径含「档案登记的别名参与匹配」（别名约定已生效的文案证据）。
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

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel')
console.log('TAB:', tab.id, tab.url)
const page = await attach(tab.webSocketDebuggerUrl)

try {
  await evalUntil(page, `document.body.innerText.includes('Agent') && document.body.innerText.includes('第1章')`, (v) => v === true, 20000, '正文页就绪')
  console.log('OK 正文页就绪')

  // ① 次级检查项已收进「检查」折叠菜单（3e0ec55）：先开菜单，断言菜单项存在（title 含「人物在场与称谓核查」）
  console.log('打开检查菜单:', await page.eval(openCheckMenu()))
  await sleep(350)
  const hasEntry = await page.eval(`[...document.querySelectorAll('[role="menuitem"]')].some((b) => (b.title || '').includes('人物在场与称谓核查'))`)
  if (!hasEntry) throw new Error('未找到「人物在场与称谓核查」菜单项')
  console.log('OK 「人物在场与称谓核查」菜单项存在')

  // ② 点击菜单项 → 抽屉出现（标题 = 人物在场与称谓核查）
  console.log('点击菜单项:', await page.eval(clickByTitle('人物在场与称谓核查（本地规则·秒级）')))
  await evalUntil(page, `document.body.innerText.includes('人物在场与称谓核查')`, (v) => v === true, 10000, '抽屉标题出现')
  console.log('OK 抽屉打开（标题=人物在场与称谓核查）')

  // ③ 状态行：本地规则核查：共列 1 条（零模型·秒级）
  await evalUntil(page, `document.body.innerText.includes('本地规则核查：共列')`, (v) => v === true, 10000, '本地规则状态行')
  console.log('OK 状态行「本地规则核查」')

  // ④ 演示条目（清单列了却未署名出场 + 阿七）渲染
  await evalUntil(page, `document.body.innerText.includes('清单列了却未署名出场')`, (v) => v === true, 10000, '条目渲染')
  const hasItem = await page.eval(`document.body.innerText.includes('阿七') && document.body.innerText.includes('让 agent 改')`)
  if (!hasItem) throw new Error('条目未渲染（缺 阿七/让 agent 改）')
  console.log('OK 演示条目渲染（含「让 agent 改」入口）')

  // ⑤ 摘要口径：档案登记的别名参与匹配（别名约定文案落地）
  const hasAliasMention = await page.eval(`document.body.innerText.includes('档案登记的别名参与匹配')`)
  if (!hasAliasMention) throw new Error('摘要未含别名口径文案')
  console.log('OK 摘要含别名口径文案（档案登记的别名参与匹配）')

  console.log('\nPASS: 人物在场与称谓核查（入口 → 抽屉 → 本地规则状态 → 条目 → 别名口径）链路 OK')
} finally {
  await fetch(CDP + '/json/close/' + tab.id)
  page.close()
}
