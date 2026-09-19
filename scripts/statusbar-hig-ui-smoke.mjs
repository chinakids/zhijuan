// 正文编辑状态条·HIG 走查冒烟（2026-09-20 体验层 02:15 轮）
// 背景：候选「正文页编辑状态条与保存反馈走查」。走查发现的实缺（本轮修）：
//  ① 长提示（拦截/失败）会把「保存 ⌘S」按钮挤成 20px 宽/3 行高（违反 F-20260917-01 按钮规范）
//  ② 拦截提示「再按一次保存确认」/失败重试时保存钮 disabled=true（只剩 ⌘S 能走，鼠标入口失效）
//  ③ 状态文本无 role=status（屏幕阅读器不播报保存结果；HIG 状态反馈可感知）
//  ④ 保存中态为纯静态文字（HIG Progress「保持进展可见」）→ 加 12px 转圈
//  ⑤ 真机 fs 事件随保存回灌 extVersion →「✓ 已保存」被重载 effect 立刻擦成 idle（反馈几乎不可见）
// 断言：idle/未保存/已保存/拦截/失败 五态呈现 + 按钮禁用逻辑 + 1000 窄窗不越界 + role=status + 零 JS 异常
// 用法：node scripts/statusbar-hig-ui-smoke.mjs （先 npm run build + node scripts/serve-renderer.mjs 8123，CDP 9224 在跑）
const PORT = 8123
const BASE = process.env.ZJ_SMOKE_BASE || `http://localhost:${PORT}`
const page = await (await fetch('http://127.0.0.1:9224/json/new?' + encodeURIComponent(`${BASE}/?cb=${Date.now()}`), { method: 'PUT' })).json()
if (!page) { console.error('NO PAGE'); process.exit(1) }
const watchdog = setTimeout(() => { console.error('WATCHDOG TIMEOUT'); process.exit(2) }, 180000)
const ws = new WebSocket(page.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
const errors = []
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params?.exceptionDetails?.text ?? 'exception')
  if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') errors.push('console.error')
}
function cmd(method, params = {}) {
  return new Promise((res, rej) => {
    const id = ++seq
    const to = setTimeout(() => { pending.delete(id); rej(new Error(`CDP TIMEOUT: ${method}`)) }, 8000)
    pending.set(id, (m) => { clearTimeout(to); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result) })
    ws.send(JSON.stringify({ id, method, params }))
  })
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ev = async (expression) => {
  const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
  return r.result?.value
}
await new Promise((r) => (ws.onopen = r))
await cmd('Runtime.enable')
let pass = 0, fail = 0
const ok = (cond, msg) => { console.log((cond ? '✅ ' : '❌ ') + msg); cond ? pass++ : fail++ }
const shot = async (name) => {
  try {
    const s = await cmd('Page.captureScreenshot', { format: 'png' })
    if (!s?.data) return
    const fs = await import('node:fs')
    const hhmm = new Date().toTimeString().slice(0, 5).replace(':', '')
    fs.writeFileSync(`${process.env.HOME}/Pictures/zhijuan/${name}-${hhmm}.png`, Buffer.from(s.data, 'base64'))
    console.log(`📸 截图: ~/Pictures/zhijuan/${name}-${hhmm}.png`)
  } catch (e) { console.log('截图失败（不阻断）: ' + e.message) }
}
// 状态条定位（复用 save-guard 的查找口径）
const barSniff = `(() => {
  const bar = [...document.querySelectorAll('div')].find((d) => (d.className || '').includes('h-7') && (d.className || '').includes('border-t') && d.textContent.includes('保存'))
  if (!bar) return null
  const saveBtn = [...bar.querySelectorAll('button')].find((b) => (b.textContent || '').includes('保存'))
  const stSpan = bar.querySelector('span[role="status"]')
  return {
    text: bar.innerText,
    saveDisabled: saveBtn ? saveBtn.disabled : null,
    saveW: saveBtn ? saveBtn.getBoundingClientRect().width : null,
    blk: { l: bar.getBoundingClientRect().left, r: bar.getBoundingClientRect().right },
    saveR: saveBtn ? saveBtn.getBoundingClientRect().right : null,
    stR: stSpan ? stSpan.getBoundingClientRect().right : null,
    stH: stSpan ? stSpan.getBoundingClientRect().height : null,
    stTitle: stSpan ? (stSpan.getAttribute('title') || '') : '',
    hasRole: !!stSpan
  }
})()`

