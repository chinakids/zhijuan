// 织卷无头冒烟 · 开关控件族走查（体验层 2026-09-16 23:15 轮，HIG Toggles）
// ---------------------------------------------------------------------------
// 背景：织卷设置页 5 组 Switch（工具开关 todo/askUser、检查能力 caps×9、联网采集、
//       批注定时优化）——作者配置面即时生效控件；919b214 通用控件状态走查未覆盖本家族。
// 调研：HIG Toggles（developer.apple.com/design/human-interface-guidelines/toggles，
//       2024-03-29 新版；旧 /switches 已 404，现存档 /tmp/hig-toggles-2315.txt）
//       关键条款：① toggle=对立值开关（非列表选择用 pop-up）；② 清晰标识开关对象（周边上下文/
//       label）；③ 状态视觉差异必须明显且**不只靠颜色**（加/去填充、显隐形状、变化细节）；
//       macOS：④ 开关用窗口主体（勿 toolbar/status bar）；⑤ switch 用于强调设置，别拿它替换
//       既有 checkbox；「checkboxes/radio」织卷无使用点（无层级/多选场景，不引入）。
// 验收：① 每开关行有 Label+说明（标识清晰）；② 两态差异=颜色+thumb 位移双通道（非仅颜色）；
//       ③ 键盘 Space 可切（Radix role=switch）；④ **即时生效一致性**：agentTools/采集/批注
//       三组开关与 caps 同口径即时落盘（改动前仅 caps 即时，其余等「保存设置」=改了不存即丢，
//       与 macOS 设置即时生效惯例及同页 caps 行为不一致——本轮收口）；⑤ aria-label=行标题
//       （role=switch 无名称的 a11y 实缺）；⑥ 两主题（暖纸/深色）两态可辨；⑦ 窄窗 1000px
//       无水平溢出、开关不被挤出；disabled 无使用点（组件样式已备，只记录）。
import { writeFileSync, mkdirSync } from 'node:fs'

const CDP = 'http://127.0.0.1:9224'
const SPA = process.env.ZJ_SMOKE_BASE || 'http://127.0.0.1:8123'
const HW = new Date().toTimeString().slice(0, 5).replace(':', '') // HHMM（截图命名契约）

const r = await fetch(`${CDP}/json/new?${encodeURIComponent(`${SPA}/#/settings?cb=${HW}`)}`, { method: 'PUT' })
const target = await r.json()
const ws = new WebSocket(target.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m)
    pending.delete(m.id)
  }
}
function cmd(method, params = {}) {
  return new Promise((res, rej) => {
    const id = ++seq
    pending.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)))
    ws.send(JSON.stringify({ id, method, params }))
  })
}
const sleep = (ms) => new Promise((res) => setTimeout(res, ms))
await new Promise((res) => (ws.onopen = res))
await cmd('Page.enable')
await cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false })

async function evalJs(expr) {
  const rr = await cmd('Runtime.evaluate', { expression: expr, returnByValue: true })
  if (rr.exceptionDetails) throw new Error('eval ex: ' + JSON.stringify(rr.exceptionDetails))
  return rr.result?.value
}
async function evalUntil(expr, pred, timeout = 30000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    const v = await evalJs(expr)
    if (pred ? pred(v) : v) return v
    await sleep(600)
  }
  throw new Error('timeout: ' + expr)
}
async function clickXY(x, y) {
  await cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 })
  await cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
}
async function clickText(text) {
  const p = await evalJs(`(() => {
    const els = [...document.querySelectorAll('button')].filter((x) => x.textContent.trim().includes(${JSON.stringify(text)}))
    const el = els[0]
    if (!el) return null
    const rr = el.getBoundingClientRect()
    return { x: rr.x + rr.width / 2, y: rr.y + rr.height / 2 }
  })()`)
  if (!p) throw new Error('clickText not found: ' + text)
  await clickXY(p.x, p.y)
}
async function pressSpace() {
  await cmd('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 })
  await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 })
}
async function shot(name) {
  const s = await cmd('Page.captureScreenshot', { format: 'png' })
  const dir = process.env.HOME + '/Pictures/zhijuan'
  mkdirSync(dir, { recursive: true })
  writeFileSync(`${dir}/${name}.png`, Buffer.from(s.data, 'base64'))
  console.log('SHOT', `${dir}/${name}.png`)
}
async function goSettings(sectionLabel, waitLabel) {
  await evalJs(`(() => { window.location.hash = '#/'; return true })()`)
  await evalUntil(`document.body.innerText.includes('项目库')`, Boolean)
  await sleep(300)
  await evalJs(`(() => { window.location.hash = '#/settings'; return true })()`)
  await evalUntil(`document.body.innerText.includes('保存设置')`, Boolean)
  await sleep(600)
  if (sectionLabel) {
    await clickText(sectionLabel)
    await evalUntil(`document.body.innerText.includes(${JSON.stringify(waitLabel)})`, Boolean)
    await sleep(500)
  }
}

