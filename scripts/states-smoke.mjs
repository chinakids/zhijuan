// 织卷无头冒烟 · 读取失败/动作失败反馈（体验层 2026-09-11，配合 devShim ?zj-fail= 一次性瞬态失败）
// 用法：node scripts/states-smoke.mjs
// 前置：node scripts/serve-renderer.mjs；本机专用无头 Chrome CDP 127.0.0.1:9224
// 验收点：
// ① 首页 ?zj-fail=listProjects → 「读取项目库失败」卡 + 重试 → 项目列表出现
// ② 项目页 ?zj-fail=listProjects → 「打开项目失败」+ 重试 → 恢复进入正文页
// ③ 正文页 ?zj-fail=listChapters → 「读取章节失败」+ 重试 → 章节列表出现
// ④ 正文页 ?zj-fail=readDoc → 点开第01章 → 「读取文档失败」+ 重试 → 编辑器加载正文
// ⑤ 人物页 ?zj-fail=listDocs → 「读取失败」+ 重试 → 档案列表出现
// ⑥ 首页 ?zj-fail=createProject → 新建项目 → toast「新建项目失败」
// ⑦–⑪（体验层 2026-09-11 11:15 轮）素材库/大纲/时间线/设置读取失败卡+重试；空白项目空态「新建第一章」直达按钮
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

