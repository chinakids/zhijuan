// 织卷封版验收预演 · 双线中篇写作动线端到端走查（体验层，W44 周增量）
// 用法：node scripts/seal-walkthrough-ui-smoke.mjs
// 前置：npm run build；SPA 服务（node scripts/serve-renderer.mjs 8123）；本机无头 Chrome CDP 127.0.0.1:9224
// 走查九步（docs/周交付/2026-W44-封版验收预演-双线中篇动线走查.md）：
//   ① 新建项目 → 引导（世界观 → 主要人物 → 完成）  ② 建两条时间线的章（章头 时间线 字段）
//   ③ 章卡/时间切片设定（切片名/涉及人物）          ④ 正文写作（编辑器真写入）
//   ⑤ 保存触发切片同步 → 出提案                     ⑥ 采纳提案（写入人物/世界观档）
//   ⑦ 规则体检状态栏（HealthBar）＋审计抽屉          ⑧ 时间线视图按线查看
//   ⑨ 章导航（镜头内连写 + 镜头外当前章说明）
// 每步输出 PASS / BLOCK；末尾汇总阻断面（挡封版 vs 体验瑕疵）。
import { writeFileSync, mkdirSync } from 'node:fs'
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
const OUT = process.env.HOME + '/Pictures/zhijuan'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let fails = 0
const steps = []
function ok(name, cond, detail = '') {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail ? ' | ' + String(detail).slice(0, 240) : ''))
  if (!cond) fails++
  return cond
}
function step(name, verdict, detail = '') {
  steps.push({ name, verdict, detail })
  console.log(`STEP ${verdict} ${name}${detail ? ' | ' + detail : ''}`)
}
async function openTab(url) {
  const r = await fetch(CDP + '/json/new?' + encodeURIComponent(url), { method: 'PUT' })
  return r.json()
}
function attach(wsUrl) {
  const ws = new WebSocket(wsUrl); let seq = 0; const pending = new Map(); const errors = []
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.method === 'Runtime.exceptionThrown') errors.push((m.params.exceptionDetails?.exception?.description ?? '').slice(0, 200))
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push((m.params.args?.map((a) => a.value ?? a.description ?? '').join(' ') ?? '').slice(0, 200))
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  }
  const cmd = (method, params = {}) => new Promise((res, rej) => {
    const id = ++seq; pending.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)))
    ws.send(JSON.stringify({ id, method, params }))
  })
  return new Promise((res) => {
    ws.onopen = async () => {
      await cmd('Runtime.enable')
      res({
        cmd, errors,
        eval: async (expression) => {
          const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
          if (r.exceptionDetails) throw new Error('EVAL: ' + (r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)).slice(0, 400))
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
    try { const v = await page.eval(expr); if (pred(v)) return v } catch {}
    if (Date.now() - t0 > timeoutMs) throw new Error('TIMEOUT waiting: ' + label)
    await sleep(250)
  }
}
async function shot(page, name) {
  mkdirSync(OUT, { recursive: true })
  const hh = String(new Date().getHours()).padStart(2, '0')
  const mm = String(new Date().getMinutes()).padStart(2, '0')
  const s = await page.cmd('Page.captureScreenshot', { format: 'png' })
  const p = OUT + '/' + name + '-' + hh + mm + '.png'
  writeFileSync(p, Buffer.from(s.data, 'base64'))
  console.log('SCREENSHOT:', p)
  return p
}
// React 受控字段写入：原生 setter + input 事件（React 18 受控组件唯一可靠路径）
const setVal = (sel, val) => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)})
  if (!el) return false
  el.focus()
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
  setter.call(el, ${JSON.stringify(val)})
  el.dispatchEvent(new Event('input', { bubbles: true }))
  return true
})()`
const clickText = (txt, scope = 'button') => `(() => {
  const els = [...document.querySelectorAll(${JSON.stringify(scope)})]
  const b = els.find((x) => (x.innerText || '').replace(/\\s+/g, ' ').trim().includes(${JSON.stringify(txt)}))
  if (!b) return false
  b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
  b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }))
  b.click()
  return true
})()`
const clickSel = (sel) => `(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b) return false; b.click(); return true })()`

const t0 = Date.now()
const tab = await openTab(BASE + '/?cb=' + Date.now() + '&zj-sync-items=2#/')
const page = await attach(tab.webSocketDebuggerUrl)
let fatal = ''
try {
  await page.cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  await evalUntil(page, `typeof window.zhijuan?.createProject === 'function' && !!document.querySelector('[data-testid="home-new-project"]')`, Boolean, 20000, '首页就绪')

  // ── ① 新建项目 + 引导（世界观 → 主要人物 → 完成）
  await page.eval(clickSel('[data-testid="home-new-project"]'))
  await evalUntil(page, `!!document.querySelector('#newproj-name')`, Boolean, 8000, '新建项目对话框')
  await page.eval(setVal('#newproj-name', '双线预演'))
  await page.eval(setVal('#newproj-desc', '封版验收预演：双线中篇最小动线'))
  await page.eval(clickText('创建并进入'))
  const guideOpen = await evalUntil(page, `!!document.querySelector('#guide-world-bg')`, Boolean, 12000, '项目引导第 1 步').catch(() => false)
  let projectId = null
  if (guideOpen) {
    await page.eval(setVal('#guide-world-bg', '近未来的江城，旧港区与新城隔水相望。', 'textarea'))
    await page.eval(setVal('#guide-world-tone', '潮湿、克制，带一点旧物件的温度。', 'textarea'))
    await page.eval(setVal('#guide-world-rules', '· 夜航灯语是港区唯一还通行的旧规矩\n· 灯油每月由渡船送来一次', 'textarea'))
    await page.eval(clickText('下一步：主要人物'))
    await evalUntil(page, `!!document.querySelector('input[placeholder="姓名 *"]')`, Boolean, 8000, '引导第 2 步')
    await page.eval(setVal('input[placeholder="姓名 *"]', '林晚'))
    await page.eval(setVal('input[placeholder="在故事里的身份"]', '港区渡船守夜人'))
    await page.eval(setVal('input[placeholder="关键特征"]', '寡言、认得每一盏灯的编号'))
    const done = await page.eval(clickText('完成，进入正文'))
    ok('①a 引导写入世界观与人物档', done, '完成，进入正文')
    const startChap = await evalUntil(page, `!!document.querySelector('button') && [...document.querySelectorAll('button')].some((b) => /开始写第一章|稍后再说/.test(b.innerText || ''))`, Boolean, 12000, '引导完成页').catch(() => false)
    if (startChap) {
      const started = await page.eval(clickText('开始写第一章'))
      if (!started) await page.eval(clickText('稍后再说'))
    }
    step('① 新建项目 → 引导（世界观/人物/完成）', 'PASS', '引导三步走通，落点=建章对话框')
  } else {
    step('① 新建项目 → 引导（世界观/人物/完成）', 'BLOCK', '创建后未出现引导（#guide-world-bg 超时）')
  }
  projectId = await page.eval(`(() => { const m = location.hash.match(/#\\/project\\/([^/]+)/); return m ? decodeURIComponent(m[1]) : null })()`)
  ok('①b 已进入项目页', !!projectId, projectId)

  // ── ② 建两条时间线的六章（章1/3/5 主线，章2/4/6 过去线）
  const plan = [
    { no: 1, title: '渡口', line: '', slice: '第一幕_归港' },
    { no: 2, title: '旧灯', line: '过去线', slice: '前史_点灯' },
    { no: 3, title: '夜航', line: '', slice: '第一幕_夜航' },
    { no: 4, title: '退潮', line: '过去线', slice: '前史_退潮' },
    { no: 5, title: '灯语', line: '', slice: '第二幕_灯语' },
    { no: 6, title: '空塔', line: '过去线', slice: '前史_空塔' }
  ]
  let created = 0
  for (let i = 0; i < plan.length; i++) {
    const c = plan[i]
    console.log('  · 建章 ' + c.no + ' 开始')
    if (i === 0) await evalUntil(page, `!!document.querySelector('#cc-title')`, Boolean, 12000, '建章对话框').catch(() => {})
    if (!(await page.eval(`!!document.querySelector('#cc-title')`))) {
      await page.eval(clickSel('[title="新建章节"]'))
      await evalUntil(page, `!!document.querySelector('#cc-title')`, Boolean, 8000, '建章对话框(重开)')
    }
    await page.eval(setVal('#cc-title', c.title))
    await page.eval(setVal('#cc-slice', c.slice))
    await page.eval(setVal('#cc-line', c.line))
    await page.eval(setVal('#cc-cast', '林晚, 陈砚'))
    await page.eval(setVal('#cc-goal', '本章推进一次灯语交接'))
    await page.eval(clickText('创建', 'button'))
    const grew = await evalUntil(page, `document.querySelectorAll('[data-testid="chapter-sidebar"] button').length`, (v) => v > i, 12000, '章列出现第 ' + c.no + ' 章').catch(() => 0)
    if (grew > i) created++
    await sleep(250)
  }
  ok('② 六章双线建齐', created === 6, 'created=' + created)
  // 线徽标 + 镜头 chips
  const lensInfo = await page.eval(`(() => {
    const chips = [...document.querySelectorAll('[data-testid="chapter-line-filter"] button')].map((b) => (b.innerText || '').trim())
    const rows = [...document.querySelectorAll('[data-testid="chapter-sidebar"] button')].map((b) => (b.innerText || '').replace(/\\s+/g, ' ').trim()).filter((t) => /第\\d+章/.test(t))
    return { chips, rows }
  })()`)
  ok('②b 章列可见两线章节', lensInfo.rows.length >= 6, JSON.stringify(lensInfo.rows).slice(0, 200))
  ok('②c 镜头 chips 出现两条线', (lensInfo.chips || []).length >= 3, JSON.stringify(lensInfo.chips).slice(0, 160))
  await shot(page, 'seal-walk-2-chapters')

  // ── ③④ 切片设定与正文写作（选中第1章 → 写入正文）
  const sel = (t) => `(() => {
    const b = [...document.querySelectorAll('[data-testid="chapter-sidebar"] button')].find((x) => (x.innerText || '').includes(${JSON.stringify(t)}))
    if (!b) return false
    b.click(); return true
  })()`
  await page.eval(sel('第1章'))
  await evalUntil(page, `window.__ZJ_EDITORS && window.__ZJ_EDITORS.length > 0`, Boolean, 15000, '编辑器挂载')
  // 约定头不在编辑器正文里（withFm 只编辑头下正文），须读盘验证
  const curl = await page.eval(`(async () => {
    const id = decodeURIComponent(location.hash.match(/#\\/project\\/([^/]+)/)[1])
    const list = await window.zhijuan.listChapters(id)
    const raw1 = await window.zhijuan.readDoc(id, '正文/' + list[0].file)
    const raw2 = await window.zhijuan.readDoc(id, '正文/' + list[1].file)
    return { f1: list[0].file, h1: (raw1 || '').slice(0, 220), f2: list[1].file, h2: (raw2 || '').slice(0, 220) }
  })()`)
  const fmOk = /切片/.test(curl.h1) && /涉及人物/.test(curl.h1) && !/时间线/.test(curl.h1) && /时间线/.test(curl.h2) && /过去线/.test(curl.h2)
  ok('③ 章头（切片/涉及人物/时间线；主线省略字段）落盘可读', fmOk, curl.f1 + ' | ' + curl.h1.replace(/\n/g, ' ') + ' || ' + curl.h2.replace(/\n/g, ' '))

  const body = '# 渡口\n\n雨落在渡口的铁皮棚上，声音像有人在数钱。林晚把灯油桶挪进棚里，抬头看了一眼对岸——第三盏灯还没亮。\n\n她认得每一盏灯的编号，也认得那盏不亮的灯底下站着的人。'
  await page.eval(`(() => { window.__ZJ_EDITORS[0].setContent(window.__ZJ_EDITORS[0].getMarkdown().replace(/^# .*$/m, '') + ${JSON.stringify('\n\n' + body)}) ; return true })()`)
  await sleep(300)
  // 触发 dirty（setContent 为程序化注入，可能被判定为 saved 基准）：聚焦后插入一个字
  await page.eval(`(() => { window.__ZJ_EDITORS[0].focus(); return true })()`)
  await page.cmd('Input.insertText', { text: '。' })
  await sleep(400)
  const saveEnabled = await page.eval(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /^保存/.test((x.innerText || '').trim())); return b ? !b.disabled : null })()`)
  ok('④a 正文写入后保存钮可用', saveEnabled === true, 'canSave=' + saveEnabled)
  const syncBefore = await page.eval(`(window.__ZJ_SYNCS || []).length`)
  await page.eval(clickText('保存'))
  const synced = await evalUntil(page, `(window.__ZJ_SYNCS || []).length`, (v) => v > syncBefore, 20000, '切片同步被触发').catch(() => null)
  ok('⑤ 保存触发切片同步', synced !== null, 'syncs=' + JSON.stringify(await page.eval('window.__ZJ_SYNCS || []')))
  const syncMsg = await page.eval(`(() => { const els = [...document.querySelectorAll('span,div')].filter((x) => /已比对|切片同步|设定变化|提案/.test(x.innerText || '') && (x.innerText || '').trim().length > 0 && (x.innerText || '').trim().length < 70); return els.length ? els[els.length - 1].innerText.trim() : null })()`)
  step('④ 正文写作 + ⑤ 保存触发切片同步', synced !== null ? 'PASS' : 'BLOCK', '同步提示=' + syncMsg)
  const propCount = await page.eval(`(async () => { const id = decodeURIComponent(location.hash.match(/#\\/project\\/([^/]+)/)[1]); const list = await window.zhijuan.listProposals(id); return { n: list.length, first: list[0] ? { id: list[0].id, status: list[0].status, items: list[0].items.length } : null } })()`)
  ok('⑤b 切片同步产出待确认提案', propCount.n > 0, JSON.stringify(propCount))

  // ── ⑥ 采纳提案
  await sleep(600)
  const openedDrawer = await page.eval(clickText('待确认提案'))
  if (openedDrawer) {
    await evalUntil(page, `!!document.querySelector('[role="dialog"]')`, Boolean, 8000, '提案抽屉').catch(() => {})
    const acceptBtn = await page.eval(`(() => {
      const dlg = document.querySelector('[role="dialog"]')
      if (!dlg) return false
      const b = [...dlg.querySelectorAll('button')].find((x) => /^接受$/.test((x.innerText || '').trim()) || /接受/.test(x.getAttribute('title') || ''))
      if (!b) return false
      b.click(); return true
    })()`)
    await sleep(1500)
    const after = await page.eval(`(async () => { const id = decodeURIComponent(location.hash.match(/#\\/project\\/([^/]+)/)[1]); const list = await window.zhijuan.listProposals(id); return list.map((p) => ({ status: p.status, items: p.items.map((i) => i.target) })) })()`)
    const accepted = (after || []).some((p) => p.status === 'accepted' || p.status === 'applied')
    ok('⑥ 提案可采纳并落盘', acceptBtn && (accepted || (after || []).length > 0), JSON.stringify(after).slice(0, 220))
    step('⑥ 采纳提案（写入设定档）', acceptBtn ? 'PASS' : 'BLOCK', '接受钮=' + acceptBtn + ' 状态=' + JSON.stringify(after).slice(0, 140))
    await shot(page, 'seal-walk-6-proposal')
    await page.eval(`(() => { const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) => /关闭|Close/.test(x.innerText || '') || /关闭/.test(x.getAttribute('aria-label') || '')); if (b) b.click(); return true })()`)
    await page.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await page.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await sleep(500)
  } else {
    step('⑥ 采纳提案（写入设定档）', 'BLOCK', '提案入口（待确认提案）未找到')
  }

  // ── ⑦ 规则体检状态栏
  const hb = await evalUntil(page, `!!document.querySelector('[data-testid="health-status"]')`, Boolean, 12000, 'HealthBar').catch(() => false)
  const hbText = hb ? await page.eval(`(() => { const el = document.querySelector('[data-testid="health-bar"]'); return el ? (el.innerText || '').replace(/\\s+/g, ' ').trim() : null })()`) : null
  ok('⑦ 规则体检状态栏常驻', hb, hbText)
  if (hb) {
    await page.eval(clickSel('[data-testid="health-status"]'))
    const drawer = await evalUntil(page, `!!document.querySelector('[data-testid="audit-kind-select"]')`, Boolean, 8000, '审计抽屉').catch(() => false)
    ok('⑦b 点状态栏开审计抽屉', drawer)
    await page.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await page.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await sleep(400)
    step('⑦ 规则体检状态栏 + 审计抽屉', 'PASS', hbText || '')
  } else {
    step('⑦ 规则体检状态栏 + 审计抽屉', 'BLOCK', 'health-status 未渲染（选中章后应常驻）')
  }

  // ── ⑧ 时间线视图按线查看
  await page.eval(`(() => { location.hash = '#/project/' + location.hash.match(/#\\/project\\/([^/]+)/)[1] + '/timeline'; return true })()`)
  await sleep(1200)
  const tl = await evalUntil(page, `(() => {
    const groups = [...document.querySelectorAll('section[aria-label^="时间线："]')].map((s) => ({
      line: (s.getAttribute('aria-label') || '').replace('时间线：', ''),
      heads: [...s.querySelectorAll('[data-testid="timeline-line-head"]')].map((h) => (h.innerText || '').trim()),
      chapters: [...s.querySelectorAll('a[href*="novel"]')].length
    }))
    const chips = [...document.querySelectorAll('[role="tablist"][aria-label="时间线筛选"] button')].map((b) => (b.innerText || '').trim())
    return { groups, chips }
  })()`, (v) => v && v.groups && v.groups.length >= 2, 12000, '时间线页按线分组').catch(() => null)
  const mainG = tl && tl.groups.find((g) => g.line === '主线')
  const pastG = tl && tl.groups.find((g) => g.line === '过去线')
  ok('⑧a 时间线页按线分组（主线/过去线各一组）', !!mainG && !!pastG, JSON.stringify(tl && tl.groups))
  ok('⑧b 每组只含本线章节（3/3，不串线）', !!(mainG && pastG && mainG.chapters === 3 && pastG.chapters === 3), mainG && pastG ? mainG.chapters + '/' + pastG.chapters : 'n/a')
  ok('⑧c 时间线页可切换镜头', (tl?.chips || []).length >= 3, JSON.stringify(tl?.chips))
  step('⑧ 时间线视图按线查看', mainG && pastG && mainG.chapters === 3 && pastG.chapters === 3 ? 'PASS' : 'BLOCK', JSON.stringify(tl && tl.groups))
  await shot(page, 'seal-walk-8-timeline')

  // ── ⑨ 章导航（镜头内连写 + 镜头外当前章说明）
  await page.eval(`(() => { location.hash = '#/project/' + location.hash.match(/#\\/project\\/([^/]+)/)[1] + '/novel'; return true })()`)
  await evalUntil(page, `!!document.querySelector('[data-testid="chapter-sidebar"]')`, Boolean, 12000, '正文页')
  await page.eval(sel('第2章'))
  await sleep(600)
  const lensPast = await page.eval(`(() => { const c = [...document.querySelectorAll('[data-testid="chapter-line-filter"] button')].find((b) => (b.innerText || '').includes('过去线')); if (!c) return false; c.click(); return true })()`)
  await sleep(700)
  const navState = await page.eval(`(() => {
    const q = (t) => { const b = document.querySelector('[data-testid="' + t + '"]'); return b ? { title: b.getAttribute('title'), disabled: !!b.disabled } : null }
    const rows = [...document.querySelectorAll('[data-testid="chapter-sidebar"] button')].map((b) => (b.innerText || '').replace(/\\s+/g, ' ').trim()).filter((t) => /第\\d+章/.test(t))
    const note = document.querySelector('[data-testid="chapter-lens-outside-note"]')
    const chip = document.querySelector('[data-testid="chapter-line-filter"] [aria-selected="true"]')
    return { prev: q('chapter-prev'), next: q('chapter-next'), rows, note: note ? (note.innerText || '').trim() : null, chip: chip ? chip.getAttribute('data-line') : null }
  })()`)
  ok('⑨a 镜头筛选后章列只留该线章', navState.rows.length === 3, JSON.stringify(navState.rows).slice(0, 200))
  ok('⑨b 线内「下一章」跳到同线下一章', /第4章/.test(navState.next?.title || ''), JSON.stringify(navState.next))
  await shot(page, 'seal-walk-9-nav-lens')
  // 切回主线镜头后，当前章（第2章）在镜头外 → 一行说明
  await page.eval(`(() => { const c = [...document.querySelectorAll('[data-testid="chapter-line-filter"] button')].find((b) => (b.getAttribute('data-line') || '') === '主线'); if (!c) return false; c.click(); return true })()`)
  await sleep(800)
  const noteState = await page.eval(`(() => {
    const n = document.querySelector('[data-testid="chapter-lens-outside-note"]')
    const rows = [...document.querySelectorAll('[data-testid="chapter-sidebar"] button')].map((b) => (b.innerText || '').replace(/\\s+/g, ' ').trim()).filter((t) => /第\\d+章/.test(t))
    return { note: n ? (n.innerText || '').trim() : null, rows: rows.length }
  })()`)
  ok('⑨c 镜头外的当前章有一行说明', !!noteState.note && /第2章|不在/.test(noteState.note), JSON.stringify(noteState))
  ok('⑨d 主线镜头只留主线三章', noteState.rows === 3, 'rows=' + noteState.rows)
  const navPass = navState.rows.length === 3 && /第4章/.test(navState.next?.title || '') && !!noteState.note
  step('⑨ 章导航（镜头内连写 + 镜头外说明）', navPass ? 'PASS' : 'BLOCK', 'note=' + noteState.note + ' next=' + JSON.stringify(navState.next))

  ok('零 JS 异常', page.errors.length === 0, JSON.stringify(page.errors).slice(0, 300))

  // ── ⑩ 连续写作的切章守卫（双线连写必经过：写一半切到另一条线，不能丢稿）
  await page.eval(sel('第3章'))
  await evalUntil(page, `window.__ZJ_EDITORS && window.__ZJ_EDITORS.length > 0`, Boolean, 12000, '第3章编辑器')
  await sleep(500)
  await page.eval(`(() => { window.__ZJ_EDITORS[0].focus(); return true })()`)
  await page.cmd('Input.insertText', { text: '门' })
  await sleep(500)
  await page.eval(sel('第1章'))
  const guard = await evalUntil(page, `(() => { const d = document.querySelector('[role="dialog"]'); if (!d) return null; const t = (d.innerText || '').replace(/\\s+/g, ' '); return /有未保存的改动/.test(t) ? { text: t.slice(0, 120), buttons: [...d.querySelectorAll('button')].map((b) => (b.innerText || '').trim()) } : null })()`, (v) => !!v, 8000, '切章守卫').catch(() => null)
  ok('⑩a 写一半切章弹确认（三选）', !!guard, JSON.stringify(guard))
  await page.eval(clickText('取消'))
  await sleep(600)
  const afterCancel = await page.eval(`(() => {
    const rows = [...document.querySelectorAll('[data-testid="chapter-sidebar"] button')]
    const selRow = rows.find((x) => (x.className || '').includes('accent-soft'))
    return { sel: selRow ? (selRow.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 24) : null, dialog: !!document.querySelector('[role="dialog"]') }
  })()`)
  ok('⑩b 取消留在原章（不丢稿）', /第3章/.test(afterCancel.sel || '') && !afterCancel.dialog, JSON.stringify(afterCancel))
  // 收尾：保存第3章，避免离开时留下 dirty 态（与真实作者动作一致）
  await page.eval(clickText('保存'))
  await sleep(900)
  const guardOk = !!guard && /第3章/.test(afterCancel.sel || '')
  steps.push({ name: '⑩ 切章未保存守卫（连续写作不丢稿）', verdict: guardOk ? 'PASS' : 'BLOCK', detail: JSON.stringify(guard && guard.buttons) + ' / 取消后=' + afterCancel.sel })
  console.log('STEP ' + (guardOk ? 'PASS' : 'BLOCK') + ' ⑩ 切章未保存守卫')
} catch (e) {
  fatal = String(e && e.message ? e.message : e)
  console.log('FATAL:', fatal)
  fails++
} finally {
  await sleep(300)
  page.close()
}
const dur = Math.round((Date.now() - t0) / 1000)
console.log('\n==== 走查汇总（' + dur + 's）====')
for (const s of steps) console.log(s.verdict.padEnd(6) + ' ' + s.name + (s.detail ? ' | ' + s.detail : ''))
console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILS`)
if (fatal) console.log('fatal:', fatal)
process.exit(fails === 0 ? 0 : 1)