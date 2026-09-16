// 织卷无头冒烟 · Select / Pop-up button 组件走查（HIG Pop-up buttons，体验层 2026-09-16 20:15 轮）
// 用法：node scripts/select-popup-ui-smoke.mjs
// 前置：npm run build；node scripts/serve-renderer.mjs 8123；本机专用无头 Chrome CDP 127.0.0.1:9224
// 依据：Apple HIG Pop-up buttons（/tmp/hig-popup-2015.txt 实抓）——
//       「displays a menu of mutually exclusive options」「menu closes & button updates to indicate current
//       selection」「Provide a useful default selection」「Give people a way to predict options without opening
//       it（label/explanatory text below）」；HIG Buttons「Always include a press state」+ 919b214 通用控件
//       状态口径（颜色通道无 transform）。
// 走查面（唯一 Select＝Home 新建项目·初始内容；主题/引擎提供方为按钮组不属 pop-up 范畴）：
//   ① 默认值显示（trigger=空白（仅目录骨架）·有用默认）＋label/解释文本在场（HIG 可预测选项）
//   ② 菜单=3 项互斥 flat list、当前项 checked+Check 图标；显示名无「示例（示例）」冗余（F1 修复回归）
//   ③ 真实键盘 ArrowDown+Enter 选择→trigger 更新当前值+菜单关闭（HIG「update to indicate current selection」）
//   ④ trigger 按压态 active:bg-well（press 反馈；F2 修复回归）
//   ⑤ dark parity（trigger/菜单深色跟随）；⑥ 无 JS 异常；⑦ 截图 ~/Pictures/zhijuan/
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const os = await import('node:os')
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
        eval: async (expression) => {
          const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
          if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 300))
          return r.result?.value
        },
        key: async (code, key, keyCode) => {
          await cmd('Input.dispatchKeyEvent', { type: 'rawKeyDown', code, key, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode })
          await cmd('Input.dispatchKeyEvent', { type: 'keyUp', code, key, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode })
        },
        errors,
        close: () => ws.close()
      })
    }
  })
}
async function evalUntil(page, expr, pred, timeoutMs = 20000, label = expr) {
  const t0 = Date.now()
  for (;;) {
    try { const v = await page.eval(expr); if (pred(v)) return v } catch {}
    if (Date.now() - t0 > timeoutMs) throw new Error('TIMEOUT waiting: ' + label)
    await sleep(300)
  }
}
const openMenu = async (page) => {
  await page.eval(`(() => {
    const t = document.querySelector('[role="combobox"]')
    t.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse', button: 0 }))
    t.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse', button: 0 }))
    t.click()
  })()`)
  await sleep(600)
}

