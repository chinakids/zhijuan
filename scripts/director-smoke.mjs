// 织卷 · 章节导演真模型冒烟（无 GUI）：走真实边车 + 真模型，给一章导出导演板并落盘。
// 用法：cd ~/Desktop/织卷 && LOCAL_LLM_KEY=local node scripts/director-smoke.mjs
import { build as esbuild } from 'esbuild'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
process.env.ZJ_APP_PATH = root
process.env.ZJ_USERDATA = process.env.ZJ_USERDATA || '/tmp/zj-smoke-userdata'

const entry = '/tmp/zj-director-entry.mts'
writeFileSync(
  entry,
  [
    `import { runDirector } from '${root}/src/main/agent/director'`,
    `import { readDoc } from '${root}/src/main/store'`,
    `import { closeHarness } from '${root}/src/main/agent/runtime'`,
    '',
    "const PJ = '织卷smoke'",
    "const CH = '正文/第02章_灯下.md'",
    "const W = '大纲/第02章_灯下_导演.md'",
    '',
    "console.log('== 章节导演 director（真模型）==', CH)",
    'const t = Date.now()',
    'let exitCode = 1',
    'try {',
    '  const r = await runDirector(PJ, CH)',
    "  console.log('[OK ' + ((Date.now() - t) / 1000).toFixed(1) + 's] ' + JSON.stringify(r).slice(0, 2500))",
    '  if (r.ok) {',
    "    const got = readDoc(PJ, W) ?? ''",
    "    console.log('[落盘] ' + W + ' -> ' + got.length + ' 字符；片段: ' + got.slice(0, 260).replace(/\\n/g, ' '))",
    "    exitCode = got.length > 200 ? 0 : 2",
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
  outfile: '/tmp/zj-director-bundle.mjs',
  alias: { electron: resolve(root, 'scripts/electron-stub.mjs') },
  external: ['node:*'],
  logLevel: 'warning'
})

const r = spawnSync('node', ['/tmp/zj-director-bundle.mjs'], {
  env: { ...process.env, LOCAL_LLM_KEY: 'local', ZJ_USERDATA: process.env.ZJ_USERDATA },
  encoding: 'utf-8',
  timeout: 8 * 60 * 1000
})
process.stdout.write(r.stdout || '')
if (r.stderr) process.stderr.write(r.stderr?.toString() || '')
process.exit(r.status ?? 1)
