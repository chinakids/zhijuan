// 织卷无头冒烟 · 检查抽屉的全局通知（本章小环 / 导演兑现检查 → Toaster）
// 用法：node scripts/check-toast-ui-smoke.mjs
// 前置：npm run build；python3 -m http.server 8123 --directory out/renderer；CDP 9224
// 验收点：① 运行中关闭小环 → 完成 warning「发现 N 条」；② 开着完成 → 不打扰（无 toast）；
//         ③ 运行中关闭 + 失败 → error toast；④ 兑现检查运行中关闭 → warning「N 处未兑现」；
//         ⑤ 兑现检查开着完成 → 不打扰；⑥ 无 JS 异常。
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
  const errors = []
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.method === 'Runtime.exceptionThrown') {
      errors.push((m.params.exceptionDetails?.exception?.description ?? '').slice(0, 200))
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errors.push((m.params.args?.map((a) => a.value ?? a.description ?? '').join(' ') ?? '').slice(0, 200))
    }
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  }
  const cmd = (method, params = {}) =>
    new Promise((res, rej) => {
      const id = ++seq
      pending.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)))
      ws.send(JSON.stringify({ id, method, params }))
    })
  return new Promise((res) => {
    ws.onopen = async () => {
      await cmd('Runtime.enable')
      res({
        cmd,
        errors,
        eval: async (expression) => {
          const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
          if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 300))
          return r.result?.value
        },
        close: () => ws.close()
      })
    }
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

