// 织卷无头冒烟 · 批注导航列表抽屉（体验层 2026-09-13；候选1③）
// 用法：node scripts/anno-nav-ui-smoke.mjs
// 前置：node scripts/serve-renderer.mjs（8123）；本机专用无头 Chrome CDP 127.0.0.1:9224
// 链路（devShim 演示项目）：选第1章 → 点「批注 2」→ 抽屉打开（role=dialog/意图/行号/原文预览）
//       → 点击条目跳转到对应高亮（模型选区=命中文段，抽屉保持打开）→ 焦点圈闭/收起按钮/Esc 关闭+回焦
//       → 气泡删除一条 → 列表即时减员 → 删最后一条 → 抽屉自动收起 → 亮/暗主题抽屉底色核对
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
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
    if (m.method === 'Runtime.exceptionThrown') errors.push((m.params.exceptionDetails?.exception?.description ?? '').slice(0, 200))
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push((m.params.args?.map((a) => a.value ?? a.description ?? '').join(' ') ?? '').slice(0, 200))
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m)
      pending.delete(m.id)
    }
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
    await sleep(300)
  }
}
// 真实键盘（CDP Input）：Escape vk=27
async function pressEsc(page) {
  await page.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await page.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await sleep(150)
}
const bodyHas = (t) => `document.body.innerText.includes(${JSON.stringify(t)})`
const clickBtn = (text, exact = true) => `(() => {
  const els = [...document.querySelectorAll('button')]
  const el = els.find((b) => ${exact ? `(b.innerText || '').trim() === ${JSON.stringify(text)}` : `(b.innerText || '').includes(${JSON.stringify(text)})`})
  if (!el) return false
  el.click()
  return true
})()`

let pass = 0
let fail = 0
function ok(name, cond, extra = '') {
  if (cond) {
    pass++
    console.log('PASS ' + name)
  } else {
    fail++
    console.log('FAIL ' + name + (extra ? ' | ' + extra : ''))
  }
}

const tab = await openTab(BASE + '/#/project/demo-aseya/novel?cb=' + Date.now())
const page = await attach(tab.webSocketDebuggerUrl)
await evalUntil(page, bodyHas('第1章'), Boolean, 20000, '正文页载入')

// ① 选第1章 → 编辑器挂载（Novel 页默认不挂编辑器）+ 两条批注高亮
await page.eval(clickBtn('第1章 · 雾港', false))
await evalUntil(page, `window.__ZJ_EDITORS && window.__ZJ_EDITORS.length > 0`, Boolean, 20000, '编辑器挂载')
await evalUntil(page, `document.querySelectorAll('.zj-anno').length`, (n) => n === 2, 15000, '两条批注高亮')
ok('两条批注高亮（前置）', true, '')

// ② 底部「批注 2」按钮 → 点击展开抽屉（替代跳第一条）
const badge = await page.eval(`(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.innerText || '').trim() === '批注 2'); return b ? b.innerText.trim() : '' })()`)
ok('底部「批注 2」按钮存在', badge === '批注 2', String(badge))
await page.eval(clickBtn('批注 2', true))
await evalUntil(page, `!!document.querySelector('.zj-anno-drawer')`, Boolean, 8000, '抽屉出现')
const drawerInfo = await page.eval(`(() => {
  const d = document.querySelector('.zj-anno-drawer')
  return { role: d.getAttribute('role'), label: d.getAttribute('aria-label'), w: d.getBoundingClientRect().width }
})()`)
ok('抽屉 role=dialog + aria-label=批注列表', drawerInfo.role === 'dialog' && drawerInfo.label === '批注列表', JSON.stringify(drawerInfo))
ok('抽屉宽 380px（列表型侧栏）', drawerInfo.w === 380, 'w=' + drawerInfo.w)

// ③ 抽屉内容：标题/计数/两条（行号徽标 L10/L12、意图、原文预览）
ok('抽屉头部「批注列表/共 2 条」', (await page.eval(`document.querySelector('.zj-anno-drawer').innerText`)).includes('共 2 条'), '')
const items = await page.eval(`[...document.querySelectorAll('.zj-anno-item')].map((b) => ({ row: b.getAttribute('data-row'), jump: b.getAttribute('data-jumpable'), text: b.textContent }))`)
ok('列表条目×2 且 data-row=[1,2]', items.length === 2 && items[0].row === '1' && items[1].row === '2', JSON.stringify(items.map((i) => i.row)))
ok('条目1：L10 徽标+意图+原文预览', items[0]?.text.includes('L10') && items[0]?.text.includes('这句太文艺了') && items[0]?.text.includes('雨把港口'), (items[0]?.text || '').slice(0, 60))
ok('条目2：L12 徽标+意图+原文预览', items[1]?.text.includes('L12') && items[1]?.text.includes('沈藏语气再轻一点') && items[1]?.text.includes('点了根烟'), (items[1]?.text || '').slice(0, 60))
ok('两条均标记可定位', items.every((i) => i.jump === '1'), '')

// ④ 点击条目1 → 编辑器模型选区=命中文段（getSelected），抽屉保持打开
await page.eval(`document.querySelectorAll('.zj-anno-item')[0].click()`)
await sleep(400)
const sel1 = await page.eval(`window.__ZJ_EDITORS[0].getSelected()`)
ok('跳转①命中「雨把港口」文段', typeof sel1 === 'string' && sel1.includes('雨把港口'), 'sel=' + String(sel1).slice(0, 40))
ok('跳转后抽屉保持打开（连续浏览）', (await page.eval(`!!document.querySelector('.zj-anno-drawer')`)) === true, '')

