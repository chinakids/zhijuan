// 织卷无头冒烟 · 项目引导 HIG 走查（2026-09-19 20:15 体验层轮）
// 验收点：① step0 初始焦点=首个输入字段；② 步骤切换后焦点落当前步首字段（HIG「primary item automatically receives focus」）；
//         ③ step1 仅 Back+Done 两按钮（HIG Sheets「Avoid showing all three buttons — Cancel, Done, and Back」）；
//         ④ step1 单行输入 Enter=触发主按钮（HIG Buttons「primary button responds to the Return key」，IME 守卫）；
//         ⑤ step2 完成页 Esc/X 可关闭（数据已写盘）；saving 中 Esc 不关（写入不被打断）；
//         ⑥ step0「以后补充」路径保留（防回归）；⑦ 全程无 JS 异常。
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

const clickBtn = (text) => `(() => {
  const els = [...document.querySelectorAll('button')]
  const el = els.find(b => b.innerText.trim() === ${JSON.stringify(text)} || b.innerText.includes(${JSON.stringify(text)}))
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
const activeInfo = `(() => { const a = document.activeElement; return a ? (a.placeholder || a.innerText.trim() || a.getAttribute('aria-label') || a.tagName) : 'none' })()`
const escKey = `(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true })()`
const enterInName = `(() => { const el = document.querySelector('input[placeholder="姓名 *"]');
  if (!el) return false
  el.focus()
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }))
  return true })()`

let fails = 0
const ok = (name, cond, extra = '') => {
  console.log((cond ? 'OK ' : 'NG ') + name + (extra ? ' | ' + extra : ''))
  if (!cond) fails++
}

async function openGuide(page, projName) {
  await evalUntil(page, pageHas('新建项目'), (v) => v === true, 20000, 'Home 就绪')
  await page.eval(clickBtn('新建项目'))
  await evalUntil(page, pageHas('创建并进入'), (v) => v === true, 8000, '新建项目对话框')
  await page.eval(fill('input[placeholder="如：山那边"]', projName))
  await sleep(200)
  await page.eval(clickBtn('创建并进入'))
  await evalUntil(page, pageHas('开始《' + projName + '》'), (v) => v === true, 20000, '引导弹窗出现')
}

// ===== 场景 A：引导 HIG 走查（焦点/按钮/Enter/Esc） =====
{
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/')
  console.log('TAB A:', tab.id)
  const page = await attach(tab.webSocketDebuggerUrl)
  try {
    await openGuide(page, '引导HIG')
    await sleep(300) // 等 useEffect 聚焦完成

    ok('A1 step0 初始焦点=「时代背景」输入框', (await page.eval(activeInfo)).startsWith('如：近未来的柳城'), await page.eval(activeInfo))

    // step0 → step1
    await page.eval(clickBtn('下一步：主要人物'))
    await evalUntil(page, `document.querySelector('input[placeholder="姓名 *"]') !== null`, (v) => v === true, 8000, '进入 step1')
    await sleep(300)

    const btns = await page.eval(`[...document.querySelectorAll('button')].filter(b => b.offsetParent !== null).map(b => b.innerText.trim()).filter(Boolean)`)
    ok('A2 step1 不再显示「以后补充」（HIG 三按钮同显规避）', !btns.includes('以后补充'), JSON.stringify(btns))
    ok('A3 step1 保留「上一步」+「完成，进入正文」（Back+Done）', btns.includes('上一步') && btns.includes('完成，进入正文'))
    ok('A4 step1 焦点自动落在「姓名 *」输入框', (await page.eval(activeInfo)) === '姓名 *', await page.eval(activeInfo))

    // 回 step0 → 焦点应回「时代背景」
    await page.eval(clickBtn('上一步'))
    await sleep(400)
    ok('A5 返回 step0 后焦点回「时代背景」输入框', (await page.eval(activeInfo)).startsWith('如：近未来的柳城'), await page.eval(activeInfo))

    // 再进 step1，填一人，Enter 触发完成
    await page.eval(clickBtn('下一步：主要人物'))
    await sleep(400)
    await page.eval(fill('input[placeholder="姓名 *"]', '林晚'))
    await page.eval(fill('input[placeholder="在故事里的身份"]', '守灯人'))
    await sleep(150)
    await page.eval(enterInName)
    await evalUntil(page, pageHas('创作物料就位'), (v) => v === true, 10000, 'Enter 触发完成')
    ok('A6 step1 输入框 Enter 触发「完成，进入正文」（HIG Return=primary）', true)
    await sleep(300)
    ok('A7 step2 焦点落在「现在新建第一章」主按钮', (await page.eval(activeInfo)) === '现在新建第一章', await page.eval(activeInfo))

    // step2 Esc 应关闭引导（数据已写盘）
    await page.eval(escKey)
    await sleep(600)
    ok('A8 step2 完成页 Esc 可关闭（数据已写盘无风险）', !(await page.eval(pageHas('开始《引导HIG》'))))
    ok('A9 全程无 JS 异常', page.errors.length === 0, page.errors.slice(0, 2).join(' ; '))
  } catch (e) {
    ok('场景A异常', false, String(e).slice(0, 300))
  }
  page.close()
}

// ===== 场景 B：「以后补充」仍在 step0 + 有输入时 Esc 关闭（取消语义，防回归） =====
{
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/')
  console.log('TAB B:', tab.id)
  const page = await attach(tab.webSocketDebuggerUrl)
  try {
    await openGuide(page, '引导HIG-B')
    await sleep(200)
    ok('B1 step0 仍有「以后补充」（Cancel 语义保留）', await page.eval(`(() => [...document.querySelectorAll('button')].some(b => b.innerText.includes('以后补充')))()`))
    await page.eval(fill('textarea[placeholder^="如：近未来的柳城"]', '测试世界观'))
    await sleep(150)
    await page.eval(escKey)
    await sleep(600)
    ok('B2 step0 有输入时 Esc=取消关闭（与「以后补充」同语义，无确认=轻量向导 Cancel 口径）', !(await page.eval(pageHas('开始《引导HIG-B》'))))
    ok('B3 全程无 JS 异常', page.errors.length === 0, page.errors.slice(0, 2).join(' ; '))
  } catch (e) {
    ok('场景B异常', false, String(e).slice(0, 300))
  }
  page.close()
}

console.log(fails === 0 ? 'GUIDE HIG SMOKE OK' : 'GUIDE HIG SMOKE FAILED: ' + fails)
process.exit(fails === 0 ? 0 : 1)
