// 织卷无头冒烟 · 正文字数口径（F-20261027-02）：章首「本章故事要素」指引块不计入字数
// 用法：node scripts/chapter-wordcount-guide-ui-smoke.mjs
// 前置：npm run build；node scripts/serve-renderer.mjs 8123；无头 Chrome CDP 127.0.0.1:9224
// 验收点（创作层 2026-10-28）：
//   ① 建章写了要素块（目标/核心冲突）但未动笔 → 章列字数 = 题名长度（不再是 58 字）
//   ② 同一时刻状态条「约 N 字」与章列字数一致（两处同源 countWords，不许一个 58 一个 2）
//   ③ 盘上文档仍完整保留要素块（写盘契约 D-V2-7 不动）
//   ④ 写入正文并保存 → 字数 = 题名 + 正文（要素块仍不计）
//   ⑤ 全程零 JS 异常
import { writeFileSync, mkdirSync } from 'node:fs'

const CDP = 'http://127.0.0.1:9224'
const BASE = process.env.ZJ_SMOKE_BASE || 'http://localhost:8123'
const OUT = process.env.HOME + '/Pictures/zhijuan'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const cb = Date.now()
let fails = 0
function ok(name, cond, detail = '') {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail ? ' | ' + String(detail).slice(0, 200) : ''))
  if (!cond) fails++
}

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
        cmd, errors,
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
    } catch { /* retry */ }
    if (Date.now() - t0 > timeoutMs) throw new Error('TIMEOUT waiting: ' + label)
    await sleep(300)
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
}

