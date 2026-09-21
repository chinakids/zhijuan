// 织卷无头冒烟 · 新项目引导 flow（ProjectGuide + 建章故事要素对话框）
// 用法：node scripts/guide-ui-smoke.mjs
// 前置：npm run build；node scripts/serve-renderer.mjs 8123；CDP 9224
// 验收点：① 新建项目→引导弹窗（世界观/角色/完成三步骤）；② 「现在新建第一章」→ 自动打开建章对话框；
//         ③ 建章后章节列表出现；④ 引导写入的世界观/角色掉进 mock 数据层；⑤ 「以后补充」路径原样可用（防回归）；
//         ⑥ 全程无 JS 异常；⑦ 「完成页→稍后再说」落点=正文空态且文案与按钮一致（2026-09-22 05:15 轮）。
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

// 按按钮文本点击（排除 disabled）
const clickBtn = (text) => `(() => {
  const els = [...document.querySelectorAll('button')]
  const el = els.find(b => b.innerText.trim() === ${JSON.stringify(text)} || b.innerText.includes(${JSON.stringify(text)}))
  if (!el || el.disabled) return false
  el.click()
  return true
})()`

// React 受控输入：native setter + input 事件
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

// ===== 场景 A：完整引导 → 「现在新建第一章」直达建章 =====
{
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/')
  console.log('TAB A:', tab.id)
  const page = await attach(tab.webSocketDebuggerUrl)
  try {
    await evalUntil(page, pageHas('新建项目'), (v) => v === true, 20000, 'Home 页就绪')
    ok('A1 Home 页就绪（新建项目入口可见）', true)

    await page.eval(clickBtn('新建项目'))
    await evalUntil(page, pageHas('创建并进入'), (v) => v === true, 8000, '新建项目对话框')
    ok('A2 新建项目对话框打开（创建并进入可见）', true)

    await page.eval(fill('input[placeholder="如：山那边"]', '引导冒烟测试'))
    await sleep(200)
    await page.eval(clickBtn('创建并进入'))
    await evalUntil(page, pageHas('开始《引导冒烟测试》'), (v) => v === true, 20000, '引导弹窗出现')
    ok('A3 建项目后项目引导弹窗出现（世界观→主要人物→完成）', true)

    // 世界观一步：填三项 → 下一步
    await page.eval(fill('textarea[placeholder^="如：近未来的柳城"]', '海边的旧城，灯塔立在防波堤尽头。'))
    await page.eval(fill('textarea[placeholder^="如：潮湿、克制"]', '潮湿、克制，旧物件有温度。'))
    await page.eval(fill('textarea[placeholder^="每条一行：如"]', '· 灯塔每晚入夜亮起，清晨熄灭'))
    await sleep(150)
    await page.eval(clickBtn('下一步：主要人物'))
    await evalUntil(page, `document.querySelector('input[placeholder="在故事里的身份"]') !== null`, (v) => v === true, 8000, '人物步骤')
    ok('A4 引导进入「主要人物」步骤', true)

    // 角色一步：加一名 → 完成
    await page.eval(fill('input[placeholder="姓名 *"]', '林晚'))
    await page.eval(fill('input[placeholder="在故事里的身份"]', '守灯人'))
    await page.eval(fill('input[placeholder="关键特征"]', '会修灯，怕海'))
    await sleep(150)
    await page.eval(clickBtn('完成，进入正文'))
    await evalUntil(page, pageHas('创作物料就位'), (v) => v === true, 10000, '引导完成页')
    ok('A5 引导完成页出现（创作物料就位）', true)
    ok('A6 完成页提供「现在新建第一章」直达动作', await page.eval(pageHas('现在新建第一章')))

    await page.eval(clickBtn('现在新建第一章'))
    await evalUntil(page, `document.querySelector('input[placeholder="如：夏夜的信"]') !== null`, (v) => v === true, 10000, '建章对话框')
    ok('A7 点「现在新建第一章」自动打开新建章节对话框（故事要素可填）', true)

    await page.eval(fill('input[placeholder="如：夏夜的信"]', '第一章 灯灭'))
    await sleep(150)
    await page.eval(clickBtn('创建'))
    await evalUntil(page, pageHas('第1章 · 第一章 灯灭'), (v) => v === true, 15000, '章节列表出现')
    ok('A8 建章成功，章节列表出现「第1章 · 第一章 灯灭」', true)

    // 数据层（devShim mock）：引导写盘的世界观/角色确实进去了
    const data = await page.eval(`(async () => {
      const id = decodeURIComponent(location.hash.split('?')[0].split('/')[2])
      const world = await window.zhijuan.listDocs(id, '世界观')
      const chars = await window.zhijuan.listDocs(id, '人物')
      const chs = await window.zhijuan.listChapters(id)
      const projs = (await window.zhijuan.listProjects()).map(p => p.id)
      return { id, hash: location.hash, projs, world: world.map(d => d.file), chars: chars.map(d => d.file), chs: chs.map(c => c.file) }
    })()`)
    ok('A9 引导写入世界观/总纲.md 与人物档案（mock 实锤；listDocs 返回相对 relDir 裸名）',
      data.world.includes('总纲.md') && data.chars.includes('林晚.md'),
      JSON.stringify({ id: data.id, hash: data.hash, projs: data.projs, world: data.world, chars: data.chars }))
    ok('A10 新章文件已落（正文/第01章_第一章 灯灭.md）', data.chs.includes('第01章_第一章 灯灭.md'), JSON.stringify(data.chs))

    ok('A11 全程无 JS 异常/console.error', page.errors.length === 0, page.errors.slice(0, 2).join(' ; '))
  } catch (e) {
    ok('场景A异常', false, String(e).slice(0, 300))
  }
  page.close()
}

