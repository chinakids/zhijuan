// 织卷 · 输出截断信号真模型探针（2026-09-25 智能层，候选 1「finish=length 截断提示面」）
// 验证链：① dsh 事件面 turn/end 携带 reason.kind='max-tokens'（wire finish_reason=length 的映射）
//         → ② engine.ts translate 把它转成 AgentOutEvent 'truncated'（本轮新增）
// 做法：driveSession 用极小 maxTokens+超长续写请求构造真实截断 → 收集原始事件 →
//       逐条喂给 translate（真实现）→ 断言 emit 序列含 type:'truncated'，且返回文本明显短于全文。
// 用法：cd ~/Desktop/织卷 && node scripts/truncate-probe.mjs
import { resetProbeUserdata } from './lib/probe-settings.mjs'
import { build as esbuild } from 'esbuild'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
process.env.ZJ_APP_PATH = root
process.env.ZJ_USERDATA = '/tmp/zj-smoke-truncate'
resetProbeUserdata()

const entry = '/tmp/zj-truncate-entry.mts'
writeFileSync(
  entry,
  [
    `import { driveSession } from '${root}/src/main/agent/runtime'`,
    `import { translate } from '${root}/src/main/agent/engine'`,
    '',
    'let bad = false',
    "const SID = 'zj-trunc-probe-1'",
    "const PROMPT = ['请写一小段小说正文：夜色中的海港，渔火与灯塔。', '要求：只输出正文本身，不要任何说明；写满大约 1200 字，不要提前收尾。'].join('\\n')",
    "const events = []",
    "const t0 = Date.now()",
    "try {",
    "  const text = await driveSession(SID, PROMPT, {",
    "    maxTokens: 150, // 极小输出预算：必触发截断（正常续写会上千 token）",
    "    maxMs: 3 * 60 * 1000,",
    '    onEvent: (n) => {',
    "      if (n.method === 'session.event') {",
    '        const ev = n.params?.event',
    "        if (ev?.type === 'turn/end' || ev?.type === 'turn/start') events.push({ type: ev.type, reason: ev?.data?.reason })",
    '      }',
    '    }',
    '  })',
    "  console.log('[TEXT] 返回字符数=' + text.length + '，前 80 字=' + JSON.stringify(text.slice(0, 80)))",
    "  const reasons = events.filter(e => e.type === 'turn/end').map(e => e.reason)",
    "  console.log('[EVENTS] turn/end reason=' + JSON.stringify(reasons))",
    "  const hasMaxTokens = reasons.some(r => r?.kind === 'max-tokens')",
    "  if (!hasMaxTokens) { console.log('[FAIL] 事件面未见 reason.kind=max-tokens——截断信号不可达'); bad = true }",
    "  else console.log('[OK] 事件面 reason.kind=max-tokens 可达')",
    "  if (text.length < 10) console.log('[DIAG] 输出完全为空（reasoning 吃光预算）——仍算截断，可接受')",
    "  else if (text.length > 800) { console.log('[FAIL] 输出远超预算疑似未截断'); bad = true }",
    "  // ② translate 转发链：把收集的 turn/end 原始事件喂给真实现，断言 emit 出 truncated",
    "  const out = []",
    "  const emit = (e) => out.push(e)",
    "  for (const raw of events) {",
    "    if (raw.type !== 'turn/end') continue",
    "    translate({ method: 'session.event', params: { event: { type: 'turn/end', data: { turn: 1, reason: raw.reason } } } }, 'req-1', emit)",
    "  }",
    "  const hasTruncated = out.some(e => e.type === 'truncated')",
    "  console.log('[TRANSLATE] emit 序列=' + JSON.stringify(out.map(e => e.type)))",
    "  if (!hasTruncated) { console.log('[FAIL] translate 未转发 truncated 事件'); bad = true }",
    "  else console.log('[OK] translate 转发 truncated 事件')",
    '} catch (e) {',
    "  console.log('[ERR] ' + String(e?.message || e).slice(0, 400))",
    '  bad = true',
    '}',
    "process.exit(bad ? 3 : 0)"
  ].join('\n'),
  'utf-8'
)

await esbuild({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: '/tmp/zj-truncate-bundle.mjs',
  alias: { electron: resolve(root, 'scripts/electron-stub.mjs') },
  external: ['node:*'],
  logLevel: 'warning'
})

const r = spawnSync('node', ['/tmp/zj-truncate-bundle.mjs'], {
  env: { ...process.env, LOCAL_LLM_KEY: 'local', ZJ_USERDATA: process.env.ZJ_USERDATA },
  encoding: 'utf-8',
  timeout: 5 * 60 * 1000
})
process.stdout.write(r.stdout || '')
if (r.stderr) process.stderr.write(r.stderr || '')
console.log('[PROBE-EXIT] ' + r.status)
process.exit(r.status ?? 1)
