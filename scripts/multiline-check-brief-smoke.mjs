// 织卷 · 检查材料包「按线标注」数据层冒烟（2026-10-27 智能层，封版目标①）
// 背景：本章小环（chapterBrief）与全卷巡查（volumeBrief）的材料里，两线正文/人物档混在一包；
//   模型不知线归属 → 别线的人物状态/时间差会被报成本线冲突（假冲突），而封版验收正是要「两线切片与正文自洽」。
// 本轮口径：多线项目 ① 本章材料加「本章时间线 + 同线前驱 + 时间线纪律」，人物档「## 切片：」按本线过滤；
//   ② 全卷材料每章标题带（时间线：X）+ 顶部纪律块；单线项目零打扰（与旧材料逐字一致）。
// 断言：A 多线本章材料标注/过滤；B 同线前驱不跨线；C 单线无纪律块且人物档不过滤；D 全卷标注；
//   E 路径不回显「正文/正文/」。可选真模型段（ZJ_LIVE=1）：runChapterCheck 在健康双线项目上应零假冲突。
// 用法：cd ~/Desktop/织卷 && node scripts/multiline-check-brief-smoke.mjs        # 数据层
//       ZJ_LIVE=1 node scripts/multiline-check-brief-smoke.mjs                   # + 真模型本章小环
import { writeProbeSettings } from './lib/probe-settings.mjs'
import { build as esbuild } from 'esbuild'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { rmSync, mkdirSync, writeFileSync } from 'node:fs'

const root = resolve(import.meta.dirname, '..')
process.env.ZJ_APP_PATH = root
process.env.ZJ_USERDATA = '/tmp/zj-smoke-checkbrief-userdata'
const LIB = '/tmp/zj-smoke-checkbrief-lib'
const UD = process.env.ZJ_USERDATA
rmSync(UD, { recursive: true, force: true })
rmSync(LIB, { recursive: true, force: true })
mkdirSync(UD, { recursive: true })
mkdirSync(LIB, { recursive: true })
writeProbeSettings({ libraryRoot: LIB }, UD)

