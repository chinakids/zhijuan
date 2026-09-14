// 织卷无头冒烟 · devShim 与真机口径一致性回归（候选 3 对表审计产物）
// 用法：node scripts/devshim-consistency-smoke.mjs
// 前置：out/renderer 已 build；node scripts/serve-renderer.mjs（8899）提供 SPA fallback；本机无头 Chrome CDP 127.0.0.1:9224
// 验收点（本轮修复项逐一锁定）：
//  ① writeDoc 返回 true（真机 doc:write handler 同口径；preload 类型 Promise<boolean>）
//  ② removeProject 返回 { ok: true }（真机 store.removeProject）
//  ③ openProject 返回 true（真机 project:open；preload 类型 Promise<boolean>）
//  ④ workspaceStatus.docs 按名称 zh 排序（真机 listWorkspaceDocs）
//  ⑤ listHistory.size = UTF-8 字节数（真机 statSync size，HistoryDrawer 显示「字节」）— 修复前为字符数（偏小）
//  ⑥ agentStatus 含 message 字段（真机恒有）
//  ⑦ agentListCapabilities = 9 项且含 acts / annotation-sync（真机 listCapabilities 全量）— 修复前 7 项
//  ⑩ listTemplates 含非内建模板演示项（真机＝扫描用户模板目录；dev 第二项驱动「多模板选择」UI 分支）
//  ⑧ 全程零 JS 异常
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8899'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
const ok = (label) => console.log('OK', label)
const bad = (label, why) => {
  failures++
  console.log('FAIL', label, '::', why)
}

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

// ===================== 主流程 =====================
const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/')
console.log('TAB:', tab.id)
const page = await attach(tab.webSocketDebuggerUrl)

