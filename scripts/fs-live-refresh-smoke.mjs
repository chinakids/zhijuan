// 织卷 · 实时刷新真机冒烟（F-20261029-01）
// 场景：编辑器打开某章 → agent/外部进程写盘 → 编辑器必须 1.5s 内显示新内容（无需重开）。
// 前置：真机 app 带 --remote-debugging-port=<port> 在跑（非 devShim）。
// 用法：node scripts/fs-live-refresh-smoke.mjs [port]
import fs from 'node:fs'
import path from 'node:path'

const PORT = process.argv[2] || '9333'
const CDP = `http://127.0.0.1:${PORT}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let pass = 0
let fail = 0
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ✓', name, extra) } else { fail++; console.log('  ✗', name, extra) }
}

const targets = await (await fetch(CDP + '/json')).json()
const page = targets.find((t) => t.type === 'page' && t.url.startsWith('file://'))
if (!page) throw new Error('没有找到织卷页面（CDP ' + CDP + '）')
const ws = new WebSocket(page.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
const errs = []
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.method === 'Runtime.exceptionThrown') errs.push((m.params.exceptionDetails?.exception?.description || '').slice(0, 200))
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push((m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200))
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
}
const cmd = (method, params = {}) => new Promise((res, rej) => {
  const id = ++seq
  pending.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)))
  ws.send(JSON.stringify({ id, method, params }))
})
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
await cmd('Runtime.enable')
const ev = async (expression) => {
  const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error('EVAL: ' + (r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)))
  return r.result?.value
}
const editorText = () => ev("document.querySelector('.ProseMirror')?.innerText ?? ''")

const origHash = await ev('location.hash')
const name = '__刷新探针' + Date.now().toString(36).slice(-4)
const proj = await ev(`window.zhijuan.createProject(${JSON.stringify(name)}, '实时刷新冒烟，用完即删')`)
const pid = proj.id
console.log('项目', pid)
await ev(`window.zhijuan.openProject(${JSON.stringify(pid)})`)

const rel = '正文/第01章_探针.md'
const v1 = `# 第01章 探针\n\n> == 本章故事要素 ==\n> 人物：\n\n初始内容ALPHA。\n`
await ev(`window.zhijuan.writeDoc(${JSON.stringify(pid)}, ${JSON.stringify(rel)}, ${JSON.stringify(v1)})`)
const reveal = await ev(`window.zhijuan.revealProject(${JSON.stringify(pid)})`)
const candidates = [
  reveal?.path,
  path.join(process.env.HOME || '', 'Documents/织卷工作区/项目库', pid),
  path.join(process.env.HOME || '', 'Documents/织卷项目库', pid)
].filter(Boolean)
const projDir = candidates.find((p) => fs.existsSync(path.join(p, rel)))
console.log('项目目录', projDir, reveal?.path ? '' : '(由默认库根推断)')

await ev(`location.hash = '#/project/' + encodeURIComponent(${JSON.stringify(pid)}) + '/novel'`)
await sleep(1500)
const clicked = await ev(`(() => {
  const btn = Array.from(document.querySelectorAll('button')).find((b) => (b.innerText || '').includes('第01章'))
  if (!btn) return false
  btn.click(); return true
})()`)
check('章节能打开', clicked === true)
await sleep(1500)
const t1 = await editorText()
check('编辑器加载初始正文', t1.includes('初始内容ALPHA'), JSON.stringify(t1.slice(0, 40)))

// ①外部进程直接写盘（等价：外部 agent / 编辑器以外的手改）
if (projDir) {
  fs.writeFileSync(path.join(projDir, rel), v1.replace('初始内容ALPHA', '外部写盘BETA'), 'utf-8')
  await sleep(1500)
  const t2 = await editorText()
  check('外部写盘 → 编辑器实时刷新', t2.includes('外部写盘BETA'), JSON.stringify(t2.slice(0, 40)))
} else {
  check('外部写盘 → 编辑器实时刷新', false, '拿不到项目目录')
}

// ②IPC 写盘（等价：应用内 agent 采纳 zj_edit/提案落地）
await ev(`window.zhijuan.writeDoc(${JSON.stringify(pid)}, ${JSON.stringify(rel)}, ${JSON.stringify(v1.replace('初始内容ALPHA', '采纳写盘GAMMA'))})`)
await sleep(1500)
const t3 = await editorText()
check('agent 采纳写盘 → 编辑器实时刷新', t3.includes('采纳写盘GAMMA'), JSON.stringify(t3.slice(0, 40)))

check('无 JS 异常', errs.length === 0, errs.slice(0, 2).join(' | '))

// 清理：删项目、回原页面
await ev(`window.zhijuan.removeProject(${JSON.stringify(pid)})`)
await ev(`location.hash = ${JSON.stringify(origHash)}`)
await sleep(300)
ws.close()
console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} ${pass}/${pass + fail}`)
process.exit(fail === 0 ? 0 : 1)