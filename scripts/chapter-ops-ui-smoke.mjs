// 织卷无头冒烟 · 章节右键菜单（§6.2）：重命名 / 导出单章 md / 删除（联动大纲副产物）
// 用法：node scripts/chapter-ops-ui-smoke.mjs
// 前置：npm run build；python3 -m http.server 8123 --directory out/renderer；本机无头 Chrome CDP 127.0.0.1:9224
// 验收点：① 右键章节列表项出现菜单（重命名/导出 md/删除 三项）；② 重命名走真 mock：约定头题名与文件名都换、旧文件消失；
//         ③ 导出触发「已导出单章」回执；④ 删除走确认框 → toast「已移入废纸篓」、章节从列表消失、readDoc 为空；
//         ⑤ 全程无 JS 异常；两主题截图存档。
const CDP = 'http://127.0.0.1:9224'
const BASE = 'http://localhost:8123'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const fs = await import('node:fs')

async function openTab(url) {
  const r = await fetch(CDP + '/json/new?' + encodeURIComponent(url), { method: 'PUT' })
  return r.json()
}

function attach(wsUrl) {
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
  return new Promise((res) => {
    ws.onopen = async () => {
      await cmd('Runtime.enable')
      res({
        cmd,
        errors,
        eval: async (expression) => {
          const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
          if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 300))
          return r.result?.value
        },
        close: () => ws.close()
      })
    }
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

const clickBtn = (text, inDialog = false) => `(() => {
  const roots = ${inDialog ? "[...document.querySelectorAll('[role=dialog]')]" : '[document]'}
  const el = roots.flatMap(r => [...r.querySelectorAll('button')]).find(b => (b.innerText || '').trim() === ${JSON.stringify(text)})
  if (!el || el.disabled) return false
  el.click()
  return true
})()`

const fill = (selector, value) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)})
  if (!el) return false
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)})
  el.dispatchEvent(new Event('input', { bubbles: true }))
  return true
})()`

const pageHas = (t) => `document.body.innerText.includes(${JSON.stringify(t)})`
const ctxMenuOn = (label) => `(() => {
  const btn = [...document.querySelectorAll('aside button')].find(b => (b.innerText || '').includes(${JSON.stringify(label)}))
  if (!btn) return false
  btn.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 200, button: 2 }))
  return true
})()`
const readDoc = (rel) => `window.zhijuan.readDoc('demo-aseya', ${JSON.stringify(rel)})`

async function shot(page, name) {
  try {
    const r = await page.cmd('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync('/tmp/' + name, Buffer.from(r.data, 'base64'))
    console.log('SHOT /tmp/' + name)
  } catch (e) {
    console.log('SHOT WARN', String(e).slice(0, 100))
  }
}

let fails = 0
const ok = (name, cond, extra = '') => {
  console.log((cond ? 'OK ' : 'NG ') + name + (extra ? ' | ' + extra : ''))
  if (!cond) fails++
}

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya')
console.log('TAB:', tab.id)
const page = await attach(tab.webSocketDebuggerUrl)
try {
  // ① 进入项目正文页：左侧章节列表出现
  await evalUntil(page, pageHas('第1章 · 雾港'), (v) => v === true, 20000, '章节列表就绪')
  ok('列表展示了 4 章', (await page.eval(pageHas('第4章 · 雾夜'))) === true)

  // ② 右键第 1 章 → 菜单三项
  ok('右键已触发', (await page.eval(ctxMenuOn('第1章 · 雾港'))) === true)
  await evalUntil(page, pageHas('导出 md'), (v) => v === true, 8000, '菜单出现')
  ok('菜单三项齐全', (await page.eval(pageHas('重命名')) && await page.eval(pageHas('导出 md')) && await page.eval(pageHas('删除'))) === true)
  await shot(page, 'zj-chop-menu.png')

  // ③ 重命名「雾港」→「新雾都」：菜单项 → Dialog 输入 + 确认
  await page.eval(clickBtn('重命名', false))
  await evalUntil(page, pageHas('新题名'), (v) => v === true, 8000, '重命名对话框')
  await page.eval(fill('input[placeholder="新题名"]', '新雾都'))
  await sleep(150)
  await page.eval(clickBtn('重命名', true))
  // 列表刷新后出现新题名
  await evalUntil(page, pageHas('第1章 · 新雾都'), (v) => v === true, 12000, '列表出现新题名')
  const newDoc = await page.eval(readDoc('正文/第01章_新雾都.md'))
  const oldDoc = await page.eval(readDoc('正文/第01章_雾港.md'))
  ok('重命名落盘：新文件含新题名', newDoc !== null && newDoc.includes('题名: 新雾都') && newDoc.includes('雨把港口'), '')
  ok('重命名落盘：旧文件已消失', oldDoc === null, '')
  // 大纲副产物同步（devShim 种子里有 大纲/第01章_雾港.md）
  const outlineNew = await page.eval(readDoc('大纲/第01章_新雾都.md'))
  const outlineOld = await page.eval(readDoc('大纲/第01章_雾港.md'))
  ok('大纲章卡随同改名', outlineNew !== null && outlineOld === null, '')
  // ③.5 副产物内容同步 + 索引重建（与真机 store.renameChapter 同口径）：fm 题名/H1/对应正文行 → 新题名与新路径
  ok('章卡内容同步：fm 题名/H1/对应正文行', outlineNew !== null && outlineNew.includes('题名: 新雾都') && outlineNew.includes('# 章卡 第1章 新雾都') && outlineNew.includes('> 对应正文：正文/第01章_新雾都.md') && !outlineNew.includes('# 章卡 第1章 雾港'), '')
  const boardNew = await page.eval(readDoc('大纲/第01章_新雾都_导演.md'))
  ok('导演板内容同步：fm 题名/H1/对应正文行', boardNew !== null && boardNew.includes('题名: 新雾都') && boardNew.includes('# 导演板 · 第1章 新雾都') && boardNew.includes('> 对应正文：正文/第01章_新雾都.md'), '')
  const idxNew = await page.eval(readDoc('大纲/索引.md'))
  ok('索引重建：条目题名/定位更新为新题名', idxNew !== null && idxNew.includes('## 第1章 · 新雾都') && !idxNew.includes('## 第1章 · 雾港'), '')
  await shot(page, 'zj-chop-renamed.png')

  // ④ 导出第 2 章（devShim mock 直接回执）
  ok('右键第2章', (await page.eval(ctxMenuOn('第2章 · 灯塔'))) === true)
  await evalUntil(page, pageHas('导出 md'), (v) => v === true, 8000, '菜单出现(2)')
  await page.eval(clickBtn('导出 md', false))
  await evalUntil(page, pageHas('已导出单章'), (v) => v === true, 10000, '导出回执')
  ok('导出回执出现', true)

  // ⑤ 删除第 3 章（含确认框）：菜单删除 → dialog「移入废纸篓」→ 列表消失 + 文件清空
  ok('右键第3章', (await page.eval(ctxMenuOn('第3章 · 码头'))) === true)
  await evalUntil(page, pageHas('删除'), (v) => v === true, 8000, '菜单出现(3)')
  await page.eval(clickBtn('删除', false))
  await evalUntil(page, pageHas('移入废纸篓'), (v) => v === true, 8000, '删除确认框')
  await page.eval(clickBtn('移入废纸篓', true))
  await evalUntil(page, pageHas('已移入废纸篓'), (v) => v === true, 10000, '删除回执')
  const gone = await page.eval(readDoc('正文/第03章_码头.md'))
  ok('删除落盘：正文已清空', gone === null, '')
  // 等列表刷新后第3章消失
  await evalUntil(page, `!document.body.innerText.includes('第3章 · 码头')`, (v) => v === true, 10000, '列表移除第3章')
  ok('列表已移除第3章', true)

  const jsErrors = page.errors.filter((e) => !e.includes('favicon')).slice(0, 5)
  ok('无 JS 异常', jsErrors.length === 0, jsErrors.join(' ; '))
} catch (e) {
  ok('脚本异常', false, String(e).slice(0, 300))
}

page.close()
console.log(fails === 0 ? 'ALL PASS' : `FAILS: ${fails}`)
process.exit(fails === 0 ? 0 : 1)
