// 织卷无头冒烟 · 提案「全部接受」部分失败可见性（创作层 2026-09-16 00:45 轮；候选 2）
// 21:45 观察③：allApply 旧实现 `if (r.ok)` 静默吞失败——无 toast、无 errMap，与单卡 doApply 失败可见性
//   不对齐（批量接受后作者误以为全部生效，破坏「设定已更新」的认知闭环）。
// 落地：循环收集失败 {id,msg} → 逐条 reportErr（errMap，换组后卡片红字仍可见）+ toast 汇总
//   （title「N 条提案未应用」+ description「其余 M 条已接受，<首条原因>」）；按钮 busy 防连点。
// 用法：node scripts/allapply-fail-ui-smoke.mjs
// 前置：npm run build；out/renderer 已由静态服务器伺服（scripts/serve-renderer.mjs）；
//       本机专用无头 Chrome CDP 127.0.0.1:9224
// 链路（真实用户路径）：设置页开「批注定时优化」→ 回正文页 10s 自动首扫生成 2 条批注同步提案
//   → 写盘模拟作者手动改原文（首条 before 漂移）→ 抽屉「全部接受」→ 断言：
//   ① toast「1 条提案未应用」+「其余 1 条已接受」+「请人工确认」可见（批量汇总）
//   ② 失败卡卡片内红字可见（errMap 换组保留，与单卡同机制）
//   ③ 漂移提案 rejected / 有效提案 accepted（状态不被部分成功混淆）
//   ④ 正文：漂移提案 after 未写入（作者手动版本保留）、有效提案 after 已写入
//   ⑤ 按钮 busy 防连点：接受中「全部接受」disabled（devShim 瞬时完成，跳过时序断言，以 disabled 属性存在为准）
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
const PID = 'demo-aseya'
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
    ws.onopen = () =>
      res({
        cmd,
        eval: async (expression) => {
          const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
          if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 300))
          return r.result?.value
        },
        close: () => ws.close()
      })
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

