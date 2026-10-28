// 织卷 · 文档保存态 / 采纳后实时刷新 · 无头 UI 冒烟（体验层 2026-10-28，F-20261028-05/06）
// 覆盖：
//  ①打开「AI 风格」文档（磁盘原文与 Milkdown 序列化格式不同）→ 不得显示「未保存」
//  ②外部写盘（模拟采纳提案）→ 编辑器无需重开即灌入新内容
//  ③用户真实输入 → 必须出现「● 未保存」
// devShim 内存数据；测试末尾把演示章节恢复原样。
// 用法：node scripts/ai-doc-saved-state-ui-smoke.mjs [base]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const base = process.argv[2] || 'http://127.0.0.1:8899'
const CDP = 'http://127.0.0.1:9224'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const REL = '正文/第05章_灯下.md'

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
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log('  ✓', name, extra) }
  else { fail++; console.log('  ✗', name, extra) }
}

const tab = await newTab('about:blank')
const { ws, cmd, errors } = await connect(tab.webSocketDebuggerUrl)
await cmd('Page.enable')
const ev = async (expression) => {
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
    return f
  } catch (e) { console.log('  截图失败', e.message); return '' }
}

// AI 风格正文：行尾空格 + 无标题结构 + 列表；经 Milkdown 解析→序列化必与原文不同
const AI_MD = '雾从窗缝里进来。\n\n她把灯芯剪短了一截，火苗立刻矮下去，屋子里反而更安静了。  \n\n- 门外没有脚步声\n- 潮水在下面\n'
const LIVE_MARK = '她伸手去拨那截灯芯，指尖被烫了一下。'

await cmd('Page.navigate', { url: `${base}/?cb=aidocsave#/project/demo-aseya/novel` })
await sleep(3000)

const original = await ev(`window.zhijuan.readDoc('demo-aseya', ${JSON.stringify(REL)}).then((v) => v ?? '')`)
const w = await ev(`window.zhijuan.writeDoc('demo-aseya', ${JSON.stringify(REL)}, ${JSON.stringify(AI_MD)}).then(() => 'ok').catch((e) => String(e))`)
check('准备：写入 AI 风格文档', w === 'ok', w)

await cmd('Page.reload')
await sleep(3500)
const clicked = await ev(`(() => { const b=[...document.querySelectorAll('button')].find((x) => /第5章/.test(x.innerText)); if (!b) return 'not found'; b.click(); return 'clicked' })()`)
check('打开第 5 章', clicked === 'clicked', clicked)
let mounted = false
for (let i = 0; i < 24; i++) { if (await ev(`!!document.querySelector('.ProseMirror')`)) { mounted = true; break } await sleep(250) }
check('编辑器挂载', mounted)
await sleep(900)

const hasDirty = async () => await ev(`document.body.innerText.includes('未保存')`)
const hasText = async (t) => await ev(`document.body.innerText.includes(${JSON.stringify(t)})`)

check('① 打开后不显示「未保存」', (await hasDirty()) === false)
// 正文渲染是异步的（readDoc→setContent），轮询等待而非一次性断言
let rendered = false
for (let i = 0; i < 16; i++) { if (await hasText('雾从窗缝里进来')) { rendered = true; break } await sleep(250) }
check('① 正文已渲染', rendered)

// ② 外部写盘（模拟采纳提案落盘）→ 不重开也应实时刷新
const w2 = await ev(`window.zhijuan.writeDoc('demo-aseya', ${JSON.stringify(REL)}, ${JSON.stringify(AI_MD + '\n' + LIVE_MARK + '\n')}).then(() => 'ok').catch((e) => String(e))`)
check('② 外部写盘成功', w2 === 'ok', w2)
let live = false
for (let i = 0; i < 24; i++) { await sleep(250); if (await hasText(LIVE_MARK)) { live = true; break } }
check('② 采纳后编辑器实时刷新（无需重开）', live)
check('② 刷新后仍非 dirty', (await hasDirty()) === false)

// ③ 用户真实输入 → 必须 dirty
await ev(`document.querySelector('.ProseMirror')?.focus()`)
await cmd('Input.insertText', { text: '她低头看了看。' })
await sleep(700)
check('③ 真实编辑后显示「未保存」', (await hasDirty()) === true)

await shot('ai-doc-saved-live')
check('无 JS 异常', errors.length === 0, errors.slice(0, 2).join(' | '))

// 恢复演示章节
await ev(`window.zhijuan.writeDoc('demo-aseya', ${JSON.stringify(REL)}, ${JSON.stringify(original)}).then(() => 'ok').catch(() => 'fail')`)
await fetch(CDP + '/json/close/' + tab.id)
console.log(`\n=== ${pass} passed, ${fail} failed ===`)
process.exit(fail ? 1 : 0)