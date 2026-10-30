// 织卷无头冒烟 · 检查自动化的「可执行落点」：缺段删注释 / 章号对齐文件名（2026-10-30 智能层，封版① 配套）
// 背景：2026-10-29 轮把在场核查（presence）接成了按章合并的可执行卡，但本地 9 项里
// 时序（order）与缺段（actgaps）仍只有建议文本 → 作者看完还得自己找文件改。
// 本轮按 Vale action 系统同哲学（vale.sh/docs/topics/styles/#actions：能确定替换/删除的才给
// quick fix，需判断的留 suggestion）补两条确定性落点：
//   · 缺段：每条占位注释自带「删除该注释」卡（before=注释原文，after=''）
//   · 时序 R1/R2：章号缺失/与文件名不一致 → 自带「章号对齐文件名」卡
// 覆盖：
//   A auditAuto 三项真算 → 3 张卡（缺段 1 / 章号不对 1 / 章号缺失 1）
//   B 三类卡的 target/kind/before/after/reason 形态
//   C 重跑 created=0（pending 去重）
//   D 提案抽屉里能看见「检查 · 缺段核查」卡
//   E 采纳即落盘：占位注释消失、正文其余保留；章号改成文件名编号
//   F 全程无 JS 异常
// 用法：node scripts/audit-fixcards-ui-smoke.mjs   （需 out/renderer 已 build + SPA server + CDP 9224）
import { writeFileSync } from 'node:fs'
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
  const p = new Map()
  const errors = []
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data)
    if (msg.id && p.has(msg.id)) {
      p.get(msg.id)(msg)
      p.delete(msg.id)
      return
    }
    if (msg.method === 'Runtime.exceptionThrown')
      errors.push(msg.params?.exceptionDetails?.exception?.description || JSON.stringify(msg.params?.exceptionDetails || {}).slice(0, 200))
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error')
      errors.push((msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200))
  }
  const cmd = (method, params = {}) =>
    new Promise((res, rej) => {
      const id = ++seq
      p.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)))
      ws.send(JSON.stringify({ id, method, params }))
    })
  return new Promise((res) => {
    ws.onopen = async () => {
      const page = {
        cmd,
        errors,
        eval: async (expression) => {
          const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
          if (r.exceptionDetails) throw new Error('EVAL ' + JSON.stringify(r.exceptionDetails).slice(0, 300))
          return r.result?.value
        }
      }
      try { await cmd('Runtime.enable') } catch {}
      res(page)
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
    if (Date.now() - t0 > timeoutMs) throw new Error('TIMEOUT ' + label)
    await sleep(250)
  }
}
let fail = 0
const ok = (n, c, x = '') => {
  console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' | ' + x : ''))
  if (!c) fail++
}

// 三个临时章节：缺段占位 / 章号与文件名不一致 / 章号缺失
const GAP = '<!-- 分幕草稿缺第 2 段：此处情节未写成，待补齐 -->'
const DOC_GAP = `---\n章号: 91\n题名: 检查缺段\n切片: 第一幕_夜\n---\n# 检查缺段\n\n她回头。\n\n${GAP}\n\n然后说：走吧。\n`
const DOC_NUM = `---\n章号: 5\n题名: 检查章号\n切片: 第一幕_夜\n---\n# 检查章号\n\n正文一句。\n`
const DOC_ADD = `---\n题名: 检查补号\n切片: 第一幕_夜\n---\n# 检查补号\n\n正文一句。\n`

const openDrawer = `(() => { const b = [...document.querySelectorAll('button')].find(x => (x.getAttribute('title')||'').includes('待确认') || (x.innerText||'').includes('待确认提案')); if (b) { b.click(); return true } return false })()`
const cardsJson = `(() => [...document.querySelectorAll('[data-pid]')].map(c => ({ all: c.innerText })))()`