// ===== 0. 打开 Novel 页并选中第1章 =====
await cmd('Page.navigate', { url: `${BASE}/?cb=${Date.now()}#/project/demo-aseya/novel` })
await sleep(3000)
const clicked = await ev(`(() => {
  const btn = [...document.querySelectorAll('aside button')].find((b) => (b.innerText || '').includes('第1章') && (b.innerText || '').includes('雾港'))
  if (!btn) return false
  btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
  btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }))
  btn.click()
  return true
})()`)
ok(!!clicked, '点击了第1章（雾港）')
await sleep(2500)
ok(await ev(`!!(window.__ZJ_EDITORS && window.__ZJ_EDITORS.length)`), '编辑器实例已挂载')

// ===== 1. idle：无改动 → 保存钮禁用（防无谓写盘） =====
let s = await ev(barSniff)
ok(s && s.text.includes('历史') && s.text.includes('保存 ⌘S'), '状态条就绪（历史/保存同槽）')
ok(s && s.saveDisabled === true, 'idle 态保存钮禁用')
ok(s && s.hasRole === true, '状态文本带 role=status（HIG 状态可感知）')

// ===== 2. 编辑 → 未保存 =====
await ev(`window.__ZJ_EDITORS[0].setContent('走查正文：雾尚未散尽，栈桥的木栏结了一层盐霜。\\n\\n第二段。')`)
await sleep(1200)
s = await ev(barSniff)
ok(s && (s.text || '').includes('● 未保存'), 'dirty 态呈现「● 未保存」')
ok(s && s.saveDisabled === false, 'dirty 态保存钮可用')

// ===== 3. 点击保存 → 「✓ 已保存」可见（修复⑤：不被 extVersion 重载擦掉） =====
await ev(`(() => {
  const bar = [...document.querySelectorAll('div')].find((d) => (d.className || '').includes('h-7') && (d.className || '').includes('border-t') && d.textContent.includes('保存'))
  const btn = [...bar.querySelectorAll('button')].find((b) => (b.textContent || '').includes('保存'))
  btn.click(); return true
})()`)
let seenSaved = false
for (let i = 0; i < 12; i++) {
  await sleep(150)
  const x = await ev(barSniff)
  if (x && (x.text || '').includes('✓ 已保存')) { seenSaved = true; break }
}
ok(seenSaved, '保存后可见「✓ 已保存」即时反馈（HIG 反馈即时无歧义）')
await shot('statusbar-saved')
await sleep(2400)
s = await ev(barSniff)
ok(s && !(s.text || '').includes('已保存'), '1.8s 后「已保存」自动回 idle')

