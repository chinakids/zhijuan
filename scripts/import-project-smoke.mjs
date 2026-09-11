// 织卷 · 导入已有目录 数据层冒烟（无 GUI / 无模型）：真文件系统 + 真 store.importProject。
// 验证：① 外部目录内容复制入库、骨架/project.md 生成；② .git/.DS_Store/node_modules 被跳过；
//       ③ 重复导入幂等（copied=false 且不清内容）；④ 目录不存在返回结构化错误；
//       ⑤ listProjects 可见新项目、章节统计正确；⑥ 库内项目目录传入自身幂等。
// 用法：cd ~/Desktop/织卷 && node scripts/import-project-smoke.mjs
import { build as esbuild } from 'esbuild'
import { writeFileSync, mkdtempSync, rmSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const tmp = mkdtempSync(join(tmpdir(), 'zj-import-smoke-'))
process.env.ZJ_USERDATA = join(tmp, 'userdata')
process.env.ZJ_APP_PATH = root
mkdirSync(process.env.ZJ_USERDATA, { recursive: true })
writeFileSync(
  join(process.env.ZJ_USERDATA, 'zhijuan-settings.json'),
  JSON.stringify({ libraryRoot: join(tmp, 'lib') }),
  'utf-8'
)

const entry = join(tmp, 'entry.mts')
writeFileSync(
  entry,
  [
    `import { importProject, listProjects, createProject } from '${root}/src/main/store'`,
    `import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'`,
    `import { join } from 'node:path'`,
    ``,
    `const lib = '${join(tmp, 'lib')}'`,
    `const ext = '${join(tmp, 'ext', '我的旧稿')}'`,
    `let fails = 0`,
    `const check = (name, cond) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name); if (!cond) fails++ }`,
    ``,
    `// 造外部「已有作品」目录（含杂物）`,
    `mkdirSync(join(ext, '正文'), { recursive: true })`,
    `mkdirSync(join(ext, '人物'), { recursive: true })`,
    `mkdirSync(join(ext, '.git'), { recursive: true })`,
    `mkdirSync(join(ext, 'node_modules', 'pkg'), { recursive: true })`,
    `writeFileSync(join(ext, '正文', '第01章_初见.md'), '# 第01章 初见\\\\n\\\\n那是初雪后的清晨。')`,
    `writeFileSync(join(ext, '人物', '女主.md'), '# 女主\\\\n\\\\n（此处应有设定）')`,
    `writeFileSync(join(ext, '.git', 'config'), '[core]')`,
    `writeFileSync(join(ext, '.DS_Store'), 'junk')`,
    `writeFileSync(join(ext, 'node_modules', 'pkg', 'x.md'), '占位')`,
    ``,
    `// ① 外部目录导入`,
    `const r1 = importProject(ext)`,
    `check('导入成功 ok', r1.ok === true)`,
    `check('copied=true', r1.copied === true)`,
    `check('summary 名称=旧稿目录名', r1.summary?.name === '我的旧稿')`,
    `const dst = join(lib, '我的旧稿')`,
    `check('正文已拷入', existsSync(join(dst, '正文', '第01章_初见.md')))`,
    `check('正文内容一致', readFileSync(join(dst, '正文', '第01章_初见.md'), 'utf-8').includes('初雪后的清晨'))`,
    `check('人物已拷入', existsSync(join(dst, '人物', '女主.md')))`,
    `check('.git 被跳过', !existsSync(join(dst, '.git')))`,
    `check('.DS_Store 被跳过', !existsSync(join(dst, '.DS_Store')))`,
    `check('node_modules 被跳过', !existsSync(join(dst, 'node_modules')))`,
    `check('骨架 素材库/索引.md 补全', existsSync(join(dst, '素材库', '索引.md')))`,
    `check('骨架 世界观/总纲.md 补全', existsSync(join(dst, '世界观', '总纲.md')))`,
    `check('project.md 生成且含 name', existsSync(join(dst, 'project.md')) && readFileSync(join(dst, 'project.md'), 'utf-8').includes('name: 我的旧稿'))`,
    ``,
    `// ⑤ listProjects 可见 + 统计`,
    `const inList = listProjects().find((p) => p.id === '我的旧稿')`,
    `check('listProjects 可见新项目', !!inList)`,
    `check('章节统计=1', inList?.stats.chapters === 1)`,
    `check('人物统计=1', inList?.stats.characters === 1)`,
    ``,
    `// ② 重复导入：不复制、内容保留`,
    `const r2 = importProject(ext)`,
    `check('重复导入 ok', r2.ok === true)`,
    `check('重复导入 copied=false', r2.copied === false)`,
    `check('重复导入不清内容', existsSync(join(dst, '正文', '第01章_初见.md')))`,
    ``,
    `// ③ 目录不存在`,
    `const r3 = importProject(join('${join(tmp, 'ext')}', '不存在'))`,
    `check('不存在目录 ok=false', r3.ok === false)`,
    `check('不存在目录带错误信息', typeof r3.error === 'string' && r3.error.includes('不存在'))`,
    ``,
    `// ⑥ 库内项目自身幂等`,
    `const p = createProject('库内项目', '')`,
    `const r4 = importProject(join(lib, p.id))`,
    `check('库内项目自身 ok 且 copied=false', r4.ok === true && r4.copied === false)`,
    `check('库内项目自身 summary 对应', r4.summary?.id === p.id)`,
    ``,
    `console.log(fails === 0 ? '\\nSMOKE OK' : '\\nSMOKE FAIL: ' + fails)`,
    `process.exit(fails === 0 ? 0 : 1)`
  ].join('\n'),
  'utf-8'
)

const out = join(tmp, 'bundle.mjs')
await esbuild({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: out,
  alias: { electron: resolve(root, 'scripts/electron-stub.mjs'), 'electron/main': resolve(root, 'scripts/electron-stub.mjs') },
  logLevel: 'silent'
})
rmSync(entry, { force: true })
await import(out)
rmSync(tmp, { recursive: true, force: true })