const out = '/tmp/checkbrief-bundle.mjs'
await esbuild({
  stdin: {
    contents: `export { chapterBrief, volumeBrief, runChapterCheck, runAudit } from ${JSON.stringify(resolve(root, 'src/main/agent/audit.ts'))};
export { createProject, writeDoc } from ${JSON.stringify(resolve(root, 'src/main/store.ts'))};
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
const { chapterBrief, volumeBrief, runChapterCheck, runAudit, createProject, writeDoc, closeHarness } = await import(
  pathToFileURL(out).href
)

let pass = 0
const assert = (name, cond) => {
  if (!cond) throw new Error('断言失败: ' + name)
  pass++
  console.log('  ✓ ' + name)
}

const chapterRaw = (no, title, slice, line, body) =>
  `---\n章号: ${no}\n题名: ${title}\n切片: ${slice}\n时间线: ${line}\n涉及人物: [沈藏]\n---\n\n${body}\n`

// 人物档：基础档案（长期）+ 两个切片小节（状态按线分叉——右手：主线完好 / 旧线烧伤）
const charDoc =
  '# 沈藏\n\n## 基础档案\n\n雾港摆渡人，话少。\n\n' +
  '## 切片：渡口\n\n- 右手完好，撑篙有力。\n\n' +
  '## 切片：旧灯会\n\n- 右手在灯会大火中烧伤，缠着布。\n'

try {
  console.log('=== A/B 多线项目：本章材料按线标注 + 人物档按线过滤 ===')
  const multi = createProject('多线检查材料冒烟', '数据层冒烟用（结束后清理）')
  if (!multi) throw new Error('createProject 失败')
  writeDoc(multi.id, '正文/第01章_渡口.md', chapterRaw(1, '渡口', '渡口', '主线', '阿七在渡口等船。'))
  writeDoc(multi.id, '正文/第02章_灯会.md', chapterRaw(2, '灯会', '旧灯会', '旧线', '灯会起火了。'))
  writeDoc(multi.id, '正文/第03章_潮汐.md', chapterRaw(3, '潮汐', '渡口', '主线', '涨潮了，船还没来。'))
  writeDoc(multi.id, '人物/沈藏.md', charDoc)
  writeDoc(multi.id, '世界观/切片_渡口.md', '# 切片：渡口\n\n- 渡口只有一班船。\n')
  writeDoc(multi.id, '世界观/切片_旧灯会.md', '# 切片：旧灯会\n\n- 灯会是十年前的旧事。\n')

  const main3 = chapterBrief(multi.id, '正文/第03章_潮汐.md', '涨潮了，船还没来。')
  assert('A1 本章标注所属线', main3.includes('【本章时间线】「主线」'))
  assert('A2 同线前驱（不取别线第02章）', main3.includes('同线上一章：第1章'))
  assert('A3 材料含时间线纪律（列全两条线）', main3.includes('【时间线纪律】') && main3.includes('主线、旧线'))
  assert('A4 保留本线切片状态', main3.includes('撑篙有力'))
  assert('A5 剥掉别线切片状态（不把别线伤手当本章事实）', !main3.includes('烧伤'))
  assert('A6 过滤留痕 + 现读出口', main3.includes('略去其他线切片小节 1 个（旧灯会）') && main3.includes('zj_read_doc'))
  assert('A7 基础档案保留（长期小节不被线过滤误伤）', main3.includes('雾港摆渡人'))

  console.log('--- B 本线开篇（同线无前章）---')
  const past2 = chapterBrief(multi.id, '正文/第02章_灯会.md', '灯会起火了。')
  assert('B1 旧线章标注旧线', past2.includes('【本章时间线】「旧线」'))
  assert('B2 本线开篇提示', past2.includes('本章为本线开篇'))
  assert('B3 旧线自己的状态在、主线状态不在', past2.includes('烧伤') && !past2.includes('撑篙有力'))

  console.log('--- D 全卷材料：每章带线名 + 顶部纪律块 ---')
  const vol = volumeBrief(multi.id)
  assert('D1 纪律块在材料顶部（正文清单之后）', vol.includes('【时间线纪律】'))
  assert('D2 主线章标线名', vol.includes('（时间线：主线）'))
  assert('D3 旧线章标线名', vol.includes('（时间线：旧线）'))

  console.log('=== C 单线项目：零打扰（旧材料口径） ===')
  const single = createProject('单线检查材料对照', '数据层冒烟用（结束后清理）')
  if (!single) throw new Error('createProject 失败')
  writeDoc(single.id, '正文/第01章_雾.md', chapterRaw(1, '雾', '第一幕', '主线', '雾起了。'))
  writeDoc(single.id, '正文/第02章_灯.md', chapterRaw(2, '灯', '第一幕', '主线', '灯亮了。'))
  writeDoc(single.id, '人物/沈藏.md', charDoc)
  const one2 = chapterBrief(single.id, '正文/第02章_灯.md', '灯亮了。')
  assert('C1 单线无时间线纪律', !one2.includes('【时间线纪律】'))
  assert('C2 单线无本章时间线标注', !one2.includes('【本章时间线】'))
  assert('C3 单线人物档不过滤（两节都在）', one2.includes('撑篙有力') && one2.includes('烧伤'))
  const oneVol = volumeBrief(single.id)
  assert('C4 单线全卷无纪律块、无章线标', !oneVol.includes('【时间线纪律】') && !oneVol.includes('（时间线：'))

  console.log('--- E 路径口径：不出现「正文/正文/」 ---')
  assert('E1 本章材料路径单前缀', main3.includes('（正文/第03章_潮汐.md）') && !main3.includes('正文/正文/'))

  if (process.env.ZJ_LIVE === '1') {
    console.log('=== 真模型：健康双线项目本章小环（应零假冲突） ===')
    const t = Date.now()
    // 轻微跨线诱饵：旧线灯会大火「烧伤右手」 vs 主线第03章「沈藏撑篙」——按线比较不应报冲突
    const r = await runChapterCheck(multi.id, '正文/第03章_潮汐.md', 'chapter')
    const secs = ((Date.now() - t) / 1000).toFixed(1)
    if (!r.ok) throw new Error('runChapterCheck 失败：' + r.error)
    const items = r.result.items ?? []
    console.log(`  耗时 ${secs}s；items=${items.length}；lastRaw=${r.lastRaw === undefined ? '无（真零发现）' : '有（提取失败/弱结果）'}；summary=${JSON.stringify(r.result.summary ?? '')}`)
    for (const it of items) console.log(`   · [${it.severity}/${it.type}] ${it.where} :: ${it.what}`)
    assert('L1 真模型返回结构化结果（链路通，非提取失败）', typeof r.result === 'object' && r.lastRaw === undefined)
    assert('L2 不把别线伤手当本章矛盾（按线过滤生效）', !items.some((i) => /烧伤|旧灯会|缠着布/.test(`${i.what}${i.where}${i.suggest ?? ''}`)))
    console.log('--- L3 全卷巡查（volumeBrief 纪律块 + 章线标）---')
    const t2 = Date.now()
    const v = await runAudit(multi.id, 'consistency')
    if (!v.ok) throw new Error('runAudit 失败：' + v.error)
    const vitems = v.result?.items ?? []
    console.log(`  耗时 ${((Date.now() - t2) / 1000).toFixed(1)}s；items=${vitems.length}；lastRaw=${v.lastRaw === undefined ? '无' : '有'}`)
    for (const it of vitems) console.log(`   · [${it.severity}/${it.type}] ${it.where} :: ${it.what}`)
    assert('L3 全卷巡查真模型返回结构化结果（链路通，非提取失败）', v.lastRaw === undefined)
    assert('L4 全卷巡查不把别线伤手当矛盾', !vitems.some((i) => /烧伤|旧灯会|缠着布/.test(`${i.what}${i.where}${i.suggest ?? ''}`)))
    await closeHarness?.()
  }

  console.log(`\nMULTILINE CHECK-BRIEF SMOKE PASS（${pass} 断言）`)
  process.exit(0)
} catch (e) {
  console.error('\nFAILED:', e?.message ?? e)
  process.exit(1)
}