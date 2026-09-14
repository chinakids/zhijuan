// 相对路径跨平台一致性·数据层冒烟（真文件系统，不依赖模型）
// 背景：docs/平台层-走向win-走查.md —— 主进程枚举目录树原用 path.join/relative 拼相对路径，
//       mac 产出 '/'、Windows 产出 '\'，而渲染层/devShim 的 IPC 契约恒为 '/'（'目录/' + file）。
// 验证：listDocs/searchDocs/recentLibraryDocs 返回的 file 恒正斜杠、无反斜杠；
//       listDocs 返回的 file 可直接回环 readDoc（渲染层拼前缀后的读写链路不坏）。
// 用法：cd ~/Desktop/织卷 && node scripts/relpath-posix-smoke.mjs
import { build as esbuild } from 'esbuild'
import { resolve } from 'node:path'
import { rmSync } from 'node:fs'

const root = resolve(import.meta.dirname, '..')
process.env.ZJ_APP_PATH = root
process.env.ZJ_USERDATA = '/tmp/zj-smoke-relpath'
rmSync(process.env.ZJ_USERDATA, { recursive: true, force: true })
const out = '/tmp/zj-relpath-bundle.mjs'
const LIB = '/tmp/zj-smoke-relpath-lib'
rmSync(LIB, { recursive: true, force: true })

await esbuild({
  stdin: {
    contents: `export * from ${JSON.stringify(resolve(root, 'src/main/store.ts'))};
export * from ${JSON.stringify(resolve(root, 'src/main/library.ts'))};
export { setSettings } from ${JSON.stringify(resolve(root, 'src/main/settings.ts'))};`,
    resolveDir: root,
    loader: 'ts'
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: out,
  alias: { electron: resolve(root, 'scripts/electron-stub.mjs') },
  external: ['node:*']
})

const store = await import('file://' + out)
const { setSettings } = store
setSettings({ workspace: LIB + '/ws', libraryRoot: LIB + '/lib' })

let pass = 0
let fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('PASS', name, extra) }
  else { fail++; console.log('FAIL', name, extra) }
}
const noBackslash = (s) => !s.includes('\\')

// 0) 建项目 + 写正文 / 嵌套素材（子目录两层）
const p = store.createProject('路径冒烟', '')
if (!p) { console.log('FAIL createProject'); process.exit(1) }
const id = p.id
store.writeDoc(id, '正文/第01章_雾港.md', '---\n章号: 1\n题名: 雾港\n切片: 一\n---\n\n正文内容')
store.writeDoc(id, '正文/第02章_灯下.md', '---\n章号: 2\n题名: 灯下\n切片: 二\n---\n\n正文内容')
store.writeDoc(id, '素材库/环境/灯塔.md', '# 灯塔\n\n素材内容')
store.writeDoc(id, '素材库/场景/码头/夜.md', '# 夜\n\n素材内容')
store.writeDoc(id, '素材库/采集池/任务_1.md', '---\nstatus: pending\n---\n\n任务卡')

// 1) listDocs：返回相对 relDir 的路径（渲染层自己拼 '目录/' 前缀，见 Novel.tsx 354/404 行同款）
//    —— 一级目录 file 无分隔符、嵌套子目录恒正斜杠（win 上 path.join 曾产出反斜杠）
const chapters = store.listDocs(id, '正文')
ok('listDocs(正文) 有 2 条', chapters.length === 2, String(chapters.length))
ok('listDocs(正文) 顶层 file 无分隔符（相对 正文/）', chapters.every((d) => !d.file.includes('/') && !d.file.includes('\\')), JSON.stringify(chapters.map((d) => d.file)))
ok('name 已剥 .md', chapters.every((d) => !d.name.includes('.md')), JSON.stringify(chapters.map((d) => d.name)))
ok('回环：渲染层拼 正文/ + file 可 readDoc', chapters.length > 0 && store.readDoc(id, '正文/' + chapters[0].file)?.includes('正文内容'), chapters[0]?.file)

const mats = store.listDocs(id, '素材库')
ok('listDocs(素材库) 含嵌套子目录且恒正斜杠', mats.some((d) => d.file === '环境/灯塔.md') && mats.some((d) => d.file === '场景/码头/夜.md'), JSON.stringify(mats.map((d) => d.file)))
ok('listDocs(素材库) 无反斜杠', mats.every((d) => !d.file.includes('\\')))
ok('listDocs 通用枚举含采集池（CollectionBar 专用取任务卡）', mats.some((d) => d.file === '采集池/任务_1.md'))

// 2) searchDocs / recentLibraryDocs：返回相对项目根 file 恒正斜杠
const hits = store.searchDocs(id, '素材库', '灯塔')
ok('searchDocs 命中且 file=素材库/环境/灯塔.md', hits.some((h) => h.file === '素材库/环境/灯塔.md'), JSON.stringify(hits.map((h) => h.file)))
ok('searchDocs file 无反斜杠', hits.every((h) => !h.file.includes('\\')))
const recents = store.recentLibraryDocs(id, 10)
ok('recentLibraryDocs 返回且全正斜杠', recents.length > 0 && recents.every((d) => !d.file.includes('\\')), JSON.stringify(recents.map((d) => d.file)))
ok('recentLibraryDocs 排除采集池', recents.every((d) => !d.file.includes('采集池')))

// 3) 章节列表（listChapters 经 listDocs）file 亦正斜杠（相对 正文/）
const chs = store.listChapters(id)
ok('listChapters file 正斜杠', chs.every((c) => !c.file.includes('\\')), JSON.stringify(chs.map((c) => c.file)))

console.log(`\nRESULT ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