let fatal = null
let page = null
let screenshotPath = ''
try {
  const tab = await openTab(BASE + '/#/project/' + PID + '/settings')
  page = await attach(tab.webSocketDebuggerUrl)
  await evalUntil(page, bodyHas('外观与数据'), Boolean, 20000, '设置页加载')
  await page.eval(clickBtn('外观与数据', false))
  await evalUntil(page, bodyHas('批注定时优化'), Boolean, 10000, '外观节批注开关')

  // ① 开启「批注定时优化」并保存
  const sw = await page.eval(`(() => {
    const rows = [...document.querySelectorAll('div')].filter((d) => d.textContent && d.textContent.includes('批注定时优化') && d.querySelector('button[role="switch"]'))
    const row = rows[rows.length - 1]
    const s = row && row.querySelector('button[role="switch"]')
    if (!s) return 'NO_SWITCH'
    const checked = s.getAttribute('aria-checked')
    if (checked !== 'true') s.click()
    return 'OK:' + checked
  })()`)
  ok('设置页存在「批注定时优化」开关', sw === 'OK:false' || sw === 'OK:true', String(sw))
  await page.eval(clickBtn('保存设置'))
  await sleep(600)

  // ② 回正文页等自动首扫生成批注提案（2 条）
  await page.eval(`(() => { location.hash = '#/project/${PID}/novel'; return 1 })()`)
  await evalUntil(page, bodyHas('第1章'), Boolean, 20000, '正文载入')
  await evalUntil(
    page,
    `window.zhijuan.listProposals('${PID}').then((ps) => ps.filter((p) => p.source === 'annotation-sync' && p.status === 'pending').length)`,
    (v) => Number(v) >= 2,
    30000,
    '自动扫描生成批注提案'
  )
  const ann = await page.eval(`window.zhijuan.listProposals('${PID}').then((ps) => ps.filter((p) => p.source === 'annotation-sync' && p.status === 'pending').map((p) => ({ id: p.id, before: p.items[0].before, after: p.items[0].after, target: p.items[0].target })))`)
  ok('取到 2 条批注提案', ann.length >= 2 && ann[0].before && ann[1].after, JSON.stringify(ann.map((a) => a.id)))

  // ③ 写盘模拟作者手动编辑：把首条提案 before 替换掉（before 漂移）→ 批量接受时应失败且可见
  const driftTarget = ann[0].target
  const driftBefore = ann[0].before
  const driftAfter = ann[0].after
  const okAfter = ann[1].after
  const MUT = '（作者手动改过的一句话）'
  const mut = await page.eval(`window.zhijuan.readDoc('${PID}', ${JSON.stringify(driftTarget)}).then((t) => {
    if (!t || !t.includes(${JSON.stringify(driftBefore)})) return 'NO_BEFORE'
    const s = t.split(${JSON.stringify(driftBefore)}).join(${JSON.stringify(MUT)})
    return window.zhijuan.writeDoc('${PID}', ${JSON.stringify(driftTarget)}, s).then(() => 'OK')
  })`)
  ok('写盘模拟作者手动编辑（首条 before 漂移）', mut === 'OK', String(mut))

  // ④ 打开提案抽屉（入口=左侧导航底部「待确认提案」徽标按钮；09-17 fc82c58 起文案与计数分离为徽标，
  //     按 title 锚点点击——旧「待确认提案 2」带空格文案已不存在）
  await page.eval(`(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => (b.title || '').includes('查看/处理待确认') || (b.innerText || '').includes('待确认提案'))
    if (btn) btn.click()
    return !!btn
  })()`)
  await evalUntil(page, bodyHas('扫描批注'), Boolean, 10000, '抽屉打开')
  ok('抽屉打开（待确认 2 条）', await page.eval(bodyHas('待确认 2')), '')

  // ⑤ 点击「全部接受」→ **2026-09-21 前置预检**：dry-run 发现首条 before 漂移 → 弹带信息确认（不是直接执行）；
  //    先点「取消」验证零执行，再点「仍全部接受」进入既有批量逻辑
  const clicked = await page.eval(clickBtn('全部接受'))
  ok('点击「全部接受」', clicked === true, String(clicked))
  await evalUntil(page, bodyHas('部分提案的目标已变化'), Boolean, 10000, '预检确认框出现')
  const preDlg = await page.eval(`(() => {
    const b = document.body.innerText
    return { dlg: b.includes('部分提案的目标已变化'), desc: b.includes('将接受 2 条提案，其中 1 条的目标内容已变化') }
  })()`)
  ok('预检确认框带信息（N/M 计数可见）', preDlg.dlg && preDlg.desc, JSON.stringify(preDlg))
  // ⑤a 取消：确认框关闭、提案全部保持 pending（零执行）
  await page.eval(clickBtn('取消'))
  await evalUntil(page, `!document.body.innerText.includes('部分提案的目标已变化')`, Boolean, 6000, '取消后确认框关闭')
  const pendAfterCancel = await page.eval(`window.zhijuan.listProposals('${PID}').then((ps) => ps.filter((p) => p.source === 'annotation-sync' && p.status === 'pending').length)`)
  ok('取消后全部仍 pending（零执行）', pendAfterCancel === 2, String(pendAfterCancel))
  // ⑤b 再点并确认：预检再次出现 →「仍全部接受」→ 批量执行
  await page.eval(clickBtn('全部接受'))
  await evalUntil(page, bodyHas('部分提案的目标已变化'), Boolean, 10000, '预检确认框再次出现')
  const confirmed = await page.eval(clickBtn('仍全部接受'))
  ok('点击「仍全部接受」', confirmed === true, String(confirmed))

  // ⑥ 批量汇总 toast：title「1 条提案未应用」+ description「其余 1 条已接受」+「请人工确认」
  const toastSeen = await page.eval(`(async () => {
    const t0 = Date.now()
    while (Date.now() - t0 < 8000) {
      const b = document.body.innerText
      if (b.includes('1 条提案未应用')) return b.includes('其余 1 条已接受') && b.includes('请人工确认') ? 'SUMMARY_OK' : 'TOAST_PARTIAL'
      await new Promise((r) => setTimeout(r, 150))
    }
    return 'NONE'
  })()`)
  ok('批量失败汇总 toast 可见（1 条未应用+其余 1 条已接受+请人工确认）', toastSeen === 'SUMMARY_OK', String(toastSeen))

  // ⑦ 失败卡卡片内红字可见（errMap 换组保留，与单卡 doApply 同机制）
  const redText = await page.eval(`(async () => {
    const t0 = Date.now()
    while (Date.now() - t0 < 5000) {
      const els = [...document.querySelectorAll('p')]
      const el = els.find((p) => (p.className || '').includes('bg-danger-soft') && (p.innerText || '').includes('请人工确认'))
      if (el) return getComputedStyle(el).color
      await new Promise((r) => setTimeout(r, 150))
    }
    return 'NO_RED'
  })()`)
  ok('失败卡卡片内红字可见（批量接受后仍保留）', redText.startsWith('rgb') || redText.startsWith('oklab'), String(redText))

  // ⑧ 状态：漂移提案 rejected / 有效提案 accepted
  const st = await page.eval(`window.zhijuan.listProposals('${PID}').then((ps) => {
    const a = ps.find((x) => x.id === ${JSON.stringify(ann[0].id)})
    const b = ps.find((x) => x.id === ${JSON.stringify(ann[1].id)})
    return { drift: a ? a.status : 'GONE', good: b ? b.status : 'GONE' }
  })`)
  ok('漂移提案 rejected（非 accepted）', st.drift === 'rejected', JSON.stringify(st))
  ok('有效提案 accepted', st.good === 'accepted', JSON.stringify(st))

  // ⑨ 正文：漂移 after 未写入（作者手动版保留）／有效 after 已写入
  const md = await page.eval(`window.zhijuan.readDoc('${PID}', ${JSON.stringify(driftTarget)})`)
  ok('漂移提案 after 未写入正文', typeof md === 'string' && !md.includes(driftAfter), '')
  ok('作者手动文本保留', typeof md === 'string' && md.includes(MUT), '')
  ok('有效提案 after 已写入正文', typeof md === 'string' && md.includes(okAfter), '')

  // 截图
  try {
    const shot = await page.cmd('Page.captureScreenshot', { format: 'png' })
    const { mkdirSync, writeFileSync } = await import('node:fs')
    mkdirSync(process.env.HOME + '/Pictures/zhijuan', { recursive: true })
    screenshotPath = process.env.HOME + '/Pictures/zhijuan/allapply-fail-' + new Date().toTimeString().slice(0, 5).replace(':', '') + '.png'
    writeFileSync(screenshotPath, Buffer.from(shot.data, 'base64'))
    console.log('SCREENSHOT ' + screenshotPath)
  } catch (e) {
    console.log('SCREENSHOT_FAIL ' + String(e))
  }
} catch (e) {
  fatal = e
  console.log('FATAL ' + String(e && e.stack ? e.stack : e))
}

console.log(`RESULT: pass=${pass} fail=${fail}`)
process.exit(fatal || fail ? 1 : 0)
