// 织卷 · 双线中篇验收演练（智能层侧）· 真模型探针（2026-10-28 智能层，封版目标①）
// ---------------------------------------------------------------------------
// 本周增量（docs/周交付/2026-W44-封版验收预演-双线中篇动线走查.md）给智能层的分工是
// 「规则体检与 Agent 装配在双线场景下的表现（线内不串）」。体验层已把动线跑通（预演-2026-10-27.md），
// 报告留的口子正是：「真模型切片同步在双线语境的质量」缺真模型直连验证。
//
// 本探针补这一口，跑真边车 + 真模型两件事：
//   A. runChat 按线续写两章（主线 / 过去线）——模型不得把另一线的独家事实当本线事实承接；
//   B. runSync 切片同步四章里挑两章（主线 / 过去线）——提案 after 不得把别线切片状态并进本线
//      （2026-10-28 起材料带【本次同步的时间线】纪律，由 shared/line.lineSyncNote 产出）。
//
// 双线独家事实（只出现在一条线，出现即串线）：
//   主线：红灯笼（檐角）／右手腕旧伤被绳结勒出血珠
//   过去线：黄铜子弹壳（旧院槐树下）／右手腕那道伤「被子弹壳边缘划的」（同一人物、同一部位，跨线同形诱饵）
//
// 用法：cd ~/Desktop/织卷 && node scripts/multiline-sync-seal-live.mjs
import { writeProbeSettings } from './lib/probe-settings.mjs'
import { build as esbuild } from 'esbuild'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const tmp = mkdtempSync(join(tmpdir(), 'zj-mline-seal-'))
process.env.ZJ_APP_PATH = root
process.env.ZJ_USERDATA = join(tmp, 'userdata')
mkdirSync(process.env.ZJ_USERDATA, { recursive: true })
const LIB = join(tmp, 'lib')
writeProbeSettings({ libraryRoot: LIB })

