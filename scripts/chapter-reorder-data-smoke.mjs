// 章节重排（上移/下移）真机数据层冒烟（创作层 2026-10-09 轮）：store.reorderChapter 真实落盘——
// 文件名交换 + 约定头章号交换 + 正文体零变化 + 大纲副产物改名/章卡 fm 同步 + 版本历史目录迁移 +
// proposals.chapter 指针迁移 + 边界/非规范名报错。用法：node scripts/chapter-reorder-data-smoke.mjs
import { writeProbeSettings } from './lib/probe-settings.mjs'
import { build as esbuild } from 'esbuild'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { rmSync, readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'

const root = resolve(import.meta.dirname, '..')
process.env.ZJ_APP_PATH = root
process.env.ZJ_USERDATA = '/tmp/zj-smoke-reorder'
rmSync(process.env.ZJ_USERDATA, { recursive: true, force: true })
mkdirSync(process.env.ZJ_USERDATA, { recursive: true })
writeProbeSettings({ libraryRoot: '/tmp/zj-smoke-reorder-lib' })
rmSync('/tmp/zj-smoke-reorder-lib', { recursive: true, force: true })
const out = '/tmp/reorder-bundle.mjs'

await esbuild({
  stdin: {
    contents: `export { createProject, writeDoc, readDoc, projectDir, listChapters, reorderChapter } from ${JSON.stringify(
      resolve(root, 'src/main/store.ts')
    )};`,
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

const mod = await import(pathToFileURL(out).href)
const { createProject, writeDoc, readDoc, projectDir, listChapters, reorderChapter } = mod

let pass = 0
const assert = (name, cond) => {
  if (!cond) throw new Error('断言失败: ' + name)
  pass++
  console.log('  ✓ ' + name)
}

console.log('=== 章节重排（真机 store.reorderChapter 落盘）===')
const pid = 'reorder-smoke-' + Date.now().toString(36)
const sum = createProject(pid, '重排冒烟')
if (!sum) throw new Error('createProject 失败')
const projDir = projectDir(pid)
assert('项目已创建', existsSync(projDir))

const ch = (no, title, slice, body) =>
  `---\n章号: ${no}\n题名: ${title}\n切片: ${slice}\n---\n${body}`
writeDoc(pid, '正文/第01章_雾港.md', ch(1, '雾港', '雾夜', '# 雾港\n\n雾港正文A。'))
writeDoc(pid, '正文/第02章_灯塔.md', ch(2, '灯塔', '灯下', '# 灯塔\n\n灯塔正文B。'))
writeDoc(pid, '正文/第03章_码头.md', ch(3, '码头', '晨光', '# 码头\n\n码头正文C。'))
// 大纲副产物：第02章 章卡（带 章号 fm）+ 导演板（不带 章号 fm，不得被新增字段）
const card = `---\n章号: 2\n题名: 灯塔\n切片: 灯下\n状态: 已回建\n---\n# 灯塔 章卡\n\n关键事件：守灯。`
const board = `---\n题名: 灯塔\n切片: 灯下\n---\n# 灯塔 · 导演板\n\n情绪弧。`
writeDoc(pid, '大纲/第02章_灯塔.md', card)
writeDoc(pid, '大纲/第02章_灯塔_导演.md', board)
// 版本历史入口目录（第02章）+ 一条指向第02章的提案
const histDir = `${projDir}/.zhijuan/history/正文/第02章_灯塔`
mkdirSync(histDir, { recursive: true })
writeFileSync(`${histDir}/20261009-140000-000.md`, '旧快照')
const propDir = `${projDir}/.zhijuan/proposals`
mkdirSync(propDir, { recursive: true })
writeFileSync(
  `${propDir}/reorder-p.json`,
  JSON.stringify({ id: 'reorder-p', source: 'slice-sync', chapter: '正文/第02章_灯塔.md', slice: '灯下', status: 'pending', items: [], createdAt: '2026-10-09T06:00:00.000Z' })
)

// 基线顺序
let list = listChapters(pid)
assert('基线顺序 雾港/灯塔/码头', list.map((c) => c.fm?.['题名']).join(',') === '雾港,灯塔,码头')

// 1) 第02章 上移 → 与第01章交换
let r = reorderChapter(pid, '正文/第02章_灯塔.md', -1)
assert('上移成功', r.ok === true && r.aRel === '正文/第01章_灯塔.md' && r.bRel === '正文/第02章_雾港.md')
list = listChapters(pid)
assert('列表顺序变为 灯塔/雾港/码头', list.map((c) => c.fm?.['题名']).join(',') === '灯塔,雾港,码头')
assert(
  '约定头章号已交换（灯塔=1/雾港=2）',
  list[0].fm?.['章号'] === 1 && list[1].fm?.['章号'] === 2
)
assert('磁盘文件名已交换', existsSync(`${projDir}/正文/第01章_灯塔.md`) && existsSync(`${projDir}/正文/第02章_雾港.md`))
assert('旧文件名已不存在', !existsSync(`${projDir}/正文/第01章_雾港.md`) && !existsSync(`${projDir}/正文/第02章_灯塔.md`))
const bodyA = readDoc(pid, '正文/第01章_灯塔.md') ?? ''
const bodyB = readDoc(pid, '正文/第02章_雾港.md') ?? ''
assert('正文体零变化（灯塔）', bodyA.includes('# 灯塔') && bodyA.includes('灯塔正文B。') && bodyA.includes('切片: 灯下'))
assert('正文体零变化（雾港）', bodyB.includes('# 雾港') && bodyB.includes('雾港正文A。') && bodyB.includes('切片: 雾夜'))
assert('大纲章卡已随章改名', existsSync(`${projDir}/大纲/第01章_灯塔.md`) && !existsSync(`${projDir}/大纲/第02章_灯塔.md`))
const cardNew = readFileSync(`${projDir}/大纲/第01章_灯塔.md`, 'utf-8')
assert('章卡 fm 章号已同步为 1', cardNew.includes('章号: 1'))
const boardNew = readFileSync(`${projDir}/大纲/第01章_灯塔_导演.md`, 'utf-8')
assert('导演板改名且未被新增章号字段', existsSync(`${projDir}/大纲/第01章_灯塔_导演.md`) && !boardNew.includes('章号:'))
assert('版本历史目录已迁移', existsSync(`${projDir}/.zhijuan/history/正文/第01章_灯塔`) && !existsSync(histDir))
const prop = JSON.parse(readFileSync(`${propDir}/reorder-p.json`, 'utf-8'))
assert('提案 chapter 指针已迁移', prop.chapter === '正文/第01章_灯塔.md')

// 2) 下移恢复 + 再上移首章（边界拦截）
r = reorderChapter(pid, '正文/第01章_灯塔.md', 1)
assert('下移成功', r.ok === true && r.aRel === '正文/第02章_灯塔.md')
list = listChapters(pid)
assert('恢复原始顺序', list.map((c) => c.fm?.['题名']).join(',') === '雾港,灯塔,码头')
r = reorderChapter(pid, '正文/第01章_雾港.md', -1)
assert('首章上移被拦', r.ok === false && r.error === '已是第一章')
r = reorderChapter(pid, '正文/第03章_码头.md', 1)
assert('末章下移被拦', r.ok === false && r.error === '已是最后一章')

// 3) 非规范文件名报错（临时造一个无「第N章」前缀文件）
writeDoc(pid, '正文/乱序章.md', ch(9, '乱序章', '灯下', '# 乱序\n\nx。'))
r = reorderChapter(pid, '正文/乱序章.md', 1)
assert('非规范名报错', r.ok === false && r.error.includes('第N章'))

// 4) 无中间态残留（临时文件被清走）
const leftover = readdirSync(`${projDir}/正文`).filter((n) => n.includes('.zj-reorder'))
assert('无临时文件残留', leftover.length === 0)

console.log(`\n全部通过：${pass} 断言`)
