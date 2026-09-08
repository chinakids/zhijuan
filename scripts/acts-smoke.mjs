// 织卷 · 分幕生成真模型冒烟（无 GUI）：走真实边车 + 真模型，
// 按 织卷smoke 项目第02章导演板的情绪弧分段，前 2 段逐段起草，拼成草稿落 大纲/ 并用 readDoc 回读实锤。
// 用法：cd ~/Desktop/织卷 && LOCAL_LLM_KEY=local node scripts/acts-smoke.mjs
import { build as esbuild } from 'esbuild'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
process.env.ZJ_APP_PATH = root
process.env.ZJ_USERDATA = process.env.ZJ_USERDATA || '/tmp/zj-smoke-userdata'

const entry = '/tmp/zj-acts-entry.mts'
writeFileSync(
  entry,
  [
    `import { runActs } from '${root}/src/main/agent/acts'`,
    `import { readDoc } from '${root}/src/main/store'`,
    `import { closeHarness } from '${root}/src/main/agent/runtime'`,
    '',
    "const PJ = '织卷smoke'",
    "const CH = '正文/第02章_灯下.md'",
    "const W = '大纲/第02章_灯下_分幕.md'",
    "const MAX = Number(process.env.ZJ_ACTS_MAX || '2')",
    "const prompts = []",
    '',
    "console.log('== 分幕生成 acts（真模型，先 ' + MAX + ' 段）==', CH)",
    'const t = Date.now()',
    'let exitCode = 1',
    'try {',
    "  const r = await runActs(PJ, CH, MAX, (i, p) => { prompts.push({ i, p }); console.log('[act ' + i + '] 提示词 ' + p.length + ' 字，等待引擎…') })",
    "  console.log('[OK ' + ((Date.now() - t) / 1000).toFixed(1) + 's] ' + JSON.stringify(r).slice(0, 600))",
    '  if (r.ok) {',
    "    const got = readDoc(PJ, W) ?? ''",
    "    console.log('[落盘] ' + W + ' -> ' + got.length + ' 字符；片段: ' + got.slice(0, 180).replace(/\\n/g, ' '))",
    "    const hasFm = got.includes('分幕草稿')",
    "    const words = r.words",
    "    console.log('[核对] acts=' + r.acts + ' words=' + words + ' 约定头=分幕草稿:' + hasFm)",
    "    const first = prompts.find((x) => x.i === 1)",
    "    const hasPrevTail = !!first && first.p.includes('【上一章结尾】') && first.p.includes('谁也没再说话')",
    "    console.log('[核对] 首段提示词带上一章结尾:' + hasPrevTail + (first ? '（提示词 ' + first.p.length + ' 字）' : '（未捕获）'))",
    "    exitCode = r.acts >= 1 && words > 200 && hasFm && hasPrevTail ? 0 : 3",
    '  } else exitCode = 1',
    '} catch (e) {',
    "  console.log('[ERR ' + ((Date.now() - t) / 1000).toFixed(1) + 's] ' + String(e?.message || e).slice(0, 400))",
    '  exitCode = 1',
    '} finally {',
    '  await closeHarness()',
    '  process.exit(exitCode)',
    '}'
  ].join('\n'),
  'utf-8'
)

await esbuild({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: '/tmp/zj-acts-bundle.mjs',
  alias: { electron: resolve(root, 'scripts/electron-stub.mjs') },
  external: ['node:*'],
  logLevel: 'warning'
})

const r = spawnSync('node', ['/tmp/zj-acts-bundle.mjs'], {
  env: { ...process.env, LOCAL_LLM_KEY: 'local', ZJ_USERDATA: process.env.ZJ_USERDATA },
  encoding: 'utf-8',
  timeout: 20 * 60 * 1000
})
process.stdout.write(r.stdout || '')
if (r.stderr) process.stderr.write(r.stderr?.toString() || '')
process.exit(r.status ?? 1)
