// 织卷 · agent 子任务真模型冒烟（无 GUI）：本章短巡查/分层修订/大纲回建/素材升格，全走真实边车 + 真模型。
// 用法：cd ~/Desktop/织卷 && LOCAL_LLM_KEY=local node scripts/subtasks-smoke.mjs
import { build as esbuild } from 'esbuild'
import { writeFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
process.env.ZJ_APP_PATH = root
// 独立干净 userData（杜绝共享默认目录残留 settings 导致 libraryRoot 指向已删目录）
process.env.ZJ_USERDATA = '/tmp/zj-smoke-subtasks'
rmSync(process.env.ZJ_USERDATA, { recursive: true, force: true })

const entry = '/tmp/zj-subtasks-entry.mts'
writeFileSync(
  entry,
  [
    `import { runChapterCheck } from '${root}/src/main/agent/audit'`,
    `import { runAudit } from '${root}/src/main/agent/audit'`,
    `import { runOutlineRebuild } from '${root}/src/main/agent/outline'`,
    `import { runMaterialTriage } from '${root}/src/main/agent/triage'`,
    `import { runDirector } from '${root}/src/main/agent/director'`,
    `import { closeHarness } from '${root}/src/main/agent/runtime'`,
    '',
    "const PJ = '织卷smoke'",
    "const CH = '正文/第01章_雾港栈桥.md'",
    '',
    'let bad = false',
    'const EMPTY = ',
    '  { audit: (r) => r?.ok && !r.result?.items?.length && !r.result?.summary,',
    '    outline: (r) => r?.ok && Object.keys(r.emptyRaw ?? {}).length > 0,',
    '    triage: (r) => r?.ok && !r.result?.items?.length,',
    "    director: (r) => r?.ok && !(r.sheet?.arcs?.length) }",
    'async function step(name, fn, emptyKey) {',
    "  process.stdout.write('\\n## === ' + name + ' ===\\n')",
    '  const t = Date.now()',
    '  try {',
    "    const r = await fn()",
    "    console.log('[OK ' + ((Date.now() - t) / 1000).toFixed(1) + 's] ' + JSON.stringify(r, null, 2).slice(0, 3000))",
    '    if (emptyKey && EMPTY[emptyKey](r)) {',
    "      console.log('[DIAG] 结果为空——最后一次模型原始回复（前 2500 字，判定「模型空输出 vs 解析失败」用）:\\n' + (r.lastRaw ? r.lastRaw.slice(0, 2500) : (r.emptyRaw ? JSON.stringify(r.emptyRaw).slice(0, 2000) : '<无 lastRaw：透传未生效>')))",
    '      bad = true',
    '    }',
    '  } catch (e) {',
    "    console.log('[ERR ' + ((Date.now() - t) / 1000).toFixed(1) + 's] ' + String(e?.message || e).slice(0, 400))",
    '    bad = true',
    '  }',
    '}',
    '',
    "await step('本章短巡查 chapter', () => runChapterCheck(PJ, CH, 'chapter'), 'audit')",
    "await step('分层修订 revision', () => runChapterCheck(PJ, CH, 'revision'), 'audit')",
    "await step('多视角审视 perspectives', () => runAudit(PJ, 'perspectives'), 'audit')",
    "await step('大纲回建 outline', () => runOutlineRebuild(PJ), 'outline')",
    "await step('素材升格 triage', () => runMaterialTriage(PJ), 'triage')",
    "await step('章节导演 director', () => runDirector(PJ, CH), 'director')",
    'await closeHarness()',
    'process.exit(bad ? 3 : 0)'
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
