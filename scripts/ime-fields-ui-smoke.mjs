// 织卷无头冒烟 · IME 组合期输入面收尾走查（2026-09-18 体验层轮，F-IME-03）
// 覆盖 5 个「Enter 提交」输入面：新建项目 / 重命名章节 / 新建人物档案 / 新类别 / 新建素材
//   组合态（imeSetComposition）Enter 只确认候选，不得触发提交；正常态 Enter 仍提交（防过度修复）。
// 其余输入面（批注弹层/AskCard/设置页/新建章节/采集表单）无 Enter 提交 handler——轮查结论见迭代日志。
// 前置：node scripts/serve-renderer.mjs 8899；本机无头 Chrome CDP 127.0.0.1:9224（Chrome 153+）
const CDP = 'http://127.0.0.1:9224'
const PORT = 8899
const BASE = process.env.ZJ_SMOKE_BASE || `http://localhost:${PORT}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let pass = 0, fail = 0
const ok = (cond, msg) => { console.log((cond ? '✅ ' : '❌ ') + msg); cond ? pass++ : fail++ }

const r = await fetch(CDP + '/json/new', { method: 'PUT' })
const tab = await r.json()
const page = await attach(tab.webSocketDebuggerUrl)
async function attach(wsUrl) {
  const ws = new WebSocket(wsUrl)
  let seq = 0
  const pending = new Map()
  const errors = []
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
    else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params?.exceptionDetails?.text || 'exc')
    else if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') errors.push('console.error')
  }
  const cmd = (method, params = {}) =>
    new Promise((res, rej) => {
      const id = ++seq
      pending.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)))
      ws.send(JSON.stringify({ id, method, params }))
    })
  await new Promise((res) => {
    ws.onopen = async () => {
      try { await cmd('Runtime.enable'); await cmd('Page.enable') } catch {}
      res()
    }
  })
  return {
    cmd,
    errors,
    eval: async (expression) => {
      const rr = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (rr.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(rr.exceptionDetails).slice(0, 300))
      return rr.result?.value
    },
    close: () => ws.close()
  }
}
async function evalUntil(page, expr, pred, timeoutMs = 15000, label = expr) {
  const t0 = Date.now()
  for (;;) {
    try { const v = await page.eval(expr); if (pred(v)) return v } catch {}
    if (Date.now() - t0 > timeoutMs) throw new Error('TIMEOUT waiting: ' + label)
    await sleep(250)
  }
}
const nav = async (hash) => {
  await page.eval(`location.hash = ${JSON.stringify(hash)}`)
  await sleep(600)
}
const dialogTitle = () => page.eval(`(() => { const d=document.querySelector('[role="dialog"]'); if(!d) return ''; const t=d.querySelector('h2,[data-slot="dialog-title"]'); return (t?t.textContent:'').trim() })()`)
const clickByText = (txt) => page.eval(`(() => { const b=[...document.querySelectorAll('button')].find(x=>((x.textContent||'').includes(${JSON.stringify(txt)}))&&!x.closest('[aria-hidden="true"]')); if(b){b.click();return true} return false })()`)
const imeStart = async (sel, text) => {
  await page.eval(`(() => { const i=document.querySelector(${JSON.stringify(sel)}); if(!i) return false; i.focus(); return true })()`)
  await sleep(300)
  await page.cmd('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length })
  await sleep(500)
}
const imeCancel = async () => {
  try { await page.cmd('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 }) } catch {}
  await sleep(300)
}
const pressEnter = () =>
  page.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 36 })
const typePlain = (sel, v) => page.eval(`(() => {
  const i = document.querySelector(${JSON.stringify(sel)}); if (!i) return false
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  setter.call(i, ${JSON.stringify(v)})
  i.dispatchEvent(new Event('input', { bubbles: true }))
  i.focus()
  return true
})()`)
const pressPlainEnter = async () => {
  // 正常态 Enter（无组合会话）：CDP 合成键即 isComposing=false
  await pressEnter()
  await sleep(800)
}

try {
  // ================= A. 新建项目（Home） =================
  await page.cmd('Page.navigate', { url: `${BASE}/?cb=${Date.now()}#/` })
  await evalUntil(page, `!!document.querySelector('[data-testid="home-new-project"]')`, (v) => v === true, 20000, '首页就绪')
  await page.eval(`document.querySelector('[data-testid="home-new-project"]').click()`)
  await evalUntil(page, `document.querySelector('[role="dialog"]')?.textContent?.includes('新建项目')`, (v) => v === true, 8000, '新建项目对话框')
  await imeStart('input[placeholder="如：山那边"]', 'shanting')
  await pressEnter()
  await sleep(500)
  ok((await dialogTitle()) === '新建项目', `A1 组合态 Enter 不误建项目（dialog=${(await dialogTitle()) || '已关'}）`)
  ok(!(await page.eval(`location.hash`)).startsWith('#/project/'), `A2 未发生跳转（hash=${await page.eval(`location.hash`)})`)
  await imeCancel()
  // 正常态 Enter 仍创建（防过度修复）
  await typePlain('input[placeholder="如：山那边"]', 'IME测试项目')
  await pressPlainEnter()
  await evalUntil(page, `location.hash.startsWith('#/project/')`, (v) => v === true, 10000, '正常态 Enter 跳转')
  ok(true, 'A3 正常态 Enter 仍创建并跳转')
  // A4 关闭建项目引导（D-V2-7：新建项目自动走引导流程；不关则后续路由全被 modal 遮挡）
  await evalUntil(page, `document.querySelector('[role="dialog"]')?.textContent?.includes('开始《')`, (v) => v === true, 10000, '引导对话框')
  await sleep(300)
  await clickByText('以后补充')
  await evalUntil(page, `!document.querySelector('[role="dialog"]')`, (v) => v === true, 10000, '引导已关')
  ok(true, 'A4 新建项目走引导且可关闭')

  // ================= B. 重命名章节（Novel） =================
  await nav('#/project/demo-aseya/novel')
  await evalUntil(page, `!!document.querySelector('[data-testid="chapter-sidebar"]') && [...document.querySelectorAll('button')].some(b=>((b.textContent||'').includes('第1章'))&&!b.closest('[aria-hidden="true"]'))`, (v) => v === true, 20000, 'Novel 就绪')
  await page.eval(`(() => { const el=[...document.querySelectorAll('button')].find(b=>((b.textContent||'').includes('第1章'))&&!b.closest('[aria-hidden="true"]')); if(el){el.click();return true} return false })()`)
  await evalUntil(page, `!!document.querySelector('.zj-md .milkdown .ProseMirror')`, (v) => v === true, 20000, '编辑器挂载')
  await sleep(400)
  const box = await page.eval(`(() => { const el=[...document.querySelectorAll('button')].find(b=>((b.textContent||'').includes('第1章'))&&!b.closest('[aria-hidden="true"]')); if(!el) return null; const r=el.getBoundingClientRect(); return {x:r.x+r.width/2, y:r.y+10} })()`)
  await page.cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'right', buttons: 2, clickCount: 1 })
  await page.cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'right', buttons: 0, clickCount: 1 })
  await sleep(400)
  await clickByText('重命名')
  await evalUntil(page, `document.querySelector('[role="dialog"]')?.textContent?.includes('重命名章节')`, (v) => v === true, 8000, '重命名对话框')
  await imeStart('input[placeholder="新题名"]', 'guanai')
  await pressEnter()
  await sleep(500)
  ok((await dialogTitle()) === '重命名章节', `B1 组合态 Enter 不误重命名（dialog=${(await dialogTitle()) || '已关'}）`)
  await imeCancel()
  await typePlain('input[placeholder="新题名"]', '第1章_改写中')
  await pressPlainEnter()
  await evalUntil(page, `!document.querySelector('[role="dialog"]')`, (v) => v === true, 10000, '正常态 Enter 关闭对话框')
  ok(true, 'B2 正常态 Enter 仍重命名（对话框已关）')

  // ================= C. 新建人物档案（Characters/DocSection） =================
  await nav('#/project/demo-aseya/characters')
  await evalUntil(page, `!!document.querySelector('[aria-label="新建人物档案"]')`, (v) => v === true, 20000, '人物页就绪')
  await page.eval(`document.querySelector('[aria-label="新建人物档案"]').click()`)
  await evalUntil(page, `document.querySelector('[role="dialog"]')?.textContent?.includes('新建人物档案')`, (v) => v === true, 8000, '新建人物对话框')
  await imeStart('input[placeholder="如：夏晚晴"]', 'xiayan')
  await pressEnter()
  await sleep(500)
  ok((await dialogTitle()) === '新建人物档案', `C1 组合态 Enter 不误建档（dialog=${(await dialogTitle()) || '已关'}）`)
  await imeCancel()
  await clickByText('取消')
  await sleep(400)

  // ================= D. 新建类别（Library） =================
  await nav('#/project/demo-aseya/library')
  await evalUntil(page, `[...document.querySelectorAll('button')].some(b=>((b.textContent||'').includes('新类别'))&&!b.closest('[aria-hidden="true"]'))`, (v) => v === true, 20000, '素材库就绪')
  await clickByText('新类别')
  await evalUntil(page, `document.querySelector('[role="dialog"]')?.textContent?.includes('新建类别')`, (v) => v === true, 8000, '新建类别对话框')
  await imeStart('input[placeholder^="如：人物、场景"]', 'ceshi')
  await pressEnter()
  await sleep(500)
  ok((await dialogTitle()) === '新建类别', `D1 组合态 Enter 不误建类别（dialog=${(await dialogTitle()) || '已关'}）`)
  await imeCancel()
  await typePlain('input[placeholder^="如：人物、场景"]', '测试类别')
  await pressPlainEnter()
  await evalUntil(page, `!document.querySelector('[role="dialog"]')`, (v) => v === true, 10000, '类别对话框关闭')
  await evalUntil(page, `document.body.innerText.includes('测试类别')`, (v) => v === true, 10000, '类别树出现')
  ok(true, 'D2 正常态 Enter 仍建类别（树已出现）')

  // ================= E. 新建素材（Library，当前类别=测试类别） =================
  await evalUntil(page, `(() => { const b=[...document.querySelectorAll('button')].find(x=>((x.textContent||'').includes('新建素材'))&&!x.closest('[aria-hidden="true"]')); if(b&&!b.disabled){b.click();return true} return false })()`, (v) => v === true, 8000, '新建素材对话框')
  await evalUntil(page, `document.querySelector('[role="dialog"]')?.textContent?.includes('新建素材卡')`, (v) => v === true, 8000, '素材对话框')
  await imeStart('input[placeholder="如：旧图书馆的借书卡"]', 'sucai')
  await pressEnter()
  await sleep(500)
  ok((await dialogTitle()) === '新建素材卡（类别：测试类别）', `E1 组合态 Enter 不误建素材（dialog=${(await dialogTitle()) || '已关'}）`)
  await imeCancel()
  await clickByText('取消')
  await sleep(400)

  ok(page.errors.length === 0, `无 JS 异常（errors=${page.errors.length}）`)
} catch (e) {
  console.error('❌ FATAL: ' + e.message)
  fail++
} finally {
  console.log(`\nPASS=${pass} FAIL=${fail}`)
  try { await fetch(`${CDP}/json/close/${tab.id}`) } catch {}
  process.exit(fail > 0 ? 1 : 0)
}