let fails = 0
const ok = (m) => console.log('ok  -', m)
const bad = (m, extra) => { fails++; console.log('BAD -', m, extra ?? '') }

const rowOf = (t) => `(() => {
  const l = [...document.querySelectorAll('label')].find((x) => x.textContent.includes(${JSON.stringify(t)}))
  if (!l) return null
  const row = l.closest('div')?.parentElement
  const sw = row?.querySelector('[role="switch"]')
  const desc = l.parentElement?.querySelector('p')
  if (!row || !sw) return null
  const rr = row.getBoundingClientRect()
  const sr = sw.getBoundingClientRect()
  const dr = desc ? desc.getBoundingClientRect() : null
  const cs = getComputedStyle(sw)
  const th = sw.querySelector('[data-state]') ?? sw.firstElementChild
  const tc = th ? getComputedStyle(th) : null
  return {
    label: l.textContent,
    desc: desc ? desc.textContent.slice(0, 60) : null,
    swW: sr.width, swH: sr.height,
    checked: sw.getAttribute('data-state'),
    trackBg: cs.backgroundColor,
    labelAria: sw.getAttribute('aria-label'),
    thumbX: th ? th.getBoundingClientRect().x - sr.x : null,
    thumbBg: tc ? tc.backgroundColor : null,
    rowRight: rr.right, descRight: dr ? dr.right : null, swLeft: sr.left,
    focused: document.activeElement === sw
  }
})()`

// ---------- 入口：设置页 → 写作引擎分区 ----------
await evalUntil(`document.body.innerText.includes('保存设置')`, Boolean)
await sleep(900)
await clickText('写作引擎')
await evalUntil(`document.body.innerText.includes('任务清单（todo_write）')`, Boolean)
await sleep(600)

// ① engine 分区标签与数量（2 工具 + 9 检查能力）
const eng = await evalJs(`(() => ({
  n: document.querySelectorAll('[role="switch"]').length,
  labels: [...document.querySelectorAll('label')].map((l) => l.textContent.trim())
}))()`)
ok(`写作引擎分区开关数=${eng.n}（2 工具 + 9 检查能力）`)
if (eng.n !== 11) bad('engine 分区开关数应为 11', JSON.stringify(eng.labels))
for (const t of ['任务清单（todo_write）', '需要你确认（ask_user）', '全卷检查', '多视角审视', '本章检查', '大纲回建', '章节导演', '导演兑现检查', '素材升格', '分幕生成', '批注改写引擎']) {
  if (!eng.labels.includes(t)) bad('engine 缺行标签: ' + t)
}
ok('engine 行标签齐备')

// ② 形态：36×20 pill + 16px thumb；③ 两态差异=颜色+thumb 位移双通道
const s0 = await evalJs(rowOf('任务清单（todo_write）'))
ok(`形态 ${s0.swW}x${s0.swH}, checked=${s0.checked}, thumbX=${s0.thumbX}`)
if (Math.abs(s0.swW - 36) > 1 || Math.abs(s0.swH - 20) > 1) bad('switch 尺寸非 36×20', `${s0.swW}x${s0.swH}`)
if (!(s0.thumbX >= 16)) bad('checked thumb 位置异常', String(s0.thumbX))
// 点任务清单行内 switch（真实点击）
const swPos = await evalJs(`(() => {
  const l = [...document.querySelectorAll('label')].find((x) => x.textContent.includes('任务清单（todo_write）'))
  const sw = l?.closest('div')?.parentElement?.querySelector('[role="switch"]')
  if (!sw) return null
  const r = sw.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})()`)
