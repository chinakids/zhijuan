// 织卷无头冒烟 · 设置页技能包管理 UI（体验层 2026-09-21）
// 用法：node scripts/skill-settings-ui-smoke.mjs
// 前置：node scripts/serve-renderer.mjs 8123；本机专用无头 Chrome CDP 127.0.0.1:9224（需先 npm run build）
// 验收点：管理面走查——列表（名称/描述/已停用徽标/未生效徽标）、开关停用/启用、新建（校验/Enter/IME 守卫）、
//         编辑（名称锁定+保存）、导入/导出（mock 回执）、删除两击确认与 3s 回退、窄窗零溢出、零 JS 异常。
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
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m)
      pending.delete(m.id)
    } else if (m.method === 'Runtime.exceptionThrown') {
      errors.push('EXC: ' + (m.params?.exceptionDetails?.text ?? ''))
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') {
      errors.push('CONSOLE: ' + JSON.stringify(m.params?.args ?? []).slice(0, 200))
    }
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

function ok(name, cond, extra = '') {
  if (!cond) {
    console.error('  ✗ ' + name + (extra ? ' | ' + extra : ''))
    process.exit(1)
  }
  console.log('  ✓ ' + name)
}

async function setField(page, selector, text) {
  return page.eval(
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)})
      if (!el) return 'NO_EL'
      el.focus()
      const proto = Object.getPrototypeOf(el)
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
      setter.call(el, ${JSON.stringify(text)})
      el.setSelectionRange(el.value.length, el.value.length)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      return el.value
    })()`
  )
}

async function clickEl(page, expr) {
  return page.eval(`(() => { const el = ${expr}; if (!el) return false; el.click(); return true })()`)
}

async function pointerClick(page, expr) {
  return page.eval(`(() => {
    const el = ${expr}
    if (!el) return false
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }))
    el.click()
    return true
  })()`)
}

const rowOf = (name) =>
  `[...document.querySelectorAll('[data-testid="skill-row"]')].find((r) => r.querySelector('span[title]')?.getAttribute('title') === ${JSON.stringify(name)})`

const ROW_NAMES = () =>
  `[...document.querySelectorAll('[data-testid="skill-row"] span[title]')].map((s) => s.getAttribute('title'))`

const CANVAS = 'document.body.innerText'

async function main() {
  const tab = await openTab(BASE + '/#/settings?cb=' + Date.now())
  const page = await attach(tab.webSocketDebuggerUrl)
  let pass = 0
  try {
    // —— A. 导航与列表 ——
    await evalUntil(page, `[...document.querySelectorAll('button')].some(b => b.innerText.includes('写作引擎'))`, (v) => v === true, 15000, '设置页加载')
    ok('A1 设置页加载（写作引擎分区按钮在）', true)
    await clickEl(page, `[...document.querySelectorAll('button')].find(b => b.innerText.includes('写作引擎'))`)
    await evalUntil(page, `document.querySelector('[data-testid="skill-settings-card"]') !== null`, (v) => v === true, 10000, '技能卡渲染')
    ok('A2 技能包卡片渲染（写作引擎区新卡片）', true)
    const rowNames = await evalUntil(page, ROW_NAMES(), (v) => Array.isArray(v) && v.includes('倒叙开篇法'), 10000, '种子技能行')
    ok('A3 列表含种子「倒叙开篇法」「禁用示例」', rowNames.includes('倒叙开篇法') && rowNames.includes('禁用示例'), JSON.stringify(rowNames))
    const disabledBadge = await page.eval(`${rowOf('禁用示例')}?.innerText.includes('已停用') === true`)
    ok('A4 禁用示例行带「已停用」徽标', disabledBadge === true)
    const descShown = await page.eval(`${rowOf('倒叙开篇法')}?.innerText.includes('从人物高光时刻落笔') === true`)
    ok('A5 列表行显示技能描述', descShown === true)
    pass += 5

    // —— B. 开关停用/启用（写面=setSkillDisabled → listSkills 重拉） ——
    const swOnBefore = await page.eval(`${rowOf('倒叙开篇法')}?.querySelector('[role="switch"]')?.getAttribute('aria-checked')`)
    ok('B1 倒叙开篇法默认启用（switch checked）', swOnBefore === 'true', String(swOnBefore))
    await pointerClick(page, `${rowOf('倒叙开篇法')}?.querySelector('[role="switch"]')`)
    await evalUntil(page, `${rowOf('倒叙开篇法')}?.innerText.includes('已停用') === true`, (v) => v === true, 8000, '停用后徽标出现')
    ok('B2 关闭开关 → 行出现「已停用」徽标', true)
    const msgB = await page.eval(`document.querySelector('[data-testid="skill-settings-card"] p[role="status"]')?.innerText ?? ''`)
    ok('B3 停用反馈消息', msgB.includes('已停用技能'), msgB)
    await pointerClick(page, `${rowOf('倒叙开篇法')}?.querySelector('[role="switch"]')`)
    await evalUntil(page, `${rowOf('倒叙开篇法')}?.querySelector('[role="switch"]')?.getAttribute('aria-checked') === 'true'`, (v) => v === true, 8000, '重新启用')
    const badgeGone = await page.eval(`${rowOf('倒叙开篇法')}?.innerText.includes('已停用') === false`)
    ok('B4 重新启用 → 徽标消失', badgeGone === true)
    pass += 4

    // —— C. 新建技能（空表单禁用 → 填写 → 创建） ——
    await clickEl(page, `[...document.querySelectorAll('button')].find(b => b.innerText.trim() === '新建技能')`)
    await evalUntil(page, `document.querySelector('#zj-skill-name') !== null`, (v) => v === true, 8000, '新建对话框')
    const titleC = await page.eval(`document.querySelector('[role="dialog"]')?.innerText.includes('新建技能包')`)
    ok('C1 新建对话框（标题=新建技能包）', titleC === true)
    const saveDisabled0 = await page.eval(`(() => { const b = [...document.querySelectorAll('[role="dialog"] button')].find(b => b.innerText.includes('创建技能')); return b?.disabled })()`)
    ok('C2 空表单创建按钮 disabled', saveDisabled0 === true, String(saveDisabled0))
    await setField(page, '#zj-skill-name', '断章钩子法')
    await setField(page, '#zj-skill-desc', '章节结尾留一个未解的问题，勾着读者翻页')
    await setField(page, '#zj-skill-triggers', '钩子 断章')
    await setField(page, '#zj-skill-body', '步骤：\n1. 在本章最后一个动作后抛出问题\n2. 不回答，直接收束')
    const saveDisabled1 = await page.eval(`(() => { const b = [...document.querySelectorAll('[role="dialog"] button')].find(b => b.innerText.includes('创建技能')); return b?.disabled })()`)
    ok('C3 填写后创建按钮可用', saveDisabled1 === false, String(saveDisabled1))
    // Enter 提交（焦点在名称框；IME 组合态除外——先正常 Enter）
    await page.eval(`(() => { const el = document.querySelector('#zj-skill-name'); el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); return true })()`)
    await evalUntil(page, `document.querySelector('[role="dialog"]') === null`, (v) => v === true, 8000, '对话框关闭')
    const rowNamesC = await evalUntil(page, ROW_NAMES(), (v) => Array.isArray(v) && v.includes('断章钩子法'), 8000, '新技能出现')
    ok('C4 Enter 创建成功 → 列表出现「断章钩子法」', rowNamesC.includes('断章钩子法'))
    const msgC = await page.eval(`document.querySelector('[data-testid="skill-settings-card"] p[role="status"]')?.innerText ?? ''`)
    ok('C5 创建反馈消息', msgC.includes('已保存技能《断章钩子法》'), msgC)
    pass += 5

    // —— D. 校验错误 + 编辑（名称锁定）+ IME Enter 守卫 ——
    await clickEl(page, `[...document.querySelectorAll('button')].find(b => b.innerText.trim() === '新建技能')`)
    await evalUntil(page, `document.querySelector('#zj-skill-name') !== null`, (v) => v === true, 8000, '新建对话框2')
    await setField(page, '#zj-skill-name', 'a/b')
    await setField(page, '#zj-skill-desc', '非法名演示')
    await clickEl(page, `[...document.querySelectorAll('[role="dialog"] button')].find(b => b.innerText.includes('创建技能'))`)
    await evalUntil(page, `document.querySelector('[role="dialog"] p[role="alert"]') !== null`, (v) => v === true, 8000, '字段错误')
    const errText = await page.eval(`document.querySelector('[role="dialog"] p[role="alert"]')?.innerText ?? ''`)
    ok('D1 非法技能名（a/b）→ 字段级错误常驻且对话框不关', errText.includes('不合法') || errText.includes('失败'), errText)
    // 关闭（Esc）
    await page.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await evalUntil(page, `document.querySelector('[role="dialog"]') === null`, (v) => v === true, 8000, 'Esc 关闭')
    // 编辑
    await clickEl(page, `document.querySelector('button[aria-label="编辑技能 倒叙开篇法"]')`)
    await evalUntil(page, `document.querySelector('#zj-skill-name') !== null`, (v) => v === true, 8000, '编辑对话框')
    const editState = await page.eval(`({ name: document.querySelector('#zj-skill-name')?.value, disabled: document.querySelector('#zj-skill-name')?.disabled, title: document.querySelector('[role="dialog"]')?.innerText.includes('编辑技能包《倒叙开篇法》') })`)
    ok('D2 编辑对话框回显 + 技能名锁定', editState.name === '倒叙开篇法' && editState.disabled === true, JSON.stringify(editState))
    await setField(page, '#zj-skill-desc', '从人物高光时刻落笔再回叙起因，制造悬念与代入感（修订）')
    await clickEl(page, `[...document.querySelectorAll('[role="dialog"] button')].find(b => b.innerText.includes('保存修改'))`)
    await evalUntil(page, `document.querySelector('[role="dialog"]') === null`, (v) => v === true, 8000, '保存关闭')
    const descEdited = await page.eval(`${rowOf('倒叙开篇法')}?.innerText.includes('（修订）') === true`)
    ok('D3 编辑保存 → 描述更新', descEdited === true)
    // IME 组合态 Enter 不提交（新建对话框，填好必填后 imeSetComposition → Enter）
    await clickEl(page, `[...document.querySelectorAll('button')].find(b => b.innerText.trim() === '新建技能')`)
    await evalUntil(page, `document.querySelector('#zj-skill-name') !== null`, (v) => v === true, 8000, '新建对话框3')
    await setField(page, '#zj-skill-name', '组合态技能')
    await setField(page, '#zj-skill-desc', 'IME 组合态 Enter 不应创建')
    await page.eval(`(() => { const el = document.querySelector('#zj-skill-name'); el.focus(); return true })()`)
    try { await page.cmd('Input.imeSetComposition', { text: '组', selectionStart: 1, selectionEnd: 1 }) } catch {}
    // 组合态 Enter 必须用 CDP 真实键盘事件（合成 KeyboardEvent 无 isComposing 标记；createchapter-hig 同款）
    await page.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 36 })
    await sleep(900)
    const imeState = await page.eval(`({ dlg: document.querySelector('[role="dialog"]') !== null })`)
    ok('D4 IME 组合态 Enter 不提交（对话框仍开）', imeState.dlg === true, JSON.stringify(imeState))
    try { await page.cmd('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 }) } catch {}
    await page.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await evalUntil(page, `document.querySelector('[role="dialog"]') === null`, (v) => v === true, 8000, 'Esc 关闭2')
    pass += 4

    // —— E. 导入 / 导出（devShim mock：导入「名字命名法」；导出虚拟路径） ——
    await clickEl(page, `[...document.querySelectorAll('button')].find(b => b.innerText.includes('导入 .md'))`)
    const rowNamesE = await evalUntil(page, ROW_NAMES(), (v) => Array.isArray(v) && v.includes('名字命名法'), 8000, '导入技能出现')
    ok('E1 导入 .md → 列表出现「名字命名法」', rowNamesE.includes('名字命名法'))
    const msgE1 = await page.eval(`document.querySelector('[data-testid="skill-settings-card"] p[role="status"]')?.innerText ?? ''`)
    ok('E2 导入反馈消息', msgE1.includes('已导入技能包'), msgE1)
    await clickEl(page, `document.querySelector('button[aria-label="导出技能 倒叙开篇法"]')`)
    const msgE2 = await evalUntil(page, `document.querySelector('[data-testid="skill-settings-card"] p[role="status"]')?.innerText ?? ''`, (v) => v.includes('已导出'), 8000, '导出反馈')
    ok('E3 导出 → 反馈含目标路径', msgE2.includes('已导出《倒叙开篇法》') && msgE2.includes('/tmp'), msgE2)
    pass += 3

    // —— F. 删除两击确认 + 3s 回退 ——
    await clickEl(page, `document.querySelector('button[aria-label="删除技能 断章钩子法"]')`)
    const confirmShown = await evalUntil(page, `[...document.querySelectorAll('button')].some(b => b.innerText.trim() === '确认删除')`, (v) => v === true, 8000, '确认删除按钮')
    ok('F1 删除第一击 → 出现「确认删除」', confirmShown === true)
    // 3s 回退
    await sleep(3300)
    const backToIcon = await page.eval(`document.querySelector('button[aria-label="删除技能 断章钩子法"]') !== null`)
    ok('F2 确认 3 秒未点 → 回退为图标', backToIcon === true)
    // 两击真删
    await clickEl(page, `document.querySelector('button[aria-label="删除技能 断章钩子法"]')`)
    await evalUntil(page, `[...document.querySelectorAll('button')].some(b => b.innerText.trim() === '确认删除')`, (v) => v === true, 8000, '确认删除按钮2')
    await clickEl(page, `[...document.querySelectorAll('button')].find(b => b.innerText.trim() === '确认删除')`)
    await evalUntil(page, `![...document.querySelectorAll('[data-testid="skill-row"] span[title]')].some(s => s.getAttribute('title') === '断章钩子法')`, (v) => v === true, 8000, '删除后行消失')
    ok('F3 确认删除 → 行消失', true)
    const msgF = await page.eval(`document.querySelector('[data-testid="skill-settings-card"] p[role="status"]')?.innerText ?? ''`)
    ok('F4 删除反馈消息', msgF.includes('已删除技能'), msgF)
    pass += 4

    // —— G. 窄窗零溢出 ——
    const width = await page.cmd('Browser.getWindowForTarget')
    try { await page.cmd('Emulation.setDeviceMetricsOverride', { width: 1000, height: 750, deviceScaleFactor: 1, mobile: false }) } catch {}
    await sleep(600)
    const overflow = await page.eval(`({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, ok: document.documentElement.scrollWidth <= window.innerWidth })`)
    ok('G1 窄窗 1000 宽页面零横向溢出', overflow.ok === true && overflow.sw <= overflow.iw, JSON.stringify(overflow))
    try { await page.cmd('Emulation.clearDeviceMetricsOverride') } catch {}
    await sleep(300)
    pass += 1

    // —— H. 零 JS 异常 ——
    ok('H1 全程无 JS 异常（exceptionThrown + console error）', page.errors.length === 0, page.errors.slice(0, 3).join(' ; '))

    console.log(`\n=== 结果: ${pass + 1} 断言全过（skill 设置管理 UI 冒烟）===`)
    page.close()
    process.exit(0)
  } catch (e) {
    console.error('  ✗ 冒烟失败: ' + e.message)
    console.error('  JS errors so far: ' + page.errors.slice(0, 5).join(' ; '))
    page.close()
    process.exit(1)
  }
}

main()