const tab = await openTab(BASE)
const page = await attach(tab.webSocketDebuggerUrl)
try {
  await evalUntil(page, `typeof window.zhijuan?.auditAuto === 'function'`, (v) => v === true, 20000, 'zhijuan 就绪')
  await page.eval(`window.zhijuan.setSettings({ guideEnabled: false })`)
  await page.eval(`(location.hash = '#/project/demo-aseya/novel', 1)`)
  await sleep(1200)

  // 铺三个临时章节（devShim 内存文档；本 tab 独占，不影响他 tab）
  await page.eval(`window.zhijuan.writeDoc('demo-aseya', '正文/第91章_检查缺段.md', ${JSON.stringify(DOC_GAP)})`)
  await page.eval(`window.zhijuan.writeDoc('demo-aseya', '正文/第92章_检查章号.md', ${JSON.stringify(DOC_NUM)})`)
  await page.eval(`window.zhijuan.writeDoc('demo-aseya', '正文/第93章_检查补号.md', ${JSON.stringify(DOC_ADD)})`)

  // A/B 自动检查 → 三类卡
  const r1 = await page.eval(`window.zhijuan.auditAuto('demo-aseya', { kinds: ['actgaps','order'] })`)
  ok('A1 auditAuto 出卡（缺段/章号两路都真算）', r1?.created >= 3, `created=${r1?.created} ran=${JSON.stringify(r1?.ran)}`)
  const cards = await page.eval(`(async () => { const ps = await window.zhijuan.listProposals('demo-aseya'); return ps.filter(p => p.source === 'audit' && p.status === 'pending').map(p => ({ id: p.id, it: p.items[0] })) })()`)
  const gapCard = (cards ?? []).find((c) => (c.it?.target ?? '').includes('检查缺段'))
  const numCard = (cards ?? []).find((c) => (c.it?.target ?? '').includes('检查章号'))
  const addCard = (cards ?? []).find((c) => (c.it?.target ?? '').includes('检查补号'))
  ok('B1 缺段卡：target=该章、kind=replace-text、after 为空', gapCard?.it?.kind === 'replace-text' && gapCard?.it?.after === '', JSON.stringify(gapCard?.it ?? null).slice(0, 160))
  ok('B2 缺段卡 before 就是占位注释原文（含两侧换行）', (gapCard?.it?.before ?? '').includes('分幕草稿缺第 2 段') && (gapCard?.it?.before ?? '').startsWith('\n'), JSON.stringify(gapCard?.it?.before ?? '').slice(0, 80))
  ok('B3 缺段卡理由中文可读', /检查 · 缺段核查/.test(gapCard?.it?.reason ?? '') && !/actgaps/.test(gapCard?.it?.reason ?? ''), gapCard?.it?.reason)
  ok('B4 章号不一致卡：章号 5 → 92（对齐文件名）', numCard?.it?.before === '章号: 5' && numCard?.it?.after === '章号: 92', `${numCard?.it?.before} → ${numCard?.it?.after}`)
  ok('B5 章号缺失卡：在约定头末行后补「章号: 93」', (addCard?.it?.after ?? '') === (addCard?.it?.before ?? '') + '\n章号: 93' && (addCard?.it?.before ?? '').includes('切片: 第一幕_夜'), `${addCard?.it?.before} → ${addCard?.it?.after}`)

  // C 去重
  const r2 = await page.eval(`window.zhijuan.auditAuto('demo-aseya', { kinds: ['actgaps','order'] })`)
  ok('C1 重跑 created=0（pending 去重）', r2?.created === 0, `created=${r2?.created}`)

  // D 抽屉呈现
  const opened = await page.eval(openDrawer)
  ok('D1 提案抽屉可打开', opened === true)
  const list = await evalUntil(page, cardsJson, (v) => Array.isArray(v) && v.length > 0, 10000, '提案卡出现')
  ok('D2 抽屉里有「检查 · 缺段核查」卡（不是内部 id）', list.some((c) => c.all.includes('检查 · 缺段核查')))
  // D3/D4 前后对照可读：占位注释是 HTML 注释，markdown 会整段吞掉 → 卡内按原样等宽显示
  const diffOpen = await page.eval(`(() => { const c = [...document.querySelectorAll('[data-pid]')].find(x => x.innerText.includes('缺段核查')); if (!c) return 'NO_CARD'; const b = [...c.querySelectorAll('button')].find(x => x.innerText.includes('前后对照')); if (!b) return 'NO_BTN'; b.click(); return 'OK' })()`)
  await sleep(400)
  const diffText = await page.eval(`(() => { const c = [...document.querySelectorAll('[data-pid]')].find(x => x.innerText.includes('缺段核查')); return c ? c.innerText : '' })()`)
  ok('D3 展开前后对照能看见要删的占位注释原文', diffOpen === 'OK' && diffText.includes('分幕草稿缺第 2 段'), `${diffOpen} | ${diffText.slice(0, 120).replace(/\n/g, ' / ')}`)
  ok('D4 删除类卡片「将写入」写明（删除这一段）', diffText.includes('（删除这一段）'))

  // E 采纳即落盘
  const applied = await page.eval(`window.zhijuan.applyProposal('demo-aseya', ${JSON.stringify(gapCard?.id ?? '')})`)
  ok('E1 缺段卡采纳成功', applied?.ok === true, JSON.stringify(applied ?? null).slice(0, 120))
  const gapAfter = await page.eval(`window.zhijuan.readDoc('demo-aseya', '正文/第91章_检查缺段.md')`)
  ok('E2 占位注释已删、正文其余保留', !String(gapAfter).includes('分幕草稿缺第 2 段') && String(gapAfter).includes('她回头。') && String(gapAfter).includes('然后说：走吧。'), String(gapAfter).slice(0, 80).replace(/\n/g, ' / '))
  ok('E3 删注释后不留多余空行', /她回头。\n\n然后说：走吧。/.test(String(gapAfter)))

  const applied2 = await page.eval(`window.zhijuan.applyProposal('demo-aseya', ${JSON.stringify(numCard?.id ?? '')})`)
  const numAfter = await page.eval(`window.zhijuan.readDoc('demo-aseya', '正文/第92章_检查章号.md')`)
  ok('E4 章号卡采纳后约定头=章号: 92', applied2?.ok === true && /章号: 92/.test(String(numAfter)), String(numAfter).split('\n').slice(0, 4).join(' / '))

  const applied3 = await page.eval(`window.zhijuan.applyProposal('demo-aseya', ${JSON.stringify(addCard?.id ?? '')})`)
  const addAfter = await page.eval(`window.zhijuan.readDoc('demo-aseya', '正文/第93章_检查补号.md')`)
  ok('E5 补号卡采纳后约定头多出「章号: 93」', applied3?.ok === true && /章号: 93/.test(String(addAfter)), String(addAfter).split('\n').slice(0, 4).join(' / '))

  // F 无 JS 异常
  ok('F1 无 JS 异常', page.errors.length === 0, page.errors.slice(0, 2).join(' / '))

  const s = await page.cmd('Page.captureScreenshot', { format: 'png' })
  const stamp = new Date().toTimeString().slice(0, 5).replace(':', '')
  writeFileSync(process.env.HOME + `/Pictures/zhijuan/audit-fixcards-${stamp}.png`, Buffer.from(s.data, 'base64'))
  console.log('SHOT ' + process.env.HOME + `/Pictures/zhijuan/audit-fixcards-${stamp}.png`)
} catch (e) {
  console.error('FATAL: ' + e.message)
  if (page.errors?.length) console.error('JS ERRORS: ' + page.errors.slice(0, 3).join(' / '))
  fail++
} finally {
  try { await fetch(CDP + '/json/close/' + tab.id) } catch {}
}
console.log(`\n结果：${fail === 0 ? 'ALL PASS' : fail + ' 项失败'}`)
process.exit(fail ? 1 : 0)
