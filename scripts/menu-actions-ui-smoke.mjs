// 织卷无头冒烟 · 系统菜单第二刀：渲染层单点分发（MenuBridge）+ 页面接线 + 启用态上报
// 用法：node scripts/menu-actions-ui-smoke.mjs
// 前置：npm run build；python3 /tmp/spa_server.py 8123（SPA fallback）；CDP 127.0.0.1:9224
// 链路：devShim __ZJ_MENU_EMIT（模拟主进程 menu:action）→ preload 桥等价 → MenuBridge switch
//       → CustomEvent 派发 → Home/Novel/DocEditor/Prose 接线 → UI 实效断言。
// 验收点：① 初始启用态上报 route=home/editor=false；② settings 跳转；③ newProject 打开建项对话框；
//         ④ 进项目+选章后 editor=true 上报；⑤ newChapter 打开建章对话框；⑥ 菜单 save 真实写盘；
//         ⑦ 菜单 findOpen 打开查找条；⑧ shortcutHelp 打开速查；⑨ 全程无 JS 异常。
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

async function evalUntil(page, expr, pred, timeoutMs = 25000, label = expr) {
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

const pageHas = (t) => `document.body.innerText.includes(${JSON.stringify(t)})`
const menuState = () => `(() => { const s = window.__ZJ_MENU_STATE?.(); return s ? JSON.stringify(s) : null })()`
const menuEmit = (id) => `window.__ZJ_MENU_EMIT(${JSON.stringify(id)})`

let fails = 0
const ok = (name, cond, extra = '') => {
  console.log((cond ? 'OK ' : 'NG ') + name + (extra ? ' | ' + extra : ''))
  if (!cond) fails++
}

{
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/')
  console.log('TAB:', tab.id)
  const page = await attach(tab.webSocketDebuggerUrl)
  try {
    // —— P1 初始启用态 ——
    await evalUntil(page, pageHas('新建项目'), (v) => v === true, 25000, 'Home 页就绪')
    const s1 = JSON.parse(await evalUntil(page, menuState(), (v) => v && JSON.parse(v).route === 'home', 8000, '初始上报 home'))
    ok('P1 初始上报 route=home editor=false', s1.route === 'home' && s1.editor === false, JSON.stringify(s1))

    // —— P2 设置跳转 ——
    await page.eval(menuEmit('settings'))
    await evalUntil(page, `location.hash === '#/settings'`, (v) => v === true, 8000, 'hash 跳设置页')
    await evalUntil(page, pageHas('工作区与项目'), (v) => v === true, 15000, '设置页就绪')
    ok('P2 菜单 settings → 跳转设置页', true)

    // —— P3 新建项目对话框（仅 Home）——
    await page.eval(`location.hash = '#/'`)
    await evalUntil(page, pageHas('新建项目'), (v) => v === true, 15000, '回到 Home')
    await page.eval(menuEmit('newProject'))
    await evalUntil(page, pageHas('创建并进入'), (v) => v === true, 8000, '新建项目对话框')
    ok('P3 菜单 newProject → Home 建项对话框打开', true)
    // 关闭（「取消」）
    await page.eval(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.innerText.trim() === '取消'); if (b) b.click(); return !!b })()`)
    await sleep(400)

    // —— P4 进项目选章：editor 上报 ——
    await page.eval(`(() => { const c = document.querySelector('[aria-label^="打开项目"]'); if (c) c.click(); return !!c })()`)
    await evalUntil(page, `location.hash.startsWith('#/project/demo-aseya')`, (v) => v === true, 15000, '进入项目')
    await evalUntil(page, pageHas('雾港'), (v) => v === true, 20000, 'Novel 章节列表就绪')
    // 点章节项（按钮内文本分行，用 includes 复合匹配）
    await page.eval(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.innerText.includes('雾港')); if (b) b.click(); return !!b })()`)
    await evalUntil(page, `(window.__ZJ_EDITORS?.length ?? 0) > 0`, (v) => v === true, 20000, '编辑器挂载')
    const s2 = JSON.parse(await evalUntil(page, menuState(), (v) => {
      if (!v) return false
      const s = JSON.parse(v)
      return s.route === 'project' && s.editor === true
    }, 8000, '项目内+编辑器上报'))
    ok('P4 上报 route=project editor=true', s2.route === 'project' && s2.editor === true, JSON.stringify(s2))

    // —— P5 菜单 newChapter → 建章对话框 ——
    await page.eval(menuEmit('newChapter'))
    await evalUntil(page, `document.querySelector('input[placeholder="如：夏夜的信"]') !== null`, (v) => v === true, 8000, '建章对话框')
    ok('P5 菜单 newChapter → 建章对话框打开（预填上一章）', true)
    // Esc 关闭（Radix DismissableLayer 监听 document keydown）
    await page.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await sleep(400)

    // —— P6 菜单 save → 真实写盘 ——
    await page.eval(`(() => { const e = window.__ZJ_EDITORS[0]; e.setContent(e.getMarkdown() + '\\n\\n菜单冒烟追加句。'); return true })()`)
    await sleep(300)
    await page.eval(menuEmit('save'))
    await evalUntil(page, `(async () => { const d = await window.zhijuan.readDoc('demo-aseya', '正文/第01章_雾港.md'); return (d ?? '').includes('菜单冒烟追加句') })()`, (v) => v === true, 10000, '菜单保存写盘')
    ok('P6 菜单 save → 正文写盘（readDoc 实锤）', true)

    // —— P7 菜单 findOpen/findNext/findUseSel → 查找条 ——
    await page.eval(menuEmit('findOpen'))
    await evalUntil(page, `document.querySelector('.zj-find-input') !== null`, (v) => v === true, 8000, '查找条')
    await page.eval(menuEmit('findNext'))
    await sleep(300)
    const findOpenStill = await page.eval(`document.querySelector('.zj-find-input') !== null`)
    ok('P7 菜单 findOpen → 查找条打开；findNext 无词 no-op 不报错', findOpenStill === true)

    // —— P8 菜单 shortcutHelp → 全局速查 ——
    await page.eval(menuEmit('shortcutHelp'))
    await evalUntil(page, pageHas('完整清单见仓库 docs/快捷键.md'), (v) => v === true, 8000, '快捷键速查')
    ok('P8 菜单 shortcutHelp → 快捷键速查打开', true)

    // —— P9 无 JS 异常 ——
    ok('P9 全程无页面 JS 异常', page.errors.length === 0, page.errors.join(' || '))
  } finally {
    page.close()
  }
}

console.log(fails === 0 ? '\nRESULT: ALL PASS' : `\nRESULT: ${fails} FAILED`)
process.exit(fails === 0 ? 0 : 1)
