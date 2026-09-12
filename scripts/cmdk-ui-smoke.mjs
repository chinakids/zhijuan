// 织卷无头冒烟 · ⌘K 全局命令面板（cmdk）——页面导航 / 打开章节 / 打开项目 / 空态
// 用法：node scripts/cmdk-ui-smoke.mjs
// 前置：python3 -m http.server 8123 --directory out/renderer；本机专用无头 Chrome CDP 127.0.0.1:9224
// 验收点：① Cmd+K 打开面板（cmdk-root，分组：页面/打开章节/打开项目）；
//         ② 输入过滤后回车跳转页面（人物设定）；③ 打开章节项 → novel?ch= 定位并高亮（__ZJ_DOC.rel）；
//         ④ 无匹配时出现空态文案；⑤ 无页面异常。
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

const key = async (page, type, mod = 4) =>
  page.cmd('Input.dispatchKeyEvent', {
    type,
    key: 'k',
    code: 'KeyK',
    windowsVirtualKeyCode: 75,
    nativeVirtualKeyCode: 75,
    modifiers: mod
  })

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel')
console.log('TAB:', tab.id)
const page = await attach(tab.webSocketDebuggerUrl)
let fails = 0
const ok = (name, cond, extra = '') => {
  console.log((cond ? 'OK ' : 'NG ') + name + (extra ? ' | ' + extra : ''))
  if (!cond) fails++
}

