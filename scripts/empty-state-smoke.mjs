// 织卷无头冒烟 · 空态统一版式（体验层 2026-09-11，V-05 空态插画）
// 用法：node scripts/empty-state-smoke.mjs
// 前置：node scripts/serve-renderer.mjs；本机专用无头 Chrome CDP 127.0.0.1:9224
// 验收点（devShim ?zj-empty= 场景注入；真机空态是同一套 React 组件）：
// ① 首页 zj-empty=projects → empty-projects 版式（插图 library + 标题 + 说明 + 新建按钮）→ 点击弹「新建项目」
// ② 首页有项目 → 搜索无匹配 → empty-search（插图 search）→ 清空恢复列表
// ③ 正文页 zj-empty=chapters → empty-chapters（紧凑版 + 新建第一章按钮）→ 点击弹新建章节
// ④ 人物页 zj-empty=docs:人物 → empty-docs（紧凑版，保留原说明文案）
// ⑤ 世界观页 zj-empty=docs:世界观 → empty-docs
// ⑥ 时间线 zj-empty=timeline → empty-timeline（插图 timeline + 标题）
// ⑦ 大纲页 zj-empty=docs:大纲 → 主区 empty-outline（插图 outline）
// ⑧ 素材库 zj-empty=library → empty-materials（紧凑版）
// ⑨ 主题跟随：empty-projects 切 .dark 后插图底色 computed 变化且仍半透明（无硬编码色）
// ⑩ narrow viewport：小窗下空态不横向溢出（scrollWidth <= clientWidth + 1）
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

const has = (sel) => `document.querySelector(${JSON.stringify(sel)}) !== null`
const bodyHas = (t) => `document.body.innerText.includes(${JSON.stringify(t)})`

async function clickText(page, text) {
  const r = await page.eval(`(() => {
    const el = [...document.querySelectorAll('button')].find((b) => b.textContent.includes(${JSON.stringify(text)}))
    if (!el) return 'NO_BTN'
    el.click()
    return 'OK'
  })()`)
  if (r !== 'OK') throw new Error('clickText failed: ' + r + ' for ' + text)
}

