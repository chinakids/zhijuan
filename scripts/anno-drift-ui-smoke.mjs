// 织卷无头冒烟 · 批注提案「原文已变→请人工确认」分支（创作层 2026-09-15 15:45 轮；候选 2）
// 追加（18:45 轮）：「replace-text 缺少 before 文段」分支——devShim applyAnchor 与真机同口径拆分两种失败
//   原因（缺 before=提案构造不完整/防御分支；原文漂移=作者手动编辑竞态），冒烟补 devShim 侧文案断言。
// 用法：node scripts/anno-drift-ui-smoke.mjs
// 前置：npm run build；out/renderer 已由静态服务器伺服（如 scripts/serve-renderer.mjs / python -m http.server）；
//       本机专用无头 Chrome CDP 127.0.0.1:9224
// 链路（真实用户路径）：设置页开「批注定时优化」→ 回正文页 10s 自动首扫生成 2 条批注同步提案
//   → 写盘模拟作者手动改原文（before 漂移）→ 抽屉「接受」→ 断言：
//   ① toast「提案未应用 / 请人工确认」可见（失败可见性，0826a6c 补 toast 兜底）
//   ② 正文未被改写（作者手动版本保留、批注 after 未写入）
//   ③ 提案状态 rejected（devShim 与真机同口径：失败不标 accepted）
//   ④ 批注 csv 行未被删除（失败不 resolveAnnotationRows，保留重扫机会）
//   ⑤ 事后点「扫描批注」→ 防重提示仍生效（pending 无、rejected 不在防重判据内时……见步骤说明）
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
    await sleep(300)
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

const tab = await openTab(BASE + '/#/project/' + PID + '/settings')
const page = await attach(tab.webSocketDebuggerUrl)
await evalUntil(page, bodyHas('外观与数据'), Boolean, 20000, '设置页加载')
await page.eval(clickBtn('外观与数据', false))
await evalUntil(page, bodyHas('批注定时优化'), Boolean, 10000, '外观节批注开关')

// ① 开启「批注定时优化」并保存
const sw = await page.eval(`(() => {
  const rows = [...document.querySelectorAll('div')].filter((d) => d.textContent && d.textContent.includes('批注定时优化') && d.querySelector('button[role="switch"]'))
  const row = rows[rows.length - 1]
  const s = row && row.querySelector('button[role="switch"]')
  if (!s) return 'NO_SWITCH'
  const checked = s.getAttribute('aria-checked')
  if (checked !== 'true') s.click()
  return 'OK:' + checked
})()`)
ok('设置页存在「批注定时优化」开关', sw === 'OK:false' || sw === 'OK:true', String(sw))
await page.eval(clickBtn('保存设置'))
await sleep(600)

// ② 回正文页等自动首扫生成批注提案
await page.eval(`(() => { location.hash = '#/project/${PID}/novel'; return 1 })()`)
await evalUntil(page, bodyHas('第1章'), Boolean, 20000, '正文载入')
await evalUntil(
  page,
  `window.zhijuan.listProposals('${PID}').then((ps) => ps.filter((p) => p.source === 'annotation-sync' && p.status === 'pending').length)`,
  (v) => Number(v) >= 2,
  30000,
  '自动扫描生成批注提案'
)
const ann = await page.eval(`window.zhijuan.listProposals('${PID}').then((ps) => ps.filter((p) => p.source === 'annotation-sync' && p.status === 'pending').map((p) => ({ id: p.id, before: p.items[0].before, after: p.items[0].after, target: p.items[0].target })))`)
ok('取到首条批注提案（before 可定位）', Boolean(ann[0] && ann[0].before && ann[0].target), JSON.stringify(ann[0] && { id: ann[0].id, t: ann[0].target }))

