// 多时间线叙事 · 章卡/导演板线名透传数据层冒烟（2026-09-17 创作层，设计文档 §4.5 创作层行）
// bundle 主进程 outline.ts（回建）/director.ts（导演板）真机实现 + 临时双线交错项目，驱动 mock（不依赖模型）：
//   ① 多线项目回建：过去线章卡 fm 写「时间线: 过去线」、主线章卡不写（缺省=主线零冗余）；
//   ② 导演板同口径：过去线板子写线名、主线板子不写；
//   ③ parseOutlineCard 回读线名（章卡文件=权威）；
//   ④ 单线老项目（无「时间线」字段）零回归：章卡/导演板均无该字段。
// 用法：cd ~/Desktop/织卷 && node scripts/multiline-outline-director-smoke.mjs
import { writeProbeSettings } from './lib/probe-settings.mjs'
import { build as esbuild } from 'esbuild'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { rmSync, mkdirSync, writeFileSync } from 'node:fs'

const root = resolve(import.meta.dirname, '..')
process.env.ZJ_APP_PATH = root
process.env.ZJ_USERDATA = '/tmp/zj-smoke-mline-outline-userdata'
const LIB = '/tmp/zj-smoke-mline-outline-lib'
const UD = process.env.ZJ_USERDATA
rmSync(UD, { recursive: true, force: true })
rmSync(LIB, { recursive: true, force: true })
mkdirSync(UD, { recursive: true })
mkdirSync(LIB, { recursive: true })
writeProbeSettings({ libraryRoot: LIB }, UD)

