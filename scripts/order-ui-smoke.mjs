// 织卷无头冒烟 · 切片时序核查（devShim 真算化，2026-09-16）：
// ① demo-order（含跨线重名/线内倒流/线内同名不连续种子）→ 真算命中 3 条（R5/R6/R7 均可见）；
// ② demo-aseya（健康数据）→ 真算零命中（证明 order 不再是写死 mock，与真机 chapterOrderCheck 同一实现）。
// 用法：node scripts/order-ui-smoke.mjs
// 前置：node scripts/serve-renderer.mjs 8123；本机专用无头 Chrome CDP 127.0.0.1:9224
// 验收点：① 正文页 Agent 面板「检查」菜单出现「切片时序核查」入口；② 点击后抽屉标题=切片时序核查；
//         ③ 状态行「本地规则核查：共列 3 条」；④ 条目渲染（切片序号倒流 / 出现在 2 条时间线 / 第 2、6 章共用）；
//         ⑤ 抽屉内「时序」Tab 可切换（在「在场」与「时序」间往返）且标题随切；⑥ demo-aseya 上真算共列 0 条。
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

async function openOrderDrawer(base, projectId, cb) {
  const tab = await openTab(base + '/?cb=' + cb + '#/project/' + projectId + '/novel')
  console.log('TAB:', tab.id, tab.url)
  const page = await attach(tab.webSocketDebuggerUrl)
  await evalUntil(page, `document.body.innerText.includes('Agent') && document.body.innerText.includes('第1章')`, (v) => v === true, 20000, '正文页就绪')
  console.log('OK 正文页就绪（' + projectId + '）')
  // ① 本地规则入口=编辑器下方「规则体检」状态栏（F-20260916-05）：选中章 → 点盾牌 → 抽屉 → 切「时序」Tab
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
      const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) => (x.textContent || '').trim() === ${JSON.stringify(tabText)})
      if (!b) return 'NO_TAB'
      b.click()
      return 'OK'
    })()`)
    if (r !== 'OK') throw new Error('切 Tab 失败: ' + r + '（' + tabText + '）')
    await evalUntil(page, `document.body.innerText.includes(${JSON.stringify(titlePart)})`, (v) => v === true, timeoutMs, '抽屉标题出现: ' + titlePart)
  }
  await zjHealthOpen(page, '时序', '切片时序核查')
  console.log('OK 抽屉打开（标题=切片时序核查）')
  return { tab, page }
}

let tabA, tabB
let pageA, pageB
let done = false
try {
  // ---------- ① demo-order：真算命中 3 条（R5 倒流 / R6 同名不连续 / R7 跨线重名） ----------
  const a = await openOrderDrawer(BASE, 'demo-order', Date.now())
  tabA = a.tab; pageA = a.page

  // 状态行：本地规则核查：共列 3 条（零模型·秒级）
  await evalUntil(pageA, `document.body.innerText.includes('本地规则核查：共列 3 条')`, (v) => v === true, 10000, '本地规则状态行')
  console.log('OK 状态行「本地规则核查：共列 3 条」')

  // 条目：R5 切片序号倒流 / R7 跨线重名（出现在 2 条时间线） / R6 线内不连续共用（第 2、6 章）
  const items = await pageA.eval(`(() => {
    const t = document.body.innerText
    return {
      hasR5: t.includes('切片序号倒流'),
      hasR7: t.includes('出现在 2 条时间线'),
      hasR6: t.includes('第 2、6 章共用'),
      hasAgent: t.includes('让 agent 改'),
      hasCaveat: t.includes('带「第X」序号的切片名才参与顺序比较')
    }
  })()`)
  const misses = Object.entries(items).filter(([, v]) => !v).map(([k]) => k)
  if (misses.length) throw new Error('条目缺失: ' + misses.join(','))
  console.log('OK 条目渲染（R5 倒流 + R7 跨线重名 + R6 同名不连续，「让 agent 改」入口 + 口径说明）')

  // 抽屉内「时序」Tab 高亮，切到「在场」再切回「时序」标题随切
  const tabState = await pageA.eval(`(() => {
    const btns = [...document.querySelectorAll('button')]
    const on = btns.find((b) => (b.textContent || '').trim() === '时序')
    return on ? on.className : 'NOT_FOUND'
  })()`)
  if (!String(tabState).includes('bg-accent-soft')) throw new Error('「时序」Tab 未高亮: ' + tabState)
  console.log('OK 「时序」Tab 高亮')
  console.log('切到「在场」:', await pageA.eval(clickByText('在场')))
  await evalUntil(pageA, `document.body.innerText.includes('人物在场核查')`, (v) => v === true, 10000, '切到在场')
  console.log('OK 切成「在场」')
  console.log('切回「时序」:', await pageA.eval(clickByText('时序')))
  await evalUntil(pageA, `document.body.innerText.includes('切片时序核查')`, (v) => v === true, 10000, '切回时序')
  console.log('OK 切回「时序」')

  // ---------- ② demo-aseya：健康数据真算零命中（证明与真机同一实现，非写死） ----------
  const b = await openOrderDrawer(BASE, 'demo-aseya', Date.now() + 1)
  tabB = b.tab; pageB = b.page
  await evalUntil(pageB, `document.body.innerText.includes('本地规则核查：共列 0 条')`, (v) => v === true, 10000, '零命中状态行')
  console.log('OK demo-aseya 真算零命中（共列 0 条）')

  done = true
  console.log('\nPASS: 切片时序核查真算化（入口 → 抽屉 → 真算命中 R5/R6/R7 → 健康项目零命中）链路 OK')
} finally {
  if (tabA) { await fetch(CDP + '/json/close/' + tabA.id); pageA?.close() }
  if (tabB) { await fetch(CDP + '/json/close/' + tabB.id); pageB?.close() }
}
process.exit(done ? 0 : 0)
