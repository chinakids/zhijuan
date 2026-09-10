// 织卷无头冒烟 · ⌘K 全局命令面板素材全文搜索（平台层：素材检索跨页直达）
// 用法：node scripts/cmdk-material-smoke.mjs
// 前置：python3 -m http.server 8123 --directory out/renderer；本机专用无头 Chrome CDP 127.0.0.1:9224
// 验收点：① ⌘K 面板空输入不显示素材组；② 输入「旧物」→「素材 · 全文搜索」组出现、命中「追忆型开头」；
//         ③ 点击命中 → 跳转 library?doc= 且素材编辑器打开（__ZJ_DOC.rel 实锤）、doc 参数被消费清掉；
//         ④ 第二次搜索「茶楼」文件名命中 → 打开 素材库/人物/旧茶楼账房.md；⑤ 无结果不出素材组 + 空态；
//         ⑥ 原有页面/章节/项目三组不回归；⑦ 无 JS 异常。
const CDP = 'http://127.0.0.1:9224'
const BASE = 'http://localhost:8123'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
    if (m.method === 'Runtime.exceptionThrown') {
      errors.push((m.params.exceptionDetails?.exception?.description ?? '').slice(0, 200))
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errors.push((m.params.args?.map((a) => a.value ?? a.description ?? '').join(' ') ?? '').slice(0, 200))
    }
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

