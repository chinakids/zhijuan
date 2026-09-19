// 织卷无头冒烟 · 新建章节故事要素对话框 HIG 视角走查（2026-09-19 23:15 轮）
// 用法：node scripts/createchapter-hig-ui-smoke.mjs
// 前置：npm run build；SPA fallback server（8899）；CDP 9224
// 验收点：
//  A（1100×700 demo-multiline 折叠态流程）：
//  ① 打开即焦点=题名（HIG Text fields primary item）+ 8 个字段均有独立 label（placeholder 消失后 label 条款）
//  ② 预填跟随（切片/线/人物 + 「已沿用」提示）+ 多线 chips 语义（HIG Entering data prefill 条款）
//  ③ 高度修复：dialog ≤85dvh 且完全在视口内、内容可滚动（HIG Sheets reasonable default size）
//  ④ 题名为空时「创建」disabled（HIG Entering data 必填才可继续）
//  ⑤ 单行字段 Enter=创建（HIG Buttons Return key；2a7dfd0 先例）——dialog 关闭+章列表出现新章
//  ⑥ IME 组合态 Enter 不创建（ime.ts 单一来源守卫；ime-composition 同法）
//  B（800×600 矮视口）：dialog 高度修复在更矮视口同样成立
//  全程零 JS 异常。
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

let fails = 0
const ok = (name, cond, extra = '') => {
  console.log((cond ? 'OK ' : 'NG ') + name + (extra ? ' | ' + extra : ''))
  if (!cond) fails++
}

// 打开建章对话框（折叠态：先点「打开章节列表」，浮层内点＋）；返回页面状态断言
async function openCreateDlg(page, viewportW, viewportH, cb) {
  await page.cmd('Emulation.setDeviceMetricsOverride', { width: viewportW, height: viewportH, deviceScaleFactor: 1, mobile: false })
  await sleep(2200)
  await page.eval(`(() => { const b=[...document.querySelectorAll('button')].find(b=>b.innerText.includes('打开章节列表')); if(b) b.click(); return !!b })()`)
  await sleep(500)
  await evalUntil(page, `!!document.querySelector('button[aria-label="新建章节"]')`, (v) => v, 15000, '新建章节按钮')
  await page.eval(`document.querySelector('button[aria-label="新建章节"]').click()`)
  await sleep(700)
}

async function dlgSnapshot(page) {
  return page.eval(`(() => {
    const dlg = document.querySelector('[role="dialog"]')
    if (!dlg) return null
    const rect = dlg.getBoundingClientRect()
    const inputs = [...dlg.querySelectorAll('input, textarea')]
    const inp = (ph) => inputs.find(x => x.placeholder === ph) ?? null
    return {
      labels: [...dlg.querySelectorAll('label')].map(l => l.innerText),
      focusPh: document.activeElement?.placeholder ?? null,
      slice: inp('如：第二幕_台风夜（留空则用章号）')?.value ?? null,
      line: inp('如：过去线（留空默认主线）')?.value ?? null,
      cast: inp('如：林晚，顾知远')?.value ?? null,
      chips: [...dlg.querySelectorAll('[data-testid^="line-chip"]')].map(c => c.innerText),
      prefillHint: dlg.innerText.includes('已沿用'),
      dlgH: rect.height, top: rect.top, bottom: rect.bottom,
      clientH: dlg.clientHeight, scrollH: dlg.scrollHeight,
      createDisabled: [...dlg.querySelectorAll('button')].find(b => b.innerText.trim() === '创建')?.disabled ?? null
    }
  })()`)
}

async function fillTitle(page, val) {
  return page.eval(`(() => {
    const dlg = document.querySelector('[role="dialog"]')
    const inp = dlg.querySelector('input')
    const proto = HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(inp, ${JSON.stringify(val)})
    inp.dispatchEvent(new Event('input', { bubbles: true }))
    inp.focus()
    return inp.value
  })()`)
}