const fill = (selector, value) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)})
  if (!el) return false
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)})
  el.dispatchEvent(new Event('input', { bubbles: true }))
  return true
})()`
const clickBtn = (text) => `(() => {
  const els = [...document.querySelectorAll('button')]
  const el = els.find(b => b.innerText.trim() === ${JSON.stringify(text)} || b.innerText.includes(${JSON.stringify(text)}))
  if (!el || el.disabled) return false
  el.click()
  return true
})()`
const openCreate = `(() => {
  const el = document.querySelector('button[title="新建章节"]')
  if (!el || el.disabled) return false
  el.click()
  return true
})()`
// 章列行内「切片 · N 字」的 N（按题名定位本章行；新章切片名=章号，故也用题名 secondary 匹配）
const rowWords = (title) => `(() => {
  const els = [...document.querySelectorAll('span[title]')].filter(e => / · \\d+ 字$/.test(e.getAttribute('title') || ''))
  const hit = els.find(e => ((e.parentElement?.parentElement?.innerText) || '').includes(${JSON.stringify(title)}))
  if (!hit) return null
  const m = (hit.getAttribute('title') || '').match(/ · (\\d+) 字$/)
  return m ? Number(m[1]) : null
})()`
const statusWords = `(() => {
  const m = (document.body.innerText || '').match(/约 (\\d+) 字/)
  return m ? Number(m[1]) : null
})()`

const CHAPTER_TITLE = '渡口'

async function run() {
  const tab = await openTab(BASE + '/#/project/demo-aseya?cb=' + cb)
  const page = await attach(tab.webSocketDebuggerUrl)
  try {
    await evalUntil(page, `document.querySelector('button[title="新建章节"]') !== null`, (v) => v === true, 20000, '正文页就绪')
    // 建章：填题名 + 要素（目标/核心冲突）→ 要素块写入正文体首部
    await page.eval(openCreate)
    await evalUntil(page, `document.querySelector('#cc-title') !== null`, (v) => v === true, 10000, '建章对话框')
    await page.eval(fill('#cc-title', CHAPTER_TITLE))
    await page.eval(fill('#cc-goal', '把船撑到对岸'))
    await page.eval(fill('#cc-conflict', '夜里起了雾，对岸的灯灭了'))
    await sleep(150)
    await page.eval(clickBtn('创建'))
    await evalUntil(page, `document.body.innerText.includes('${CHAPTER_TITLE}')`, (v) => v === true, 15000, '新章出现')
    await evalUntil(page, `window.__ZJ_EDITORS && window.__ZJ_EDITORS.length > 0`, Boolean, 15000, '编辑器挂载')
    await sleep(600)

    // ③ 写盘契约：要素块仍在盘上（本次只改计数口径，不动写入）
    const docInfo = await page.eval(`(async () => {
      const id = decodeURIComponent(location.hash.match(/#\\/project\\/([^/]+)/)[1])
      const list = await window.zhijuan.listChapters(id)
      const ch = list.find(c => ${JSON.stringify(CHAPTER_TITLE)} === c.title || (c.file || '').includes(${JSON.stringify(CHAPTER_TITLE)}))
      const raw = ch ? await window.zhijuan.readDoc(id, '正文/' + ch.file) : null
      return { file: ch ? ch.file : null, wordCount: ch ? ch.wordCount : null, hasGuide: /== 本章故事要素 ==/.test(raw || ''), head: (raw || '').slice(0, 60) }
    })()`)
    ok('①a 章头（约定头）仍在盘上', !!docInfo.file, JSON.stringify(docInfo))
    ok('③ 盘上仍完整保留「本章故事要素」指引块（写盘契约不动）', docInfo.hasGuide === true, docInfo.head)

    // ① 章列字数 = 题名长度（渡口=2），不再是 58
    const rw = await page.eval(rowWords(CHAPTER_TITLE))
    ok('① 章列字数 = 题名长度 2（要素块不计）', rw === 2, 'row=' + JSON.stringify(rw) + ' listChapters.wordCount=' + docInfo.wordCount)
    // ①b 与我们期望不一致时给出 listChapters 层证据（同一 countWords 单源）
    ok('①b listChapters.wordCount 同口径=2', docInfo.wordCount === 2, 'wc=' + docInfo.wordCount)

    // ② 状态条同口径
    await sleep(400)
    const sw = await page.eval(statusWords)
    ok('② 状态条「约 N 字」与章列同源=2', sw === 2, 'status=' + JSON.stringify(sw))
    await shot(page, 'wordcount-guide-new')

    // ④ 写正文并保存 → 字数 = 题名 + 正文（要素块仍不计；章列字数随保存后的 listChapters 更新）
    const body = '雾从江面漫上来，灯笼晃了一下。'
    await page.eval(`(() => {
      const ed = window.__ZJ_EDITORS[0]
      ed.setContent(ed.getMarkdown() + ${JSON.stringify('\n\n' + body)})
      return true
    })()`)
    await page.eval(`(() => { window.__ZJ_EDITORS[0].focus(); return true })()`)
    await page.cmd('Input.insertText', { text: '。' })
    await sleep(400)
    const expect = 2 + [...body, '。'].length // 中文按字，标点也算可见字符
    const sw2 = await page.eval(statusWords)
    ok('④a 状态条字数含正文、不含要素块', sw2 === expect, 'status=' + sw2 + ' expect=' + expect)
    // 保存后章列（listChapters 读盘计数）同步到同一口径
    await page.eval(clickBtn('保存'))
    const rw2 = await evalUntil(page, rowWords(CHAPTER_TITLE), (v) => v === expect, 15000, '保存后章列字数').catch(
      () => null
    )
    ok('④b 保存后章列字数与状态条同源', rw2 === expect, 'row=' + rw2 + ' expect=' + expect)
    // ④c 保存把正文按编辑器序列化回写（== 会被转义成 \==），剥块逻辑仍要认——不认就「保存一次字数又虚高」
    const after = await page.eval(`(async () => {
      const id = decodeURIComponent(location.hash.match(/#\\/project\\/([^/]+)/)[1])
      const list = await window.zhijuan.listChapters(id)
      const ch = list.find(c => (c.file || '').includes(${JSON.stringify(CHAPTER_TITLE)}))
      const raw = ch ? await window.zhijuan.readDoc(id, '正文/' + ch.file) : ''
      return { wc: ch ? ch.wordCount : null, guide: /本章故事要素/.test(raw || ''), escaped: /\\\\==\\s*本章故事要素/.test(raw || '') }
    })()`)
    ok('④c 回写后要素块仍在、计数仍正确', after.guide === true && after.wc === expect, JSON.stringify(after))
    await shot(page, 'wordcount-guide-written')

    ok('⑤ 全程无 JS 异常/console.error', page.errors.length === 0, page.errors.slice(0, 2).join(' ; '))
  } catch (e) {
    ok('场景异常', false, String(e).slice(0, 300))
  }
  page.close()
}

await run()
console.log(fails === 0 ? 'CHAPTER-WORDCOUNT-GUIDE SMOKE OK' : 'CHAPTER-WORDCOUNT-GUIDE SMOKE FAILED: ' + fails)
process.exit(fails === 0 ? 0 : 1)