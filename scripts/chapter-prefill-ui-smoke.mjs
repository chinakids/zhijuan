// 织卷无头冒烟 · 建章连续写作流：新建章节预填上一章（切片名/涉及人物）
// 用法：node scripts/chapter-prefill-ui-smoke.mjs
// 前置：npm run build；http.server 8123（SPA fallback）；CDP 9224
// 验收点：① 无上一章时建章对话框空开（不显示「沿用上一章」提示）；
//         ② 有上一章时点「＋」预填上一章切片名/涉及人物，并显示提示；
//         ③ 预填可改，创建后约定头与输入一致（readDoc 实锤）；
//         ④ 第三次打开预填跟随「最新上一章」的值（不是缓存首次）；
//         ⑤ 全程无 JS 异常。
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

let fails = 0
const ok = (name, cond, extra = '') => {
  console.log((cond ? 'OK ' : 'NG ') + name + (extra ? ' | ' + extra : ''))
  if (!cond) fails++
}

// 输入框当前值（受控 React）
const inputVal = (ph) => `(document.querySelector('input[placeholder=${JSON.stringify(ph)}]')?.value) ?? null`

{
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/')
  console.log('TAB:', tab.id)
  const page = await attach(tab.webSocketDebuggerUrl)
  try {
    // —— 走项目引导建第 1 章（此时无上一章，验证「空开」）——
    await evalUntil(page, pageHas('新建项目'), (v) => v === true, 20000, 'Home 页就绪')
    await page.eval(clickBtn('新建项目'))
    await evalUntil(page, pageHas('创建并进入'), (v) => v === true, 8000, '新建项目对话框')
    await page.eval(fill('input[placeholder="如：山那边"]', '连续写作冒烟'))
    await sleep(150)
    await page.eval(clickBtn('创建并进入'))
    await evalUntil(page, pageHas('开始《连续写作冒烟》'), (v) => v === true, 20000, '引导弹窗出现')
    // 引导：世界观一步（直接下一步，材料可空）→ 人物一步加林晚 → 完成，进入正文
    await evalUntil(page, pageHas('下一步：主要人物'), (v) => v === true, 10000, '引导世界观步')
    await page.eval(clickBtn('下一步：主要人物'))
    await evalUntil(page, `document.querySelector('input[placeholder="姓名 *"]') !== null`, (v) => v === true, 10000, '引导角色步')
    await page.eval(fill('input[placeholder="姓名 *"]', '林晚'))
    await sleep(150)
    await page.eval(clickBtn('完成，进入正文'))
    await evalUntil(page, pageHas('创作物料就位'), (v) => v === true, 10000, '引导完成页')
    await page.eval(clickBtn('现在新建第一章'))
    await evalUntil(page, `document.querySelector('input[placeholder="如：夏夜的信"]') !== null`, (v) => v === true, 10000, '建章对话框')
    ok('P1 无上一章：建章对话框打开且切片/人物空开',
      (await page.eval(inputVal('如：第二幕_台风夜（留空则用章号）'))) === '' &&
      (await page.eval(inputVal('如：林晚，顾知远'))) === '',
      'slice=' + JSON.stringify(await page.eval(inputVal('如：第二幕_台风夜（留空则用章号）'))))
    ok('P2 无上一章：不显示「已沿用上一章」提示', !(await page.eval(pageHas('已沿用上一章'))))

    // 建第 1 章：亮明切片与人物（后续第 2 章应预填它们）
    await page.eval(fill('input[placeholder="如：夏夜的信"]', '第一章 启程'))
    await page.eval(fill('input[placeholder="如：第二幕_台风夜（留空则用章号）"]', '第一幕_雾港夜'))
    await page.eval(fill('input[placeholder="如：林晚，顾知远"]', '林晚，顾知远'))
    await sleep(150)
    await page.eval(clickBtn('创建'))
    await evalUntil(page, pageHas('第1章 · 第一章 启程'), (v) => v === true, 15000, '第1章列表出现')
    ok('P3 第1章创建成功（第1章 · 第一章 启程）', true)

    // —— 点「＋」建第 2 章：应预填上一章 ——
    await page.eval(`(() => { const els=[...document.querySelectorAll('button')]; const el=els.find(b=>b.title==='新建章节'); if(!el) return false; el.click(); return true })()`)
    await evalUntil(page, `document.querySelector('input[placeholder="如：夏夜的信"]') !== null`, (v) => v === true, 10000, '第2章建章对话框')
    ok('P4 有上一章：切片预填=上一章「第一幕_雾港夜」',
      (await page.eval(inputVal('如：第二幕_台风夜（留空则用章号）'))) === '第一幕_雾港夜')
    ok('P5 有上一章：涉及人物预填=上一章「林晚，顾知远」',
      (await page.eval(inputVal('如：林晚，顾知远'))) === '林晚，顾知远')
    ok('P6 有上一章：显示「已沿用上一章」提示', await page.eval(pageHas('已沿用上一章')))

    // 修改人物（预填可改）→ 创建第 2 章
    await page.eval(fill('input[placeholder="如：夏夜的信"]', '第二章 夜航'))
    await page.eval(fill('input[placeholder="如：林晚，顾知远"]', '林晚，陈默'))
    await sleep(150)
    await page.eval(clickBtn('创建'))
    await evalUntil(page, pageHas('第2章 · 第二章 夜航'), (v) => v === true, 15000, '第2章列表出现')
    ok('P7 第2章创建成功（第2章 · 第二章 夜航）', true)

    // —— 第三次点「＋」：预填应跟随最新上一章（人物=林晚, 陈默）——
    await page.eval(`(() => { const els=[...document.querySelectorAll('button')]; const el=els.find(b=>b.title==='新建章节'); if(!el) return false; el.click(); return true })()`)
    await evalUntil(page, `document.querySelector('input[placeholder="如：夏夜的信"]') !== null`, (v) => v === true, 10000, '第3章建章对话框')
    ok('P8 预填跟随最新上一章：人物=「林晚，陈默」（非首次缓存）',
      (await page.eval(inputVal('如：林晚，顾知远'))) === '林晚，陈默')
    ok('P9 预填跟随最新上一章：切片仍「第一幕_雾港夜」',
      (await page.eval(inputVal('如：第二幕_台风夜（留空则用章号）'))) === '第一幕_雾港夜')
    await page.eval(clickBtn('取消'))
    await sleep(300)

    // —— 数据层实锤：第 2 章约定头与输入一致 ——
    const raw = await page.eval(`(async () => {
      const id = decodeURIComponent(location.hash.split('?')[0].split('/')[2])
      return await window.zhijuan.readDoc(id, '正文/第02章_第二章 夜航.md') ?? ''
    })()`)
    ok('P10 第2章约定头落盘（切片/涉及人物与输入一致）',
      raw.includes('切片: 第一幕_雾港夜') && raw.includes('涉及人物: [林晚, 陈默]'),
      JSON.stringify((raw.match(/^切片:.*$/m) ?? [''])[0]) + ' / ' + JSON.stringify((raw.match(/^涉及人物:.*$/m) ?? [''])[0]))

    ok('P11 全程无 JS 异常/console.error', page.errors.length === 0, page.errors.slice(0, 2).join(' ; '))
  } catch (e) {
    ok('场景异常', false, String(e).slice(0, 300))
  }
  page.close()
}

console.log(fails === 0 ? 'CHAPTER PREFILL SMOKE OK' : 'CHAPTER PREFILL SMOKE FAILED: ' + fails)
process.exit(fails === 0 ? 0 : 1)