// ===== 场景 B：「以后补充」路径（防回归） =====
{
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/')
  console.log('TAB B:', tab.id)
  const page = await attach(tab.webSocketDebuggerUrl)
  try {
    await evalUntil(page, pageHas('新建项目'), (v) => v === true, 20000, 'Home 页就绪')
    await page.eval(clickBtn('新建项目'))
    await evalUntil(page, pageHas('创建并进入'), (v) => v === true, 8000, '新建项目对话框')
    await page.eval(fill('input[placeholder="如：山那边"]', '引导跳过测试'))
    await sleep(150)
    await page.eval(clickBtn('创建并进入'))
    await evalUntil(page, pageHas('开始《引导跳过测试》'), (v) => v === true, 20000, '引导弹窗出现')
    ok('B1 「以后补充」场景：引导弹窗出现', true)
    await page.eval(clickBtn('以后补充'))
    await evalUntil(page, pageHas('还没有章节'), (v) => v === true, 10000, '正文空态')
    const guideGone = await page.eval(pageHas('开始《引导跳过测试》'))
    ok('B2 「以后补充」关闭引导并停在正文空态（未误入建章）', guideGone === false)
    ok('B3 全程无 JS 异常', page.errors.length === 0, page.errors.slice(0, 2).join(' ; '))
  } catch (e) {
    ok('场景B异常', false, String(e).slice(0, 300))
  }
  page.close()
}

// ===== 场景 C：完整引导 → 完成页「稍后再说」→ 落点=正文空态，文案与按钮一致（2026-09-22 05:15 轮） =====
{
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/')
  console.log('TAB C:', tab.id)
  const page = await attach(tab.webSocketDebuggerUrl)
  try {
    await evalUntil(page, pageHas('新建项目'), (v) => v === true, 20000, 'Home 页就绪')
    await page.eval(clickBtn('新建项目'))
    await evalUntil(page, pageHas('创建并进入'), (v) => v === true, 8000, '新建项目对话框')
    await page.eval(fill('input[placeholder="如：山那边"]', '引导落点测试'))
    await sleep(200)
    await page.eval(clickBtn('创建并进入'))
    await evalUntil(page, pageHas('开始《引导落点测试》'), (v) => v === true, 20000, '引导弹窗出现')

    // 世界观一步填三项 → 下一步 → 人物一步填一人 → 完成
    await page.eval(fill('textarea[placeholder^="如：近未来的柳城"]', '海边的旧城，灯塔立在防波堤尽头。'))
    await page.eval(fill('textarea[placeholder^="如：潮湿、克制"]', '潮湿、克制，旧物件有温度。'))
    await page.eval(fill('textarea[placeholder^="每条一行：如"]', '· 灯塔每晚入夜亮起，清晨熄灭'))
    await sleep(150)
    await page.eval(clickBtn('下一步：主要人物'))
    await evalUntil(page, `document.querySelector('input[placeholder="姓名 *"]') !== null`, (v) => v === true, 8000, '人物步骤')
    await page.eval(fill('input[placeholder="姓名 *"]', '林晚'))
    await page.eval(fill('input[placeholder="在故事里的身份"]', '守灯人'))
    await sleep(150)
    await page.eval(clickBtn('完成，进入正文'))
    await evalUntil(page, pageHas('创作物料就位'), (v) => v === true, 10000, '引导完成页')

    // 完成页事实采集：作者已停在正文创作页（hash=/novel），指引文案不再写「去「正文创作」」
    const facts1 = await page.eval(`(() => ({
      hash: location.hash,
      liTexts: [...document.querySelectorAll('[role="dialog"] li')].map(li => li.innerText)
    }))()`)
    ok('C1 完成页时作者已在正文创作页（hash 含 /novel，无需再「去」）', facts1.hash.includes('/novel'), facts1.hash)
    ok('C2 完成页指引不再写「去「正文创作」」（作者已在正文页）', facts1.liTexts.length === 3 && !facts1.liTexts[2].includes('去「正文创作」') && facts1.liTexts[2].includes('新建第一章'), JSON.stringify(facts1.liTexts))

    // 点「稍后再说」→ 落点=正文空态
    await page.eval(clickBtn('稍后再说'))
    await evalUntil(page, pageHas('还没有章节'), (v) => v === true, 10000, '正文空态')
    const facts2 = await page.eval(`(() => {
      const hint = document.querySelector('[data-testid="empty-chapters"] p')
      const actionBtns = [...document.querySelectorAll('[data-testid="empty-chapters"] button')].map(b => b.innerText.trim())
      return { hash: location.hash, guideGone: !document.body.innerText.includes('开始《引导落点测试》'), hintText: hint ? hint.innerText : null, actionBtns }
    })()`)
    ok('C3 「稍后再说」关闭引导且停留正文创作页', facts2.guideGone && facts2.hash.includes('/novel'), facts2.hash)
    ok('C4 落点为正文空态：提示文案准确（不再虚指「右上角」）', !!facts2.hintText && facts2.hintText.includes('还没有章节') && facts2.hintText.includes('「新建第一章」') && !facts2.hintText.includes('右上角'), JSON.stringify(facts2.hintText))
    ok('C5 空态自带「新建第一章」动作按钮（可见即点）', facts2.actionBtns.some((t) => t.includes('新建第一章')), JSON.stringify(facts2.actionBtns))
    ok('C6 全程无 JS 异常', page.errors.length === 0, page.errors.slice(0, 2).join(' ; '))
  } catch (e) {
    ok('场景C异常', false, String(e).slice(0, 300))
  }
  page.close()
}

console.log(fails === 0 ? 'GUIDE SMOKE OK' : 'GUIDE SMOKE FAILED: ' + fails)
process.exit(fails === 0 ? 0 : 1)