async function setInput(page, selector, value) {
  await page.eval(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (!el) return 'NO_INPUT'
    el.focus()
    const proto = Object.getPrototypeOf(el)
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
    setter.call(el, ${JSON.stringify(value)})
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    return el.value
  })()`)
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

const artOf = (v) => `document.querySelector('svg[data-zj-art=${JSON.stringify(v)}]') !== null`

// ① 首页无项目
await step('① 首页空项目版式+新建按钮', async () => {
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '&zj-empty=projects#/')
  const page = await attach(tab.webSocketDebuggerUrl)
  await evalUntil(page, has('[data-testid="empty-projects"]'), Boolean, 20000, 'empty-projects')
  const art = await page.eval(artOf('library'))
  if (!art) throw new Error('art=library missing')
  const hasBtn = await page.eval(bodyHas('新建项目'))
  if (!hasBtn) throw new Error('新建项目 button missing')
  await clickText(page, '新建项目')
  await evalUntil(page, has('[role="dialog"]'), Boolean, 8000, 'create dialog')
  page.close()
})

// ② 搜索无结果
await step('② 首页搜索无匹配空态', async () => {
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/')
  const page = await attach(tab.webSocketDebuggerUrl)
  await evalUntil(page, `${has('[data-testid="empty-search"]')} === false && ${bodyHas('余烬的灯')}`, Boolean, 20000, 'project list')
  await setInput(page, 'input[type="search"]', 'zzz不存在的项目xyz')
  await evalUntil(page, has('[data-testid="empty-search"]'), Boolean, 10000, 'empty-search')
  const art = await page.eval(artOf('search'))
  if (!art) throw new Error('art=search missing')
  await setInput(page, 'input[type="search"]', '')
  await evalUntil(page, `${has('[data-testid="empty-search"]')} === false`, Boolean, 10000, 'list restored')
  page.close()
})

// ③ 正文页无章节
await step('③ 正文页无章节空态+新建第一章', async () => {
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '&zj-empty=chapters#/project/demo-aseya/novel')
  const page = await attach(tab.webSocketDebuggerUrl)
  await evalUntil(page, has('[data-testid="empty-chapters"]'), Boolean, 20000, 'empty-chapters')
  const noArt = await page.eval(has('svg[data-zj-art]'))
  if (noArt) throw new Error('compact 模式不应有插图')
  await clickText(page, '新建第一章')
  await evalUntil(page, has('[role="dialog"]'), Boolean, 8000, 'create chapter dialog')
  page.close()
})

// ④ 人物页无档案
await step('④ 人物页无档案空态', async () => {
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '&zj-empty=docs:人物#/project/demo-aseya/characters')
  const page = await attach(tab.webSocketDebuggerUrl)
  await evalUntil(page, has('[data-testid="empty-docs"]'), Boolean, 20000, 'empty-docs')
  const hint = await page.eval(`document.querySelector('[data-testid="empty-docs"]')?.innerText || ''`)
  if (!hint.includes('还没有人物档案')) throw new Error('人物空态文案缺失: ' + hint)
  page.close()
})

// ⑤ 世界观页无设定
await step('⑤ 世界观页无设定空态', async () => {
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '&zj-empty=docs:世界观#/project/demo-aseya/worldview')
  const page = await attach(tab.webSocketDebuggerUrl)
  await evalUntil(page, has('[data-testid="empty-docs"]'), Boolean, 20000, 'empty-docs')
  const hint = await page.eval(`document.querySelector('[data-testid="empty-docs"]')?.innerText || ''`)
  if (!hint.includes('还没有设定文档')) throw new Error('世界观空态文案缺失: ' + hint)
  page.close()
})

// ⑥ 时间线空态
await step('⑥ 时间线空态', async () => {
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '&zj-empty=timeline#/project/demo-aseya/timeline')
  const page = await attach(tab.webSocketDebuggerUrl)
  await evalUntil(page, has('[data-testid="empty-timeline"]'), Boolean, 20000, 'empty-timeline')
  const art = await page.eval(artOf('timeline'))
  if (!art) throw new Error('art=timeline missing')
  const title = await page.eval(`document.querySelector('[data-testid="empty-timeline"]')?.innerText || ''`)
  if (!title.includes('还没有时间切片')) throw new Error('时间线空态标题缺失')
  page.close()
})

// ⑦ 大纲主区空态
await step('⑦ 大纲主区空态', async () => {
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '&zj-empty=docs:大纲#/project/demo-aseya/outline')
  const page = await attach(tab.webSocketDebuggerUrl)
  await evalUntil(page, has('[data-testid="empty-outline"]'), Boolean, 20000, 'empty-outline')
  const art = await page.eval(artOf('outline'))
  if (!art) throw new Error('art=outline missing')
  page.close()
})

// ⑧ 素材库无类别
await step('⑧ 素材库无类别空态', async () => {
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '&zj-empty=library#/project/demo-aseya/library')
  const page = await attach(tab.webSocketDebuggerUrl)
  await evalUntil(page, has('[data-testid="empty-materials"]'), Boolean, 20000, 'empty-materials')
  page.close()
})

// ⑨ 主题跟随（亮暗切换后插图底色变化、始终半透明无硬编码）
await step('⑨ 空态插图主题跟随', async () => {
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '&zj-empty=projects#/')
  const page = await attach(tab.webSocketDebuggerUrl)
  await evalUntil(page, has('[data-testid="empty-projects"]'), Boolean, 20000, 'empty-projects')
  const fillOf = `getComputedStyle(document.querySelector('svg[data-zj-art="library"] rect')).fill`
  const light = await page.eval(fillOf)
  if (!light || !light.includes('rgb')) throw new Error('light fill invalid: ' + light)
  await page.eval(`document.documentElement.classList.add('dark')`)
  await sleep(300)
  const dark = await page.eval(fillOf)
  if (!dark || !dark.includes('rgb')) throw new Error('dark fill invalid: ' + dark)
  if (light === dark) throw new Error('主题切换后插图底色未变化')
  page.close()
})

// ⑩ 窄窗口不溢出
await step('⑩ 窄窗口空态不横向溢出', async () => {
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '&zj-empty=projects#/')
  const page = await attach(tab.webSocketDebuggerUrl)
  await evalUntil(page, has('[data-testid="empty-projects"]'), Boolean, 20000, 'empty-projects')
  await page.cmd('Emulation.setDeviceMetricsOverride', { width: 420, height: 800, deviceScaleFactor: 1, mobile: false })
  await sleep(500)
  const ok = await page.eval(`document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1`)
  if (!ok) throw new Error('窄窗口横向溢出')
  await page.cmd('Emulation.clearDeviceMetricsOverride')
  page.close()
})

console.log('---')
console.log(`RESULT: pass=${pass} fail=${fail}`)
process.exit(fail ? 1 : 0)