let fatal = null
let tabId = null
try {
  const tab = await openTab(BASE + '/?cb=selx' + Date.now())
  tabId = tab.id
  const page = await attach(tab.webSocketDebuggerUrl)
  await evalUntil(page, `document.body.innerText.includes('项目库')`, (v) => v === true, 15000, 'home ready')
  // 打开新建项目对话框
  await page.eval(`(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('新建项目')); if (!b) return 'NF'; b.click() })()`)
  await evalUntil(page, `document.body.innerText.includes('初始内容')`, (v) => v === true, 10000, 'dialog ready')

  // ① 默认值显示 + label/解释文本
  const t1 = await page.eval(`(() => {
    const t = document.querySelector('[role="combobox"]')
    return {
      text: t ? t.textContent.trim() : null,
      label: [...document.querySelectorAll('label')].some((l) => (l.textContent || '').includes('初始内容')),
      help: document.body.innerText.includes('选「示例」会带一份人物档案') || document.body.innerText.includes('模板放在')
    }
  })()`)
  if (t1.text !== '空白（仅目录骨架）') throw new Error('① 默认值显示 FAIL: ' + JSON.stringify(t1))
  if (!t1.label || !t1.help) throw new Error('① label/解释文本 FAIL: ' + JSON.stringify(t1))
  console.log('OK ① 默认值显示+label+解释文本在场')

  // ② 菜单 3 项互斥 flat + checked 当前项 + 无「示例（示例）」冗余
  await openMenu(page)
  const m = await page.eval(`(() => {
    const opts = [...document.querySelectorAll('[role="option"]')]
    return {
      count: opts.length,
      items: opts.map((o) => ({ text: o.textContent.trim(), checked: o.dataset.state, hasCheck: !!o.querySelector('svg') }))
    }
  })()`)
  if (m.count !== 3) throw new Error('② 菜单项数 FAIL: ' + JSON.stringify(m))
  const texts = m.items.map((x) => x.text)
  if (!(texts[0] === '空白（仅目录骨架）' && texts[1] === '示例' && texts[2] === '悬疑短篇')) throw new Error('② 显名/顺序 FAIL: ' + JSON.stringify(texts))
  if (texts.some((x) => x.includes('示例（示例）'))) throw new Error('② 「示例（示例）」冗余未修: ' + JSON.stringify(texts))
  if (!(m.items[0].checked === 'checked' && m.items[0].hasCheck)) throw new Error('② checked 当前项 FAIL: ' + JSON.stringify(m.items[0]))
  console.log('OK ② 3 项互斥 + 当前项 checked + 显示名无冗余')

  // ④ trigger 按压态（真实鼠标 pressed 期间 computed bg = well）
  await page.key('Escape', 'Escape', 27) // 先关菜单（避免遮挡）
  await sleep(400)
  // 坑（2026-09-16 本轮实踩）：Esc 关菜单后 Radix 把焦点还给 trigger；CDP 合成 mousePressed 对已聚焦
  // 元素不触发 :active（真实浏览器 mousedown 已聚焦元素必有 :active，属脚本韧性）→ 先 blur 再按，
  // 与 toolbar-press 冒烟「press 前鼠标移开」同思路（真实用户点下拉前焦点大概率在别处）。
  await page.eval(`document.activeElement && document.activeElement.blur && document.activeElement.blur()`)
  await sleep(200)
  const press = await page.eval(`(async () => {
    const t = document.querySelector('[role="combobox"]')
    const r = t.getBoundingClientRect()
    const c = { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    return c
  })()`)
  await page.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: press.x, y: press.y })
  await page.cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x: press.x, y: press.y, button: 'left', buttons: 1, clickCount: 1 })
  await sleep(250)
  const pressBg = await page.eval(`getComputedStyle(document.querySelector('[role="combobox"]')).backgroundColor`)
  await page.cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x: press.x, y: press.y, button: 'left', buttons: 0, clickCount: 1 })
  await sleep(300)
  // 放开后（菜单可能已开）比对：press（well）≠ rest
  const restBg = await page.eval(`getComputedStyle(document.querySelector('[role="combobox"]')).backgroundColor`)
  if (pressBg === restBg) throw new Error('④ press 态 FAIL: press=' + pressBg + ' rest=' + restBg)
  console.log('OK ④ trigger 按压态可辨: press=' + pressBg + ' rest=' + restBg)
  // 若这次按下把菜单开了，Esc 关掉
  await page.key('Escape', 'Escape', 27)
  await sleep(300)

  // ③ 真实键盘选择：打开后 ArrowDown+Enter →「示例」+ trigger 更新 + 菜单关闭
  await openMenu(page)
  if (!(await page.eval(`!!document.querySelector('[role="option"]')`))) throw new Error('③ 菜单未打开')
  await page.key('ArrowDown', 'ArrowDown', 40)
  await sleep(250)
  await page.key('Enter', 'Enter', 13)
  await sleep(600)
  const t3 = await page.eval(`(() => {
    const t = document.querySelector('[role="combobox"]')
    return { text: t ? t.textContent.trim() : null, open: !!document.querySelector('[role="option"]') }
  })()`)
  if (t3.text !== '示例' || t3.open) throw new Error('③ 键盘选择 FAIL: ' + JSON.stringify(t3))
  console.log('OK ③ 键盘 ArrowDown+Enter 选择→trigger 更新+菜单关闭')

  // ⑤ dark parity（trigger 深色跟随）
  await page.eval(`document.documentElement.classList.add('dark')`)
  await sleep(400)
  const dk = await page.eval(`(() => { const cs = getComputedStyle(document.querySelector('[role="combobox"]')); return { bg: cs.backgroundColor, color: cs.color } })()`)
  if (dk.bg === 'rgb(255, 254, 251)' || !dk.color) throw new Error('⑤ dark FAIL: ' + JSON.stringify(dk))
  console.log('OK ⑤ dark parity: ' + JSON.stringify(dk))
  await page.eval(`document.documentElement.classList.remove('dark')`)
  await sleep(300)

  // ⑦ 截图（light 打开态）
  await openMenu(page)
  const shot = await page.cmd('Page.captureScreenshot', { format: 'png' })
  const stamp = new Date().toTimeString().slice(0, 5).replace(':', '')
  const outDir = os.homedir() + '/Pictures/zhijuan'
  fs.mkdirSync(outDir, { recursive: true })
  const file = `${outDir}/select-popup-${stamp}.png`
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'))
  console.log('OK ⑦ 截图: ' + file)

  // ⑥ 无 JS 异常
  const errs = page.errors.filter((e) => !e.includes('favicon'))
  if (errs.length) throw new Error('⑥ JS 异常: ' + JSON.stringify(errs.slice(0, 3)))
  console.log('OK ⑥ 无 JS 异常')
  console.log('\nPASS: Select/Pop-up button 走查全部通过')
} catch (e) {
  fatal = e
  console.log('FAIL:', e.message)
} finally {
  try { if (tabId) await fetch(CDP + '/json/close/' + tabId, { method: 'PUT' }) } catch {}
  console.log(fatal ? 'RESULT: FAIL' : 'RESULT: PASS')
  process.exit(fatal ? 1 : 0)
}