try {
  // ① 正文页就绪
  await evalUntil(page, `document.body.innerText.includes('第1章') && document.body.innerText.includes('Agent')`, (v) => v === true, 20000, '正文页就绪')
  ok('正文页就绪', true)

  // ② Cmd+K 打开面板
  await key(page, 'rawKeyDown')
  await key(page, 'keyUp')
  await evalUntil(page, `!!document.querySelector('[cmdk-root]')`, (v) => v === true, 8000, '面板出现')
  const groups = await page.eval(`[...document.querySelectorAll('[cmdk-group-heading]')].map((g) => g.innerText)`)
  ok('Cmd+K 打开面板', true, 'groups=' + JSON.stringify(groups))
  ok('面板含「页面」组', groups.includes('页面'))
  ok('面板含「打开章节」组', groups.includes('打开章节'))
  ok('面板含「打开项目」组', groups.includes('打开项目'))

  // ③ 输入过滤 → 回车跳转「人物设定」
  await page.eval(`document.querySelector('[cmdk-input]').focus()`)
  await page.cmd('Input.insertText', { text: '人物' })
  await sleep(600)
  const filtered = await page.eval(`[...document.querySelectorAll('[cmdk-item]')].filter((i) => !i.hasAttribute('hidden')).map((i) => i.innerText)`)
  ok('过滤「人物」后命中', filtered.some((t) => t.includes('人物设定')), 'items=' + JSON.stringify(filtered))
  await page.cmd('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
  await page.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
  await evalUntil(page, `location.hash.includes('/characters')`, (v) => v === true, 8000, '跳转人物设定')
  ok('回车跳转「人物设定」', true, 'hash=' + (await page.eval(`location.hash`)))

  // ④ 再开面板 → 打开章节「雾港」
  await key(page, 'rawKeyDown')
  await key(page, 'keyUp')
  await evalUntil(page, `!!document.querySelector('[cmdk-input]')`, (v) => v === true, 8000, '面板再次出现')
  await page.eval(`document.querySelector('[cmdk-input]').focus()`)
  await page.cmd('Input.insertText', { text: '雾港' })
  await sleep(600)
  const chItems = await page.eval(`[...document.querySelectorAll('[cmdk-item]')].filter((i) => !i.hasAttribute('hidden')).map((i) => i.innerText.trim())`)
  ok('过滤「雾港」命中章节项', chItems.some((t) => t.includes('雾港')), 'items=' + JSON.stringify(chItems))
  // 点击该章节项（onSelect）
  await page.eval(`(() => { const it = [...document.querySelectorAll('[cmdk-item]')].find((i) => !i.hasAttribute('hidden') && i.innerText.includes('雾港')); return it ? (it.click(), 'CLICKED') : 'NOT_FOUND' })()`)
  await evalUntil(page, `location.hash.includes('novel') && location.hash.includes('ch=')`, (v) => v === true, 8000, '跳转 novel?ch=')
  ok('打开章节跳 novel?ch=', true, 'hash=' + (await page.eval(`location.hash`)))
  await evalUntil(page, `(window.__ZJ_DOC && window.__ZJ_DOC.rel) || document.body.innerText.includes('雨把港口')`, (v) => !!v, 15000, '章节内容加载')
  const docRel = await page.eval(`window.__ZJ_DOC ? window.__ZJ_DOC.rel : null`)
  ok('选中章节写入编辑器 (rel=正文/第01章_雾港.md)', docRel === '正文/第01章_雾港.md', 'rel=' + docRel)

  // ⑤ 空态
  await key(page, 'rawKeyDown')
  await key(page, 'keyUp')
  await evalUntil(page, `!!document.querySelector('[cmdk-input]')`, (v) => v === true, 8000, '面板第三次出现')
  await page.eval(`document.querySelector('[cmdk-input]').focus()`)
  await page.cmd('Input.insertText', { text: 'zzzz' })
  await sleep(600)
  const emptyText = await page.eval(`document.querySelector('[cmdk-empty]')?.innerText ?? ''`)
  ok('无匹配显示空态', emptyText.includes('没有匹配的结果'), emptyText)

  // ⑥ 无页面异常
  await sleep(800)
  const errs = page.errors.filter((e) => !/ResizeObserver/.test(e) && !/Download the React DevTools/.test(e))
  ok('无 JS 异常', errs.length === 0, errs.slice(0, 3).join(' ;; '))

  // ⑦ Home（项目外）：Ctrl+K 分支 + 「打开项目」入口
  const tab2 = await openTab(BASE + '/?cb=' + Date.now() + '#/')
  const page2 = await attach(tab2.webSocketDebuggerUrl)
  await evalUntil(page2, `document.body.innerText.includes('项目列表') || document.body.innerText.includes('新建项目')`, (v) => v === true, 20000, 'Home 就绪')
  await page2.cmd('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'k', code: 'KeyK', windowsVirtualKeyCode: 75, nativeVirtualKeyCode: 75, modifiers: 2 })
  await page2.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', windowsVirtualKeyCode: 75, nativeVirtualKeyCode: 75, modifiers: 2 })
  await evalUntil(page2, `!!document.querySelector('[cmdk-root]')`, (v) => v === true, 8000, 'Ctrl+K 打开面板')
  const groups2 = await page2.eval(`[...document.querySelectorAll('[cmdk-group-heading]')].map((g) => g.innerText)`)
  ok('Ctrl+K 打开面板（项目外）', true, 'groups=' + JSON.stringify(groups2))
  const homeHasProject = await page2.eval(`[...document.querySelectorAll('[cmdk-item]')].some((i) => i.innerText.includes('余烬的灯'))`)
  ok('Home 面板列「打开项目」项', homeHasProject)
  const projItem = await page2.eval(`(() => { const it = [...document.querySelectorAll('[cmdk-item]')].find((i) => i.innerText.includes('余烬的灯')); return it ? (it.click(), 'CLICKED') : 'NOT_FOUND' })()`)
  ok('点击项目项', projItem === 'CLICKED', projItem)
  await evalUntil(page2, `location.hash.includes('/project/demo-aseya')`, (v) => v === true, 8000, '跳转项目')
  ok('跳转项目 novel 页', true, 'hash=' + (await page2.eval(`location.hash`)))
  page2.close()
  await sleep(500)
} catch (e) {
  console.error('FATAL ' + e.message)
  fails++
} finally {
  page.close()
  console.log(fails === 0 ? 'SMOKE PASS' : 'SMOKE FAIL (' + fails + ')')
  process.exit(fails === 0 ? 0 : 1)
}
