// 织卷无头冒烟 · 全局 Toast 通知系统（store/toasts + components/ui/toast）
// 用法：node scripts/toast-ui-smoke.mjs
// 前置：npm run build；python3 -m http.server 8123 --directory out/renderer；CDP 9224
// 验收点：① 大纲页真实动作（导演本章）→ 成功 toast；② 并发/堆叠（回建 + 导演并存）；
//         ③ 自动消失（默认 6s）；④ 错误类 toast（__ZJ_TOAST 直发）；⑤ 栈上限 4；⑥ 无 JS 异常。
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

const toastCount = (page) => page.eval(`document.querySelectorAll('.zj-toast').length`)
const toastTitles = (page) => page.eval(`[...document.querySelectorAll('.zj-toast')].map((t) => t.innerText.split('\\n')[0])`)

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/outline')
console.log('TAB:', tab.id)
const page = await attach(tab.webSocketDebuggerUrl)
let fails = 0
const ok = (name, cond, extra = '') => {
  console.log((cond ? 'OK ' : 'NG ') + name + (extra ? ' | ' + extra : ''))
  if (!cond) fails++
}

try {
  // ① 大纲页就绪（章卡列表含两章）
  await evalUntil(page, `document.body.innerText.includes('章卡') && document.body.innerText.includes('第2章 · 灯塔')`, (v) => v === true, 20000, '大纲页就绪')
  ok('大纲页就绪', true)
  const vis = await page.eval(`document.visibilityState`)
  ok('页面可见（定时器不会被节流）', vis === 'visible', 'visibility=' + vis)

  // ② 选第2章（灯塔）→ 导演本章 → 成功 toast
  await page.eval(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.innerText.includes('第2章 · 灯塔')); return b ? (b.click(), 'CLICKED') : 'NOT_FOUND' })()`)
  await sleep(400)
  await page.eval(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.innerText.trim() === '导演本章'); return b ? (b.click(), 'CLICKED') : 'NOT_FOUND' })()`)
  await evalUntil(page, `[...document.querySelectorAll('.zj-toast')].some((t) => t.innerText.includes('导演板已生成'))`, (v) => v === true, 10000, '导演成功 toast')
  ok('真实动作→成功 toast', true, JSON.stringify(await toastTitles(page)))

  // ③ 回建缺失 → 与导演 toast 堆叠（并发通知不再互相覆盖）
  await page.eval(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.innerText.trim().startsWith('回建缺失')); return b ? (b.click(), 'CLICKED') : 'NOT_FOUND' })()`)
  await evalUntil(page, `[...document.querySelectorAll('.zj-toast')].some((t) => t.innerText.includes('章卡回建完成'))`, (v) => v === true, 10000, '回建成功 toast')
  await sleep(300)
  const cnt = await toastCount(page)
  ok('两条通知堆叠共存', cnt >= 2, 'count=' + cnt)
  ok('堆叠标题正确', JSON.stringify(await toastTitles(page)).includes('章卡回建完成') && JSON.stringify(await toastTitles(page)).includes('导演板已生成'))

  // ④ 自动消失：success 默认 6s
  await sleep(6800)
  const after = await toastCount(page)
  ok('toast 自动消失', after === 0, 'count=' + after)

  // ⑤ 错误类 toast（直发 API，验证 error 样式与文案渲染）
  await page.eval(`window.__ZJ_TOAST.add({ kind: 'error', title: '巡查失败', description: '写作引擎没有响应' })`)
  await evalUntil(page, `document.querySelectorAll('.zj-toast').length === 1`, (v) => v === true, 5000, 'error toast')
  const errCls = await page.eval(`document.querySelector('.zj-toast svg').getAttribute('class')`)
  ok('error toast 样式（text-danger）', /text-danger/.test(errCls ?? ''), 'cls=' + errCls)
  await page.eval(`window.__ZJ_TOAST.clear()`)

  // ⑥ 栈上限 4：一次加 6 条只留 4 条
  await page.eval(`(() => { for (let i = 1; i <= 6; i++) window.__ZJ_TOAST.add({ title: 't' + i }); return 1 })()`)
  await sleep(300)
  const capCount = await toastCount(page)
  ok('栈上限 4（超出挤掉最旧）', capCount === 4, 'count=' + capCount)
  const capTitles = await toastTitles(page)
  ok('最旧被挤掉', !capTitles.includes('t1') && capTitles.includes('t6'), JSON.stringify(capTitles))
  await page.eval(`window.__ZJ_TOAST.clear()`)
  await sleep(200)

  // ⑦ 无页面异常
  const errs = page.errors.filter((e) => !/ResizeObserver/.test(e) && !/Download the React DevTools/.test(e))
  ok('无 JS 异常', errs.length === 0, errs.slice(0, 3).join(' ;; '))
} catch (e) {
  console.error('FATAL ' + e.message)
  fails++
} finally {
  page.close()
  console.log(fails === 0 ? 'SMOKE PASS' : 'SMOKE FAIL (' + fails + ')')
  process.exit(fails === 0 ? 0 : 1)
}