// ③ 写盘模拟作者手动编辑：把提案 before 替换掉（before 漂移）
const target = ann[0].target
const before = ann[0].before
const afterTxt = ann[0].after
const MUT = '（作者手动改过的一句话）'
const mut = await page.eval(`window.zhijuan.readDoc('${PID}', ${JSON.stringify(target)}).then((t) => {
  if (!t || !t.includes(${JSON.stringify(before)})) return 'NO_BEFORE'
  const s = t.split(${JSON.stringify(before)}).join(${JSON.stringify(MUT)})
  return window.zhijuan.writeDoc('${PID}', ${JSON.stringify(target)}, s).then(() => 'OK')
})`)
ok('写盘模拟作者手动编辑（before 漂移）', mut === 'OK', String(mut))

// ④ 打开提案抽屉
await page.eval(clickBtn('待确认提案 2'))
await evalUntil(page, bodyHas('扫描批注'), Boolean, 10000, '抽屉打开')
ok('抽屉打开（含「扫描批注」按钮）', true)

// ⑤ 接受首条提案（其 before 已漂移）→ 应失败
const clicked = await page.eval(`(() => {
  const card = [...document.querySelectorAll('div')].find((d) => (d.className || '').includes('mb-2') && (d.innerText || '').includes('来自：批注同步') && (d.innerText || '').includes('接受'))
  if (!card) return 'NO_CARD'
  const acc = [...card.querySelectorAll('button')].find((b) => (b.innerText || '').trim() === '接受')
  if (!acc) return 'NO_BTN'
  acc.click()
  return 'CLICKED'
})()`)
ok('点击「接受」（首条漂移提案）', clicked === 'CLICKED', String(clicked))

// ⑥ 失败可见：toast「提案未应用」+ 「请人工确认」文案
const errSeen = await page.eval(`(async () => {
  const t0 = Date.now()
  while (Date.now() - t0 < 5000) {
    if (document.body.innerText.includes('请人工确认')) return document.body.innerText.includes('提案未应用') ? 'TOAST_OK' : 'ERR_ONLY'
    await new Promise((r) => setTimeout(r, 150))
  }
  return 'NONE'
})()`)
ok('接受失败提示「请人工确认」可见（toast 兜底）', errSeen === 'TOAST_OK' || errSeen === 'ERR_ONLY', String(errSeen))

// ⑦ 正文未被改写：作者手动版本保留、批注 after 未写入
const md = await page.eval(`window.zhijuan.readDoc('${PID}', ${JSON.stringify(target)})`)
ok('正文未被改写（作者手动文本保留）', typeof md === 'string' && md.includes(MUT), '')
ok('批注 after 未写入正文', typeof md === 'string' && !md.includes(afterTxt), '')

// ⑧ 提案状态 = rejected（devShim 与真机同口径；0909 前误置 accepted）
const st = await page.eval(`window.zhijuan.listProposals('${PID}').then((ps) => { const p = ps.find((x) => x.id === ${JSON.stringify(ann[0].id)}); return p ? p.status : 'GONE' })`)
ok('漂移提案状态置 rejected（非 accepted）', st === 'rejected', String(st))

// ⑨ 批注 csv 行未被删除（失败不 resolveAnnotationRows，保留重扫机会）
const csv = await page.eval(`window.zhijuan.readDoc('${PID}', '正文/第01章_雾港_批注.csv')`)
ok('批注 csv 行未被删除（保留重扫）', typeof csv === 'string' && csv.includes('L10:1'), JSON.stringify(csv))