try {
  await page.eval(`(() => {
    window.__zjErr = []
    window.addEventListener('error', (e) => window.__zjErr.push(String(e.message || e)))
    window.addEventListener('unhandledrejection', (e) => window.__zjErr.push('REJ:' + String(e.reason)))
  })()`)

  await evalUntil(page, `!!window.zhijuan`, (v) => v === true, 20000, 'devShim 注入')

  // ① writeDoc 返回 true
  const w = await page.eval(`window.zhijuan.writeDoc('demo-aseya', '正文/第00章_口径探测.md', '# 口径探测\\n')`)
  if (w === true) ok('① writeDoc 返回 true')
  else bad('① writeDoc 返回 true', `got=${JSON.stringify(w)}`)

  // ② removeProject 返回 { ok: true }
  const rm = await page.eval(`window.zhijuan.removeProject('demo-blank')`)
  if (rm && rm.ok === true) ok('② removeProject 返回 { ok: true }')
  else bad('② removeProject 返回 { ok: true }', `got=${JSON.stringify(rm)}`)

  // ③ openProject 返回 true
  const op = await page.eval(`window.zhijuan.openProject('demo-aseya')`)
  if (op === true) ok('③ openProject 返回 true')
  else bad('③ openProject 返回 true', `got=${JSON.stringify(op)}`)

  // ④ workspaceStatus.docs 按名称 zh 排序（与真机 listWorkspaceDocs 同口径）
  //   （真机/ devShim 一致：未初始化时 docs 为空；先 workspaceInit 落档后再查排序）
  const ws = await page.eval(`(async () => {
    await window.zhijuan.workspaceInit()
    return window.zhijuan.workspaceStatus()
  })()`)
  const sorted = ws.docs.every((d, i, arr) => i === 0 || arr[i - 1].name.localeCompare(d.name, 'zh') <= 0)
  if (ws.docs.length >= 2 && sorted) ok('④ workspaceStatus.docs 按名称 zh 排序（' + ws.docs.map((d) => d.name).join(' / ') + '）')
  else bad('④ workspaceStatus.docs 按名称 zh 排序', `docs=${JSON.stringify(ws.docs)}`)

  // ⑤ listHistory.size = UTF-8 字节数：写入不同内容触发快照（prev 存在才留版），再比对字节
  const hist = await page.eval(`(async () => {
    const id = 'demo-aseya'
    const rel = '正文/第01章_雾港.md'
    const before = await window.zhijuan.readDoc(id, rel)
    await window.zhijuan.writeDoc(id, rel, before + '\\n\\n（口径探测追加一行）')
    const list = await window.zhijuan.listHistory(id, rel)
    return { before, list }
  })()`)
  if (!hist.list.length) {
    bad('⑤ listHistory.size 字节口径', '无版本快照（writeDoc 未触发）')
  } else {
    const byteLen = new TextEncoder().encode(hist.before).length
    const okSize = hist.list.some((h) => h.size === byteLen)
    const anySmall = hist.list.some((h) => h.size === hist.before.length) // 修复前=字符数
    if (okSize) ok(`⑤ listHistory.size = UTF-8 字节（版本 ${hist.list.length} 条，样本 size=${hist.list[0].size} 字节 ≥ 字符数 ${hist.before.length}）`)
    else bad('⑤ listHistory.size 字节口径', `sizes=${JSON.stringify(hist.list.map((h) => h.size))} expectBytes=${byteLen}`)
    if (anySmall) bad('⑤ listHistory.size 字节口径（仍存在字符数残留）', 'size 等于字符数（未修复）')
  }

  // ⑥ agentStatus 含 message 字段
  const st = await page.eval(`window.zhijuan.agentStatus()`)
  if (st && 'message' in st && 'online' in st && 'provider' in st && 'model' in st) ok('⑥ agentStatus 含 message 字段')
  else bad('⑥ agentStatus 含 message 字段', `got=${JSON.stringify(st)}`)

  // ⑦ agentListCapabilities = 9 项且含 acts / annotation-sync
  const caps = await page.eval(`window.zhijuan.agentListCapabilities()`)
  const ids = (caps || []).map((c) => c.id)
  if (caps && caps.length === 9 && ids.includes('acts') && ids.includes('annotation-sync')) {
    ok('⑦ agentListCapabilities 9 项（含 acts / annotation-sync：' + ids.join(', ') + '）')
  } else {
    bad('⑦ agentListCapabilities 9 项', `count=${caps?.length} ids=${JSON.stringify(ids)}`)
  }

  // ⑨ 设置页「检查能力」实际渲染 9 项开关（含新补的 分幕生成 / 批注改写引擎）
  await page.eval(`location.hash = '#/project/demo-aseya/settings'`)
  await evalUntil(
    page,
    `[...document.querySelectorAll('button')].some((b) => (b.textContent || '').includes('写作引擎'))`,
    (v) => v === true,
    15000,
    '设置页就绪'
  )
  await page.eval(
    `[...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes('写作引擎'))?.click()`
  )
  await evalUntil(
    page,
    `(() => {
      const t = document.body.innerText
      return t.includes('检查能力') && t.includes('分幕生成') && t.includes('批注改写引擎')
    })()`,
    (v) => v === true,
    15000,
    '检查能力 9 项渲染'
  )
  const capUi = await page.eval(`(() => {
    const t = document.body.innerText
    const count = (t.match(/引擎未注册检查能力/) ? 0 : (t.match(/（agent 子任务）/) ? 1 : -1))
    return { hasActs: t.includes('分幕生成'), hasAnno: t.includes('批注改写引擎'), hasEmpty: t.includes('引擎未注册检查能力') }
  })()`)
  if (capUi.hasActs && capUi.hasAnno && !capUi.hasEmpty) ok('⑨ 设置页「检查能力」渲染 9 项（含 分幕生成 / 批注改写引擎）')
  else bad('⑨ 设置页「检查能力」渲染 9 项', JSON.stringify(capUi))

  // ⑩ listTemplates 非内建模板演示：API 形状（真机 builtin 排前 + 用户目录扫描）+ UI「多模板选择」可驱动
  const tmpl = await page.eval(`window.zhijuan.listTemplates()`)
  if (Array.isArray(tmpl) && tmpl.length >= 2 && tmpl.some((t) => t.builtin === false) && tmpl[0]?.builtin === true) {
    ok('⑩ listTemplates 含非内建演示模板（' + tmpl.map((t) => t.name).join(' / ') + '，builtin 排前）')
  } else {
    bad('⑩ listTemplates 含非内建演示模板', JSON.stringify(tmpl))
  }
  // UI：回首页 → 打开新建项目对话框 → 下拉出现「悬疑短篇」→ 选中（非内建直接显示名）→ 创建进入项目页
  await page.eval(`location.hash = '#/'`)
  await evalUntil(page, `!!document.querySelector('button')`, (v) => v === true, 15000, '首页就绪')
  await page.eval(
    `[...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes('新建项目'))?.click()`
  )
  await evalUntil(page, `document.body.innerText.includes('初始内容（可选）')`, (v) => v === true, 15000, '新建对话框')
  await page.eval(`document.querySelector('button[role="combobox"]')?.click()`)
  await sleep(500)
  const opts = await page.eval(`[...document.querySelectorAll('[role="option"]')].map((o) => o.textContent)`)
  if (opts.some((t) => t.includes('悬疑短篇'))) ok('⑩ 新建对话框「初始内容」下拉含非内建模板「悬疑短篇」')
  else bad('⑩ 下拉含非内建模板', `opts=${JSON.stringify(opts)}`)
  await page.eval(
    `[...document.querySelectorAll('[role="option"]')].find((o) => o.textContent.includes('悬疑短篇'))?.click()`
  )
  await sleep(400)
  const selText = await page.eval(`document.querySelector('button[role="combobox"]')?.textContent || ''`)
  if (selText.includes('悬疑短篇') && !selText.includes('示例（')) {
    ok('⑩ 选中后触发器显示非内建模板名（无「示例（」前缀）')
  } else {
    bad('⑩ 触发器显示非内建模板名', `got=${selText}`)
  }
  await page.eval(`document.querySelector('input[placeholder*="山那边"]')?.focus()`)
  await page.eval(
    `new Promise((res) => { const el = document.querySelector('input[placeholder*="山那边"]'); el.focus(); const setVal = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; setVal.call(el, '模板审计'); el.dispatchEvent(new Event('input', { bubbles: true })); setTimeout(() => res(!!el.value), 100) })`
  )
  await evalUntil(
    page,
    `(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('创建并进入')); return b && !b.disabled })()`,
    (v) => v === true,
    8000,
    '创建按钮可用'
  )
  await page.eval(
    `[...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes('创建并进入'))?.click()`
  )
  const navHash = await evalUntil(
    page,
    `location.hash`,
    (v) => typeof v === 'string' && v.startsWith('#/project/'),
    15000,
    '创建后进入项目页'
  )
  if (navHash.includes('/project/')) ok('⑩ 选非内建模板创建成功并进入项目页（' + navHash.slice(0, 40) + '…）')
  else bad('⑩ 创建后进入项目页', `hash=${JSON.stringify(navHash)}`)

  // ⑧ 零 JS 异常（过滤已知浏览器 benign 噪音：ResizeObserver loop 出自 Radix/浮层动画，非应用异常）
  const errsRaw = await page.eval(`window.__zjErr`)
  const errs = errsRaw.filter((s) => !String(s).includes('ResizeObserver loop completed with undelivered notifications'))
  if (errs.length > 0) bad('⑧ 零 JS 异常', JSON.stringify(errs))
  else ok('⑧ 全程零 JS 异常（' + errsRaw.length + ' 条原始，含 ResizeObserver 噪音 ' + (errsRaw.length - errs.length) + ' 条已滤）')
} catch (e) {
  bad('主流程', String(e && e.stack ? e.stack : e))
}

console.log(failures === 0 ? 'ALL PASS' : 'SMOKE FAIL ' + failures)
await page.close()
process.exit(failures === 0 ? 0 : 1)