// ===== 4. 正文疑似为空：拦截提示 + 保存钮应可用（修复②） =====
await ev(`window.__ZJ_EDITORS[0].setContent('')`)
await sleep(1200)
await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true }))`)
await sleep(1500)
s = await ev(barSniff)
ok(s && (s.text || '').includes('正文疑似为空'), '拦截提示出现（正文疑似为空）')
ok(s && (s.text || '').includes('再按一次保存确认'), '拦截提示含两步确认指引')
ok(s && s.saveDisabled === false, '拦截后保存钮可用（修复②：鼠标入口可走两步确认）')
ok(s && s.stH !== null && s.stH <= 22, `拦截提示单行不换行（stH=${s?.stH?.toFixed?.(0) ?? s?.stH}）`)
ok(s && s.saveW !== null && s.saveW >= 40, `保存钮未被挤碎（w=${s?.saveW?.toFixed?.(0) ?? s?.saveW}）`)
ok(s && s.saveR !== null && s.blk && s.saveR <= s.blk.r + 0.5, '保存钮未越出状态条右缘')
ok(s && (s.stTitle || '').includes('正文疑似为空'), '长提示完整内容在 title（hover 可读，截断不丢信息）')
await shot('statusbar-block')

// ===== 5. 1000 窄窗：拦截态仍不越界（编辑器 ~440 宽的最紧场景） =====
await cmd('Emulation.setDeviceMetricsOverride', { width: 1000, height: 700, deviceScaleFactor: 1, mobile: false })
await sleep(800)
s = await ev(barSniff)
ok(s && s.saveR !== null && s.blk && s.saveR <= s.blk.r + 0.5, '1000 宽下保存钮仍在状态条内（未越界）')
ok(s && s.stH !== null && s.stH <= 22, '1000 宽下拦截提示仍单行（截断生效）')
await cmd('Emulation.clearDeviceMetricsOverride')

// ===== 6. 两步确认：再点保存钮 → 写空放行；随后恢复内容 =====
await ev(`(() => {
  const bar = [...document.querySelectorAll('div')].find((d) => (d.className || '').includes('h-7') && (d.className || '').includes('border-t') && d.textContent.includes('保存'))
  const btn = [...bar.querySelectorAll('button')].find((b) => (b.textContent || '').includes('保存'))
  btn.click(); return true
})()`)
await sleep(1500)
const diskAfter = await ev(`(async () => (await window.zhijuan.readDoc('demo-aseya', '正文/第01章_雾港.md')) || '')()`)
ok(diskAfter.length < 200, `两步确认放行写空（盘上 ${diskAfter.length} 字符）`)
// 恢复内容（demo 种子健康）
await ev(`window.__ZJ_EDITORS[0].setContent('走查正文：雾尚未散尽，栈桥的木栏结了一层盐霜。\\n\\n第二段。')`)
await sleep(1200)
await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true }))`)
await sleep(1500)

// ===== 7. 错误态（?zj-fail=writeDoc 一次性注入）：失败提示 + 保存钮可重试（修复②/③） =====
await cmd('Page.navigate', { url: `${BASE}/?cb=${Date.now()}&zj-fail=writeDoc#/project/demo-aseya/novel` })
await sleep(3000)
await ev(`(() => {
  const btn = [...document.querySelectorAll('aside button')].find((b) => (b.innerText || '').includes('第1章') && (b.innerText || '').includes('雾港'))
  if (btn) { btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' })); btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' })); btn.click() }
  return !!btn
})()`)
await sleep(2500)
await ev(`window.__ZJ_EDITORS[0].setContent('错误态正文：灯塔熄灭的第三夜。\\n\\n潮水退得异常缓慢。')`)
await sleep(1200)
await ev(`(() => {
  const bar = [...document.querySelectorAll('div')].find((d) => (d.className || '').includes('h-7') && (d.className || '').includes('border-t') && d.textContent.includes('保存'))
  const btn = [...bar.querySelectorAll('button')].find((b) => (b.textContent || '').includes('保存'))
  btn.click(); return true
})()`)
await sleep(1000)
s = await ev(barSniff)
ok(s && (s.text || '').includes('保存失败'), '错误态呈现「保存失败」')
ok(s && s.saveDisabled === false, '错误后保存钮可点（=就地重试，修复②）')
await shot('statusbar-error')
// 失败注入是一次性的 → 再点一次应成功
await ev(`(() => {
  const bar = [...document.querySelectorAll('div')].find((d) => (d.className || '').includes('h-7') && (d.className || '').includes('border-t') && d.textContent.includes('保存'))
  const btn = [...bar.querySelectorAll('button')].find((b) => (b.textContent || '').includes('保存'))
  btn.click(); return true
})()`)
let retried = false
for (let i = 0; i < 10; i++) {
  await sleep(150)
  const x = await ev(barSniff)
  if (x && (x.text || '').includes('✓ 已保存')) { retried = true; break }
}
ok(retried, '失败后经按钮重试成功（就地重试链路通）')

// ===== 8. 零 JS 异常 =====
ok(errors.length === 0, `零 JS 异常（累计 ${errors.length}）${errors.length ? '：' + errors.slice(0, 3).join('; ') : ''}`)

clearTimeout(watchdog)
try { await fetch('http://127.0.0.1:9224/json/close/' + page.id, { method: 'PUT' }) } catch {}
ws.close()
console.log(`\nSTATUSBAR-HIG RESULT: ${pass}/${pass + fail}`)
process.exit(fail > 0 ? 1 : 0)
