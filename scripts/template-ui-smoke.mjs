// 织卷无头验证 · 项目模板 UI 冒烟：新建项目对话框出现「初始内容」选择 → 选「示例」→ 创建进入项目页
// 用法：npm run build && node scripts/serve-renderer.mjs 8123 &
//       node scripts/template-ui-smoke.mjs    （CDP 127.0.0.1:9224 需在跑）
const BASE = process.env.ZJ_SMOKE_BASE || 'http://127.0.0.1:8123'
const CB = Date.now()

async function newTab() {
  const res = await fetch(`http://127.0.0.1:9224/json/new?${encodeURIComponent(`${BASE}/?cb=${CB}`)}`, { method: 'PUT' })
  return res.json()
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl)
  let seq = 0
  const pending = new Map()
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m)
      pending.delete(m.id)
    }
  }
  const cmd = (method, params = {}) =>
    new Promise((res, rej) => {
      const id = ++seq
      pending.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)))
      ws.send(JSON.stringify({ id, method, params }))
    })
  return new Promise((r) => ws.onopen ? r({ ws, cmd }) : (ws.onopen = () => r({ ws, cmd })))
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitFor(page, js, timeout = 15000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    const r = await page.cmd('Runtime.evaluate', { expression: js, returnByValue: true })
    if (r.result?.value) return true
    await sleep(300)
  }
  return false
}

async function evalJs(page, js) {
  const r = await page.cmd('Runtime.evaluate', { expression: js, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error('eval error: ' + JSON.stringify(r.exceptionDetails).slice(0, 300))
  return r.result?.value
}

let failures = 0
function check(name, cond) {
  console.log((cond ? '✅' : '❌') + ' ' + name)
  if (!cond) failures++
}

const tab = await newTab()
const page = await connect(tab.webSocketDebuggerUrl)
await page.cmd('Page.enable')
await page.cmd('Runtime.enable')
await page.cmd('Page.navigate', { url: `${BASE}/?cb=${CB}` })
await page.cmd('Runtime.enable')

// 1. 首页加载（devShim 挂上 __ZJ_TEST）
check('首页加载完成（devShim）', await waitFor(page, `!!window.__ZJ_TEST && !!document.querySelector('button')`))
check('首页有「新建项目」按钮', (await evalJs(page, `document.body.innerText.includes('新建项目')`)) === true)

// 2. 打开新建项目对话框
await evalJs(page, `[...document.querySelectorAll('button')].find(b => b.textContent.includes('新建项目'))?.click()`)
check('对话框弹出（含「初始内容」标签）', await waitFor(page, `document.body.innerText.includes('初始内容（可选）')`))

// 3. 初始内容下拉：空白 + 示例
const trigger = `document.querySelector('button[role="combobox"]')`
check('存在模板选择下拉触发器', (await evalJs(page, `!!${trigger}`)) === true)
await evalJs(page, `${trigger}.click()`)
await sleep(400)
const opts = await evalJs(page, `[...document.querySelectorAll('[role="option"]')].map(o => o.textContent)`)
check(`下拉含「空白（仅目录骨架）」与「示例（示例）」（实际：${opts.join(' | ')}）`, opts.some((t) => t.includes('空白')) && opts.some((t) => t.includes('示例')))

// 4. 选「示例」
await evalJs(page, `[...document.querySelectorAll('[role="option"]')].find(o => o.textContent.includes('示例'))?.click()`)
await sleep(400)
check('选中后触发器显示「示例（示例）」', (await evalJs(page, `${trigger}.textContent`))?.includes('示例') === true)

// 5. 填项目名并创建
await evalJs(page, `document.querySelector('input[placeholder*="山那边"]')?.focus()`)
await page.cmd('Input.insertText', { text: '模板冒烟项目' })
await sleep(200)
await evalJs(page, `[...document.querySelectorAll('button')].find(b => b.textContent.includes('创建并进入'))?.click()`)

check('跳转到项目页（/project/:id/novel）', await waitFor(page, `location.hash.startsWith('#/project/') && location.hash.endsWith('/novel')`))
check('项目页侧栏出现（人物设定/世界观设定）', await waitFor(page, `document.body.innerText.includes('人物设定')`))

// 6. 控制台无致命错误（React 崩溃会整棵树空掉，这里以页面关键文本仍在为准）
check('页面仍渲染完整（项目名在顶栏）', await waitFor(page, `document.body.innerText.includes('模板冒烟项目')`))

console.log(failures === 0 ? 'TEMPLATE UI SMOKE OK' : `TEMPLATE UI SMOKE FAILED: ${failures}`)
process.exit(failures === 0 ? 0 : 1)
