// 织卷无头冒烟 · 首页「导入已有目录」对话框（平台层 2026-09-11 13:30 轮）
// 前置：node scripts/serve-renderer.mjs（8123）+ 本机无头 Chrome CDP 127.0.0.1:9224
// 验收点：
// ① 打开 Home → 「导入目录」按钮 → 对话框（标题/说明/路径输入/「选择文件夹…」按钮）
// ② 输入路径 → 点「导入」→ devShim 结构化返回 ok+copied → toast「已导入「xxx」」+ 跳转 #/project/…
// ③ ?zj-fail=importProject → 导入 → toast「导入失败」（错误路径不崩）
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

let fails = 0
const check = (name, cond) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name); if (!cond) fails++ }

// —— 打开 Home（带缓存破坏参数） ——
const tab = await openTab(BASE + '/?cb=import' + Date.now() + '#/')
const page = await attach(tab.webSocketDebuggerUrl)
await evalUntil(page, `document.querySelector('body')?.innerText.includes('织卷')`, (v) => v === true, 20000, 'Home 渲染')
// devShim 模式（无 window.zhijuan 真 IPC）就绪
await evalUntil(page, `typeof window.__ZJ_TEST !== 'undefined'`, (v) => v === true, 10000, 'devShim 就绪')

// ① 打开导入对话框
await page.eval(`(() => { const btns = [...document.querySelectorAll('button')]; const b = btns.find((x) => x.innerText.includes('导入目录')); if (!b) throw new Error('no 导入目录 btn'); b.click(); return true })()`)
await evalUntil(page, `document.body.innerText.includes('导入已有目录')`, (v) => v === true, 8000, '对话框出现')
const dlgInfo = await page.eval(`(() => {
  const t = document.body.innerText
  return {
    picker: t.includes('选择文件夹…'),
    hint: t.includes('原目录保留不动'),
    input: !!document.querySelector('input[type="text"], input:not([type="password"])')
  }
})()`)
check('对话框含「选择文件夹…」按钮', dlgInfo.picker)
check('对话框说明含「原目录保留不动」', dlgInfo.hint)

// ② 输入路径并导入（成功路径）
await page.eval(`(() => {
  const inp = [...document.querySelectorAll('input')].find((x) => !x.type || x.type === 'text')
  if (!inp) throw new Error('no input')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(inp, '/Users/me/旧稿')
  inp.dispatchEvent(new Event('input', { bubbles: true }))
  return true
})()`)
await sleep(200)
await page.eval(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.innerText.trim() === '导入'); if (!b) throw new Error('no 导入 btn'); b.click(); return true })()`)
await evalUntil(page, `document.body.innerText.includes('已导入')`, (v) => v === true, 10000, '成功 toast')
await evalUntil(page, `location.hash`, (v) => typeof v === 'string' && v.startsWith('#/project/'), 10000, '跳转项目页')
const hash = await page.eval(`location.hash`)
check(`成功导入后跳转项目页（${hash}）`, /^#\/project\/demo-/.test(hash))
await page.close()

// ③ 失败路径：zj-fail=importProject
const tab2 = await openTab(BASE + '/?zj-fail=importProject&cb=importFail' + Date.now() + '#/')
const page2 = await attach(tab2.webSocketDebuggerUrl)
await evalUntil(page2, `document.body.innerText.includes('织卷')`, (v) => v === true, 20000, 'Home2 渲染')
await page2.eval(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.innerText.includes('导入目录')); if (!b) throw new Error('no btn'); b.click(); return true })()`)
await evalUntil(page2, `document.body.innerText.includes('导入已有目录')`, (v) => v === true, 8000, '对话框2')
await page2.eval(`(() => {
  const inp = [...document.querySelectorAll('input')].find((x) => !x.type || x.type === 'text')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(inp, '/Users/me/旧稿')
  inp.dispatchEvent(new Event('input', { bubbles: true }))
  return true
})()`)
await sleep(200)
await page2.eval(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.innerText.trim() === '导入'); if (!b) throw new Error('no btn'); b.click(); return true })()`)
await evalUntil(page2, `document.body.innerText.includes('导入目录失败')`, (v) => v === true, 10000, '失败 toast')
check('失败路径 toast「导入目录失败」出现', true)
await page2.close()

console.log(fails === 0 ? '\nUI SMOKE OK' : '\nUI SMOKE FAIL: ' + fails)
process.exit(fails === 0 ? 0 : 1)
