// 织卷 · 多时间线装配真模型探针（2026-09-18 智能层，F-20260916-02 / 周交付增量 #4 印证）
// 数据层冒烟 multiline-context-smoke.mjs 已证「装配内容正确」（线内前驱/人物按线过滤），
// 但没有任何真模型探针验证「模型行为不跨线误承接」——多线头号风险（设计文档 §4.4/§4.5）。
// 场景：双线交错临时项目（主线 01/03/05 + 过去线 02/04），独家事实：
//   X=主线第03章尾部「红灯笼」（装配给第05章=线内前驱应有）
//   Y=过去线第04章尾部「木匣子」（他线前驱，装配**不得**含）
//   Z=人物档「## 切片：旧巷」小节「黄铜子弹壳」（他线人物状态，装配**不得**含）
// 判定：数据层白盒（X 在/Y 不在/Z 不在/回退链线内）+ 真模型三问（Q1 必须答 X 且不把 Y 当本线
//   上一章；Q2/Q3 不把他线物件归当前线；要求零工具=证明来自装配而非现读）。
// 用法：cd ~/Desktop/织卷 && node scripts/multiline-context-live.mjs
import { build as esbuild } from 'esbuild'
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const tmp = mkdtempSync(join(tmpdir(), 'zj-mline-live-'))
process.env.ZJ_APP_PATH = root
process.env.ZJ_USERDATA = join(tmp, 'userdata')
mkdirSync(process.env.ZJ_USERDATA, { recursive: true })
writeFileSync(join(process.env.ZJ_USERDATA, 'zhijuan-settings.json'), JSON.stringify({ libraryRoot: join(tmp, 'lib') }), 'utf-8')

const lib = join(tmp, 'lib')
const pid = '多线装配真模型探针'
const P = (rel) => join(lib, pid, rel)
for (const d of ['正文', '人物', '世界观']) mkdirSync(P(d), { recursive: true })

// ---- 双线交错场景文件（独家事实只出现在一处）----
const chapterRaw = (no, title, slice, line, names, body) =>
  [
    '---', `章号: ${no}`, `题名: ${title}`, line ? `时间线: ${line}` : '', `切片: ${slice}`,
    `时间: 2026-09`, `涉及人物: [${names.join(', ')}]`, '---', '', body
  ].filter((l) => l !== '').join('\n')

// 主线第01章（无独家事实）
writeFileSync(
  P('正文/第01章_渡口.md'),
  chapterRaw(1, '渡口', '第一幕_渡口', '', ['林晚'], '渡口的夜静得出奇。林晚站在石阶上等船，江水在脚下慢慢退潮。'),
  'utf-8'
)
// 过去线第02章（无独家事实）
writeFileSync(
  P('正文/第02章_老街.md'),
  chapterRaw(2, '老街', '旧巷', '过去', ['林晚'], '老街的傍晚，日头斜斜地挂在电线杆上。林晚背着书包从巷口走过。'),
  'utf-8'
)
// 主线第03章：正文尾部=独家事实 X（红灯笼）——将是第05章的线内前驱
writeFileSync(
  P('正文/第03章_灯下.md'),
  chapterRaw(3, '灯下', '第二幕_灯下', '', ['林晚'], '灯下的摊位收了，林晚帮着把桌子搬进屋里。出门的时候，她抬头看了一眼——红灯笼在檐下挂了一整夜，谁也没去摘。'),
  'utf-8'
)
// 过去线第04章：正文尾部=独家事实 Y（木匣子）——他线前驱，装配不得含
writeFileSync(
  P('正文/第04章_旧院.md'),
  chapterRaw(4, '旧院', '旧院', '过去', ['林晚'], '旧院的槐树又长高了一截。那天傍晚，木匣子被埋进槐树根下的土里，盖了三层落叶。'),
  'utf-8'
)
// 主线第05章（当前章，探针问它）
writeFileSync(
  P('正文/第05章_新灯.md'),
  chapterRaw(5, '新灯', '第三幕_新灯', '', ['林晚'], '新灯挂上檐角的第一夜，林晚站在街对面看了很久。'),
  'utf-8'
)
// 人物档：同一人两线状态不同（设计文档 C 形态）；Z=子弹壳只在过去线小节
writeFileSync(
  P('人物/林晚.md'),
  [
    '---', '姓名: 林晚', '身份: 学生', '---', '',
    '林晚，基础档案。', '## 基础档案', '- 身份：学生', '- 家：临河的老屋',
    '', '## 切片：第一幕_渡口', '渡口那夜之后，林晚开始相信陈默说的话。',
    '', '## 切片：旧巷', '旧巷那夜，林晚的抽屉里锁着一枚黄铜子弹壳。', ''
  ].join('\n'),
  'utf-8'
)
// 世界观切片：第三幕_新灯 与 旧院 刻意不建 → 第05章走回退链取线内前驱（第二幕_灯下）
writeFileSync(P('世界观/切片_第一幕_渡口.md'), ['# 切片：第一幕_渡口', '', '- 码头的灯一到夜里就亮。', ''].join('\n'), 'utf-8')
writeFileSync(P('世界观/切片_旧巷.md'), ['# 切片：旧巷', '', '- 老街的电线杆上贴满了寻人启事。', ''].join('\n'), 'utf-8')
writeFileSync(P('世界观/切片_第二幕_灯下.md'), ['# 切片：第二幕_灯下', '', '- 灯下的摊位每晚九点收摊。', ''].join('\n'), 'utf-8')

