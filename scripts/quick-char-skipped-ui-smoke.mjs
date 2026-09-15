// 织卷无头冒烟 · 快速建档「已有档案不覆盖」skipped 分支（创作层 2026-09-15 15:45 候选2）
// 用法：node scripts/quick-char-skipped-ui-smoke.mjs
// 前置：node scripts/serve-renderer.mjs（8123）；本机专用无头 Chrome CDP 127.0.0.1:9224
// 链路（devShim + ?zj-guard=3 注入 1 已纠正 + 2 未建档(新角色1/新角色2)）：
//   设置开「批注定时优化」→ 回项目 10s 自动首扫生成批注提案 → 顶栏「待确认提案」→ 抽屉「接受」
//   → 接受后触发切片同步 → toast「（拦截 3 条）」+ action「为 2 名人物建档案」
//   → **点击前用 writeDoc 预置 人物/新角色1.md 作者手写内容**（模拟「作者已在别处建档/列表未刷新」竞态：
//     注入发生在同步时，issues 已含新角色1；建档时 readDoc 现查拿到手写档）
//   → 点击 → 断言：新角色1 未被覆盖（内容不变）、新角色2 落盘模板、toast「已为 1 名人物建档案，1 名已有档案未改动」
//   → 数据层重跑 agentSync：两 target 均已落盘，不再拦截（只剩已纠正 1 条）
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
const PID = 'demo-aseya'
const HANDWRITTEN = [
  '---',
  '姓名: 新角色1',
  '身份: 码头会计',
  '---',
  '',
  '# 新角色1',
  '',
  '- 作者手写档案：她每晚都在候船厅数船票，从不出错。（此档为冒烟预置，绝不能被模板覆盖）',
  ''
].join('\n')
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

console.log('--- 快速建档 skipped 分支（已有档案绝不覆盖） ---')
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

  // ② 10s 自动首扫 → 生成批注提案 → 抽屉接受（与 quick-char-toast 同前置链路）
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

  // ③ toast 带拦截明细 + 建档动作按钮（issues 已注入含 新角色1/新角色2）
  await evalUntil(page, bodyHas('（拦截 3 条）'), Boolean, 20000, 'toast 拦截 3 条')
  const hasBtn = await page.eval(`[...document.querySelectorAll('.zj-toast button')].some((b) => (b.innerText || '').trim() === '为 2 名人物建档案')`)
  ok('① 前置链路就绪：toast 拦截 3 条 + 「为 2 名人物建档案」按钮（未建档 2 条）', hasBtn === true)

  // ④ 关键：点击建档前，预置 人物/新角色1.md「作者手写内容」——模拟作者已在别处建档/列表未刷新的竞态
  const preset = await page.eval(`window.zhijuan.writeDoc('${PID}', '人物/新角色1.md', ${JSON.stringify(HANDWRITTEN)})`)
  ok('② 预置作者手写档 人物/新角色1.md（模拟列表未刷新竞态；注入时该档尚不存在）', preset === true)

  // ⑤ 点击批量建档 → 写前 readDoc 现查：新角色1 已存在 → skipped 不覆盖；新角色2 → created 模板落盘
  await page.eval(toastBtn('为 2 名人物建档案'))
  const c1 = await evalUntil(
    page,
    `window.zhijuan.readDoc('${PID}', '人物/新角色1.md')`,
    (t) => typeof t === 'string' && t.length > 0,
    8000,
    '新角色1 读回'
  )
  ok('③ 新角色1 作者手写档未被覆盖（内容原样，模板未写入）', c1 === HANDWRITTEN, 'got: ' + JSON.stringify(c1?.slice(0, 60)))
  const c2 = await evalUntil(
    page,
    `window.zhijuan.readDoc('${PID}', '人物/新角色2.md')`,
    (t) => typeof t === 'string' && t.length > 0,
    8000,
    '新角色2 档案落盘'
  )
  ok('④ 新角色2 未建档仍新建（模板落盘：约定头+占位）', c2.includes('别名: []') && c2.includes('# 新角色2') && c2.includes('（身份 / 职业）'))

  // ⑥ toast 更新：「已为 1 名人物建档案，1 名已有档案未改动；下次保存同步不再拦截」+ 建档按钮摘除
  await evalUntil(page, bodyHas('已为 1 名人物建档案，1 名已有档案未改动；下次保存同步不再拦截'), Boolean, 10000, 'toast 更新 mixed 文案')
  const btnGone = await page.eval(`![...document.querySelectorAll('.zj-toast button')].some((b) => (b.innerText || '').includes('建档案'))`)
  ok('⑤ toast 更新「已为 1 名人物建档案，1 名已有档案未改动」且建档按钮摘除', btnGone === true)

  // ⑦ 数据层重跑：两个 target 均已落盘（一建一跳）→ 不再拦截，只剩已纠正 1 条
  const again = await page.eval(`window.zhijuan.agentSync('${PID}', '正文/第01章_雾港.md')`)
  const issues = (again && again.guard && again.guard.issues) || []
  ok('⑥ 重跑同步不再拦截新角色（只剩已纠正 1 条）', issues.length === 1 && issues[0].action === 'corrected' && !JSON.stringify(issues).includes('新角色'), JSON.stringify(issues))

  // ⑧ 截图存证（toast 已更新态）
  const shot = await page.cmd('Page.captureScreenshot', { format: 'png' })
  if (shot?.data) {
    const { writeFileSync, mkdirSync } = await import('node:fs')
    mkdirSync(process.env.HOME + '/Pictures/zhijuan', { recursive: true })
    const p = `${process.env.HOME}/Pictures/zhijuan/guard-bulk-skipped-${new Date().toTimeString().slice(0, 5).replace(':', '')}.png`
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