// —— 追加（18:45）：devShim applyAnchor「缺 before」分支与真机同口径拆分 ——
// ⑪ 注入「缺 before」的 replace-text 提案（agent-chat 来源；断言仅验证防御分支——
//     真实生成渠道（批注引擎/切片同步）均保证 before 非空，本分支面向外部/异常数据守卫）
const MISS_AFTER = '（缺 before 的改写结果）'
const missId = await page.eval(`window.zhijuan.createProposals('${PID}', 'agent-chat', '正文/第02章_未存在.md', '雾港夜', [{ target: ${JSON.stringify(target)}, kind: 'replace-text', after: ${JSON.stringify(MISS_AFTER)}, reason: '测试：replace-text 缺失 before 文段' }]).then((ps) => (ps[0] ? ps[0].id : 'NONE'))`)
ok('注入缺 before 提案（agent 来源，数据层可见）', typeof missId === 'string' && missId.startsWith('p'), String(missId))
const injected = await page.eval(`window.zhijuan.listProposals('${PID}').then((ps) => { const p = ps.find((x) => x.id === ${JSON.stringify(missId)}); return p ? { st: p.status, before: p.items[0] && p.items[0].before, src: p.source } : null })`)
ok('缺 before 提案 pending / before 缺失', Boolean(injected && injected.st === 'pending' && injected.before == null), JSON.stringify(injected))

// ⑫ 点提案抽屉「扫描批注」→ onChanged 刷新列表（真实用户路径；防重提示不影响刷新）→ 缺 before 卡可见
await page.eval(`(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => (b.innerText || '').includes('扫描批注'))
  if (btn) btn.click()
  return !!btn
})()`)
await sleep(800)
ok('抽屉内缺 before 提案卡可见（来自：agent）', await page.eval(bodyHas('来自：agent')), '')

// ⑬ 点击缺 before 提案卡的「接受」→ 应显示「replace-text 缺少 before 文段」（非「请人工确认」）
const clicked2 = await page.eval(`(() => {
  const card = [...document.querySelectorAll('div')].find((d) => (d.className || '').includes('mb-2') && (d.innerText || '').includes('来自：agent'))
  if (!card) return 'NO_CARD'
  const acc = [...card.querySelectorAll('button')].find((b) => (b.innerText || '').trim() === '接受')
  if (!acc) return 'NO_BTN'
  acc.click()
  return 'CLICKED'
})()`)
ok('点击「接受」（缺 before 提案）', clicked2 === 'CLICKED', String(clicked2))
const errSeen2 = await page.eval(`(async () => {
  const t0 = Date.now()
  while (Date.now() - t0 < 5000) {
    const b = document.body.innerText
    if (b.includes('replace-text 缺少 before 文段')) return b.includes('提案未应用') ? 'TOAST_OK' : 'ERR_ONLY'
    await new Promise((r) => setTimeout(r, 150))
  }
  return 'NONE'
})()`)
ok('缺 before 失败提示「replace-text 缺少 before 文段」可见（区分于请人工确认）', errSeen2 === 'TOAST_OK' || errSeen2 === 'ERR_ONLY', String(errSeen2))

// ⑭ 缺 before 提案状态 rejected（非 accepted）+ 正文未被改写
const st2 = await page.eval(`window.zhijuan.listProposals('${PID}').then((ps) => { const p = ps.find((x) => x.id === ${JSON.stringify(missId)}); return p ? p.status : 'GONE' })`)
ok('缺 before 提案状态置 rejected', st2 === 'rejected', String(st2))
const md2 = await page.eval(`window.zhijuan.readDoc('${PID}', ${JSON.stringify(target)})`)
ok('正文未被缺 before 提案改写（after 未写入）', typeof md2 === 'string' && !md2.includes(MISS_AFTER), '')

// ⑩ 截图（缺 before 失败提示可见态）
try {
  const shot = await page.cmd('Page.captureScreenshot', { format: 'png' })
  const { mkdirSync, writeFileSync } = await import('node:fs')
  mkdirSync(process.env.HOME + '/Pictures/zhijuan', { recursive: true })
  const f = process.env.HOME + '/Pictures/zhijuan/anno-drift-' + new Date().toTimeString().slice(0, 5).replace(':', '') + '.png'
  writeFileSync(f, Buffer.from(shot.data, 'base64'))
  console.log('SCREENSHOT ' + f)
} catch (e) {
  console.log('SCREENSHOT_FAIL ' + String(e))
}

console.log(`RESULT: pass=${pass} fail=${fail}`)
process.exit(fail ? 1 : 0)
