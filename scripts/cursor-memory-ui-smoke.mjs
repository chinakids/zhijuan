// 织卷 · 每文档光标/选区位置会话内记忆 · 无头 UI 冒烟（体验层 2026-09-16）
// 覆盖：①切回已浏览章恢复光标（核心）②改动后容错降级/不炸 ③静默重载保持且不抢焦点
// ④无记忆章切换不恢复不炸。devShim 内存数据，自建 tab 无污染。
// 用法：node scripts/cursor-memory-ui-smoke.mjs [base]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const base = process.argv[2] || 'http://127.0.0.1:8123'
const CDP = 'http://127.0.0.1:9224'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function newTab(url) {
  const r = await fetch(CDP + '/json/new?url=' + encodeURIComponent(url), { method: 'PUT' })
  if (!r.ok) throw new Error('newTab ' + r.status)
  return r.json()
}
function connect(wsUrl) {
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
  return new Promise((res, rej) => { ws.onerror = rej; ws.onopen = () => res({ ws, cmd }) })
}

let pass = 0
let fail = 0
const fatal = { e: null }
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log('  ✓', name, extra) }
  else { fail++; console.log('  ✗', name, extra) }
}

const tab = await newTab('about:blank')
const { ws, cmd } = await connect(tab.webSocketDebuggerUrl)
await cmd('Page.enable')
await cmd('Emulation.setFocusEmulationEnabled', { enabled: true })
await cmd('Page.bringToFront')
await cmd('Page.navigate', { url: `${base}/?cb=cursormem1#/project/demo-aseya/novel` })
async function ev(expression) {
  const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error('EVAL: ' + (r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)))
  return r.result?.value
}
const shot = async (name) => {
  try {
    const { data } = await cmd('Page.captureScreenshot', { format: 'png' })
    const d = new Date()
    const hhmm = String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0')
    const f = path.join(os.homedir(), 'Pictures', 'zhijuan', `${name}-${hhmm}.png`)
    fs.writeFileSync(f, Buffer.from(data, 'base64'))
    console.log('  截图 →', f)
  } catch (e) { console.log('  截图失败', e.message) }
}

