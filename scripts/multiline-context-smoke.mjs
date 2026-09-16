// 多时间线叙事 · 上下文装配数据层冒烟（2026-09-16 创作层，F-20260916-02 / 周交付增量 #2）
// bundle 主进程 context.ts 真机实现 + 临时双线交错项目，不依赖模型：
//   ① 过去线第 4 章：上一章尾部 = 过去线第 2 章（线内前驱），不是全局上一章（主线第 3 章）；
//   ② 主线第 3 章：上一章尾部 = 主线第 1 章；
//   ③ 多线项目装配块注明「本章时间线 + 同线前章=第N章，装配按线内前驱」；
//   ④ 世界切片回退链（本切片无设定 → 上一切片设定）按线内前驱取（幕0B，不是主线幕1C）；
//   ⑤ 单线老项目（无「时间线」字段）零回归：prev=全局上一章、块头原样无线注明。
// 用法：cd ~/Desktop/织卷 && node scripts/multiline-context-smoke.mjs
import { build as esbuild } from 'esbuild'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { rmSync, mkdirSync, writeFileSync } from 'node:fs'

const root = resolve(import.meta.dirname, '..')
process.env.ZJ_APP_PATH = root
process.env.ZJ_USERDATA = '/tmp/zj-smoke-mline-ctx-userdata'
const LIB = '/tmp/zj-smoke-mline-ctx-lib'
const UD = process.env.ZJ_USERDATA
rmSync(UD, { recursive: true, force: true })
rmSync(LIB, { recursive: true, force: true })
mkdirSync(UD, { recursive: true })
mkdirSync(LIB, { recursive: true })
writeFileSync(resolve(UD, 'zhijuan-settings.json'), JSON.stringify({ libraryRoot: LIB }))