async function evalUntil(page, expr, pred, timeoutMs = 15000, label = expr) {
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

const keyK = async (page, mod) => {
  await page.cmd('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'k', code: 'KeyK', windowsVirtualKeyCode: 75, nativeVirtualKeyCode: 75, modifiers: mod })
  await page.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', windowsVirtualKeyCode: 75, nativeVirtualKeyCode: 75, modifiers: mod })
}

async function openPalette(page) {
  await keyK(page, 4)
  await evalUntil(page, `!!document.querySelector('[cmdk-root]')`, (v) => v === true, 8000, '面板出现')
  await page.eval(`document.querySelector('[cmdk-input]').focus()`)
}

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel')
console.log('TAB:', tab.id)
const page = await attach(tab.webSocketDebuggerUrl)
let fails = 0
const ok = (name, cond, extra = '') => {
  console.log((cond ? 'OK ' : 'NG ') + name + (extra ? ' | ' + extra : ''))
  if (!cond) fails++
}

try {
  // ① 正文页就绪（devShim demo-aseya）
  await evalUntil(page, `document.body.innerText.includes('第1章') && document.body.innerText.includes('Agent')`, (v) => v === true, 20000, '正文页就绪')
  ok('正文页就绪', true)

  // ② ⌘K 开面板：空输入不显示素材组；三组仍在
  await openPalette(page)
  let groups = await page.eval(`[...document.querySelectorAll('[cmdk-group-heading]')].map((g) => g.innerText)`)
  ok('面板打开', true, 'groups=' + JSON.stringify(groups))
  ok('页面/打开章节/打开项目三组仍在', groups.includes('页面') && groups.includes('打开章节') && groups.includes('打开项目'))
  ok('空输入不显示素材组', !groups.some((g) => g.includes('素材')), 'groups=' + JSON.stringify(groups))

  // ③ 输入「旧物」→ 素材组出现且命中「追忆型开头」（正文命中）
  await page.cmd('Input.insertText', { text: '旧物' })
  // 必须等真实命中项渲染（heading 在「正在搜索…」占位阶段就出现，过早读会拿到占位 disabled 项）
  await evalUntil(
    page,
    `[...document.querySelectorAll('[cmdk-item]')].some((i) => !i.hasAttribute('hidden') && i.innerText.includes('追忆型开头'))`,
    (v) => v === true,
    10000,
    '命中项出现'
  )
  const matItems = await page.eval(`[...document.querySelectorAll('[cmdk-item]')].filter((i) => !i.hasAttribute('hidden') && i.innerText.includes('追忆型开头')).map((i) => i.innerText)`)
  ok('搜「旧物」命中「追忆型开头」', matItems.length > 0, 'items=' + JSON.stringify(matItems))
  ok('显示「正文」命中方式徽章', matItems.some((t) => t.includes('正文')), 'items=' + JSON.stringify(matItems))

  // ④ 点击命中 → 素材页直达（Library mount 后立即清参，不等待带 doc= 的瞬间）
  const clicked = await page.eval(`(() => { const it = [...document.querySelectorAll('[cmdk-item]')].find((i) => !i.hasAttribute('hidden') && i.innerText.includes('追忆型开头')); return it ? (it.click(), 'CLICKED') : 'NOT_FOUND' })()`)
  ok('点击素材命中项', clicked === 'CLICKED', clicked)
  await evalUntil(page, `location.hash.includes('library')`, (v) => v === true, 8000, '跳转素材页')
  ok('跳转素材页', true, 'hash=' + (await page.eval(`location.hash`)))
  await evalUntil(page, `window.__ZJ_DOC && window.__ZJ_DOC.rel === '素材库/桥段/追忆型开头.md'`, (v) => v === true, 15000, '素材编辑器打开')
  const docRel = await page.eval(`window.__ZJ_DOC ? window.__ZJ_DOC.rel : null`)
  ok('素材编辑器打开正确文件', docRel === '素材库/桥段/追忆型开头.md', 'rel=' + docRel)
  const bodyHasTitle = await page.eval(`document.body.innerText.includes('追忆型开头')`)
  ok('编辑器显示素材标题', bodyHasTitle)
  await sleep(600)
  const hashAfter = await page.eval(`location.hash`)
  ok('doc 参数被消费清除（刷新不残留）', !hashAfter.includes('doc='), 'hash=' + hashAfter)

  // ⑤ 再开面板：文件名命中「茶楼」→ 旧茶楼账房
  await openPalette(page)
  await page.cmd('Input.insertText', { text: '茶楼' })
  await evalUntil(
    page,
    `[...document.querySelectorAll('[cmdk-item]')].some((i) => !i.hasAttribute('hidden') && i.innerText.includes('旧茶楼账房'))`,
    (v) => v === true,
    10000,
    '茶楼命中项出现'
  )
  const teahItems = await page.eval(`[...document.querySelectorAll('[cmdk-item]')].filter((i) => !i.hasAttribute('hidden') && i.innerText.includes('旧茶楼账房')).map((i) => i.innerText)`)
  ok('搜「茶楼」命中「旧茶楼账房」', teahItems.length > 0, 'items=' + JSON.stringify(teahItems))
  ok('显示「文件名」命中方式徽章', teahItems.some((t) => t.includes('文件名')), 'items=' + JSON.stringify(teahItems))
  await page.eval(`(() => { const it = [...document.querySelectorAll('[cmdk-item]')].find((i) => !i.hasAttribute('hidden') && i.innerText.includes('旧茶楼账房')); return it ? (it.click(), 'CLICKED') : 'NOT_FOUND' })()`)
  await evalUntil(page, `window.__ZJ_DOC && window.__ZJ_DOC.rel === '素材库/人物/旧茶楼账房.md'`, (v) => v === true, 15000, '旧茶楼账房打开')
  ok('点击打开 素材库/人物/旧茶楼账房.md', true)

  // ⑥ 无结果：素材组不出现 + 空态文案
  await openPalette(page)
  await page.cmd('Input.insertText', { text: 'zzzz' })
  await sleep(1200)
  const groups2 = await page.eval(`[...document.querySelectorAll('[cmdk-group-heading]')].map((g) => g.innerText)`)
  ok('无结果不显示素材组', !groups2.some((g) => g.includes('素材')), 'groups=' + JSON.stringify(groups2))
  const emptyText = await page.eval(`document.querySelector('[cmdk-empty]')?.innerText ?? ''`)
  ok('空态文案含素材提示', emptyText.includes('素材'), emptyText)

  // ⑦ 无 JS 异常
  await sleep(800)
  const errs = page.errors.filter((e) => !/ResizeObserver/.test(e) && !/Download the React DevTools/.test(e))
  ok('无 JS 异常', errs.length === 0, errs.slice(0, 3).join(' ;; '))

  // ⑧ 回归：正文页 ⌘K 打开章节「雾港」仍可用（面板改动不破原导航）
  // 先 Esc 关掉 ⑥ 还开着的面板（⌘K 是 toggle，面板开时再按会关闭）
  await page.cmd('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 })
  await page.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 })
  await sleep(600)
  await keyK(page, 4)
  await evalUntil(page, `!!document.querySelector('[cmdk-input]')`, (v) => v === true, 8000, '面板再次出现')
  await page.eval(`document.querySelector('[cmdk-input]').focus()`)
  await page.cmd('Input.insertText', { text: '雾港' })
  await sleep(600)
  const chItems = await page.eval(`[...document.querySelectorAll('[cmdk-item]')].filter((i) => !i.hasAttribute('hidden') && i.innerText.includes('雾港')).map((i) => i.innerText)`)
  ok('回归：打开章节「雾港」项仍在', chItems.length > 0, 'items=' + JSON.stringify(chItems))
} catch (e) {
  console.error('FATAL ' + e.message)
  fails++
} finally {
  page.close()
  console.log(fails === 0 ? 'MATERIAL SMOKE PASS' : 'MATERIAL SMOKE FAIL (' + fails + ')')
  process.exit(fails === 0 ? 0 : 1)
}
