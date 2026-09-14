// 织卷无头冒烟 · 章节「修改切片名」（store.editChapterSlice + 右键菜单 + Dialog + 引用面收口）
// 用法：node scripts/chapter-slice-ui-smoke.mjs
// 前置：npm run build；node scripts/serve-renderer.mjs 8123；本机无头 Chrome CDP 127.0.0.1:9224
// 验收点：① 右键菜单出现「修改切片名」；② Dialog 预填当前切片名、可改；
//         ③ 确认后正文约定头「切片」=新值、大纲章卡 fm 切片同步、旧的 slice-sync pending 置 stale；
//         ④ 列表行显示新切片名、toast 出现；⑤ 全程无 JS 异常 + 截图存档。
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
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

  // ② 右键第 1 章 → 菜单含「修改切片名」
  ok('右键已触发', (await page.eval(ctxMenuOn('第1章 · 雾港'))) === true)
  await evalUntil(page, pageHas('修改切片名'), (v) => v === true, 8000, '菜单出现')
  await shot(page, 'zj-slice-menu.png')

  // 先造一条该章 pending 的 slice-sync 提案（devShim 真 mock 同口径），验证改名后置 stale
  const seed = await page.eval(`(async () => {
    await window.zhijuan.createProposals('demo-aseya', 'slice-sync', '正文/第01章_雾港.md', '第一幕_雾港之夜', [
      { target: '人物/阿七.md', anchor: '切片：第一幕_雾港之夜', kind: 'upsert-section', before: '', after: '旧切片状态', reason: '冒烟' }
    ])
    const ps = await window.zhijuan.listProposals('demo-aseya')
    return ps.map((p) => ({ id: p.id, source: p.source, status: p.status, chapter: p.chapter }))
  })()`)
  const seedP = (seed || []).find((p) => p.status === 'pending' && p.source === 'slice-sync')
  ok('预置 pending slice-sync 提案', !!seedP, JSON.stringify(seed).slice(0, 140))

  // ③ 点「修改切片名」→ Dialog 预填当前切片名
  await page.eval(clickBtn('修改切片名', false))
  await evalUntil(page, pageHas('时间切片名'), (v) => v === true, 8000, '修改切片名对话框')
  const prefill = await page.eval(`document.querySelector('input[placeholder="如：第二幕_台风夜"]')?.value ?? ''`)
  ok('Dialog 预填当前切片名', prefill === '第一幕_雾港之夜', 'prefill=' + prefill)

  // ④ 改值 → 保存
  await page.eval(fill('input[placeholder="如：第二幕_台风夜"]', '第一幕_风起'))
  await sleep(200)
  await page.eval(clickBtn('保存', true))
  await evalUntil(page, pageHas('已更新切片名'), (v) => v === true, 10000, 'toast 出现')

  // ⑤ 落盘断言：正文约定头 + 列表行
  await evalUntil(page, pageHas('第一幕_风起'), (v) => v === true, 10000, '列表出现新切片名')
  const doc = await page.eval(readDoc('正文/第01章_雾港.md'))
  ok('正文约定头切片=新值', !!doc && doc.includes('切片: 第一幕_风起') && !doc.includes('切片: 第一幕_雾港之夜'))
  ok('正文正文内容不动', !!doc && doc.includes('雨把港口淋成一片灰'))

  // ⑥ 大纲章卡 fm 同步（devShim 章卡种子存在；best-effort）
  const card = await page.eval(readDoc('大纲/第01章_雾港.md'))
  ok('章卡 fm 切片=新值', !!card && card.includes('切片: 第一幕_风起') && !card.includes('切片: 第一幕_雾港之夜'), card ? '' : '章卡为空')

  // ⑦ 该章 slice-sync pending 置 stale
  const afterP = await page.eval(`window.zhijuan.listProposals('demo-aseya').then((ps) => ps.map((p) => ({ id: p.id, status: p.status })))`)
  ok('旧 slice-sync 提案置 stale', !!afterP.find((p) => p.id === seedP.id && p.status === 'stale'), JSON.stringify(afterP).slice(0, 120))

  // ⑧ 全程无 JS 异常
  await sleep(600)
  ok('无 JS 异常', page.errors.length === 0, page.errors.slice(0, 2).join(' | '))
  await shot(page, 'zj-slice-done.png')
} catch (e) {
  console.log('FATAL', String(e).slice(0, 300))
  fails++
}
console.log(fails === 0 ? 'ALL PASS' : `FAILED ${fails}`)
try { await page.eval('window.close()') } catch {}
process.exit(fails === 0 ? 0 : 1)