if (swPos) await clickXY(swPos.x, swPos.y)
await sleep(400)
const s1 = await evalJs(rowOf('任务清单（todo_write）'))
if (s1.checked !== 'unchecked') bad('点击后应 unchecked', s1.checked)
if (s0.trackBg === s1.trackBg) bad('两态 track 颜色无差异', `${s0.trackBg} vs ${s1.trackBg}`)
if (!(s0.thumbX - s1.thumbX >= 12)) bad('thumb 位移通道不足（非仅颜色）', `x ${s1.thumbX} -> ${s0.thumbX}`)
ok(`两态可辨：track ${s0.trackBg}→${s1.trackBg}，thumb x ${s1.thumbX.toFixed(1)}→${s0.thumbX.toFixed(1)}`)

// ④ 键盘 Space 切换
await evalJs(`(() => { const l = [...document.querySelectorAll('label')].find((x) => x.textContent.includes('任务清单（todo_write）')); l?.closest('div')?.parentElement?.querySelector('[role="switch"]')?.focus(); return true })()`)
await pressSpace()
await sleep(400)
const s2 = await evalJs(rowOf('任务清单（todo_write）'))
if (s2.checked !== 'checked') bad('Space 未切回 checked', s2.checked)
else ok('Space 可切换（role=switch 键盘可达）')

// ⑤ agentTools 即时生效（本轮修复项：拨后不点保存、离开再回保持）
const p5 = await evalJs(`(() => {
  const l = [...document.querySelectorAll('label')].find((x) => x.textContent.includes('任务清单（todo_write）'))
  const sw = l?.closest('div')?.parentElement?.querySelector('[role="switch"]')
  if (!sw) return null
  const r = sw.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})()`)
if (p5) await clickXY(p5.x, p5.y)
await sleep(400)
await goSettings(null, '保存设置')
await goSettings('写作引擎', '任务清单（todo_write）')
let cur = await evalJs(rowOf('任务清单（todo_write）'))
if (cur.checked !== 'unchecked') bad('agentTools 开关未即时生效（重载回弹）', cur.checked)
else ok('agentTools 开关切后即时落盘（重载保持 off）')

// ⑥a engine 分区 aria-label 全量（2 工具 + 9 caps）
const ariaEngine = await evalJs(`(() => {
  const out = []
  document.querySelectorAll('[role="switch"]').forEach((sw) => {
    const l = sw.closest('div')?.querySelector('label') || sw.closest('div')?.parentElement?.querySelector('label')
    const expect = l ? l.textContent.trim() : '(unk)'
    if (!sw.getAttribute('aria-label')) out.push('无:' + expect)
    else if (sw.getAttribute('aria-label') !== expect) out.push('不匹配:' + expect + ' vs ' + sw.getAttribute('aria-label'))
  })
  return out
})()`)
if (ariaEngine.length) bad('engine aria-label 缺失/不匹配', ariaEngine.join('; '))
else ok('engine 开关带 aria-label=行标题')

// ⑥ 外观与数据分区：采集（默认 on）/批注（默认 off）即时性
await clickText('外观与数据')
await evalUntil(`document.body.innerText.includes('批注定时优化')`, Boolean)
await sleep(500)
cur = await evalJs(rowOf('联网采集管道'))
if (cur.checked !== 'checked') bad('前置：采集开关应默认开', cur.checked)
const collPos = await evalJs(`(() => {
  const l = [...document.querySelectorAll('label')].find((x) => x.textContent.includes('联网采集管道'))
  const sw = l?.closest('div')?.parentElement?.querySelector('[role="switch"]')
  if (!sw) return null
  const r = sw.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})()`)
await clickXY(collPos.x, collPos.y)
await sleep(400)
await goSettings(null, '保存设置')
await clickText('外观与数据')
await evalUntil(`document.body.innerText.includes('批注定时优化')`, Boolean)
await sleep(500)
cur = await evalJs(rowOf('联网采集管道'))
if (cur.checked !== 'unchecked') bad('采集开关未即时生效（离开再回丢了）', cur.checked)
else ok('采集开关切后即时落盘（重载保持 off）')
cur = await evalJs(rowOf('批注定时优化'))
if (cur.checked !== 'unchecked') bad('前置：批注开关应默认关', cur.checked)
const annoPos = await evalJs(`(() => {
  const l = [...document.querySelectorAll('label')].find((x) => x.textContent.includes('批注定时优化'))
  const sw = l?.closest('div')?.parentElement?.querySelector('[role="switch"]')
  if (!sw) return null
  const r = sw.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})()`)
