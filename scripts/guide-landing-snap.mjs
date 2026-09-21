// 织卷 · 引导完成态/落点空态截图（2026-09-22 05:15 轮）
// 用法：node scripts/guide-landing-snap.mjs
// 前置：npm run build；node scripts/serve-renderer.mjs 8123；CDP 9224
import { writeFile } from 'node:fs/promises'
import { mkdirSync } from 'node:fs'

const OUT_DIR = process.env.HOME + '/Pictures/zhijuan'
mkdirSync(OUT_DIR, { recursive: true })

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
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
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

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/')
const page = await attach(tab.webSocketDebuggerUrl)
try {
  await page.cmd('Emulation.setDeviceMetricsOverride', { width: 1200, height: 800, deviceScaleFactor: 2, mobile: false })
  await evalUntil(page, pageHas('新建项目'), (v) => v === true, 20000, 'Home 就绪')
  await page.eval(clickBtn('新建项目'))
  await evalUntil(page, pageHas('创建并进入'), (v) => v === true, 8000, '建项目对话框')
  await page.eval(fill('input[placeholder="如：山那边"]', '落点截图'))
  await sleep(200)
  await page.eval(clickBtn('创建并进入'))
  await evalUntil(page, pageHas('开始《落点截图》'), (v) => v === true, 20000, '引导弹窗')
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
  await evalUntil(page, pageHas('创作物料就位'), (v) => v === true, 10000, '完成页')

  const t1 = new Date().toTimeString().slice(0, 5).replace(':', '')
  const s1 = await page.cmd('Page.captureScreenshot', { format: 'png' })
  await writeFile(`${OUT_DIR}/guide-complete-${t1}.png`, Buffer.from(s1.data, 'base64'))
  console.log('saved guide-complete-' + t1 + '.png')

  await page.eval(clickBtn('稍后再说'))
  await evalUntil(page, pageHas('还没有章节'), (v) => v === true, 10000, '正文空态')
  await sleep(400)
  const t2 = new Date().toTimeString().slice(0, 5).replace(':', '')
  const s2 = await page.cmd('Page.captureScreenshot', { format: 'png' })
  await writeFile(`${OUT_DIR}/guide-empty-${t2}.png`, Buffer.from(s2.data, 'base64'))
  console.log('saved guide-empty-' + t2 + '.png')
} catch (e) {
  console.error('SNAP FAILED:', String(e).slice(0, 300))
} finally {
  page.close()
}
