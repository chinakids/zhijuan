// 织卷 · 正文版本历史 数据层冒烟（无 GUI / 无模型）：真文件系统 + 真 store.writeDoc 挂接。
// 验证：① 正文内容变化时写盘前把旧内容存档一版；② 同内容保存不产生版本；③ 非正文（人物/）不产生版本；
//       ④ 版本列表新→旧、读回一致；⑤ 超 HISTORY_LIMIT 裁剪。
// 用法：cd ~/Desktop/织卷 && node scripts/history-smoke.mjs
import { build as esbuild } from 'esbuild'
import { writeFileSync, mkdtempSync, rmSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const tmp = mkdtempSync(join(tmpdir(), 'zj-history-smoke-'))
process.env.ZJ_USERDATA = join(tmp, 'userdata')
process.env.ZJ_APP_PATH = root
mkdirSync(process.env.ZJ_USERDATA, { recursive: true })
writeFileSync(join(process.env.ZJ_USERDATA, 'zhijuan-settings.json'), JSON.stringify({ libraryRoot: join(tmp, 'lib') }), 'utf-8')

const entry = join(tmp, 'entry.mts')
writeFileSync(
  entry,
  [
    `import { writeDoc } from '${root}/src/main/store'`,
    `import { listSnapshots, readSnapshot, HISTORY_LIMIT, snapDirFor } from '${root}/src/main/history'`,
    `import { readFileSync, existsSync, mkdirSync } from 'node:fs'`,
    `import { join } from 'node:path'`,
    ``,
    `const lib = '${join(tmp, 'lib')}'`,
    `const pid = '版本smoke'`,
    `const P = (rel) => join(lib, pid, rel)`,
    `mkdirSync(P('正文'), { recursive: true })`,
    `mkdirSync(P('人物'), { recursive: true })`,
    ``,
    `let fails = 0`,
    `const check = (name, cond) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name); if (!cond) fails++ }`,
    ``,
    `// ① 首次写入（创建）：不应有版本（没有旧内容可存档）`,
    `writeDoc(pid, '正文/第01章_雾港.md', '# 第一章\\\\n\\\\n初版正文')`,
    `check('首次创建正文：无版本', listSnapshots(lib + '/' + pid, '正文/第01章_雾港.md').length === 0)`,
    ``,
    `// ② 内容变化保存：旧内容存档 1 版`,
    `writeDoc(pid, '正文/第01章_雾港.md', '# 第一章\\\\n\\\\n改稿正文')`,
    `let snaps = listSnapshots(lib + '/' + pid, '正文/第01章_雾港.md')`,
    `check('第二次保存：产生 1 版', snaps.length === 1)`,
    `check('版本内容是旧版正文', readSnapshot(lib + '/' + pid, '正文/第01章_雾港.md', snaps[0].name) === '# 第一章\\\\n\\\\n初版正文')`,
    ``,
    `// ③ 同内容保存：不产生新版本`,
    `writeDoc(pid, '正文/第01章_雾港.md', '# 第一章\\\\n\\\\n改稿正文')`,
    `check('同内容保存：仍 1 版（无噪音）', listSnapshots(lib + '/' + pid, '正文/第01章_雾港.md').length === 1)`,
    ``,
    `// ④ 非正文写盘：不产生版本`,
    `writeDoc(pid, '人物/林晚.md', '# 林晚\\\\n\\n- 年龄 17')`,
    `writeDoc(pid, '人物/林晚.md', '# 林晚\\\\n\\n- 年龄 18')`,
    `check('人物文档：0 版本', listSnapshots(lib + '/' + pid, '人物/林晚.md').length === 0)`,
    `check('历史目录只含正文条目', existsSync(join(lib, pid, snapDirFor('人物/林晚.md'))) === false)`,
    ``,
    `// ⑤ 超限裁剪：写 HISTORY_LIMIT + 3 版 → 只剩 HISTORY_LIMIT`,
    `for (let i = 0; i < 3; i++) { writeDoc(pid, '正文/第01章_雾港.md', '# 第一章\\\\n\\\\n第 ' + (i + 2) + ' 稿') }`,
    `snaps = listSnapshots(lib + '/' + pid, '正文/第01章_雾港.md')`,
    `check('累计版本数 = 4（1+3，未超限）', snaps.length === 4)`,
    `check('版本排序新→旧', snaps[0].mtimeMs >= snaps[snaps.length - 1].mtimeMs)`,
    `for (let i = 0; i < HISTORY_LIMIT; i++) { writeDoc(pid, '正文/第01章_雾港.md', '# 第一章\\\\n\\\\n压测第 ' + i + ' 稿') }`,
    `snaps = listSnapshots(lib + '/' + pid, '正文/第01章_雾港.md')`,
    `check('超限后裁剪到 ' + HISTORY_LIMIT + ' 版', snaps.length === HISTORY_LIMIT)`,
    `check('最新版是当前文件内容（历史不含当前）', readSnapshot(lib + '/' + pid, '正文/第01章_雾港.md', snaps[0].name) !== readFileSync(P('正文/第01章_雾港.md'), 'utf-8'))`,
    ``,
    `// ⑥ 版本文件格式：可入 git 的纯 md`,
    `const first = snaps[snaps.length - 1].name`,
    `check('版本文件名形如 yyyyMMdd-HHmmss-SSS.md', /^\\d{8}-\\d{6}-\\d{3}\\.md$/.test(first) || /^\\d{8}-\\d{6}-\\d{3}-\\d+\\.md$/.test(first))`,
    ``,
    `console.log(fails === 0 ? 'SMOKE OK' : 'SMOKE FAILED: ' + fails)`,
    `process.exit(fails === 0 ? 0 : 1)`
  ].join('\n')
)

const out = join(tmp, 'bundle.mjs')
await esbuild({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile: out, alias: { electron: resolve(root, 'scripts/electron-stub.mjs') }, logLevel: 'silent' })
const { spawnSync } = await import('node:child_process')
const r = spawnSync(process.execPath, [out], { stdio: 'inherit' })
if (!process.env.ZJ_KEEP) rmSync(tmp, { recursive: true, force: true })
process.exit(r.status ?? 1)