await clickXY(annoPos.x, annoPos.y)
await sleep(400)
await goSettings(null, '保存设置')
await clickText('外观与数据')
await evalUntil(`document.body.innerText.includes('批注定时优化')`, Boolean)
await sleep(500)
cur = await evalJs(rowOf('批注定时优化'))
if (cur.checked !== 'checked') bad('批注开关未即时生效', cur.checked)
else ok('批注开关切后即时落盘（重载保持 on）')

// ⑦ aria-label（两分区全量）= 行标题
const ariaBad = await evalJs(`(() => {
  const out = []
  document.querySelectorAll('[role="switch"]').forEach((sw) => {
    const l = sw.closest('div')?.querySelector('label') || sw.closest('div')?.parentElement?.querySelector('label')
    const expect = l ? l.textContent.trim() : '(unk)'
    if (!sw.getAttribute('aria-label')) out.push('无:' + expect)
    else if (sw.getAttribute('aria-label') !== expect) out.push('不匹配:' + expect + ' vs ' + sw.getAttribute('aria-label'))
  })
  return out
})()`)
if (ariaBad.length) bad('aria-label 缺失/不匹配', ariaBad.join('; '))
else ok('全部开关带 aria-label=行标题')

// ⑧ 深色主题两态可辨 + 截图（按当前实际状态分组比较，不依赖前置记忆）
await clickText('深色')
await sleep(600)
const dRows = []
for (const t of ['联网采集管道', '批注定时优化']) dRows.push(await evalJs(rowOf(t)))
const dOn = dRows.find((r) => r.checked === 'checked')
const dOff = dRows.find((r) => r.checked === 'unchecked')
if (!dOn || !dOff) bad('深色下应有 on/off 两行对照', JSON.stringify(dRows.map((r) => r.checked)))
else {
  if (dOn.trackBg === dOff.trackBg) bad('深色下两态 track 同色', `${dOn.trackBg} vs ${dOff.trackBg}`)
  if (!(dOn.thumbX - dOff.thumbX >= 12)) bad('深色下 thumb 位移不足', `${dOff.thumbX}->${dOn.thumbX}`)
  ok(`深色两态可辨：on ${dOn.trackBg} / off ${dOff.trackBg}，thumb x 差 ${(dOn.thumbX - dOff.thumbX).toFixed(1)}`)
}
await shot(`switch-settings-dark-${HW}`)
await clickText('暖纸')
await sleep(600)

// ⑨ 窄窗 1000×700：无水平溢出、开关不被挤出、说明不压开关（先切写作引擎覆盖 11 开关）
await clickText('写作引擎')
await evalUntil(`document.body.innerText.includes('任务清单（todo_write）')`, Boolean)
await sleep(400)
await cmd('Emulation.setDeviceMetricsOverride', { width: 1000, height: 700, deviceScaleFactor: 2, mobile: false })
await sleep(600)
const narrow = await evalJs(`(() => {
  const de = document.scrollingElement || document.documentElement
  const overflow = de.scrollWidth - de.clientWidth
  const bad = []
  document.querySelectorAll('[role="switch"]').forEach((sw) => {
    const r = sw.getBoundingClientRect()
    if (r.right > window.innerWidth + 1 || r.left < -1) bad.push('开关出视口@' + Math.round(r.right))
    const l = sw.closest('div')?.parentElement?.querySelector('label')?.parentElement?.querySelector('p')
    if (l) {
      const dr = l.getBoundingClientRect()
      if (dr.right > r.left + 2) bad.push('说明压开关@' + l.textContent.slice(0, 10))
    }
  })
  return { overflow, bad }
})()`)
if (narrow.overflow > 1) bad('窄窗水平溢出', narrow.overflow + 'px')
if (narrow.bad.length) bad('窄窗开关被挤压', narrow.bad.join('; '))
else ok('窄窗（1000px）无溢出、开关与说明不交叠')
await cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false })
await sleep(500)
await shot(`switch-settings-${HW}`)

console.log(fails ? `\nFAIL ${fails}` : '\nALL PASS')
try { await fetch(`${CDP}/json/close/${target.id}`, { method: 'PUT' }) } catch {}
process.exit(fails ? 1 : 0)