// ---- 第一段：数据层（bundle context.ts）----
const ctxOut = join(tmp, 'ctx-bundle.mjs')
await esbuild({
  entryPoints: [resolve(root, 'src/main/agent/context.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: ctxOut,
  alias: { electron: resolve(root, 'scripts/electron-stub.mjs') },
  external: ['node:*'],
  logLevel: 'warning'
})
const ctxMod = await import(pathToFileURL(ctxOut).href)
const ctx = await ctxMod.buildWritingContext(pid, '正文/第05章_新灯.md')
const b = ctx.blocks.join('\n')
console.log('=== 数据层：buildWritingContext(第05章_新灯) ===')
ctx.blocks.forEach((blk, i) => {
  const head = blk.split('\n').find((l) => l.startsWith('【')) ?? blk.slice(0, 40)
  console.log(`[${i + 1}] ${head}`)
})
const dataChecks = [
  ['线内前驱=第03章（非全局上一章第04章）', b.includes('【上一章尾部：第03章_灯下】') && !b.includes('【上一章尾部：第04章_旧院】')],
  ['线内前驱内容 X 真实进入装配（红灯笼）', b.includes('红灯笼')],
  ['他线前驱 Y 不污染装配（无木匣子）', !b.includes('木匣子')],
  ['块头注明本章时间线', b.includes('（本章时间线')],
  ['块头注明同线前章=第3章且非全局上一章', b.includes('同线前章=第3章') && b.includes('非全局上一章')],
  ['人物按线过滤：注入主线状态（相信陈默）', b.includes('渡口那夜之后')],
  ['人物他线小节剔除并注明（旧巷）', b.includes('略去其他线切片小节') && b.includes('旧巷')],
  ['人物 Z 不污染装配（无子弹壳）', !b.includes('子弹壳')],
  ['回退链取线内前驱切片（第二幕_灯下，非他线旧院）', b.includes('【上一切片设定：第二幕_灯下】') && !b.includes('旧院')]
]
let dataPass = true
for (const [name, ok] of dataChecks) {
  if (!ok) dataPass = false
  console.log(`  ${ok ? '✓' : '✗'} ${name}`)
}
console.log(dataPass ? 'MLINE DATA OK' : 'MLINE DATA FAILED')
if (!dataPass) {
  rmSync(tmp, { recursive: true, force: true })
  process.exit(1)
}

// ---- 第二段：真模型（bundle engine.ts，一次 runChat 三问）----
const out = join(tmp, 'engine-bundle.mjs')
await esbuild({
  entryPoints: [resolve(root, 'src/main/agent/engine.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: out,
  alias: { electron: resolve(root, 'scripts/electron-stub.mjs') },
  external: ['node:*'],
  logLevel: 'warning'
})
const mod = await import(pathToFileURL(out).href)
const events = []
console.log('\n=== 开始 runChat（多线装配探针）:', new Date().toISOString())
await mod.runChat(
  {
    requestId: 'mline-ctx-' + Date.now(),
    projectId: pid,
    chapterRel: '正文/第05章_新灯.md',
    chapterTitle: '第5章',
    prompt:
      '请只依据上面【当前创作上下文】里的内容回答下面 3 个问题，不要调用任何工具读文件，不要脑补编造：\n' +
      '1. 这一章的上一章（同一时间线的前一章）结尾，发生过什么特别的事（说出具体物件与行为）？\n' +
      '2. 项目里另一条时间线（过去线）最近一章的内容，现在这份上下文里有没有提到？如果提到了请引用并说明属于哪条线；没有就直接说没有。\n' +
      '3. 林晚在这条（当前）时间线最近的状态记录里，有没有属于她本人的特别物件？如果上下文里没有，直说没有。\n' +
      '每题一行，格式「N. 答案」。',
    quote: null
  },
  (e) => {
    events.push(e)
    if (e.type === 'delta') process.stdout.write(e.text)
    else if (e.type === 'meta') console.log('\n[工具]', e.tool)
    else if (e.type === 'meta-done') console.log('[工具完成]', (e.message ?? '').slice(0, 60))
    else if (e.type === 'error') console.error('\n[错误]', e.message)
  }
)
console.log('\n=== 完成，事件数:', events.length)
await mod.shutdown()

const final = events.filter((e) => e.type === 'final').map((e) => e.text).join('\n')
console.log('\n[最终回复]\n' + final)
const tools = events.filter((e) => e.type === 'meta').map((e) => e.tool)
console.log('\n调用工具:', JSON.stringify(tools))

// ---- 判定：Q1 必须答 X 且不把 Y 当本线上一章；Q2/Q3 不把他线物件归当前线；零工具 ----
const seg = (n) => {
  const m = final.match(new RegExp(`(?:^|\\n)${n}\\.\\s*([\\s\\S]*?)(?=\\n\\d+\\.\\s|$)`))
  return m ? m[1] : ''
}
const q1 = seg(1)
const q2 = seg(2)
const q3 = seg(3)
console.log('\n--- 题段抽取 ---\nQ1=' + q1.slice(0, 200) + '\nQ2=' + q2.slice(0, 200) + '\nQ3=' + q3.slice(0, 200))

const checks = [
  ['Q1 答出线内前驱事实 X（红灯笼）', q1.includes('红灯笼')],
  ['Q1 未把他线 Y 当本线上一章（Q1 无木匣子）', !q1.includes('木匣子')],
  ['Q2 未把 Y 归当前线（提到木匣子必须归过去线）', !(q2.includes('木匣子') && !q2.includes('过去线'))],
  ['Q3 未把 Z 归当前线（提到子弹壳必须归过去/旧巷线）', !(q3.includes('子弹壳') && !(q3.includes('过去') || q3.includes('旧巷')))],
  ['零工具读盘（信息来自装配而非现读）', !tools.some((t) => t === 'zj_read_doc' || t === 'zj_search')]
]
const misses = checks.filter(([n, ok]) => !ok).map(([n]) => n)
const livePass = misses.length === 0
console.log('\n未命中:', JSON.stringify(misses))
console.log('\n' + (dataPass && livePass ? 'MULTILINE-CTX LIVE OK' : 'MULTILINE-CTX LIVE FAILED'))
rmSync(tmp, { recursive: true, force: true })
process.exit(dataPass && livePass ? 0 : 1)