async function clickText(page, text, scope) {
  const r = await page.eval(`(() => {
    const roots = ${scope ? `[...document.querySelectorAll(${JSON.stringify(scope)})]` : '[document]'}
    const el = roots.flatMap((root) => [...root.querySelectorAll('button')]).find((b) => b.textContent.includes(${JSON.stringify(text)}))
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

// ① 首页读取失败 → 错误卡 → 重试恢复
await step('① 首页 listProjects 失败与重试', async () => {
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '&zj-fail=listProjects#/')
  const page = await attach(tab.webSocketDebuggerUrl)
  await evalUntil(page, bodyHas('读取项目库失败'), Boolean, 20000, 'error card')
  await clickText(page, '重试')
  await evalUntil(page, bodyHas('余烬的灯'), Boolean, 20000, 'project list after retry')
  page.close()
})

// ② 项目页打开失败 → 重试恢复进入正文
await step('② 项目页 listProjects 失败与重试', async () => {
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '&zj-fail=listProjects#/project/demo-aseya/novel')
  const page = await attach(tab.webSocketDebuggerUrl)
  await evalUntil(page, bodyHas('打开项目失败'), Boolean, 20000, 'workspace error')
  await clickText(page, '重试')
  await evalUntil(page, bodyHas('雾港'), Boolean, 20000, 'novel loaded after retry')
  page.close()
})

// ③ 正文页章节列表持续失败 → 错误卡（Workspace 计数先行吞掉一次，zj-fail-x 保证页面层必然复现）
await step('③ 正文页 listChapters 错误卡', async () => {
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '&zj-fail-x=listChapters#/project/demo-aseya/novel')
  const page = await attach(tab.webSocketDebuggerUrl)
  await evalUntil(page, bodyHas('读取章节失败'), Boolean, 20000, 'chapter error')
  page.close()
})

// ④ 正文读取失败 → 点开章节 → 错误卡 → 重试 → 编辑器加载
await step('④ DocEditor readDoc 失败与重试', async () => {
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '&zj-fail=readDoc#/project/demo-aseya/novel')
  const page = await attach(tab.webSocketDebuggerUrl)
  await evalUntil(page, bodyHas('雾港'), Boolean, 20000, 'chapters listed')
  await clickText(page, '雾港', 'aside.w-60')
  await evalUntil(page, bodyHas('读取文档失败'), Boolean, 20000, 'doc read error')
  await clickText(page, '重试')
  await evalUntil(page, bodyHas('雨把港口淋成一片灰'), Boolean, 20000, 'editor content after retry')
  page.close()
})

// ⑤ 人物页列表持续失败 → 错误卡（Workspace 计数先行吞掉一次，zj-fail-x 保证页面层必然复现）
await step('⑤ 人物页 listDocs 错误卡', async () => {
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '&zj-fail-x=listDocs#/project/demo-aseya/characters')
  const page = await attach(tab.webSocketDebuggerUrl)
  await evalUntil(page, bodyHas('读取失败'), Boolean, 20000, 'docs error')
  page.close()
})

// ⑥ 首页新建项目失败 → toast
await step('⑥ 首页 createProject 失败 toast', async () => {
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '&zj-fail=createProject#/')
  const page = await attach(tab.webSocketDebuggerUrl)
  await evalUntil(page, bodyHas('新建项目'), Boolean, 20000, 'home shell')
  await clickText(page, '新建项目')
  await sleep(400)
  await setInput(page, 'input[placeholder*="山那边"]', '测试失败项目')
  await sleep(200)
  await clickText(page, '创建并进入')
  await evalUntil(page, bodyHas('新建项目失败'), Boolean, 20000, 'toast error')
  page.close()
})

// ⑦ 素材库读取失败 → 错误卡 → 重试恢复（listLibraryCategories 不被 Workspace 吞，zj-fail 一次足矣）
await step('⑦ 素材库 listLibraryCategories 失败与重试', async () => {
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '&zj-fail=listLibraryCategories#/project/demo-aseya/library')
  const page = await attach(tab.webSocketDebuggerUrl)
  await evalUntil(page, bodyHas('读取素材库失败'), Boolean, 20000, 'library error card')
  await clickText(page, '重试')
  await evalUntil(page, bodyHas('桥段'), Boolean, 20000, 'library recovered')
  page.close()
})

// ⑧ 大纲读取失败 → 错误卡（listChapters 被 Workspace 计数先吞一次，用 zj-fail-x 保证页面层复现）
await step('⑧ 大纲 listChapters 错误卡', async () => {
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '&zj-fail-x=listChapters#/project/demo-aseya/outline')
  const page = await attach(tab.webSocketDebuggerUrl)
  await evalUntil(page, bodyHas('读取章卡失败'), Boolean, 20000, 'outline error card')
  await clickText(page, '重试')
  await sleep(400)
  await evalUntil(page, bodyHas('读取章卡失败'), Boolean, 20000, 'outline error persists')
  page.close()
})

// ⑨ 时间线读取失败 → 错误卡 → 重试恢复（listSlices 不被 Workspace 吞，zj-fail 一次足矣）
await step('⑨ 时间线 listSlices 失败与重试', async () => {
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '&zj-fail=listSlices#/project/demo-aseya/timeline')
  const page = await attach(tab.webSocketDebuggerUrl)
  await evalUntil(page, bodyHas('读取时间线失败'), Boolean, 20000, 'timeline error card')
  await clickText(page, '重试')
  await evalUntil(page, bodyHas('第一幕_雾港之夜'), Boolean, 20000, 'timeline recovered')
  page.close()
})

// ⑩ 设置读取失败 → 错误卡（Settings 页自身 useEffect 会再调一次 loadSettings，一次性失败会被吞，故用 zj-fail-x）
await step('⑩ 设置 getSettings 错误卡', async () => {
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '&zj-fail-x=getSettings#/project/demo-aseya/settings')
  const page = await attach(tab.webSocketDebuggerUrl)
  await evalUntil(page, bodyHas('读取设置失败'), Boolean, 20000, 'settings error card')
  await clickText(page, '重试')
  await sleep(400)
  await evalUntil(page, bodyHas('读取设置失败'), Boolean, 20000, 'settings error persists')
  page.close()
})

// ⑪ 空白项目正文空态 → 「新建第一章」直达按钮 → 打开建章对话框
await step('⑪ 空白项目空态新建第一章按钮', async () => {
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-blank/novel')
  const page = await attach(tab.webSocketDebuggerUrl)
  await evalUntil(page, bodyHas('还没有章节'), Boolean, 20000, 'empty state')
  await clickText(page, '新建第一章', 'aside.w-60')
  await evalUntil(page, bodyHas('新建章节'), Boolean, 20000, 'create dialog')
  page.close()
})

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
