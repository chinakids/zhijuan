// 织卷无头冒烟 · 文案口径回归（「人物/角色」统一 + 引导「主要人物」+ 示例说明措辞）
// 用法：node scripts/terminology-ui-smoke.mjs
// 前置：npm run build；node scripts/serve-renderer.mjs（8899）；CDP 9224（127.0.0.1:9224）
// 验收点：① 人物页组头/按钮「人物档案」、空态「出场人物」，全程无「角色档案」；
//         ② 新建项目对话框示例说明=「人物档案」；③ 引导步骤「主要人物」/按钮「下一步：主要人物」/「加一个人物」，无「主要角色」；
//         ④ 无 JS 异常。截图存 ~/Pictures/zhijuan/terminology-*.png。
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8899'
const OUT = path.join(os.homedir(), 'Pictures', 'zhijuan')
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
      await cmd('Page.enable')
      await cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
      res({
        cmd,
        errors,
        eval: async (expression) => {
          const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
          if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 300))
          return r.result?.value
        },
        shot: async (name) => {
          const r = await cmd('Page.captureScreenshot', { format: 'png', fromSurface: true })
          const f = path.join(OUT, name)
          fs.mkdirSync(OUT, { recursive: true })
          fs.writeFileSync(f, Buffer.from(r.data, 'base64'))
          return f
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

// ===== 场景 A：人物页（demo-aseya）——组头/按钮「人物档案」，无「角色档案」 =====
{
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/characters')
  console.log('TAB A:', tab.id)
  const page = await attach(tab.webSocketDebuggerUrl)
  try {
    await evalUntil(page, pageHas('人物档案'), (v) => v === true, 20000, '人物页就绪')
    const txt = await page.eval('document.body.innerText')
    ok('A1 人物页可见「人物档案」，无「角色档案」', txt.includes('人物档案') && !txt.includes('角色档案'))
    ok('A2 列表为空态时含「出场人物」', txt.includes('还没有人物档案') ? txt.includes('出场人物') : true)
    await page.shot('terminology-characters-' + new Date().toTimeString().slice(0, 5).replace(':', '') + '.png')
    await page.eval('window.location.hash = "#/"')
    await sleep(600)
    await evalUntil(page, pageHas('新建项目'), (v) => v === true, 15000, 'Home 就绪')
    ok('A3 回到 Home（新建项目可见）', true)
    await page.close()
  } catch (e) {
    console.log('NG A-SCENE: ' + e.message)
    fails++
    await page.close()
  }
}

// ===== 场景 B：新建项目对话框 → 引导「主要人物」 =====
{
  const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/')
  console.log('TAB B:', tab.id)
  const page = await attach(tab.webSocketDebuggerUrl)
  try {
    await evalUntil(page, pageHas('新建项目'), (v) => v === true, 20000, 'Home 页就绪')
    await page.eval(clickBtn('新建项目'))
    await evalUntil(page, pageHas('创建并进入'), (v) => v === true, 8000, '新建项目对话框')
    const txt1 = await page.eval('document.body.innerText')
    ok('B1 新建项目对话框示例说明=「人物档案」且无「角色档案」', txt1.includes('带一份人物档案') && !txt1.includes('角色档案'))
    await page.shot('terminology-newproject-' + new Date().toTimeString().slice(0, 5).replace(':', '') + '.png')
    await page.eval(fill('input[placeholder="如：山那边"]', '文案口径冒烟'))
    await sleep(200)
    await page.eval(clickBtn('创建并进入'))
    await evalUntil(page, pageHas('开始《文案口径冒烟》'), (v) => v === true, 20000, '引导弹窗出现')
    const txt2 = await page.eval('document.body.innerText')
    ok('B2 引导步骤=「主要人物」且无「主要角色」', txt2.includes('主要人物') && !txt2.includes('主要角色'))
    ok('B3 引导按钮=「下一步：主要人物」', txt2.includes('下一步：主要人物'))
    await page.shot('terminology-guide-' + new Date().toTimeString().slice(0, 5).replace(':', '') + '.png')
    await page.eval(clickBtn('下一步：主要人物'))
    await evalUntil(page, `document.querySelector('input[placeholder="姓名 *"]') !== null`, (v) => v === true, 8000, '人物步骤')
    const txt3 = await page.eval('document.body.innerText')
    ok('B4 人物步骤含「加一个人物」', txt3.includes('加一个人物'))
    ok('B5 人物步骤无「角色」字样', !txt3.includes('角色'))
    await page.shot('terminology-guide-step2-' + new Date().toTimeString().slice(0, 5).replace(':', '') + '.png')
    const errs = page.errors.filter(Boolean)
    ok('B6 全程无 JS 异常', errs.length === 0, errs.slice(0, 3).join(' ; '))
    await page.close()
  } catch (e) {
    console.log('NG B-SCENE: ' + e.message)
    fails++
    await page.close()
  }
}

console.log(fails === 0 ? 'ALL PASS' : 'FAILED: ' + fails)
process.exit(fails === 0 ? 0 : 1)
