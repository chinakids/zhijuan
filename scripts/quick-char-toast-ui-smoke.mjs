// 织卷无头冒烟 · 批注接受 toast 守卫明细「建档案」动作（创作层 2026-09-15 候选2 收口）
// 用法：node scripts/quick-char-toast-ui-smoke.mjs
// 前置：node scripts/serve-renderer.mjs（8123）；本机专用无头 Chrome CDP 127.0.0.1:9224
// 链路（devShim + ?zj-guard=3 注入 1 已纠正 + 2 未建档(新角色1/新角色2)）：
//   设置开「批注定时优化」→ 回项目 10s 自动首扫生成批注提案 → 顶栏「待确认提案」→ 抽屉「接受」
//   → 接受后触发切片同步 → toast「（拦截 3 条）」+ 明细逐行 + action「为 2 名人物建档案」（五入口唯一纯文本承载补齐处置能力）
//   → 点击 → 人物/新角色1.md、新角色2.md 按模板落盘（readDoc 断言）→ toast 更新「已建档案」+ 按钮摘除
//   → 数据层重跑 agentSync：已建档 target 不再拦截（只剩已纠正 1 条）
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
const PID = 'demo-aseya'
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
const clickBtn = (text, exact = true) => `(() => {
  const els = [...document.querySelectorAll('button')]
  const el = els.find((b) => ${exact ? `(b.innerText || '').trim() === ${JSON.stringify(text)}` : `(b.innerText || '').includes(${JSON.stringify(text)})`})
  if (!el) return false
  el.click()
  return true
})()`
const toastBtn = (text) => `(() => {
  const els = [...document.querySelectorAll('.zj-toast button')]
  const el = els.find((b) => (b.innerText || '').trim() === ${JSON.stringify(text)})
  if (!el) return false
  el.click()
  return true
})()`

let pass = 0
let fail = 0
function ok(name, cond, extra = '') {
  if (cond) {
    pass++
    console.log('PASS ' + name)
  } else {
    fail++
    console.log('FAIL ' + name + (extra ? ' | ' + extra : ''))
  }
}

