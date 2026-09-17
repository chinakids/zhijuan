// 织卷 · 正文多章切换滚动位置记忆 · 无头 UI 冒烟（体验层 2026-09-16）
// 覆盖：①切回已浏览章恢复滚动位置（核心）②保存静默重载后位置保持 ③无记忆章不恢复不炸
// ④切走位置被保存（存在性由①间接证明）。devShim 内存数据，自建 tab 无污染。
// 用法：node scripts/doc-scroll-memory-ui-smoke.mjs [base]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const base = process.argv[2] || 'http://127.0.0.1:8899'
const CDP = 'http://127.0.0.1:9224'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 长文档注入内容（base64 绕 CDP 转义）
const paras = []
for (let i = 1; i <= 16; i++) paras.push('第' + i + '段。阿七站在灯下，海风把衣角吹起来，她数着远处闪烁的光点，一遍一遍，直到天光发白，也没有等到那条船。')
const TAIL_B64 = Buffer.from('\n\n' + paras.join('\n\n'), 'utf8').toString('base64')

async function newTab(url) {
  const r = await fetch(CDP + '/json/new?url=' + encodeURIComponent(url), { method: 'PUT' })
  if (!r.ok) throw new Error('newTab ' + r.status)
  return r.json()
}
function connect(wsUrl) {
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
  return new Promise((res, rej) => { ws.onerror = rej; ws.onopen = async () => { await cmd('Runtime.enable'); res({ ws, cmd, errors }) } })
}

let pass = 0
let fail = 0
const fatal = { e: null }
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log('  ✓', name, extra) }
  else { fail++; console.log('  ✗', name, extra) }
}

const tab = await newTab('about:blank')
const { ws, cmd, errors } = await connect(tab.webSocketDebuggerUrl)
await cmd('Page.enable')
await cmd('Page.navigate', { url: `${base}/?cb=scrollmem1#/project/demo-aseya/novel` })
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

  await ev(`window.__getScroller = () => {
    const pm = document.querySelector('.ProseMirror'); if (!pm) return null
    let n = pm.parentElement
    while (n && n !== document.body) {
      const s = getComputedStyle(n)
      if (s.overflowY === 'auto' || s.overflowY === 'scroll') return n
      n = n.parentElement
    }
    return null
  }`)
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
  const scrollTop = () => ev(`(() => { const s = window.__getScroller(); return s ? s.scrollTop : null })()`)

  // —— 注入长文档（第01章扩展到 16 段）——
  await ev(`(async () => { const raw = await window.zhijuan.readDoc('demo-aseya', '正文/第01章_雾港.md') || ''; return await window.zhijuan.writeDoc('demo-aseya', '正文/第01章_雾港.md', raw + atob('${TAIL_B64}')) })()`)
  await sleep(800)

  // —— 1. 选第01章 → 滚到中部 ——
  await ev(`window.__clickChapter('雾港')`)
  check('第01章编辑器挂载', await waitEditor(`(window.__ZJ_EDITORS||[]).length > 0 && !!document.querySelector('.ProseMirror')`))
  await ev(`(() => { const s = window.__getScroller(); s.scrollTop = Math.min(1200, s.scrollHeight - s.clientHeight - 20); return s.scrollTop })()`)
  await sleep(300)
  const st1 = await scrollTop()
  check('滚动到中部（st=' + st1 + '）', st1 > 1000)

  // —— 2. 切第02章（无记忆）→ 3. 切回第01章：位置恢复 ——
  await ev(`window.__clickChapter('灯塔')`)
  await waitEditor(`!!document.querySelector('.ProseMirror') && (window.__ZJ_EDITORS||[]).length === 1`, 5000)
  await sleep(600)
  const st2 = await scrollTop()
  check('切走后新章顶部（st=' + st2 + '）', st2 === 0 || st2 === null)
  await ev(`window.__clickChapter('雾港')`)
  check('切回第01章编辑器重挂载', await waitEditor(`(window.__ZJ_EDITORS||[]).length > 0 && !!document.querySelector('.ProseMirror')`, 6000))
  const okRestore = await waitEditor(`(() => { const s = window.__getScroller(); return !!s && s.scrollTop > 1000 })()`, 5000)
  const st3 = await scrollTop()
  check('切回后滚动位置恢复（st=' + st3 + '）', okRestore, '≈1200 预期')

  // —— 4. 保存静默重载（外部写盘 → extVersion → setContent）——
  await ev(`(async () => { const raw = await window.zhijuan.readDoc('demo-aseya', '正文/第01章_雾港.md'); await window.zhijuan.writeDoc('demo-aseya', '正文/第01章_雾港.md', raw); return 'wrote' })()`)
  const okReload = await waitEditor(`(() => { const s = window.__getScroller(); return !!s && s.scrollTop > 1000 })()`, 4000)
  const st4 = await scrollTop()
  check('静默重载后位置保持（st=' + st4 + '）', okReload)

  // —— 截图（滚动中部的正文界面）——
  await shot('doc-scroll-memory')

  // —— 5. 短文档（第04章 311 字）切换无恢复不炸 ——
  await ev(`window.__clickChapter('第4章')`)
  await sleep(1200)
  check('短文档切换无异常', await ev(`!!document.querySelector('.ProseMirror')`))
} catch (e) {
  fatal.e = e
  console.log('  !! EXCEPTION', e.message)
} finally {
  console.log(`\ndoc-scroll-memory-ui-smoke: ${pass} pass / ${fail} fail${fatal.e ? ' (EXC)' : ''}`)
  try { ws.close() } catch { /* noop */ }
  if (errors.length) { fail++; console.log('  ✗ 无 JS 异常: ' + errors.slice(0, 3).join(' | ')) }
  else { console.log('  ✓ 无 JS 异常') }
  process.exit(fail > 0 || fatal.e ? 1 : 0)
}
