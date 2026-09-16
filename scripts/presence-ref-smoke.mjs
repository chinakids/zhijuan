// 织卷无头冒烟 · 审读发现→agent 处置指路（refFile/target 结构化档案路径）
// 用法：node scripts/presence-ref-smoke.mjs
// 前置：node scripts/serve-renderer.mjs 8123；本机专用无头 Chrome CDP 127.0.0.1:9224
// 验收点：① 「在场」Tab 的 unlisted 别名命中（沈爷=沈藏登记别名）条目显示「关联档案：人物/沈藏.md」；
//         ② 点该条「让 agent 改」→ 对话区出现 user 消息，含「请处理下面这条审读发现」与「关联档案：人物/沈藏.md」；
//         ③ 「档案」Tab 的 unused 条目（沈老爹）带 target → 出现「转提案」按钮。
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

  // ① 打开「人物在场核查」抽屉（检查项已收进「检查」折叠菜单 3e0ec55：先开菜单再点项）
  console.log('打开检查菜单:', await page.eval(openCheckMenu()))
  await sleep(350)
  const entry = await page.eval(`[...document.querySelectorAll('[role="menuitem"]')].find((b) => (b.title || '').includes('人物在场与称谓核查'))?.title ?? 'NONE'`)
  console.log('入口:', entry)
  console.log('点击菜单项:', await page.eval(clickByTitle('人物在场与称谓核查（本地规则·秒级）')))
  await evalUntil(page, `document.body.innerText.includes('人物在场与称谓核查')`, (v) => v === true, 10000, '在场抽屉打开')
  console.log('OK 在场抽屉打开')

  // ② unlisted 别名命中条目显示关联档案（refFile=人物/沈藏.md）
  await evalUntil(page, `document.body.innerText.includes('沈爷')`, (v) => v === true, 10000, '沈爷条目渲染')
  const refShown = await page.eval(`document.body.innerText.includes('关联档案：人物/沈藏.md')`)
  if (!refShown) throw new Error('条目未显示「关联档案：人物/沈藏.md」')
  console.log('OK 别名命中条目带「关联档案：人物/沈藏.md」')

  // ③ 点该条「让 agent 改」→ 对话区出现含路径的用户消息
  // （定位「别名命中」卡片本身：第04章 missing 条目提示里也含「沈爷」，须按「这是「沈藏」档案登记的别名」唯一标记筛）
  const clicked = await page.eval(`(() => {
    const card = [...document.querySelectorAll('div.rounded-lg')].find((d) => (d.textContent || '').includes('这是「沈藏」档案登记的别名'))
    if (!card) return 'NO_CARD'
    const btn = [...card.querySelectorAll('button')].find((b) => (b.textContent || '').includes('让 agent 改'))
    if (!btn) return 'NO_BTN'
    btn.click()
    return 'CLICKED'
  })()`)
  console.log('让 agent 改:', clicked)
  await evalUntil(page, `document.body.innerText.includes('请处理下面这条审读发现')`, (v) => v === true, 10000, '用户消息出现')
  const agentMsg = await page.eval(`document.body.innerText.includes('关联档案：人物/沈藏.md')`)
  if (!agentMsg) throw new Error('agent 指令未包含关联档案路径')
  console.log('OK 「让 agent 改」指令含「关联档案：人物/沈藏.md」')

  // ④ 「档案」Tab：unused 条目（沈老爹）带 target → 出现「转提案」按钮（抽屉已被「让 agent 改」关闭，须重新开检查菜单点项）
  console.log('打开检查菜单:', await page.eval(openCheckMenu()))
  await sleep(350)
  console.log('点击菜单项:', await page.eval(clickByTitle('人物档案腐坏核查（本地规则·秒级）')))
  await evalUntil(page, `document.body.innerText.includes('人物档案腐坏核查')`, (v) => v === true, 10000, '档案抽屉打开')
  await evalUntil(page, `document.body.innerText.includes('沈老爹')`, (v) => v === true, 10000, '沈老爹条目')
  const hasProposal = await page.eval(`document.body.innerText.includes('转提案')`)
  if (!hasProposal) throw new Error('unused 条目未出现「转提案」按钮（target 未生效）')
  console.log('OK unused 条目有「转提案」（target=人物/沈藏.md 生效）')

  console.log('\nPASS: 审读发现→agent 处置指路（refFile 显示 + 指令带路径 + unused 转提案）链路 OK')
} finally {
  await fetch(CDP + '/json/close/' + tab.id)
  page.close()
}
