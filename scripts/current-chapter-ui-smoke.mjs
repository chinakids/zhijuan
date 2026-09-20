// 织卷无头冒烟 · 大纲区「当前章指示」+ 正文页当前章跨路由保留（2026-09-20 体验层）
// 服务创作/产品问题=作者在正文页写某章后切到大纲区：①章卡列应见「正在写」行徽标（跨页状态指示）
// ②切回正文页应自动恢复上次所选章（应用级工作上下文，不再要求重新点选）
// 用法：node scripts/current-chapter-ui-smoke.mjs
// 前置：npm run build；node scripts/serve-renderer.mjs 8123；本机无头 Chrome CDP 127.0.0.1:9224
// 验收点：A 正文页选中第1章；B 切大纲区 → 第1章行有 current-badge「正在写」；C 切换大纲区选中章不改变 badge 位置（badge 跟随 currentChapter 而非大纲 sel）；
//         D 切回正文页 → 第1章仍选中（bg-accent-soft + 编辑器挂载 + 文档标题）；E 全程无 JS 异常；截图 2 张。
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
const ID = 'demo-aseya'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const fs = await import('node:fs')
const OUT = process.env.HOME + '/Pictures/zhijuan'
const watchdog = setTimeout(() => { console.log('!! WATCHDOG 150s'); process.exit(2) }, 150000)

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
    if (m.method === 'Runtime.exceptionThrown') errors.push((m.params.exceptionDetails?.exception?.description ?? '').slice(0, 200))
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push((m.params.args?.map((a) => a.value ?? a.description ?? '').join(' ') ?? '').slice(0, 200))
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
      await cmd('Page.enable')
      res({
        cmd, errors,
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
async function evalUntil(page, expr, pred, timeoutMs = 25000, label = expr) {
  const t0 = Date.now()
  for (;;) {
    try {
      const v = await page.eval(expr)
      if (pred(v)) return v
    } catch { /* retry */ }
    if (Date.now() - t0 > timeoutMs) throw new Error('TIMEOUT waiting: ' + label)
    await sleep(250)
  }
}
async function shot(page, name) {
  try {
    const { data } = await page.cmd('Page.captureScreenshot', { format: 'png' })
    fs.mkdirSync(OUT, { recursive: true })
    const p = `${OUT}/${name}.png`
    fs.writeFileSync(p, Buffer.from(data, 'base64'))
    console.log('截图 →', p)
  } catch (e) { console.log('截图失败', e.message || e) }
}
let fail = 0
const ok = (name, cond, extra = '') => {
  console.log((cond ? 'OK ' : 'NG ') + name + (extra ? ' | ' + extra : ''))
  if (!cond) fail++
}
const clickChapter = (t) => `(() => {
  const b = [...document.querySelectorAll('aside button')].find((x) => (x.innerText || '').includes(${JSON.stringify(t)}))
  if (!b) return false
  b.click()
  return true
})()`

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/' + ID + '/novel')
console.log('TAB:', tab.id)
const page = await attach(tab.webSocketDebuggerUrl)
try {
  // A 正文页就绪 → 选第1章
  await evalUntil(page, `document.querySelectorAll('aside button').length > 3`, (v) => v === true, 30000, 'novel 就绪')
  ok('A1 点击第1章', (await page.eval(clickChapter('第1章'))) === true)
  await evalUntil(page, `!!document.querySelector('.ProseMirror')`, (v) => v === true, 15000, '编辑器挂载')
  const selText = await page.eval(`(() => {
    const sel = [...document.querySelectorAll('aside button')].filter((b) => (b.className || '').includes('bg-accent-soft'))
    return sel.map((b) => (b.innerText || '').slice(0, 24))
  })()`)
  ok('A2 选中含第1章', selText.some((t) => t.includes('第1章')), JSON.stringify(selText))

  // B 切大纲区 → 第1章行「正在写」徽标
  await page.eval(`window.location.hash = '#/project/${ID}/outline'`)
  await evalUntil(page, `document.body.innerText.includes('章卡索引')`, (v) => v === true, 20000, 'outline 就绪')
  await evalUntil(page, `document.querySelectorAll('[data-testid="current-badge"]').length`, (v) => v === 1, 10000, 'current-badge 出现')
  const badgeInfo = await page.eval(`(() => {
    const b = document.querySelector('[data-testid="current-badge"]')
    if (!b) return null
    const row = b.closest('button')
    return { text: b.innerText.trim(), rowText: (row?.innerText || '').slice(0, 30), title: b.getAttribute('title') }
  })()`)
  ok('B1 徽标文本=正在写', badgeInfo?.text === '正在写', JSON.stringify(badgeInfo))
  ok('B2 徽标挂第1章行', (badgeInfo?.rowText || '').includes('第1章'), badgeInfo?.rowText)
  ok('B3 徽标 title 说明', badgeInfo?.title === '正文页正在写的章')

  // C 大纲区选中其他章（章卡列表点击第3章）→ badge 仍跟随当前章（第1章）不移动
  const moved = await page.eval(clickChapter('第3章'))
  await sleep(600)
  const badgeAfterSel = await page.eval(`(() => {
    const b = document.querySelector('[data-testid="current-badge"]')
    const row = b?.closest('button')
    return (row?.innerText || '').slice(0, 30)
  })()`)
  ok('C1 大纲选中其他章后 badge 不动', (badgeAfterSel || '').includes('第1章'), badgeAfterSel)
  // 截图命名规范：<功能>-<HHMM>.png
  const d = new Date()
  const hhmm = String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0')
  await shot(page, 'current-chapter-outline-' + hhmm)

  // D 切回正文页 → 第1章自动恢复（选中+编辑器挂载）
  await page.eval(`window.location.hash = '#/project/${ID}/novel'`)
  await evalUntil(page, `document.querySelectorAll('aside button').length > 3`, (v) => v === true, 20000, 'novel 回来')
  const backSel = await page.eval(`(() => {
    const sel = [...document.querySelectorAll('aside button')].filter((b) => (b.className || '').includes('bg-accent-soft'))
    return { n: sel.length, text: sel.map((b) => (b.innerText || '').slice(0, 24)) }
  })()`)
  ok('D1 切回后仍选中第1章', backSel.n === 1 && backSel.text.some((t) => t.includes('第1章')), JSON.stringify(backSel))
  await evalUntil(page, `!!document.querySelector('.ProseMirror')`, (v) => v === true, 15000, '编辑器自动挂载')
  ok('D2 编辑器自动挂载', true)
  const docText = await page.eval(`(document.querySelector('.ProseMirror')?.innerText || '').slice(0, 60)`)
  ok('D3 编辑器内容=第1章正文', docText.includes('雾港'), docText.slice(0, 40))
  await shot(page, 'current-chapter-back-' + hhmm)

  // 跨度检查：切换项目后不串（打开另一项目 novel，当前章应为空）
  await page.eval(`window.location.hash = '#/project/demo-multiline/novel'`)
  await evalUntil(page, `document.querySelectorAll('aside button').length > 3`, (v) => v === true, 20000, 'demo-multiline 就绪')
  const crossSel = await page.eval(`(() => {
    const sel = [...document.querySelectorAll('aside button')].filter((b) => (b.className || '').includes('bg-accent-soft'))
    return sel.length
  })()`)
  ok('E1 跨项目不串章（demo-multiline 无选中）', crossSel === 0, 'selCount=' + crossSel)
  await page.eval(`window.location.hash = '#/project/${ID}/novel'`)
  await sleep(800)
  const backAgain = await page.eval(`(() => {
    const sel = [...document.querySelectorAll('aside button')].filter((b) => (b.className || '').includes('bg-accent-soft'))
    return sel.map((b) => (b.innerText || '').slice(0, 20))
  })()`)
  ok('E2 回到原项目仍恢复第1章', backAgain.some((t) => t.includes('第1章')), JSON.stringify(backAgain))
} catch (e) {
  ok('脚本异常', false, e.message)
} finally {
  const errs = page.errors.filter((x) => !x.includes("Failed to load resource") && !x.includes('net::ERR') && !x.includes('favicon'))
  ok('无 JS 异常', errs.length === 0, errs.slice(0, 3).join(' ; '))
  page.close()
  const done = await fetch(CDP + '/json/close/' + tab.id, { method: 'GET' }).catch(() => null)
  console.log('FAILS=' + fail)
  process.exit(fail === 0 ? 0 : 1)
}