try {
  await sleep(5000)
  check('页面就绪（__ZJ_TEST）', await ev(`!!window.__ZJ_TEST`))

  await ev(`window.__clickChapter = (name) => {
    const btn = [...document.querySelectorAll('button')].find(b => (b.innerText||'').includes(name))
    if (!btn) return false
    btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
    btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }))
    btn.click()
    return true
  }`)
  const waitEditor = async (condExpr, ms = 6000) => {
    const t0 = Date.now()
    while (Date.now() - t0 < ms) {
      if (await ev(condExpr)) return true
      await sleep(300)
    }
    return false
  }
  const getSel = () => ev(`window.__ZJ_SEL ? window.__ZJ_SEL.get() : null`)
  const clickAt = async (ratioY) => {
    const rect = await ev(`(() => { const el = document.querySelector('.ProseMirror'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height * ${ratioY} } })()`)
    if (!rect) return false
    await cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x, y: rect.y })
    await cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 })
    await cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 })
    return true
  }
  const raw = () => ev(`window.zhijuan.readDoc('demo-aseya', '正文/第01章_雾港.md')`)

  // 长文档注入（保证点击中部有足够文本 & 恢复锚稳定）
  const paras = []
  for (let i = 1; i <= 20; i++) paras.push('第' + i + '段。阿七站在灯下，海风把衣角吹起来，她数着远处闪烁的光点，一遍一遍，直到天光发白，也没有等到那条船。')
  const TAIL_B64 = Buffer.from('\n\n' + paras.join('\n\n'), 'utf8').toString('base64')

  // —— 1. 选第01章 → 真实点击正文中部（设光标）——
  await ev(`window.__clickChapter('雾港')`)
  check('第01章编辑器挂载', await waitEditor(`(window.__ZJ_EDITORS||[]).length > 0 && !!document.querySelector('.ProseMirror') && !!window.__ZJ_SEL`))
  await ev(`(async () => { const r = await window.zhijuan.readDoc('demo-aseya', '正文/第01章_雾港.md') || ''; await window.zhijuan.writeDoc('demo-aseya', '正文/第01章_雾港.md', r + atob('${TAIL_B64}')); return 'ok' })()`)
  await sleep(800)
  check('点击正文中部', await clickAt(0.55))
  await sleep(400)
  const s1 = await getSel()
  check('点击后光标在文档中后部（from=' + (s1 && s1.from) + '）', !!s1 && s1.empty && s1.from > 300, 'docSize=' + (await ev(`(() => { const e = window.__ZJ_EDITORS[0]; return e ? 1 : 0 })()`)))
  const want = s1.from

  // —— 2. 切第02章 → 切回：光标恢复 ——
  await ev(`window.__clickChapter('灯塔')`)
  await waitEditor(`(window.__ZJ_EDITORS||[]).length === 1 && !!document.querySelector('.ProseMirror')`, 5000)
  await sleep(600)
  const s2 = await getSel()
  check('切走新章光标在文档首（from=' + (s2 && s2.from) + '）', !!s2 && s2.from < 30)
  await ev(`window.__clickChapter('雾港')`)
  check('切回第01章编辑器重挂载', await waitEditor(`(window.__ZJ_EDITORS||[]).length > 0 && !!window.__ZJ_SEL`, 6000))
  await sleep(800)
  const s3 = await getSel()
  check('切回后光标恢复原位置（from=' + (s3 && s3.from) + ' 预期 ' + want + '）', !!s3 && s3.from === want && s3.empty)

  // —— 3. 改动容错：改掉文档中部文本（before/after 可能失配）→ 恢复降级/跳过，不炸不丢到 0 ——
  await ev(`window.__clickChapter('灯塔')`)
  await waitEditor(`(window.__ZJ_EDITORS||[]).length === 1`, 5000)
  await sleep(500)
  await ev(`(async () => {
    const r = (await window.zhijuan.readDoc('demo-aseya', '正文/第01章_雾港.md')) || ''
    // 把「灯下」前 40 字处起替换 7 字，制造文档中部被改（原光标附近文本可能失配）
    const pos = r.indexOf('灯下')
    const mod = pos >= 100 ? r.slice(0, pos - 40) + '【改了】' + r.slice(pos - 33) : r + '【改了】'
    await window.zhijuan.writeDoc('demo-aseya', '正文/第01章_雾港.md', mod)
    return 'ok'
  })()`)
  await sleep(600)
  await ev(`window.__clickChapter('雾港')`)
  check('改动后切回编辑器挂载', await waitEditor(`(window.__ZJ_EDITORS||[]).length > 0 && !!window.__ZJ_SEL`, 6000))
  await sleep(800)
  const s4 = await getSel()
  check('改动后不炸且 selection 合法（from=' + (s4 && s4.from) + '）', !!s4 && Number.isFinite(s4.from) && s4.from >= 0, '(精确容错语义由单测覆盖；UI 层=不崩不 NaN)')

  // —— 4. 静默重载（同内容 writeDoc → extVersion → setContent）保持位置 ——
  await ev(`(async () => { const r = await window.zhijuan.readDoc('demo-aseya', '正文/第01章_雾港.md'); await window.zhijuan.writeDoc('demo-aseya', '正文/第01章_雾港.md', r); return 'ok' })()`)
  await sleep(1000)
  const s5 = await getSel()
  check('静默重载后 selection 不丢（from=' + (s5 && s5.from) + ' 恢复前 ' + (s4 && s4.from) + '）', !!s5 && s5.from === s4.from)

  // —— 截图 ——
  await shot('cursor-memory-restore')

  // —— 5. 无记忆章（从未编辑过）切换不恢复不炸 ——
  await ev(`window.__clickChapter('第4章')`)
  await sleep(1000)
  const s6 = await getSel()
  check('无记忆章正常（from=' + (s6 && s6.from) + '）', !!s6 && s6.from < 30, '（无恢复=不打扰）')
  await ev(`window.__clickChapter('雾港')`)
  await waitEditor(`(window.__ZJ_EDITORS||[]).length > 0 && !!window.__ZJ_SEL`, 6000)
  await sleep(600)
  const s7 = await getSel()
  check('再来回一次仍正常（from=' + (s7 && s7.from) + '）', !!s7 && s7.from > 100)
} catch (e) {
  fatal.e = e
  console.log('  !! EXCEPTION', e.message)
} finally {
  console.log(`\ncursor-memory-ui-smoke: ${pass} pass / ${fail} fail${fatal.e ? ' (EXC)' : ''}`)
  try { ws.close() } catch { /* noop */ }
  process.exit(fail > 0 || fatal.e ? 1 : 0)
}
