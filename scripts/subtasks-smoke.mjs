// 织卷 · agent 子任务真模型冒烟（无 GUI）：本章短巡查/分层修订/大纲回建/素材升格，全走真实边车 + 真模型。
// 用法：cd ~/Desktop/织卷 && LOCAL_LLM_KEY=local ZJ_USERDATA=/tmp/zj-smoke-userdata node scripts/subtasks-smoke.mjs
import { build as esbuild } from 'esbuild'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
process.env.ZJ_APP_PATH = root
process.env.ZJ_USERDATA = process.env.ZJ_USERDATA || '/tmp/zj-smoke-userdata'

const entry = '/tmp/zj-subtasks-entry.mts'
writeFileSync(
  entry,
  [
    `import { runChapterCheck } from '${root}/src/main/agent/audit'`,
    `import { runOutlineRebuild } from '${root}/src/main/agent/outline'`,
    `import { runMaterialTriage } from '${root}/src/main/agent/triage'`,
    `import { closeHarness } from '${root}/src/main/agent/runtime'`,
    '',
    "const PJ = '织卷smoke'",
    "const CH = '正文/第01章_雾港栈桥.md'",
    '',
    'async function step(name, fn) {',
    "  process.stdout.write('\\n## === ' + name + ' ===\\n')",
    '  const t = Date.now()',
    '  try {',
    "    const r = await fn()",
    "    console.log('[OK ' + ((Date.now() - t) / 1000).toFixed(1) + 's] ' + JSON.stringify(r, null, 2).slice(0, 3000))",
    '  } catch (e) {',
    "    console.log('[ERR ' + ((Date.now() - t) / 1000).toFixed(1) + 's] ' + String(e?.message || e).slice(0, 400))",
    '  }',
    '}',
    '',
    "await step('本章短巡查 chapter', () => runChapterCheck(PJ, CH, 'chapter'))",
    "await step('分层修订 revision', () => runChapterCheck(PJ, CH, 'revision'))",
    "await step('大纲回建 outline', () => runOutlineRebuild(PJ))",
    "await step('素材升格 triage', () => runMaterialTriage(PJ))",
    'await closeHarness()',
    'process.exit(0)'
  ].join('\n'),
  'utf-8'
)

await esbuild({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: '/tmp/zj-subtasks-bundle.mjs',
  alias: { electron: resolve(root, 'scripts/electron-stub.mjs') },
  external: ['node:*'],
  logLevel: 'warning'
})

const r = spawnSync('node', ['/tmp/zj-subtasks-bundle.mjs'], {
  env: { ...process.env, LOCAL_LLM_KEY: 'local', ZJ_USERDATA: process.env.ZJ_USERDATA },
  encoding: 'utf-8',
  timeout: 25 * 60 * 1000
})
process.stdout.write(r.stdout || '')
process.stderr ? process.stderr.write(r.stderr || '') : null
process.exit(r.status ?? 1)
