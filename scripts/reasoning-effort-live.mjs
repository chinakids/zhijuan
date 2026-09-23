// 织卷 · reasoning_effort 引擎侧落地真模型冒烟（无 GUI）：分层修订 revision 走真实边车 + 真模型。
// 验证点：① 引擎启动时 run/llm.override.patch.yml 按新 providers 档位表重写（配置解锁生效）；
// ② runChapterCheck(kind=revision) 成功后，会话日志 request/header 的 config 含 reasoningEffort:"low"（链路生效）；
// ③ 耗时对比默认档（06:00 轮同场景 480.3s 被中止/21:00 轮直调 511.96s vs low 47.95s）——low 显著快。
// 用法：cd ~/Desktop/织卷 && LOCAL_LLM_KEY=local node scripts/reasoning-effort-live.mjs
import { resetProbeUserdata } from './lib/probe-settings.mjs'
import { build as esbuild } from 'esbuild'
import { writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
process.env.ZJ_APP_PATH = root
process.env.ZJ_USERDATA = '/tmp/zj-smoke-reasoning'
resetProbeUserdata()

const entry = '/tmp/zj-reasoning-entry.mts'
writeFileSync(
  entry,
  [
    `import { runChapterCheck } from '${root}/src/main/agent/audit'`,
    `import { closeHarness } from '${root}/src/main/agent/runtime'`,
    '',
    "const PJ = '织卷smoke'",
    "const CH = '正文/第01章_雾港栈桥.md'",
    '',
    'let bad = false',
    'const t = Date.now()',
    'try {',
    "  const r = await runChapterCheck(PJ, CH, 'revision')",
    "  console.log('[RESULT ' + ((Date.now() - t) / 1000).toFixed(1) + 's] ' + JSON.stringify(r, null, 2).slice(0, 2500))",
    "  if (!r.ok) { console.log('[FAIL] 本轮失败: ' + r.error); bad = true }",
    '  else if (!r.result?.items?.length && !r.result?.summary) {',
    "    console.log('[DIAG] 结果为空——最后一次模型原始回复（前 2000 字）:\\n' + (r.lastRaw ? r.lastRaw.slice(0, 2000) : '<无 lastRaw>'))",
    '    bad = true',
    '  }',
    '} catch (e) {',
    "  console.log('[ERR ' + ((Date.now() - t) / 1000).toFixed(1) + 's] ' + String(e?.message || e).slice(0, 500))",
    '  bad = true',
    '}',
    'await closeHarness().catch(() => {})',
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
  outfile: '/tmp/zj-reasoning-bundle.mjs',
  alias: { electron: resolve(root, 'scripts/electron-stub.mjs') },
  external: ['node:*'],
  logLevel: 'warning'
})

// 配置解锁证据：引擎启动（ensureHarness → llmOverrideArgs）会按 providers.ts 重写 override
const patchPath = resolve(root, 'dsh-runtime/run/llm.override.patch.yml')
console.log('[PRE] override patch 存在=' + existsSync(patchPath))
if (existsSync(patchPath)) {
  const cur = readFileSync(patchPath, 'utf-8')
  console.log('[PRE] 含档位表=' + cur.includes('"low":"low"') + ' / 含旧 false=' + cur.includes('reasoningEfforts: false'))
}

const r = spawnSync('node', ['/tmp/zj-reasoning-bundle.mjs'], {
  env: { ...process.env, LOCAL_LLM_KEY: 'local', ZJ_USERDATA: process.env.ZJ_USERDATA },
  encoding: 'utf-8',
  timeout: 13 * 60 * 1000
})
process.stdout.write(r.stdout || '')
if (r.stderr) process.stderr.write(r.stderr || '')
console.log('[PROBE-EXIT] ' + r.status)

if (existsSync(patchPath)) {
  const cur = readFileSync(patchPath, 'utf-8')
  console.log('[POST] override patch 含档位表=' + cur.includes('"low":"low"') + ' / 含旧 false=' + cur.includes('reasoningEfforts: false'))
}

// 会话日志实证：找最新的 chapter-check 会话目录，解压 grep reasoningEffort
const sessRoot = resolve(root, 'dsh-runtime/dshhome/sessions')
const projDir = existsSync(sessRoot)
  ? readFileSync('/dev/null', 'utf-8') || ''
  : ''
const { execSync } = await import('node:child_process')
try {
  const latest = execSync(
    `ls -td ${sessRoot}/*/ | head -1 | xargs -I{} sh -c 'for d in {}/chapter-check-*; do echo "$d"; done' | tail -1`,
    { encoding: 'utf-8' }
  ).trim()
  if (latest) {
    const hit = execSync(
      `zstd -dc "${latest}/session.jsonl.zstd" | grep -o '"reasoningEffort":"[a-z]*"' | head -2 || true`,
      { encoding: 'utf-8' }
    ).trim()
    console.log('[LOG] 最新会话 ' + latest)
    console.log('[LOG] reasoningEffort 命中=' + (hit || '<无>'))
    if (!hit.includes('low')) console.log('[WARN] 会话日志未见 reasoningEffort:low——链路未生效')
  } else {
    console.log('[WARN] 未找到 chapter-check 会话目录')
  }
} catch (e) {
  console.log('[WARN] 会话日志取证失败: ' + String(e?.message || e).slice(0, 200))
}

process.exit(r.status ?? 1)
