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

  // ① 本地规则入口=编辑器下方「规则体检」状态栏（F-20260916-05）：选中章 → 点盾牌 → 抽屉 → 切「档案」Tab
  const zjHealthOpen = async (page, tabText, titlePart, timeoutMs = 15000) => {
    await page.eval(`(() => {
      const cand = [...document.querySelectorAll('button')].find((b) => /第.{1,6}章/.test((b.innerText || '')))
      if (!cand) return 'NO_CHAPTER'
      cand.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
      cand.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }))
      cand.click()
      return 'OK'
    })()`)
    await evalUntil(page, `!!document.querySelector('[data-testid="health-bar"]')`, (v) => v === true, 15000, '规则体检状态栏出现')
    await evalUntil(page, `!!document.querySelector('[data-testid="health-icon-issues"]') || !!document.querySelector('[data-testid="health-icon-ok"]')`, (v) => v === true, 30000, '体检完成')
    await page.eval(`document.querySelector('[data-testid="health-status"]').click()`)
    await evalUntil(page, `!!document.querySelector('[role="dialog"]')`, (v) => v === true, 10000, '抽屉打开')
    await sleep(400)
    const r = await page.eval(`(() => {
      const sel = document.querySelector('[data-testid="audit-kind-select"]')
      if (!sel) return 'NO_SELECT'
      sel.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
      sel.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }))
      sel.click()
      return 'OK'
    })()`)
    if (r !== 'OK') throw new Error('开切换菜单失败: ' + r)
    await sleep(600)
    const r2 = await page.eval(`(() => {
      const b = [...document.querySelectorAll('[role="menuitem"]')].find((x) => (x.textContent || '').trim() === ${JSON.stringify(tabText)})
      if (!b) return 'NO_TAB'
      b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
      b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }))
      b.click()
      return 'OK'
    })()`)
    if (r2 !== 'OK') throw new Error('切 Tab 失败: ' + r2 + '（' + tabText + '）')
    await evalUntil(page, `document.body.innerText.includes(${JSON.stringify(titlePart)})`, (v) => v === true, timeoutMs, '抽屉标题出现: ' + titlePart)
  }
  await zjHealthOpen(page, '档案', '人物档案腐坏核查')
  console.log('OK 抽屉打开（标题=人物档案腐坏核查）')

  // ③ 状态行：本地规则核查：共列 1 条（零模型·秒级）
  await evalUntil(page, `document.body.innerText.includes('本地规则核查：共列 1 条')`, (v) => v === true, 10000, '本地规则状态行')
  console.log('OK 状态行「本地规则核查：共列 1 条」')

  // ④ 演示条目（沈老爹 = 登记但全卷未出现的冗余别名）渲染 + 「让 agent 改」入口
  await evalUntil(page, `document.body.innerText.includes('沈老爹')`, (v) => v === true, 10000, '条目渲染')
  const hasItems = await page.eval(`document.body.innerText.includes('从未出现') && document.body.innerText.includes('让 agent 改')`)
  if (!hasItems) throw new Error('条目未渲染（缺 从未出现/让 agent 改）')
  console.log('OK 演示条目渲染（冗余别名 沈老爹，含「让 agent 改」入口）')

  // ⑤ 抽屉内当前项=切换触发器「档案」，开菜单切「在场」再切回「档案」标题随切（18fd703 下拉化）
  const curTab = await page.eval(`document.querySelector('[data-testid="audit-kind-select"]')?.textContent?.trim() ?? 'NOT_FOUND'`)
  if (curTab !== '档案') throw new Error('当前项应为「档案」: ' + curTab)
  console.log('OK 触发器显示「档案」')
  await page.eval(`(() => { const s = document.querySelector('[data-testid="audit-kind-select"]'); if (!s) return; s.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' })); s.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' })); s.click() })()`)
  await sleep(600)
  console.log('切到「在场」:', await page.eval(`(() => {
  const b = [...document.querySelectorAll('[role="menuitem"]')].find((x) => (x.textContent || '').trim() === '在场')
  if (!b) return 'NO_ITEM'
  b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
  b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }))
  b.click()
  return 'OK'
})()`))
  await evalUntil(page, `document.body.innerText.includes('人物在场核查')`, (v) => v === true, 10000, '切到在场')
  console.log('OK 切成「在场」')
  await page.eval(`(() => { const s = document.querySelector('[data-testid="audit-kind-select"]'); if (!s) return; s.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' })); s.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' })); s.click() })()`)
  await sleep(600)
  console.log('切回「档案」:', await page.eval(`(() => {
  const b = [...document.querySelectorAll('[role="menuitem"]')].find((x) => (x.textContent || '').trim() === '档案')
  if (!b) return 'NO_ITEM'
  b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
  b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }))
  b.click()
  return 'OK'
})()`))
  await evalUntil(page, `document.body.innerText.includes('人物档案腐坏核查')`, (v) => v === true, 10000, '切回档案')
  console.log('OK 切回「档案」')

  console.log('\nPASS: 人物档案腐坏核查（入口 → 抽屉 → 本地规则状态 → 冗余别名条目 → Tab 切换）链路 OK')
} finally {
  await fetch(CDP + '/json/close/' + tab.id)
  page.close()
}
