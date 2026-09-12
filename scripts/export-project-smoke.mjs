// 项目导出·数据层冒烟（真文件系统，不依赖模型）
// 验证：exportProject 复制项目目录到选定位置（跳过 .git/.DS_Store/node_modules）、
//       目标同名拒绝覆盖、项目内部拒绝、导出物可完整再导入（round-trip）。
// 用法：cd ~/Desktop/织卷 && node scripts/export-project-smoke.mjs
import { build as esbuild } from 'esbuild'
import { resolve } from 'node:path'
import { readFileSync, existsSync, readdirSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'

const root = resolve(import.meta.dirname, '..')
process.env.ZJ_APP_PATH = root
process.env.ZJ_USERDATA = '/tmp/zj-smoke-export'
rmSync(process.env.ZJ_USERDATA, { recursive: true, force: true })
const out = '/tmp/zj-export-bundle.mjs'
const LIB = '/tmp/zj-smoke-export-lib'
const LIB2 = '/tmp/zj-smoke-export-lib2'
const OUT_PARENT = '/tmp/zj-smoke-export-out'
for (const p of [LIB, LIB2, OUT_PARENT]) rmSync(p, { recursive: true, force: true })

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
const j = (...parts) => parts.join('/')

// 1) 建项目 + 写文档 + 放杂物（.git/.DS_Store/node_modules 应被跳过）
const p = store.createProject('导出冒烟', '')
if (!p) { console.log('FAIL createProject'); process.exit(1) }
const id = p.id
const rel = '正文/第01章_雾港.md'
const body = '---\n章号: 1\n题名: 雾港\n切片: 一\n---\n\n导出冒烟正文内容'
store.writeDoc(id, rel, body)
store.writeDoc(id, '素材库/环境/灯塔.md', '# 灯塔\n\n导出冒烟素材')
const proj = j(LIB, 'lib', id)
mkdirSync(j(proj, '.git'), { recursive: true })
writeFileSync(j(proj, '.git', 'config'), '[core]\n')
writeFileSync(j(proj, '.DS_Store'), 'x')
mkdirSync(j(proj, 'node_modules', 'x'), { recursive: true })
writeFileSync(j(proj, 'node_modules', 'x', 'i.js'), '0')

// 2) 导出到外部父目录
let r = store.exportProject(id, OUT_PARENT)
ok('导出 ok', r.ok === true && !!r.dest, JSON.stringify(r))
const dest = r.dest ?? ''
ok('目标=父目录/项目名', dest === j(OUT_PARENT, id), dest)
ok('project.md 已复制', existsSync(j(dest, 'project.md')))
ok('正文已复制且内容一致', readFileSync(j(dest, rel), 'utf-8') === body)
ok('素材已复制', readFileSync(j(dest, '素材库/环境/灯塔.md'), 'utf-8').includes('导出冒烟素材'))
ok('跳过了 .git', !existsSync(j(dest, '.git')))
ok('跳过了 .DS_Store', !existsSync(j(dest, '.DS_Store')))
ok('跳过了 node_modules', !existsSync(j(dest, 'node_modules')))
ok('.zhijuan 随项目走（历史/提案等数据不丢）', existsSync(j(dest, '.zhijuan')))

// 3) 同名目标拒绝覆盖
r = store.exportProject(id, OUT_PARENT)
ok('同名文件夹拒绝（不覆盖）', r.ok === false && r.error.includes('同名'), String(r.error))

// 4) 导出到项目自身内部拒绝（cp 会边抄边抄自身）
r = store.exportProject(id, proj)
ok('项目内部拒绝', r.ok === false && r.error.includes('项目内部'), String(r.error))

// 5) round-trip：换一个新库根，把导出物导入 → 内容与源一致
setSettings({ workspace: LIB2 + '/ws', libraryRoot: LIB2 + '/lib' })
const imp = store.importProject(dest)
ok('导出物可再导入', imp.ok === true && imp.summary?.name === id, JSON.stringify(imp.summary?.name))
ok('再导入后正文内容一致', store.readDoc(id, rel) === body)
ok('再导入后素材内容一致', store.readDoc(id, '素材库/环境/灯塔.md')?.includes('导出冒烟素材'))

// 6) 不存在的项目
r = store.exportProject('nope', OUT_PARENT)
ok('项目不存在报错', r.ok === false && r.error.includes('不存在'), String(r.error))

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