// ⑤ 点击条目2 → 跳到第二条（与①不同位置）
await page.eval(`document.querySelectorAll('.zj-anno-item')[1].click()`)
await sleep(400)
const sel2 = await page.eval(`window.__ZJ_EDITORS[0].getSelected()`)
ok('跳转②命中「沈藏」文段且不同于①', typeof sel2 === 'string' && sel2.includes('点了根烟') && sel2 !== sel1, 'sel2=' + String(sel2).slice(0, 40))

// ⑥（移至重开后）焦点圈闭见 ⑦；此处跳转已将焦点交给编辑器（定位后可编辑，符合意图）

// ⑦ 「收起」按钮关闭；再开 → 初始焦点圈闭在面板内 → Esc（真实键盘 CDP）关闭 + 焦点回触发源
await page.eval(clickBtn('收起', true))
await evalUntil(page, `!document.querySelector('.zj-anno-drawer')`, Boolean, 5000, '收起关闭抽屉')
ok('「收起」按钮关闭抽屉', true, '')
await page.eval(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.innerText || '').trim() === '批注 2')
  if (!b) return false
  b.focus()
  b.click()
  return true
})()`)
await evalUntil(page, `!!document.querySelector('.zj-anno-drawer')`, Boolean, 8000, '抽屉再次打开')
const focusIn = await page.eval(`(() => {
  const d = document.querySelector('.zj-anno-drawer')
  return !!(d && d.contains(document.activeElement))
})()`)
ok('再次打开后初始焦点圈闭在面板内', focusIn === true, '')
await pressEsc(page)
await evalUntil(page, `!document.querySelector('.zj-anno-drawer')`, Boolean, 5000, 'Esc 关闭抽屉')
const restoreOk = await page.eval(`(() => {
  const a = document.activeElement
  return !!(a && (a.innerText || '').trim() === '批注 2')
})()`)
ok('Esc 关闭后焦点回到「批注 2」按钮', restoreOk === true, '')

// ⑦b 主题核对（趁批注未删）：抽屉底色 = bg-paper 并随主题变化
await page.eval(clickBtn('批注 2', true))
await evalUntil(page, `!!document.querySelector('.zj-anno-drawer')`, Boolean, 8000, '抽屉再次打开（主题核对）')
const bgLight = await page.eval(`getComputedStyle(document.querySelector('.zj-anno-drawer')).backgroundColor`)
await page.eval(`document.documentElement.classList.add('dark')`)
await sleep(250)
const bgDark = await page.eval(`getComputedStyle(document.querySelector('.zj-anno-drawer')).backgroundColor`)
await page.eval(`document.documentElement.classList.remove('dark')`)
ok('亮/暗主题抽屉底色均生效且不同（bg-paper）', bgLight !== bgDark && bgLight !== 'rgba(0, 0, 0, 0)' && bgDark !== 'rgba(0, 0, 0, 0)', `${bgLight} vs ${bgDark}`)
await page.eval(clickBtn('收起', true))
await evalUntil(page, `!document.querySelector('.zj-anno-drawer')`, Boolean, 5000, '主题核对后收起')

// ⑧ 气泡删除一条 → 抽屉列表即时减员（2→1，抽屉不关）
await page.eval(clickBtn('批注 2', true))
await evalUntil(page, `document.querySelectorAll('.zj-anno-item').length`, (n) => n === 2, 8000, '抽屉第三次打开')
await page.eval(`document.querySelector('.zj-anno').click()`) // 打开第一条气泡
await evalUntil(page, `!!document.querySelector('.zj-anno-pop')`, Boolean, 8000, '气泡出现')
await page.eval(clickBtn('删除该批注', true))
await evalUntil(page, `document.querySelector('.zj-anno-pop') === null`, Boolean, 8000, '气泡关闭')
await evalUntil(page, `document.querySelectorAll('.zj-anno-item').length`, (n) => n === 1, 10000, '列表减员到 1')
ok('抽屉打开时删除批注→列表即时减员（抽屉不关）', (await page.eval(`!!document.querySelector('.zj-anno-drawer')`)) === true, '')

// ⑨ 删最后一条 → 抽屉自动收起（批注清空）
await page.eval(`document.querySelector('.zj-anno').click()`)
await evalUntil(page, `!!document.querySelector('.zj-anno-pop')`, Boolean, 8000, '气泡再次出现')
await page.eval(clickBtn('删除该批注', true))
await evalUntil(page, `document.querySelectorAll('.zj-anno').length`, (n) => n === 0, 10000, '高亮清空')
await evalUntil(page, `!document.querySelector('.zj-anno-drawer')`, Boolean, 8000, '抽屉自动收起')
ok('批注清零后抽屉自动收起', true, '')

console.log(`\nRESULT: ${pass} pass / ${fail} fail`)
if (page.errors.length) { fail++; console.log('FAIL 无 JS 异常: ' + page.errors.slice(0, 3).join(' | ')) }
else { pass++; console.log('PASS 无 JS 异常') }
if (fail > 0) process.exit(1)
process.exit(0)
