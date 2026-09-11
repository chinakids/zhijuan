// 织卷无头冒烟 · 章节删除的提案失效链（创作层 2026-09-12）
// 链路：注入 pending 提案 → 右键删除第 1 章（含大纲副产物）→ 顶栏变「已过期提案 1」
//      → 抽屉显示「已过期」卡（接受禁用+清除可用）→ 大纲页章卡消失（devShim 大纲事件口径）
//      → 清除后入口消失、抽屉回空态。
// 用法：node scripts/chapter-stale-ui-smoke.mjs
// 前置：npm run build；python3 /tmp/spa_server.py（8123 SPA fallback）；本机无头 Chrome CDP 127.0.0.1:9224
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

const pageHas = (t) => `document.body.innerText.includes(${JSON.stringify(t)})`
const ctxMenuOn = (label) => `(() => {
  const btn = [...document.querySelectorAll('aside button')].find(b => (b.innerText || '').includes(${JSON.stringify(label)}))
  if (!btn) return false
  btn.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 200, button: 2 }))
  return true
})()`

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
  // ① 正文页就绪
  await evalUntil(page, pageHas('第1章 · 雾港'), (v) => v === true, 20000, '章节列表就绪')

  // ② 注入一条指向第 1 章的 pending 提案（模拟切片同步产物）
  const inj = await page.eval(`window.zhijuan.createProposals('demo-aseya','slice-sync','正文/第01章_雾港.md','第一幕_雾港之夜',[{target:'人物/沈藏.md',anchor:'## 现时状态',kind:'upsert-section',before:'旧',after:'- 冒烟注入：去码头找船票',reason:'冒烟注入'}])`)
  ok('注入 pending 提案成功', Array.isArray(inj) && inj.length === 1, '')

  // ③ 右键第 1 章 → 删除 → 确认
  ok('右键第1章', (await page.eval(ctxMenuOn('第1章 · 雾港'))) === true)
  await evalUntil(page, pageHas('删除'), (v) => v === true, 8000, '菜单出现')
  await page.eval(clickBtn('删除', false))
  await evalUntil(page, pageHas('移入废纸篓'), (v) => v === true, 8000, '删除确认框')
  await page.eval(clickBtn('移入废纸篓', true))
  await evalUntil(page, pageHas('已移入废纸篓'), (v) => v === true, 10000, '删除回执')
  await evalUntil(page, `!document.body.innerText.includes('第1章 · 雾港')`, (v) => v === true, 10000, '列表移除第1章')
  ok('正文列表已移除第1章', true)

  // ④ 顶栏入口应变为「已过期提案 1」：pending→stale 且提案 store 被删除动作刷新
  await evalUntil(page, pageHas('已过期提案 1'), (v) => v === true, 10000, '顶栏已过期入口')
  ok('顶栏显示「已过期提案 1」', true)

  // ⑤ 打开抽屉：已过期卡片（徽标/接受禁用/清除可用）
  ok('点击已过期入口', (await page.eval(clickBtn('已过期提案 1', false))) === true)
  await evalUntil(page, pageHas('已过期 1 条'), (v) => v === true, 8000, '抽屉已过期小节')
  ok('抽屉显示「已过期 1 条」', true)
  ok('卡片显示目标与已过期徽标', (await page.eval(pageHas('已过期'))) === true && (await page.eval(pageHas('人物/沈藏.md'))) === true)
  ok('接受按钮已禁用', (await page.eval(`(() => {
    const b = [...document.querySelectorAll('[role=dialog] button')].find(x => (x.innerText || '').trim() === '接受')
    return !!b && b.disabled
  })()`)) === true)
  ok('清除按钮存在', (await page.eval(`[...document.querySelectorAll('[role=dialog] button')].some(x => (x.innerText || '').trim() === '清除')`)) === true)
  await shot(page, 'zj-stale-drawer.png')
  // 关抽屉，去大纲页
  await page.eval(clickBtn('收起', true))

  // ⑥ 大纲页：左栏章卡列表必须消失（数据层 listChapters/listDocs 对删除的响应；
  //    注意右侧「章卡索引」预览是 大纲/索引.md 的内容，删除章不更新它——断言只看左栏 aside）
  await page.eval(`location.hash = '#/project/demo-aseya/outline'`)
  await evalUntil(page, `location.hash.includes('/outline')`, (v) => v === true, 10000, 'hash切换到大纲页')
  await sleep(1500)
  const asideTxt = await page.eval(`(() => {
    const a = [...document.querySelectorAll('aside')].find(x => (x.innerText || '').includes('章卡索引（全书）'))
    return a ? a.innerText : ''
  })()`)
  ok('大纲左栏已到章卡列表（含第2章）', asideTxt.includes('第2章 · 灯塔'))
  ok('大纲左栏无「第1章 · 雾港」章卡', !asideTxt.includes('第1章'))
  ok('大纲左栏无雾港残留', !asideTxt.includes('雾港'))
  await shot(page, 'zj-outline-after-del.png')

  // ⑦ 回正文页，打开抽屉清除：入口消失、抽屉空态
  await page.eval(`location.hash = '#/project/demo-aseya/novel'`)
  await evalUntil(page, `location.hash.includes('/novel')`, (v) => v === true, 10000, 'hash切换回正文页')
  await evalUntil(page, pageHas('已过期提案 1'), (v) => v === true, 15000, '回正文页入口还在')
  await page.eval(clickBtn('已过期提案 1', false))
  await evalUntil(page, pageHas('已过期 1 条'), (v) => v === true, 8000, '抽屉再开')
  ok('点击清除按钮', (await page.eval(clickBtn('清除', true))) === true)
  await evalUntil(page, pageHas('还没有提案'), (v) => v === true, 10000, '抽屉回空态')
  ok('清除后抽屉空态', true)
  await evalUntil(page, `!document.body.innerText.includes('已过期提案')`, (v) => v === true, 8000, '入口消失')
  ok('清除后顶栏入口消失', true)

  const jsErrors = page.errors.filter((e) => !e.includes('favicon')).slice(0, 5)
  ok('无 JS 异常', jsErrors.length === 0, jsErrors.join(' ; '))
} catch (e) {
  ok('脚本异常', false, String(e).slice(0, 300))
}

page.close()
console.log(fails === 0 ? 'ALL PASS' : `FAILS: ${fails}`)
process.exit(fails === 0 ? 0 : 1)
