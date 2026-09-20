// 织卷无头冒烟 · Workspace 加载态骨架化（体验层 2026-09-21，配合 devShim ?zj-delay= 延迟注入）
// 验证：loading/error/项目未知三态 SectionNav 常驻（项目名/计数徽标骨架占位，HIG Layout remain familiar），
//       内容区占位（spinner+文案 / 错误卡+重试），加载完成后布局零移位（aside 宽度不变、骨架消失、真实计数出现）。
// 用法：node scripts/workspace-loading-ui-smoke.mjs
// 前置：node scripts/serve-renderer.mjs（已 build）；本机专用无头 Chrome CDP 127.0.0.1:9224
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
    await sleep(250)
  }
}

const bodyHas = (t) => `document.body.innerText.includes(${JSON.stringify(t)})`
// aside 常驻断言：六个板块标签齐全
const navOk = `(() => {
  const aside = document.querySelector('aside')
  if (!aside) return false
  const t = aside.innerText
  return ['正文创作','人物设定','世界观设定','大纲区','时间线','素材库','设置','返回项目列表'].every((s) => t.includes(s))
})()`
const countSkels = `document.querySelectorAll('[data-testid="zs-nav-count-skeleton"]').length`
const nameSkel = `!!document.querySelector('[data-testid="zs-nav-name-skeleton"]')`

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

// ① 加载态：SectionNav 常驻 + 骨架占位 + 内容区 spinner；完成后布局稳定零移位
await step('① 加载态骨架与完成态布局稳定', async () => {
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '&zj-delay=listProjects:1500#/project/demo-aseya/novel')
  const page = await attach(tab.webSocketDebuggerUrl)
  // 等骨架出现（listProjects 被延迟 1.5s，loading 是稳态）
  await evalUntil(page, navOk, Boolean, 20000, 'nav during loading')
  await evalUntil(page, nameSkel, Boolean, 8000, 'name skeleton')
  const skelCount = await page.eval(countSkels)
  if (skelCount !== 5) throw new Error('count skeleton = ' + skelCount + ' (expect 5)')
  if (!(await page.eval(bodyHas('正在打开项目')))) throw new Error('loading text missing')
  if (await page.eval(bodyHas('雾港'))) throw new Error('project name shown too early')
  const wLoading = await page.eval(`document.querySelector('aside').getBoundingClientRect().width`)
  if (Math.round(wLoading) !== 240) throw new Error('aside width loading = ' + wLoading)
  // 完成态
  await evalUntil(page, bodyHas('雾港'), Boolean, 20000, 'project loaded')
  await sleep(500)
  if (!(await page.eval(navOk))) throw new Error('nav missing after load')
  if (await page.eval(nameSkel)) throw new Error('name skeleton still present')
  if (await page.eval(countSkels)) throw new Error('count skeleton still present')
  if (await page.eval(bodyHas('正在打开项目'))) throw new Error('loading text still present')
  const wReady = await page.eval(`document.querySelector('aside').getBoundingClientRect().width`)
  if (Math.round(wReady) !== 240) throw new Error('aside width ready = ' + wReady)
  // 真实计数徽标出现（任一数字徽标）
  const realBadge = await page.eval(`(() => {
    const aside = document.querySelector('aside')
    return [...aside.querySelectorAll('span')].some((s) => /^\\d+$/.test(s.textContent.trim()))
  })()`)
  if (!realBadge) throw new Error('real count badge missing')
  page.close()
})

// ② 错误态：导航常驻 + 错误卡；重试 → 过渡骨架 → 恢复
await step('② 错误态导航常驻与重试恢复', async () => {
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '&zj-delay=listProjects:1500&zj-fail=listProjects#/project/demo-aseya/novel')
  const page = await attach(tab.webSocketDebuggerUrl)
  await evalUntil(page, bodyHas('打开项目失败'), Boolean, 20000, 'error card')
  if (!(await page.eval(navOk))) throw new Error('nav missing during error')
  if (!(await page.eval(nameSkel))) throw new Error('name skeleton missing during error')
  // 重试（重试的 listProjects 再次延迟 1.5s → 过渡骨架稳态可断言）
  await page.eval(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('重试'))
    if (!b) return 'NO_BTN'
    b.click()
    return 'OK'
  })()`)
  await evalUntil(page, bodyHas('正在打开项目'), Boolean, 8000, 'loading after retry')
  if (!(await page.eval(nameSkel))) throw new Error('name skeleton missing during retry loading')
  await evalUntil(page, bodyHas('雾港'), Boolean, 20000, 'recovered after retry')
  if (!(await page.eval(navOk))) throw new Error('nav missing after retry')
  page.close()
})

console.log(`\n${pass} PASS / ${fail} FAIL`)
process.exit(fail ? 1 : 0)