const toastTitles = (page) => page.eval(`[...document.querySelectorAll('.zj-toast')].map((t) => t.innerText.split('\\n')[0])`)
const toastCount = (page) => page.eval(`document.querySelectorAll('.zj-toast').length`)
const clickTitle = (page, title) =>
  page.eval(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.title === ${JSON.stringify(title)}); if (!b) return 'NOT_FOUND'; b.click(); return 'CLICKED' })()`)
const clickText = (page, text, startsWith = false) =>
  page.eval(`(() => { const b = [...document.querySelectorAll('button')].find((x) => ${startsWith ? 'x.innerText.trim().startsWith' : 'x.innerText.trim() ==='}(${JSON.stringify(text)})); if (!b) return 'NOT_FOUND'; b.click(); return 'CLICKED' })()`)

let fails = 0
const ok = (name, cond, extra = '') => {
  console.log((cond ? 'OK ' : 'NG ') + name + (extra ? ' | ' + extra : ''))
  if (!cond) fails++
}

// ── tab 1：Novel 页（本章小环） ──
const tab1 = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel')
console.log('TAB1:', tab1.id)
const page = await attach(tab1.webSocketDebuggerUrl)

try {
  await evalUntil(page, `document.body.innerText.includes('正文创作') || document.body.innerText.includes('第01章')`, (v) => v === true, 20000, 'Novel 就绪')
  ok('Novel 页就绪', true)

  // 选第01章（ChapterList 按钮，含题名「雾港」）
  await evalUntil(page, `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.innerText.includes('雾港')); if (!b) return false; b.click(); return true })()`, (v) => v === true, 10000, '选章')
  await sleep(400)

  // ① 运行中关闭 → warning「发现 2 条」（mock 延迟 1.5s 后返回 2 条演示数据）
  await page.eval(`(() => {
    window.__ORIG_CC = window.zhijuan.agentChapterCheck
    window.zhijuan.agentChapterCheck = async (...a) => { await new Promise((r) => setTimeout(r, 1500)); return window.__ORIG_CC(...a) }
    return 1
  })()`)
  await evalUntil(page, `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.title && x.title.startsWith('本章小环')); if (!b) return false; b.click(); return true })()`, (v) => v === true, 5000, '打开小环')
  await evalUntil(page, `document.body.innerText.includes('写作引擎读本章…')`, (v) => v === true, 5000, '小环运行中')
  // 立即关闭（点击遮罩或 X：X 按钮在抽屉 header，title 无；用 .fixed 遮罩点击）
  await page.eval(`(() => { const o = document.querySelector('.fixed.inset-0.z-40.bg-black\\\\/10'); if (!o) return 'NO_OVERLAY'; o.click(); return 'CLOSED' })()`)
  await sleep(300)
  ok('运行中已关闭抽屉', true)
  await evalUntil(page, `[...document.querySelectorAll('.zj-toast')].some((t) => t.innerText.includes('本章小环发现 2 条'))`, (v) => v === true, 8000, '警告 toast')
  ok('① 运行中关闭→警告 toast（发现 2 条）', true, JSON.stringify(await toastTitles(page)))
  await page.eval(`window.__ZJ_TOAST.clear()`)

  // ② 开着完成 → 不打扰：打开抽屉（chapter 结果已缓存不重跑），切「分层修订」触发重跑
  await evalUntil(page, `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.title && x.title.startsWith('本章小环')); if (!b) return false; b.click(); return true })()`, (v) => v === true, 5000, '重开小环')
  await sleep(300)
  await clickText(page, '分层修订')
  await evalUntil(page, `document.body.innerText.includes('写作引擎读本章…')`, (v) => v === true, 5000, '修订运行中')
  ok('② 抽屉开着（修订运行中）', true)
  await sleep(2200)
  const during = await toastCount(page)
  ok('② 开着完成→不打扰（0 toast）', during === 0, 'count=' + during)
  await page.eval(`(() => { const o = document.querySelector('.fixed.inset-0.z-40.bg-black\\\\/10'); if (o) o.click(); return 1 })()`)
  await sleep(200)

  // ③ 运行中关闭 + 失败 → error toast（patch 成 {ok:false}（带延迟：关抽屉后完成才发），点「重跑」）
  await page.eval(`(() => { window.zhijuan.agentChapterCheck = async () => { await new Promise((r) => setTimeout(r, 1200)); return { ok: false, error: '模拟：引擎断连' } }; return 1 })()`)
  await evalUntil(page, `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.title && x.title.startsWith('本章小环')); if (!b) return false; b.click(); return true })()`, (v) => v === true, 5000, '再开小环')
  await sleep(400)
  await clickText(page, '重跑')
  await sleep(200)
  await page.eval(`(() => { const o = document.querySelector('.fixed.inset-0.z-40.bg-black\\\\/10'); if (o) o.click(); return 1 })()`)
  await evalUntil(page, `[...document.querySelectorAll('.zj-toast')].some((t) => t.innerText.includes('本章检查失败'))`, (v) => v === true, 8000, '错误 toast')
  ok('③ 运行中关闭+失败→error toast', true, JSON.stringify(await toastTitles(page)))
  await page.eval(`window.zhijuan.agentChapterCheck = window.__ORIG_CC; window.__ZJ_TOAST.clear()`)
  page.close()
} catch (e) {
  console.error('FATAL(1) ' + e.message)
  fails++
  page.close()
}

// ── tab 2：大纲页（导演兑现检查） ──
const tab2 = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/outline')
console.log('TAB2:', tab2.id)
const page2 = await attach(tab2.webSocketDebuggerUrl)

try {
  await evalUntil(page2, `document.body.innerText.includes('章卡') && document.body.innerText.includes('第2章')`, (v) => v === true, 20000, '大纲页就绪')
  ok('大纲页就绪', true)

  // 选中第1章（devShim 预置了它的章卡+导演板），「兑现检查」应直接可用
  await page2.eval(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.innerText.includes('第1章 · 雾港')); if (!b) return 'NOT_FOUND'; b.click(); return 'CLICKED' })()`)
  await evalUntil(page2, `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.innerText.trim() === '兑现检查'); return b && !b.disabled })()`, (v) => v === true, 8000, '兑现检查可点')
  ok('选中第1章后兑现检查可点', true)

  // ④ 兑现检查 mock 延迟 → 运行中关闭 → warning「3 处未兑现」
  await page2.eval(`(() => {
    window.__ORIG_DC = window.zhijuan.agentDirectorCheck
    window.zhijuan.agentDirectorCheck = async (...a) => { await new Promise((r) => setTimeout(r, 1500)); return window.__ORIG_DC(...a) }
    return 1
  })()`)
  await clickText(page2, '兑现检查')
  await evalUntil(page2, `document.body.innerText.includes('写作引擎对照导演板核本章')`, (v) => v === true, 5000, '兑现检查运行中')
  await page2.eval(`(() => { const o = document.querySelector('.fixed.inset-0.z-40.bg-black\\\\/10'); if (o) o.click(); return 1 })()`)
  await evalUntil(page2, `[...document.querySelectorAll('.zj-toast')].some((t) => t.innerText.includes('兑现检查：3 处未兑现'))`, (v) => v === true, 8000, '未兑现 toast')
  ok('④ 运行中关闭→警告 toast（3 处未兑现）', true, JSON.stringify(await toastTitles(page2)))
  await page2.eval(`window.__ZJ_TOAST.clear()`)

  // ⑤ 兑现检查开着完成 → 不打扰（重开会重跑）
  await clickText(page2, '兑现检查')
  await sleep(2200)
  const during2 = await toastCount(page2)
  ok('⑤ 兑现检查开着完成→不打扰（0 toast）', during2 === 0, 'count=' + during2)
  await page2.eval(`((() => { const o = document.querySelector('.fixed.inset-0.z-40.bg-black\\\\/10'); if (o) o.click(); return 1 })())`)

  const errs = page2.errors.filter((e) => !/ResizeObserver/.test(e) && !/Download the React DevTools/.test(e))
  ok('⑥ 无 JS 异常', errs.length === 0, errs.slice(0, 3).join(' ;; '))
  page2.close()
} catch (e) {
  console.error('FATAL(2) ' + e.message)
  fails++
  page2.close()
}

console.log(fails === 0 ? 'SMOKE PASS' : 'SMOKE FAIL (' + fails + ')')
process.exit(fails === 0 ? 0 : 1)