const out = '/tmp/mline-ctx-bundle.mjs'
await esbuild({
  stdin: {
    contents: `export { buildWritingContext } from ${JSON.stringify(resolve(root, 'src/main/agent/context.ts'))};
export { createProject, writeDoc } from ${JSON.stringify(resolve(root, 'src/main/store.ts'))};`,
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

const { buildWritingContext, createProject, writeDoc } = await import(pathToFileURL(out).href)

let pass = 0
const assert = (name, cond) => {
  if (!cond) throw new Error('断言失败: ' + name)
  pass++
  console.log('  ✓ ' + name)
}

const chapterRaw = (no, title, slice, line) =>
  `---\n章号: ${no}\n题名: ${title}\n${line ? `时间线: ${line}\n` : ''}切片: ${slice}\n时间: 2026-09\n涉及人物: []\n---\n\n（第${no}章「${title}」正文。）\n`

const worldRaw = (name, text) => `# 切片：${name}\n\n> 本切片的世界状态\n\n${text}\n`

try {
  console.log('=== 多时间线上下文装配（主进程真实现 + 临时双线交错项目） ===')
  // 双线交错项目：章号序 1(主线),2(过去线),3(主线),4(过去线)
  const p = createProject('多线装配冒烟', '数据层冒烟用（结束后清理）')
  if (!p) throw new Error('createProject 失败')
  writeDoc(p.id, '正文/第01章_主线一.md', chapterRaw(1, '主线一', '幕1A', '主线'))
  writeDoc(p.id, '正文/第02章_过去一.md', chapterRaw(2, '过去一', '幕0B', '过去线'))
  writeDoc(p.id, '正文/第03章_主线二.md', chapterRaw(3, '主线二', '幕1C', '主线'))
  writeDoc(p.id, '正文/第04章_过去二.md', chapterRaw(4, '过去二', '幕0D', '过去线'))
  writeDoc(p.id, '世界观/切片_幕1A.md', worldRaw('幕1A', '主线世界：A 状态。'))
  writeDoc(p.id, '世界观/切片_幕0B.md', worldRaw('幕0B', '过去世界：B 状态。'))
  writeDoc(p.id, '世界观/切片_幕1C.md', worldRaw('幕1C', '主线世界：C 状态。'))
  // 幕0D 刻意不建文件 → 触发 §6.5 回退链（本切片无设定 → 上一切片设定）

  // ① 过去线第 4 章：线内前驱 = 过去线第 2 章
  const ctx4 = await buildWritingContext(p.id, '正文/第04章_过去二.md')
  const b4 = ctx4.blocks.join('\n')
  assert('① 当前章节块携带本章时间线注明', b4.includes('【当前章节：正文/第04章_过去二.md】（本章时间线「过去线」）'))
  assert('① 上一章尾部 = 第02章_过去一（线内前驱）', b4.includes('【上一章尾部：第02章_过去一】'))
  assert('① 不取全局上一章（主线第 3 章）', !b4.includes('【上一章尾部：第03章_主线二】'))
  assert('① 块头注明同线前章=第2章且非全局上一章', b4.includes('同线前章=第2章') && b4.includes('非全局上一章'))
  assert('① 回退链取线内前驱的切片（幕0B 过去世界，非主线幕1C）', b4.includes('【上一切片设定：幕0B】') && b4.includes('过去世界：B 状态'))
  assert('① 无「当前切片设定：幕0D」块（设定未落档）', !b4.includes('【当前切片设定：幕0D】'))

  // ② 主线第 3 章：线内前驱 = 主线第 1 章
  const ctx3 = await buildWritingContext(p.id, '正文/第03章_主线二.md')
  const b3 = ctx3.blocks.join('\n')
  assert('② 主线第3章上一章尾部 = 第01章_主线一', b3.includes('【上一章尾部：第01章_主线一】'))
  assert('② 不取第02章_过去一（他线）', !b3.includes('【上一章尾部：第02章_过去一】'))
  assert('② 块头注明同线前章=第1章', b3.includes('同线前章=第1章'))

  // ③ 线内第一章（过去线第 2 章）：无前驱 → 无上一章尾部块
  const ctx2 = await buildWritingContext(p.id, '正文/第02章_过去一.md')
  const b2 = ctx2.blocks.join('\n')
  assert('③ 过去线第2章无线内前驱 → 无「上一章尾部」块', !b2.includes('【上一章尾部：'))
  assert('③ 仍注明本章时间线', b2.includes('（本章时间线「过去线」）'))

  // ⑤ 单线老项目（无「时间线」字段）零回归
  const p2 = createProject('单线装配冒烟', '数据层冒烟用（结束后清理）')
  if (!p2) throw new Error('createProject 失败')
  writeDoc(p2.id, '正文/第01章_开局.md', chapterRaw(1, '开局', '幕一', ''))
  writeDoc(p2.id, '正文/第02章_推进.md', chapterRaw(2, '推进', '幕二', ''))
  writeDoc(p2.id, '正文/第03章_收束.md', chapterRaw(3, '收束', '幕三', ''))
  writeDoc(p2.id, '世界观/切片_幕一.md', worldRaw('幕一', '单线世界：一。'))
  writeDoc(p2.id, '世界观/切片_幕二.md', worldRaw('幕二', '单线世界：二。'))
  const s3 = await buildWritingContext(p2.id, '正文/第03章_收束.md')
  const sb3 = s3.blocks.join('\n')
  assert('⑤ 单线无注明（块头原样，无线）', sb3.includes('（前文略，以下为上一章结尾，用于承接）') && !sb3.includes('时间线'))
  assert('⑤ 单线 prev = 全局上一章（第02章_推进）', sb3.includes('【上一章尾部：第02章_推进】'))
  assert('⑤ 单线当前章节块无线注明', !sb3.includes('本章时间线'))

  console.log(`\nMULTILINE-CONTEXT LIVE OK（${pass} 断言全过）`)
  process.exit(0)
} catch (e) {
  console.error('\nFAIL: ' + (e instanceof Error ? e.message : e))
  process.exit(1)
}
