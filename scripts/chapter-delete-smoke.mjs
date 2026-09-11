// 章节删除·引用面一致性冒烟（真文件系统，不依赖模型）
// 验证：deleteChapter → 正文/大纲副产物/历史目录全部移除（stub trashItem 真删）、
//       同章 pending 提案置 stale、删除后重建同名章不再混入旧快照。
// 用法：cd ~/Desktop/织卷 && node scripts/chapter-delete-smoke.mjs
import { build as esbuild } from 'esbuild'
import { resolve } from 'node:path'
import { readFileSync, existsSync, readdirSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'

const root = resolve(import.meta.dirname, '..')
process.env.ZJ_APP_PATH = root
process.env.ZJ_USERDATA = '/tmp/zj-smoke-delch'
rmSync(process.env.ZJ_USERDATA, { recursive: true, force: true })
const out = '/tmp/zj-delch-bundle.mjs'
const LIB = '/tmp/zj-smoke-delch-lib'
rmSync(LIB, { recursive: true, force: true })
mkdirSync(LIB, { recursive: true })

await esbuild({
  stdin: {
    contents: `export * from ${JSON.stringify(resolve(root, 'src/main/store.ts'))};\nexport { setSettings } from ${JSON.stringify(resolve(root, 'src/main/settings.ts'))};`,
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

// 1) 建项目 + 写章两版（触发快照）+ 大纲副产物 + pending 提案
const p = store.createProject('删章', '')
if (!p) { console.log('FAIL createProject'); process.exit(1) }
const id = p.id
const rel = '正文/第01章_雾港.md'
store.writeDoc(id, rel, '---\n章号: 1\n题名: 雾港\n切片: 一\n---\n\n正文 v1')
store.writeDoc(id, rel, '---\n章号: 1\n题名: 雾港\n切片: 一\n---\n\n正文 v2')
store.writeDoc(id, '大纲/第01章_雾港.md', '# 章卡\n\n目标…')
store.writeDoc(id, '大纲/第01章_雾港_导演.md', '# 导演板\n\n…')
const pd = joinClient(LIB + '/lib', id, '.zhijuan', 'proposals')
mkdirSync(pd, { recursive: true })
writeFileSync(pd + '/x.json', JSON.stringify({ id: 'x', source: 'sync', chapter: rel, slice: '一', status: 'pending', createdAt: 1, items: [] }))
const histDir = joinClient(LIB + '/lib', id, '.zhijuan', 'history', '正文', '第01章_雾港')
ok('快照已生成', existsSync(histDir) && readdirSync(histDir).length === 1)

// 2) 删除章节
const r = await store.deleteChapter(id, rel)
ok('删除 ok', r.ok === true)
ok('cleaned=2（章卡+导演板）', r.cleaned === 2, 'got ' + r.cleaned)
ok('正文已移除', !existsSync(joinClient(LIB + '/lib', id, '正文', '第01章_雾港.md')))
ok('大纲副产物已移除', !existsSync(joinClient(LIB + '/lib', id, '大纲', '第01章_雾港.md')) && !existsSync(joinClient(LIB + '/lib', id, '大纲', '第01章_雾港_导演.md')))
ok('历史目录已移除（随删除进废纸篓语义）', !existsSync(histDir))
const prop = JSON.parse(readFileSync(pd + '/x.json', 'utf-8'))
ok('pending 提案置 stale', prop.status === 'stale', 'got ' + prop.status)

// 3) 删除后重建同名章：历史只含新快照，无旧章残留
store.writeDoc(id, rel, '---\n章号: 1\n题名: 雾港\n切片: 一\n---\n\n正文 v3')
store.writeDoc(id, rel, '---\n章号: 1\n题名: 雾港\n切片: 一\n---\n\n正文 v4')
const snaps = existsSync(histDir) ? readdirSync(histDir) : []
ok('重建后历史仅 1 个新快照（旧章快照未混入）', snaps.length === 1, 'got ' + snaps.length + ': ' + snaps.join(','))

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)

function joinClient(...parts) {
  return parts.join('/')
}
