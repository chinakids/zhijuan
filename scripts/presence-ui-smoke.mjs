// 织卷无头冒烟 · 人物在场与称谓核查：审计抽屉「在场」Tab（devShim 演示数据）
// 用法：node scripts/presence-ui-smoke.mjs
// 前置：node scripts/serve-renderer.mjs 8123；本机专用无头 Chrome CDP 127.0.0.1:9224
// 验收点：① 选中章后编辑器下方「规则体检」状态栏出现（F-20260916-05：本地规则入口已从 Agent 检查菜单迁来）；
//         ② 点盾牌打开抽屉 → 切「在场」Tab（标题=人物在场核查）；③ 状态行显示「本地规则核查：共列 1 条」；
//         ④ 演示条目（清单列了却未署名出场）渲染；⑤ 演示摘要口径含「档案登记的别名参与匹配」（别名约定已生效的文案证据）。
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

// F-20260916-05：本地规则 7 项入口=编辑器下方「规则体检」状态栏（HealthBar）——选中章 → 点盾牌 → 抽屉 → 切目标 Tab
const zjHealthOpen = async (page, tabText, titlePart, timeoutMs = 10000) => {
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

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel')
console.log('TAB:', tab.id, tab.url)
const page = await attach(tab.webSocketDebuggerUrl)

try {
  await evalUntil(page, `document.body.innerText.includes('Agent') && document.body.innerText.includes('第1章')`, (v) => v === true, 20000, '正文页就绪')
  console.log('OK 正文页就绪')

  // ① 本地规则入口=编辑器下方「规则体检」状态栏（F-20260916-05）：选中章 → 点盾牌 → 抽屉 → 切「在场」Tab
  await zjHealthOpen(page, '在场', '人物在场核查')
  console.log('OK 抽屉打开（标题=人物在场核查）')

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
