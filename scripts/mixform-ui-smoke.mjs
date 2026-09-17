// 织卷无头冒烟 · 称谓混用核查（devShim 真算命中路径）：Agent 面板新按钮 → 抽屉打开 →
// 演示项目第03章（沈藏/沈爷 叙述层交替 3 次）命中 1 条 → 条目渲染（转提案/让 agent 改入口齐全）→ 转提案置态。
// 命中判据细节（分隔/归属/单字名）由 unit/nameMix.test.ts + mixform-data-smoke.mjs 覆盖，此处验证 UI 接线。
// 用法：node scripts/mixform-ui-smoke.mjs
// 前置：npm run build 后 node scripts/serve-renderer.mjs（SPA fallback，127.0.0.1:8899）；本机专用无头 Chrome CDP 127.0.0.1:9224
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8899'
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
const check = (name, cond) => {
  if (!cond) throw new Error('断言失败: ' + name)
  pass++
  console.log('  ✓ ' + name)
}

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel')
console.log('TAB:', tab.id, tab.url)
const page = await attach(tab.webSocketDebuggerUrl)

try {
  await evalUntil(page, `document.body.innerText.includes('Agent') && document.body.innerText.includes('第1章')`, (v) => v === true, 20000, '正文页就绪')
  console.log('OK 正文页就绪')

  // ① 本地规则入口=编辑器下方「规则体检」状态栏（F-20260916-05）：选中章 → 点盾牌 → 抽屉 → 切「混用」Tab
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
  await zjHealthOpen(page, '混用', '称谓混用核查')
  console.log('OK 抽屉打开（标题=称谓混用核查）')

  // ③ 结果 summary + 命中条目渲染（第03章 沈藏/沈爷 交替 → 1 条）
  await evalUntil(page, `document.body.innerText.includes('本地规则核查') && document.body.innerText.includes('交替')`, (v) => v === true, 15000, 'mixform 结果渲染')
  const txt = await page.eval(`document.body.innerText`)
  check('summary 命中口径（发现 1 章/交替）', txt.includes('发现 1 章') && txt.includes('交替'))
  check('条目渲染：变体/交替次数/交替处上下文/若并非刻意', txt.includes('「沈爷」「沈藏」') && txt.includes('交替 3 次') && txt.includes('交替处') && txt.includes('若并非刻意'))
  check('条目渲染：where=第03章 + suggest 别名登记路径', txt.includes('正文/第03章_码头.md') && txt.includes('人物/沈藏.md'))
  check('处置入口齐备（转提案 + 让 agent 改）', txt.includes('转提案') && txt.includes('让 agent 改'))

  // ④ 点「转提案」→ 该条置「已建提案」（target=人物/沈藏.md 生效）
  console.log('点转提案:', await page.eval(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '转提案')
    if (!b) return 'NOT_FOUND'
    b.click()
    return 'CLICKED'
  })()`))
  await evalUntil(page, `document.body.innerText.includes('已建提案')`, (v) => v === true, 10000, '转提案置态')
  check('转提案后条目置「已建提案」', true)

  // ⑤ 点遮罩关闭抽屉（重跑路径）无 JS 异常
  console.log('关闭:', await page.eval(`(() => {
    const m = document.querySelector('div.fixed.inset-0.z-40')
    if (!m) return 'NOT_FOUND'
    m.click()
    return 'CLICKED'
  })()`))
  await evalUntil(page, `!document.body.innerText.includes('称谓混用核查')`, (v) => v === true, 8000, '抽屉关闭')

  console.log(`\n全部通过：${pass} 断言`)
} finally {
  page.close()
}