// ---------- 场景 A：1100×700 main ----------
{
  const tab = await openTab(BASE + '/#/project/demo-multiline/novel?cb=' + Date.now())
  const page = await attach(tab.webSocketDebuggerUrl)
  try {
    await openCreateDlg(page, 1100, 700)
    let s = await dlgSnapshot(page)
    ok('A1 labels 独立全齐', !!s && s.labels.length === 8 && s.labels[0] === '题名 *', JSON.stringify(s?.labels))
    ok('A2 初始焦点=题名', !!s && s.focusPh === '如：夏夜的信', String(s?.focusPh))
    ok('A3 预填切片', !!s && s.slice === '今_破晓', String(s?.slice))
    ok('A3 预填时间线=主线', !!s && s.line === '主线', String(s?.line))
    ok('A3 预填人物', !!s && s.cast === '陆离', String(s?.cast))
    ok('A3 已沿用提示', !!s && s.prefillHint === true)
    ok('A4 多线 chips', !!s && s.chips.length === 2 && s.chips[1] === '过去线', JSON.stringify(s?.chips))
    ok('A5 高度≤85dvh且视口内', !!s && s.dlgH <= 595.5 && s.top >= -0.5 && s.bottom <= 700.5, `H=${s?.dlgH} top=${s?.top} bottom=${s?.bottom}`)
    ok('A5 内容可滚动', !!s && s.scrollH > s.clientH, `scrollH=${s?.scrollH} clientH=${s?.clientH}`)
    ok('A6 题名空创建禁用', !!s && s.createDisabled === true, String(s?.createDisabled))
    await fillTitle(page, 'Enter检')
    await sleep(400)
    s = await dlgSnapshot(page)
    ok('A6 填题名后创建可用', !!s && s.createDisabled === false, String(s?.createDisabled))
    // Enter 创建（焦点在题名）
    await page.eval(`(() => {
      const inp = document.querySelector('[role="dialog"] input')
      inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }))
      return true
    })()`)
    await sleep(1200)
    const afterEnter = await page.eval(`({
      dlgOpen: !!document.querySelector('[role="dialog"]'),
      has: document.body.innerText.includes('Enter检')
    })`)
    ok('A5/7 Enter=创建并关闭', afterEnter.dlgOpen === false && afterEnter.has === true, JSON.stringify(afterEnter))
    // IME 组合态 Enter 不创建：再开 & 组合（折叠态：先经入口条/打开章节列表重开浮层，再点＋）
    await page.eval(`(() => {
      const b = document.querySelector('[data-testid="chapter-toggle"]') ??
        [...document.querySelectorAll('button')].find(b => b.innerText.includes('打开章节列表'))
      if (b) b.click()
      return !!b
    })()`)
    await sleep(500)
    await evalUntil(page, `!!document.querySelector('button[aria-label="新建章节"]')`, (v) => v, 15000, '新建章节按钮(IME)')
    await page.eval(`document.querySelector('button[aria-label="新建章节"]').click()`)
    await sleep(700)
    await page.eval(`document.querySelector('[role="dialog"] input').focus()`)
    await sleep(200)
    await page.cmd('Input.imeSetComposition', { text: 'ce', selectionStart: 2, selectionEnd: 2 })
    await page.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 36 })
    await sleep(700)
    const imeState = await page.eval(`({ dlgOpen: !!document.querySelector('[role="dialog"]') })`)
    ok('A6/8 IME 组合态 Enter 不创建', imeState.dlgOpen === true, JSON.stringify(imeState))
    try { await page.cmd('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 }) } catch {}
    // Esc 关闭（取消路径仍在）
    await page.eval(`(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }))
      return true
    })()`)
    await sleep(500)
    const escState = await page.eval(`!!document.querySelector('[role="dialog"]')`)
    ok('A9 Esc 关闭', escState === false)
    ok('A10 零 JS 异常', page.errors.length === 0, page.errors.slice(0, 3).join(' ; '))
  } finally {
    page.close()
    try { await fetch(CDP + '/json/close/' + tab.id) } catch {}
  }
}

// ---------- 场景 B：800×600 矮视口高度修复 ----------
{
  const tab = await openTab(BASE + '/#/project/demo-multiline/novel?cb=' + (Date.now() + 1))
  const page = await attach(tab.webSocketDebuggerUrl)
  try {
    await openCreateDlg(page, 800, 600)
    const s = await dlgSnapshot(page)
    ok('B1 600 视口高度≤85dvh且视口内', !!s && s.dlgH <= 510.5 && s.top >= -0.5 && s.bottom <= 600.5, `H=${s?.dlgH} top=${s?.top} bottom=${s?.bottom}`)
    ok('B2 内容可滚动', !!s && s.scrollH > s.clientH, `scrollH=${s?.scrollH} clientH=${s?.clientH}`)
    ok('B3 零 JS 异常', page.errors.length === 0, page.errors.slice(0, 3).join(' ; '))
  } finally {
    page.close()
    try { await fetch(CDP + '/json/close/' + tab.id) } catch {}
  }
}

console.log(fails === 0 ? 'ALL PASS' : fails + ' FAILURES')
process.exit(fails === 0 ? 0 : 1)
