// 素材库类别树 + 搜索 UI 冒烟：无头 Chrome（CDP 9224）+ devShim 演示数据（demo-aseya）
// 前置：npm run build 已跑；node scripts/serve-renderer.mjs 8123 在跑
// 步骤：开新 tab（缓存破坏）→ hash 导航 项目/素材库 → 断言类别树（人物/环境/索引）→ 点「环境」出素材卡（预览/标签）
//       → 点「＋ 新类别」建「场景」→ 树新增 → 搜索「借书卡」出命中（正文徽章+snippet）→ 点击命中进编辑器（__ZJ_DOC.rel）
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://127.0.0.1:8123'
const ID = 'lib' + Date.now()

const tab = await (await fetch(CDP + '/json/new?' + encodeURIComponent(BASE + '/?cb=' + ID), { method: 'PUT' })).json()
const ws = new WebSocket(tab.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
}
function cmd(method, params = {}) {
  return new Promise((res, rej) => {
    const id = ++seq
    pending.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)))
    ws.send(JSON.stringify({ id, method, params }))
  })
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function evalJs(expression) {
  const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error('EVAL EXC: ' + JSON.stringify(r.exceptionDetails).slice(0, 500))
  return r.result?.value
}
await new Promise((r) => (ws.onopen = r))
await cmd('Page.enable')
await cmd('Page.navigate', { url: BASE + '/?cb=' + ID + '#/project/demo-aseya/library' })
await sleep(2500)

let bad = 0
const check = (name, cond, extra = '') => {
  console.log((cond ? 'PASS' : 'FAIL') + ': ' + name + (cond ? '' : ' | ' + extra))
  if (!cond) bad++
}

// [1] 类别树出现：索引项 + 人物/环境 两个类别（环境 count=1）
const treeTxt = await evalJs(`document.querySelector('[data-zj-libtree]')?.innerText ?? ''`)
check('类别树：索引 + 人物 + 环境', treeTxt.includes('索引') && treeTxt.includes('人物') && treeTxt.includes('环境'), treeTxt.slice(0, 200))

// [2] 点「环境」→ 素材卡出现（预览「校园老图书馆」、标签「图书馆」、文件名）
await evalJs(`[...document.querySelectorAll('[data-zj-libtree] button')].find((b) => b.textContent.includes('环境'))?.click(); 'ok'`)
await sleep(700)
const libTxt = await evalJs(`document.querySelector('main')?.innerText ?? ''`)
check('点类别出素材卡（预览/标签）', libTxt.includes('采集_演示图书馆') && libTxt.includes('校园老图书馆') && libTxt.includes('图书馆'), libTxt.slice(0, 300))

// [3] 「＋ 新类别」→ 建「场景」→ 树新增
await evalJs(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '新类别')?.click(); 'ok'`)
await sleep(500)
const dlg = await evalJs(`document.querySelector('[role="dialog"]')?.innerText ?? ''`)
check('新建类别 Dialog 弹出', dlg.includes('新建类别'), dlg.slice(0, 120))
await evalJs(`(() => {
  const input = document.querySelector('[role="dialog"] input')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(input, '场景')
  input.dispatchEvent(new Event('input', { bubbles: true }))
  return 'ok'
})()`)
await sleep(200)
await evalJs(`[...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.trim() === '创建')?.click(); 'ok'`)
await sleep(900)
const tree2 = await evalJs(`document.querySelector('[data-zj-libtree]')?.innerText ?? ''`)
check('新类别「场景」出现在树', tree2.includes('场景'), tree2.slice(0, 200))

// [4] 搜索「借书卡」→ 命中（正文徽章 + snippet）
await evalJs(`(() => {
  const input = document.querySelector('input[placeholder^="搜索素材名"]')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(input, '借书卡')
  input.dispatchEvent(new Event('input', { bubbles: true }))
  return 'ok'
})()`)
await sleep(1000)
const sr = await evalJs(`(() => {
  const t = document.querySelector('main')?.innerText ?? ''
  return { hasName: t.includes('采集_演示图书馆'), hasBadge: t.includes('正文'), hasSnippet: t.includes('借书卡') }
})()`)
check('搜索命中（名称/正文徽章/snippet）', sr.hasName && sr.hasBadge && sr.hasSnippet, JSON.stringify(sr))

// [5] 点击命中 → 编辑器打开（__ZJ_DOC.rel 正确）
await evalJs(`[...document.querySelectorAll('main button')].find((b) => b.textContent.includes('采集_演示图书馆'))?.click(); 'ok'`)
await sleep(1200)
const doc = await evalJs(`window.__ZJ_DOC ? { rel: window.__ZJ_DOC.rel, loading: window.__ZJ_DOC.loading } : null`)
check('点击命中打开编辑器（rel 正确）', !!doc && doc.rel === '素材库/环境/采集_演示图书馆.md' && !doc.loading, JSON.stringify(doc))

// [6] 返回列表（回到搜索态：保留搜索词与结果）
await evalJs(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('返回'))?.click(); 'ok'`)
await sleep(500)
const back = await evalJs(`document.querySelector('main')?.innerText ?? ''`)
check('编辑可返回列表（搜索态保留）', !back.includes('返回') && back.includes('清除') && back.includes('搜索结果（1 条'), back.slice(0, 120))

await fetch(CDP + '/json/close/' + tab.id)
ws.close()
process.exit(bad ? 1 : 0)