const out = join(tmp, 'seal-bundle.mjs')
await esbuild({
  stdin: {
    contents: `export { runChat, runSync } from ${JSON.stringify(resolve(root, 'src/main/agent/engine.ts'))};
export { createProject, writeDoc, listChapters } from ${JSON.stringify(resolve(root, 'src/main/store.ts'))};
export { previousChapterInfo } from ${JSON.stringify(resolve(root, 'src/main/agent/context.ts'))};
export { closeHarness } from ${JSON.stringify(resolve(root, 'src/main/agent/runtime.ts'))};`,
    resolveDir: root,
    loader: 'ts'
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: out,
  alias: { electron: resolve(root, 'scripts/electron-stub.mjs') },
  external: ['node:*'],
  logLevel: 'warning'
})
const { runChat, runSync, createProject, writeDoc, listChapters, previousChapterInfo, closeHarness } = await import(
  pathToFileURL(out).href
)

let pass = 0
const assert = (name, cond, detail) => {
  if (!cond) throw new Error('断言失败: ' + name + (detail ? ' —— ' + detail : ''))
  pass++
  console.log('  ✓ ' + name)
}

const chapterRaw = (no, title, slice, line, names, body) =>
  [
    '---',
    `章号: ${no}`,
    `题名: ${title}`,
    line ? `时间线: ${line}` : '',
    `切片: ${slice}`,
    `涉及人物: [${names.join(', ')}]`,
    '---',
    '',
    body
  ]
    .filter((l) => l !== '')
    .join('\n')

try {
  const p = createProject('双线封版演练', '封版目标① 双线自洽演练（探针临时库，可删）')
  if (!p) throw new Error('createProject 失败')
  const id = p.id

  // ---- 双线四章（主线 1/3，过去线 2/4）----
  writeDoc(
    id,
    '正文/第01章_渡口.md',
    chapterRaw(1, '渡口', '第一幕_渡口', '', ['林晚'], '渡口的夜静得出奇。林晚站在石阶上等船，江水在脚下慢慢退潮。')
  )
  writeDoc(
    id,
    '正文/第02章_老街.md',
    chapterRaw(2, '老街', '旧巷', '过去线', ['林晚'], '老街的傍晚，日头斜斜地挂在电线杆上。林晚背着书包从巷口走过。')
  )
  // 主线第03章：本次要同步的章（新事态=红灯笼挂上檐角 + 右手腕旧伤被绳结勒出血珠）
  writeDoc(
    id,
    '正文/第03章_灯下.md',
    chapterRaw(
      3,
      '灯下',
      '第二幕_灯下',
      '',
      ['林晚'],
      '灯下的摊位收了，林晚帮着把桌子搬进屋里。出门的时候，她把那盏红灯笼挂上檐角，' +
        '绳结一圈圈缠紧，勒进右手腕的旧伤里，渗出一颗血珠。红灯笼在檐下晃了一整夜，谁也没去摘。'
    )
  )
  // 过去线第04章：另一条线要同步的章（新事态=黄铜子弹壳；同一部位旧伤，跨线同形诱饵）
  writeDoc(
    id,
    '正文/第04章_旧院.md',
    chapterRaw(
      4,
      '旧院',
      '旧院',
      '过去线',
      ['林晚'],
      '旧院的槐树又长高了一截。林晚蹲在树根边扒开三层落叶，把那枚黄铜子弹壳抠了出来，' +
        '用袖子擦了擦。右手腕那道伤就是被它的边缘划的，结了薄薄一层痂。'
    )
  )
  // 人物档：同一人物按线分小节（状态分叉）
  writeDoc(
    id,
    '人物/林晚.md',
    [
      '---',
      '姓名: 林晚',
      '身份: 学生',
      '---',
      '',
      '## 基础档案',
      '',
      '- 身份：学生',
      '- 家：临河的老屋',
      '',
      '## 切片：第一幕_渡口',
      '',
      '- 渡口那夜之后，开始相信陈默说的话。',
      '',
      '## 切片：第二幕_灯下',
      '',
      '- 手里有一盏父亲留下的红灯笼（主线当刻）。',
      '',
      '## 切片：旧巷',
      '',
      '- 抽屉里锁着一枚黄铜子弹壳（过去线当刻）。',
      ''
    ].join('\n')
  )
  writeDoc(id, '世界观/切片_第一幕_渡口.md', '# 切片：第一幕_渡口\n\n- 码头的灯一到夜里就亮。\n')
  writeDoc(id, '世界观/切片_第二幕_灯下.md', '# 切片：第二幕_灯下\n\n- 灯下的摊位每晚九点收摊。\n')
  writeDoc(id, '世界观/切片_旧巷.md', '# 切片：旧巷\n\n- 老街的电线杆上贴满了寻人启事。\n')

  // ---- 数据层：线归属与线内前驱 ----
  console.log('=== A 数据层：双线项目骨架 ===')
  const lines = [...new Set(listChapters(id).map((c) => String((c.fm || {})['时间线'] || '主线')))]
  assert('A1 章列读到两条时间线', lines.length === 2, lines.join('/'))
  const info3 = previousChapterInfo(id, '正文/第03章_灯下.md')
  assert('A2 主线章 multi 标记且线名=主线', info3.multi && info3.line === '主线', JSON.stringify(info3.line))
  assert('A3 主线前驱=第1章（不取过去线第2章）', info3.predNo === 1, String(info3.predNo))
  const info4 = previousChapterInfo(id, '正文/第04章_旧院.md')
  assert('A4 过去线章线名=过去线', info4.line === '过去线', info4.line)

  // ---- B 真模型：按线续写（runChat）----
  console.log('=== B 真模型：按线续写两章（不串线） ===')
  const chat = async (chapterRel, prompt, rid) => {
    let final = ''
    let err = null
    const t = Date.now()
    await runChat({ requestId: rid, projectId: id, chapterRel, chapterTitle: '', prompt, quote: null }, (e) => {
      if (e.type === 'final') final = e.text
      else if (e.type === 'error') err = e.message
    })
    return { final, err, secs: ((Date.now() - t) / 1000).toFixed(1) }
  }

  const ASK =
    '只续写本章最后一段（60～100 字），只输出正文本身。不要使用任何工具，答案完全依据已给出的上下文。'
  const main = await chat('正文/第03章_灯下.md', ASK, 'seal-main-' + Date.now())
  console.log(`  主线续写 ${main.secs}s / err=${main.err ?? '无'}：${main.final.slice(0, 80)}`)
  assert('B1 主线续写真模型有产出（非空非错）', !main.err && main.final.trim().length > 20)
  assert(
    'B2 主线续写不串过去线事实（无「子弹壳/旧院」）',
    !/子弹壳|旧院|槐树/.test(main.final),
    main.final.slice(0, 120)
  )
  assert('B3 主线续写承接主线当刻（提到灯）', /灯/.test(main.final), main.final.slice(0, 120))

  const past = await chat('正文/第04章_旧院.md', ASK, 'seal-past-' + Date.now())
  console.log(`  过去线续写 ${past.secs}s / err=${past.err ?? '无'}：${past.final.slice(0, 80)}`)
  assert('B4 过去线续写真模型有产出（非空非错）', !past.err && past.final.trim().length > 20)
  assert(
    'B5 过去线续写不串主线事实（无「红灯笼」）',
    !/红灯笼/.test(past.final),
    past.final.slice(0, 120)
  )

  // ---- C 真模型：切片同步（runSync）提案不串线 ----
  console.log('=== C 真模型：切片同步提案按线落笔 ===')
  const syncOne = async (chapterRel) => {
    const t = Date.now()
    const r = await runSync(id, chapterRel)
    const secs = ((Date.now() - t) / 1000).toFixed(1)
    if (!r.ok) throw new Error(`runSync(${chapterRel}) 失败：${r.error}`)
    return { items: r.items ?? [], evidence: r.evidence, secs }
  }
  const blob = (items) => items.map((i) => `${i.target}|${i.anchor}|${i.before}|${i.after}|${i.reason}`).join('\n')

  const sm = await syncOne('正文/第03章_灯下.md')
  console.log(`  主线同步 ${sm.secs}s；items=${sm.items.length}；evidence.line=${sm.evidence?.line}`)
  for (const i of sm.items) console.log(`   · ${i.target} :: ${i.anchor} :: ${String(i.after).slice(0, 60)}`)
  assert('C1 主线同步证据线名=主线', sm.evidence?.line === '主线', String(sm.evidence?.line))
  assert(
    'C2 主线提案不把过去线状态并入（无「子弹壳/旧巷」）',
    !/子弹壳|旧巷/.test(blob(sm.items)),
    blob(sm.items).slice(0, 200)
  )
  assert(
    'C3 主线提案只落本线切片/人物档',
    sm.items.every((i) => i.target === '人物/林晚.md' || i.target === '世界观/切片_第二幕_灯下.md'),
    blob(sm.items).slice(0, 200)
  )
  assert(
    'C4 主线提案 anchor 归一到本片切片',
    sm.items.every((i) => i.anchor === '切片：第二幕_灯下'),
    blob(sm.items).slice(0, 200)
  )

  const sp = await syncOne('正文/第04章_旧院.md')
  console.log(`  过去线同步 ${sp.secs}s；items=${sp.items.length}；evidence.line=${sp.evidence?.line}`)
  for (const i of sp.items) console.log(`   · ${i.target} :: ${i.anchor} :: ${String(i.after).slice(0, 60)}`)
  assert('C5 过去线同步证据线名=过去线', sp.evidence?.line === '过去线', String(sp.evidence?.line))
  assert(
    'C6 过去线提案不把主线状态并入（无「红灯笼」）',
    !/红灯笼/.test(blob(sp.items)),
    blob(sp.items).slice(0, 200)
  )
  assert(
    'C7 过去线提案只落本线切片/人物档（不写主线切片文件）',
    sp.items.every((i) => i.target === '人物/林晚.md' || i.target === '世界观/切片_旧院.md'),
    blob(sp.items).slice(0, 200)
  )

  console.log(`\nMULTILINE SYNC SEAL LIVE PASS（${pass} 断言）`)
  await closeHarness?.()
  rmSync(tmp, { recursive: true, force: true })
  process.exit(0)
} catch (e) {
  console.error('\nFAILED:', e?.message ?? e)
  try {
    await closeHarness?.()
  } catch {
    /* ignore */
  }
  process.exit(1)
}