// 织卷无头冒烟 · 称谓类「别名登记」提案 UI 链路（智能层 2026-09-15 15:00 轮）
// 验证：kind=replace-text 的别名登记提案（before=姓名行 / after=姓名行+别名行）在提案抽屉的
// 展示（原状/将写入）与「接受」落盘（in-memory 人物档别言行并入）——与数据层冒烟
// nameform-proposal-data-smoke.mjs（真机 runNameMix/runNameForms 产出 + applyProposal 真盘）互补。
// 用法：npm run build 后（devShim 已含本轮改动）node scripts/alias-proposal-ui-smoke.mjs
// 前置：serve-renderer（127.0.0.1:8899）+ 本机专用无头 Chrome CDP 127.0.0.1:9224
const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8899'
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
    ws.onopen = () =>
      res({
        cmd,
        eval: async (expression) => {
          const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
          if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 300))
          return r.result?.value
        },
        shot: async (file) => {
          await cmd('Page.enable')
          const s = await cmd('Page.captureScreenshot', { format: 'png' })
          const { writeFileSync } = await import('node:fs')
          writeFileSync(file, Buffer.from(s.data, 'base64'))
          return file
        },
        close: () => ws.close()
      })
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

let pass = 0
const check = (name, cond) => {
  if (!cond) throw new Error('断言失败: ' + name)
  pass++
  console.log('  ✓ ' + name)
}

const tab = await openTab(BASE + '/?cb=' + Date.now() + '#/project/demo-aseya/novel')
const page = await attach(tab.webSocketDebuggerUrl)
try {
  await evalUntil(page, `document.body.innerText.includes('Agent') && document.body.innerText.includes('第1章')`, (v) => v === true, 20000, '正文页就绪')

  // ① 语境说明：真实链路（runNameMix/runNameForms 产出 proposal）由数据层冒烟覆盖；
  //    此处以同构载荷验证提案抽屉展示与接受写入（kind=replace-text · 别名登记）
  const seed = await page.eval(`(() => {
    if (!window.zhijuan) return 'NO_SHIM'
    window.zhijuan.proposals.unshift({
      id: 'demo-alias-1', source: 'agent-chat', chapter: '', slice: '', status: 'pending',
      createdAt: Date.now(),
      items: [{ target: '人物/沈藏.md', anchor: '', kind: 'replace-text', before: '姓名: 沈藏', after: '姓名: 沈藏\\n别名: [韩师傅, 老韩]', reason: '巡查建议 · 登记称谓别名' }],
      meta: { note: '称谓发现 · 登记别名' }
    })
    return 'SEEDED'
  })()`)
  check('种子提案注入（window.zhijuan.proposals）', seed === 'SEEDED')

  // ② 触发提案台刷新：选章→编辑器置脏→保存正文（与真机同链路：保存 → handleChapterSaved → doSync → bump → 提案台 refresh）
  await evalUntil(page, `[...document.querySelectorAll('button')].some(b => (b.textContent||'').includes('第1章 · 雾港'))`, (v) => v === true, 15000, '章节项出现')
  await page.eval(`(() => { const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').includes('第1章 · 雾港')); b.click(); return true })()`)
  await evalUntil(page, `Array.isArray(window.__ZJ_EDITORS) && window.__ZJ_EDITORS.length > 0`, (v) => v === true, 15000, '编辑器挂载')
  const dirty = await page.eval(`(async () => {
    window.__ZJ_EDITORS[0].focus()
    return true
  })()`)
  await page.cmd('Input.insertText', { text: '。' })
  await sleep(400)
  const saved = await page.eval(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.textContent||'').includes('保存'))
    if (!b) return 'NOT_FOUND'
    if (b.disabled) return 'DISABLED'
    b.click()
    return 'CLICKED'
  })()`)
  check('点击「保存」刷新提案台', saved === 'CLICKED')

  // ③ 顶栏「待确认提案」出现 → 打开抽屉 → 卡片（理由）→ 展开「前后对照」→ 断言 before/after
  await evalUntil(page, `document.body.innerText.includes('待确认提案')`, (v) => v === true, 15000, '待确认提案入口出现')
  await page.eval(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('待确认提案'))
    if (b) b.click()
  })()`)
  await evalUntil(page, `document.body.innerText.includes('登记称谓别名') && document.body.innerText.includes('人物/沈藏.md')`, (v) => v === true, 10000, '提案卡片渲染')
  check('卡片理由「登记称谓别名」+ target 显示', true)
  await page.eval(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('前后对照'))
    if (b) b.click()
  })()`)
  await evalUntil(page, `document.body.innerText.includes('将写入') && document.body.innerText.includes('别名: [韩师傅, 老韩]')`, (v) => v === true, 8000, '前后对照展开')
  const txt = await page.eval(`document.body.innerText`)
  check('卡片「原状」= before（姓名行）', txt.includes('姓名: 沈藏'))
  check('卡片「将写入」= after（含别名行）', txt.includes('别名: [韩师傅, 老韩]'))

  const dir = process.env.HOME + '/Pictures/zhijuan'
  const { mkdirSync } = await import('node:fs')
  mkdirSync(dir, { recursive: true })
  const shotFile = dir + '/alias-proposal-' + new Date().toTimeString().slice(0, 5).replace(':', '') + '.png'
  console.log('截图:', await page.shot(shotFile))

  // ④ 接受 → 人物档（内存）别名并入
  await page.eval(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '接受')
    if (b) b.click()
  })()`)
  await evalUntil(page, `(async () => { try { const d = await window.zhijuan.readDoc('demo-aseya', '人物/沈藏.md'); return (d ?? '').includes('别名: [韩师傅, 老韩]') } catch { return false } })()`, (v) => v === true, 10000, '接受后档案并入')
  check('接受后 人物/沈藏.md 含「别名: [韩师傅, 老韩]」', true)

  console.log(`\n全部通过：${pass} 断言`)
  console.log('SCREENSHOT:' + shotFile)
} finally {
  page.close()
}