console.log('--- 批注接受 toast 守卫明细「建档案」动作 ---')
const tab = await openTab(BASE + '/?cb=' + Date.now() + '&zj-guard=3#/project/' + PID + '/settings')
const page = await attach(tab.webSocketDebuggerUrl)
try {
  // ① 设置开「批注定时优化」（自动首扫的开关）
  await evalUntil(page, bodyHas('外观与数据'), Boolean, 20000, '设置页加载')
  await page.eval(clickBtn('外观与数据', false))
  await evalUntil(page, bodyHas('批注定时优化'), Boolean, 10000, '外观节批注开关')
  await page.eval(`(() => {
    const rows = [...document.querySelectorAll('div')].filter((d) => d.textContent && d.textContent.includes('批注定时优化') && d.querySelector('button[role="switch"]'))
    const row = rows[rows.length - 1]
    const s = row && row.querySelector('button[role="switch"]')
    if (!s) return 'NO_SWITCH'
    if (s.getAttribute('aria-checked') !== 'true') s.click()
    return 'OK'
  })()`)
  await page.eval(clickBtn('保存设置'))
  await sleep(700)
  await page.eval(`(() => { location.hash = '#/project/${PID}/novel'; return 1 })()`)
  await evalUntil(page, bodyHas('第1章'), Boolean, 20000, '正文载入')

  // ② 打开项目 10s 后自动首扫 → 生成批注提案 → 进入抽屉接受
  await evalUntil(
    page,
    `window.zhijuan.listProposals('${PID}').then((ps) => ps.filter((p) => p.source === 'annotation-sync' && p.status === 'pending').length)`,
    (v) => Number(v) >= 1,
    30000,
    '自动扫描生成批注提案'
  )
  await evalUntil(page, bodyHas('待确认提案'), Boolean, 10000, '顶栏提案入口')
  await page.eval(clickBtn('待确认提案', false))
  await evalUntil(page, bodyHas('接受'), Boolean, 10000, '抽屉接受按钮')
  await page.eval(clickBtn('接受', true))

  // ③ 接受后触发切片同步 → toast 摘要「（拦截 3 条）」+ 明细（渐进披露折叠）+ 建档动作按钮
  await evalUntil(page, bodyHas('（拦截 3 条）'), Boolean, 20000, 'toast 拦截 3 条')
  ok('①a toast 出现「（拦截 3 条）」摘要', await page.eval(`[...document.querySelectorAll('.zj-toast')].some((t) => (t.innerText || '').includes('（拦截 3 条）'))`))
  ok('①b 默认折叠：明细（人物名/原因）不常显（渐进披露，2026-09-18）', await page.eval(`[...document.querySelectorAll('.zj-toast')].every((t) => !(t.innerText || '').includes('人物/新角色1.md'))`))
  // 点开「查看明细」→ 逐条明细完整可见
  await page.eval(`(() => { const b = document.querySelector('.zj-toast button[aria-label="查看明细"]'); if (b) b.click(); return 1 })()`)
  await sleep(300)
  ok('①c 点开「查看明细」后逐条完整（新角色1/新角色2/尚未建档）', await page.eval(
    `document.querySelectorAll('.zj-toast').length > 0 && [...document.querySelectorAll('.zj-toast')].some((t) => (t.innerText || '').includes('人物/新角色1.md') && (t.innerText || '').includes('人物/新角色2.md') && (t.innerText || '').includes('尚未建档'))`
  ))
  const hasBtn = await page.eval(`[...document.querySelectorAll('.zj-toast button')].some((b) => (b.innerText || '').trim() === '为 2 名人物建档案')`)
  ok('② toast 挂「为 2 名人物建档案」动作按钮（未建档 2 条）', hasBtn === true)

  // ④ 点击批量建档 → 模板落盘
  await page.eval(toastBtn('为 2 名人物建档案'))
  const c1 = await evalUntil(
    page,
    `window.zhijuan.readDoc('${PID}', '人物/新角色1.md')`,
    (t) => typeof t === 'string' && t.length > 0,
    8000,
    '新角色1 档案落盘'
  )
  const c2 = await evalUntil(
    page,
    `window.zhijuan.readDoc('${PID}', '人物/新角色2.md')`,
    (t) => typeof t === 'string' && t.length > 0,
    8000,
    '新角色2 档案落盘'
  )
  ok('③ 两名人档案均落盘（约定头+模板占位）', c1.includes('别名: []') && c1.includes('# 新角色1') && c2.includes('# 新角色2') && c1.includes('（身份 / 职业）'))

  // ⑤ toast 更新为「已建档案」+ 按钮摘除
  await evalUntil(page, bodyHas('已为 2 名人物建档案'), Boolean, 10000, 'toast 更新已建档案')
  const btnGone = await page.eval(`![...document.querySelectorAll('.zj-toast button')].some((b) => (b.innerText || '').includes('建档案'))`)
  ok('④ toast 更新「已为 2 名人物建档案」且建档按钮摘除', btnGone === true)

  // ⑥ 数据层重跑（同 devShim 口径）：已建档 target 不再拦截，只剩已纠正 1 条
  const again = await page.eval(`window.zhijuan.agentSync('${PID}', '正文/第01章_雾港.md')`)
  const issues = (again && again.guard && again.guard.issues) || []
  ok('⑤ 重跑同步不再拦截新角色（只剩已纠正 1 条）', issues.length === 1 && issues[0].action === 'corrected' && !JSON.stringify(issues).includes('新角色'), JSON.stringify(issues))

  // ⑦ 截图存证（toast 已更新态）
  const shot = await page.cmd('Page.captureScreenshot', { format: 'png' })
  if (shot?.data) {
    const { writeFileSync, mkdirSync } = await import('node:fs')
    mkdirSync(process.env.HOME + '/Pictures/zhijuan', { recursive: true })
    const p = `${process.env.HOME}/Pictures/zhijuan/guard-toast-create-${new Date().toTimeString().slice(0, 5).replace(':', '')}.png`
    writeFileSync(p, Buffer.from(shot.data, 'base64'))
    console.log('SHOT ' + p)
  }
} finally {
  page.close()
  try {
    const r = await fetch(CDP + '/json/close/' + tab.id, { method: 'PUT' })
    await r.text()
  } catch {}
}

console.log(`RESULT ${pass} passed / ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
