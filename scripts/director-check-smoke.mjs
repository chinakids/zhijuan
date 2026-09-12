// 织卷 · 导演兑现检查真模型冒烟（无 GUI）：走真实边车 + 真模型，
// 对照 织卷smoke 项目第02章的导演板核对正文是否兑现。
// 用法：cd ~/Desktop/织卷 && LOCAL_LLM_KEY=local node scripts/director-check-smoke.mjs
import { build as esbuild } from 'esbuild'
import { writeFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
process.env.ZJ_APP_PATH = root
// 独立干净 userData（杜绝共享默认目录残留 settings 导致 libraryRoot 指向已删目录）
process.env.ZJ_USERDATA = '/tmp/zj-smoke-director-check'
rmSync(process.env.ZJ_USERDATA, { recursive: true, force: true })

const entry = '/tmp/zj-dcheck-entry.mts'
writeFileSync(
  entry,
  [
    `import { runDirectorCheck } from '${root}/src/main/agent/director-check'`,
    `import { closeHarness } from '${root}/src/main/agent/runtime'`,
    '',
    "const PJ = '织卷smoke'",
    "const CH = '正文/第02章_灯下.md'",
    '',
    "console.log('== 导演兑现检查 directorCheck（真模型）==', CH)",
    'const t = Date.now()',
    'try {',
    '  const r = await runDirectorCheck(PJ, CH)',
    "  console.log('[OK ' + ((Date.now() - t) / 1000).toFixed(1) + 's] ' + JSON.stringify(r).slice(0, 4000))",
    '  if (r.ok) {',
    '    const arcs = (r.result?.arcs ?? []).length',
    '    const reds = (r.result?.redlines ?? []).length',
    '    const axes = (r.result?.axes ?? []).length',
    "    console.log('[核对] arcs=' + arcs + ' axes=' + axes + ' redlines=' + reds + ' hooks=' + (r.result?.hooks ?? []).length)",
    "    console.log('[概要] ' + (r.result?.summary ?? '').slice(0, 200))",
    // 有真实核对条目才算过：至少识别出段落或红线，且 summary 有实质内容
    '    const scored = arcs + reds + axes + (r.result?.hooks ?? []).length',
    "    const pass = r.result?.summary && scored > 0",
    "    if (!pass) console.log('[DIAG] 结果为空——最后一次模型原始回复（前 3000 字，判定「模型空输出 vs 解析失败」用）:\\n' + (r.lastRaw ? r.lastRaw.slice(0, 3000) : '<无 lastRaw：透传未生效>'))",
    '    process.exit(pass ? 0 : 3)',
    '  } else process.exit(1)',
    '} catch (e) {',
    "  console.log('[ERR ' + ((Date.now() - t) / 1000).toFixed(1) + 's] ' + String(e?.message || e).slice(0, 400))",
    '  process.exit(1)',
    '} finally {',
    '  await closeHarness()',
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
  outfile: '/tmp/zj-dcheck-bundle.mjs',
  alias: { electron: resolve(root, 'scripts/electron-stub.mjs') },
  external: ['node:*'],
  logLevel: 'warning'
})

const r = spawnSync('node', ['/tmp/zj-dcheck-bundle.mjs'], {
  env: { ...process.env, LOCAL_LLM_KEY: 'local', ZJ_USERDATA: process.env.ZJ_USERDATA },
  encoding: 'utf-8',
  timeout: 10 * 60 * 1000
})
process.stdout.write(r.stdout || '')
if (r.stderr) process.stderr.write(r.stderr?.toString() || '')
process.exit(r.status ?? 1)