const out = '/tmp/mline-outline-bundle.mjs'
const DRIVE_MOCK = resolve(root, 'scripts/drive-mock-outline.mjs')
await esbuild({
  stdin: {
    contents: `export { runOutlineRebuild, listOutlineDocs } from ${JSON.stringify(resolve(root, 'src/main/agent/outline.ts'))};
export { runDirector, directorRel } from ${JSON.stringify(resolve(root, 'src/main/agent/director.ts'))};
export { createProject, writeDoc, readDoc, listChapters } from ${JSON.stringify(resolve(root, 'src/main/store.ts'))};
export { parseOutlineCard } from ${JSON.stringify(resolve(root, 'src/shared/outline.ts'))};`,
    resolveDir: root,
    loader: 'ts'
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: out,
  alias: { electron: resolve(root, 'scripts/electron-stub.mjs') },
  plugins: [
    {
      name: 'mock-runtime',
      setup(b) {
        b.onResolve({ filter: /^\.\/runtime$/ }, () => ({ path: DRIVE_MOCK }))
      }
    }
  ],
  external: ['node:*'],
  logLevel: 'warning'
})

const { runOutlineRebuild, listOutlineDocs, runDirector, directorRel, createProject, writeDoc, readDoc, listChapters, parseOutlineCard } =
  await import(pathToFileURL(out).href)

let pass = 0
const assert = (name, cond) => {
  if (!cond) throw new Error('断言失败: ' + name)
  pass++
  console.log('  ✓ ' + name)
}

const chapterRaw = (no, title, slice, line, names = [], body = '(第' + no + '章「' + title + '」正文。)') =>
  `---\n章号: ${no}\n题名: ${title}\n${line ? `时间线: ${line}\n` : ''}切片: ${slice}\n时间: 2026-09\n涉及人物: [${names.join(', ')}]\n---\n\n${body}\n`

try {
  console.log('=== 章卡/导演板线名透传（主进程真实现 + 临时双线交错项目 + 驱动 mock） ===')
  const p = createProject('线名透传冒烟', '数据层冒烟用（结束后清理）')
  if (!p) throw new Error('createProject 失败')
  const CAST = ['林晚', '顾知远']
  writeDoc(p.id, '正文/第01章_夜航.md', chapterRaw(1, '夜航', '今_夜航', '主线', CAST))
  writeDoc(p.id, '正文/第02章_旧信.md', chapterRaw(2, '旧信', '昔_旧信', '过去线', CAST))
  writeDoc(p.id, '正文/第03章_灯塔.md', chapterRaw(3, '灯塔', '今_灯塔', '主线', CAST))

  assert('前置：listChapters 3 章', (await listChapters(p.id)).length === 3)

  // ① 回建：全部 3 章 → 每个生成一张章卡
  const rb = await runOutlineRebuild(p.id)
  assert('① 回建 ok 且 written 3', rb.ok === true && rb.written.length === 3)
  const card1 = readDoc(p.id, '大纲/第01章_夜航.md') ?? ''
  const card2 = readDoc(p.id, '大纲/第02章_旧信.md') ?? ''
  const card3 = readDoc(p.id, '大纲/第03章_灯塔.md') ?? ''
  assert('① 主线章卡（第01章）fm 不含「时间线」', !card1.includes('时间线'))
  assert('① 过去线章卡（第02章）fm 写「时间线: 过去线」', card2.includes('时间线: 过去线'))
  assert('① 主线章卡（第03章）fm 不含「时间线」', !card3.includes('时间线'))
  assert('① 章卡字段顺序=题名→时间线→切片（与正文同构）', /题名: 旧信\n时间线: 过去线\n切片: 昔_旧信/.test(card2))
  assert('① listOutlineDocs 收 3 张卡', listOutlineDocs(p.id).length === 3)

  // ③ 章卡文件=权威：parseOutlineCard 回读线名
  const back2 = parseOutlineCard(card2, '大纲/第02章_旧信.md')
  assert('③ parse 回读线名「过去线」', back2?.line === '过去线')
  const back1 = parseOutlineCard(card1, '大纲/第01章_夜航.md')
  assert('③ parse 主线卡 line 缺省（undefined）', back1 !== null && back1.line === undefined)

  // ② 导演板：过去线写线名、主线不写
  const d2 = await runDirector(p.id, '正文/第02章_旧信.md')
  assert('② 导演第02章 ok', d2.ok === true)
  const b2 = readDoc(p.id, d2.written) ?? ''
  assert('② 过去线导演板写「时间线: 过去线」', b2.includes('时间线: 过去线'))
  const d1 = await runDirector(p.id, '正文/第01章_夜航.md')
  assert('② 导演第01章 ok', d1.ok === true)
  const b1 = readDoc(p.id, d1.written) ?? ''
  assert('② 主线导演板不含「时间线」', !b1.includes('时间线'))

  // ④ 单线老项目（无「时间线」字段）零回归
  const p2 = createProject('单线透传冒烟', '数据层冒烟用（结束后清理）')
  if (!p2) throw new Error('createProject 失败')
  writeDoc(p2.id, '正文/第01章_开局.md', chapterRaw(1, '开局', '幕一', '', []))
  writeDoc(p2.id, '正文/第02章_收束.md', chapterRaw(2, '收束', '幕二', '', []))
  const rb2 = await runOutlineRebuild(p2.id)
  assert('④ 单线回建 ok', rb2.ok === true)
  const s1 = readDoc(p2.id, '大纲/第01章_开局.md') ?? ''
  assert('④ 单线章卡无「时间线」字段', !s1.includes('时间线'))
  const sd2 = await runDirector(p2.id, '正文/第02章_收束.md')
  assert('④ 单线导演 ok', sd2.ok === true)
  const sb2 = readDoc(p2.id, '大纲/第02章_收束_导演.md') ?? ''
  assert('④ 单线导演板无「时间线」字段', !sb2.includes('时间线'))

  console.log(`\nMULTILINE-OUTLINE-DIRECTOR OK（${pass} 断言全过）`)
  process.exit(0)
} catch (e) {
  console.error('\nFAIL: ' + (e instanceof Error ? e.message : e))
  process.exit(1)
}
