// 织卷 · 「追问敏锐度」真模型探针 v1（2026-09-24 智能层轮，候选 1）
// 背景：F-20260917-12 已实现「生成中发送消息排队续发」（4f1593d），但「模型是否及时采纳追问方向」无真模型验证。
// 业界语义（调研 2026-09-24，Claude Code 官方 interactive-mode 文档）：生成中发消息=排队不打断；
//   工具调用间隙同轮送入 / 轮尾按序续发；Esc/Ctrl+Enter=中断并立即发出队列（v2.1.275+）。
//   织卷 v1=轮尾续发（下轮可见），须验证模型「最新用户指令优先」。
// 场景（runChat 全链，真项目织卷smoke 副本 + 真边车 + 真模型）：
//   S1 方向修正：T1「续写要出现『琉璃风铃』」→ T2（历史=用户T1+织卷final1）「改成出现『褪色的黄布伞』，不要提琉璃风铃」
//   S2 方向修正：T1「『老式座钟』」→ T2「改成『半截烧焦的蜡烛』，不要提老式座钟」
//   S3 追加要求：T1 无标记续写 → T2「补上：续写里加上『窗台上晾着一双灰布鞋』」
// 判据：S1/S2 final2 含 B 标记（核心）且不含 A 标记（次要，报告）；S3 final2 含追加标记；final2 ≠ final1。
// 用法：cd ~/Desktop/织卷 && node scripts/followup-adapt-live.mjs（真模型，建议后台+notify）
// 固定后置：改 runChat 历史装配/纪律文案/引擎后复跑本探针；engine.ts 改动自动被携带。
import { build as esbuild } from 'esbuild'
import { writeProbeSettings } from './lib/probe-settings.mjs'
import { writeFileSync, mkdtempSync, rmSync, mkdirSync, cpSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const tmp = mkdtempSync(join(tmpdir(), 'zj-followup-'))
process.env.ZJ_APP_PATH = root
process.env.ZJ_USERDATA = join(tmp, 'userdata')
mkdirSync(process.env.ZJ_USERDATA, { recursive: true })
const lib = join(tmp, 'lib')
// 真机 llm 配置合并（2026-09-24 智能层轮实踩）：发布脱敏后 providers.ts 默认 baseURL=127.0.0.1，
// 本机真实 vLLM（算力池）→ 探针必须在 tmp settings 里合并真机 llm，否则连空地址得 0 字符空轮。
// 共享实现=scripts/lib/probe-settings.mjs（全量探针统一入口，46 文件已迁移）。
writeProbeSettings({ libraryRoot: lib, workspace: join(tmp, 'ws') })

async function bundleEntry(entry, aliasElectron) {
  const out = join(tmp, 'bundle-' + Math.random().toString(36).slice(2) + '.mjs')
  await esbuild({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    outfile: out,
    ...(aliasElectron ? { alias: { electron: resolve(root, 'scripts/electron-stub.mjs') } } : {}),
    external: ['node:*'],
    logLevel: 'warning'
  })
  return import(pathToFileURL(out).href)
}

// 真项目副本（织卷smoke → tmp 库；零污染真库）
const srcProj = join(process.env.HOME ?? '', 'Documents/织卷项目库/织卷smoke')
if (!existsSync(srcProj)) {
  console.log('FAIL：找不到真项目织卷smoke：' + srcProj)
  process.exit(1)
}
cpSync(srcProj, join(lib, '织卷smoke'), { recursive: true })

const eng = await bundleEntry(resolve(root, 'src/main/agent/engine.ts'), true)
const runChat = eng.runChat
const shutdown = eng.shutdown

const PROJ = '织卷smoke'
const CHAPTER = '正文/第01章_雾港栈桥.md'
const TITLE = '雾港栈桥'
const SCENE =
  '凌晨两点的旧城区，路灯把空荡荡的巷子照得发白。她推开铁门，脚步声在青石板上响了一下就停了。'

async function runOne(tag, prompt, history) {
  console.log(`\n=== ${tag} 开始：`, new Date().toISOString())
  let finalText = ''
  let err = null
  let metaCount = 0
  await runChat(
    {
      requestId: tag + '-' + Date.now(),
      projectId: PROJ,
      chapterRel: CHAPTER,
      chapterTitle: TITLE,
      prompt,
      quote: null,
      history: history ?? null
    },
    (e) => {
      if (e.type === 'delta') process.stdout.write(e.text)
      else if (e.type === 'meta') metaCount++
      else if (e.type === 'final') finalText = e.text
      else if (e.type === 'error') err = e.message
    }
  )
  await shutdown?.()
  console.log(`\n=== ${tag} 完成（${finalText.length} 字符，工具调用 ${metaCount} 次，err=${err ?? '无'}）`)
  if (err) throw new Error(tag + ' error: ' + err)
  return finalText
}

const T1_A1 = `你是一篇小说作者。续写下面场景的下一段（约 100 字，中文，只输出正文）：\n\n【场景】\n${SCENE}\n\n续写中要出现「琉璃风铃」。`
const T2_A1 = `先别写「琉璃风铃」了，改成：续写中要出现「褪色的黄布伞」，并且不要提到「琉璃风铃」。只输出正文。`
const T1_A2 = `你是一篇小说作者。续写下面场景的下一段（约 100 字，中文，只输出正文）：\n\n【场景】\n${SCENE}\n\n续写中要出现「老式座钟」。`
const T2_A2 = `先别写「老式座钟」了，改成：续写中要出现「半截烧焦的蜡烛」，并且不要提到「老式座钟」。只输出正文。`
const T1_B = `你是一篇小说作者。续写下面场景的下一段（约 100 字，中文，只输出正文）：\n\n【场景】\n${SCENE}`
const T2_B = `再补一句：续写里要加上「窗台上晾着一双灰布鞋」。只输出正文。`

// S1
const s1a = await runOne('S1-T1', T1_A1, null)
const s1b = await runOne('S1-T2', T2_A1, [
  { role: 'user', content: T1_A1 },
  { role: 'assistant', content: s1a }
])
// S2
const s2a = await runOne('S2-T1', T1_A2, null)
const s2b = await runOne('S2-T2', T2_A2, [
  { role: 'user', content: T1_A2 },
  { role: 'assistant', content: s2a }
])
// S3
const s3a = await runOne('S3-T1', T1_B, null)
const s3b = await runOne('S3-T2', T2_B, [
  { role: 'user', content: T1_B },
  { role: 'assistant', content: s3a }
])

const has = (t, m) => t.includes(m)
const s1PassCore = has(s1b, '黄布伞')
const s1SoftA = has(s1b, '琉璃风铃')
const s2PassCore = has(s2b, '蜡烛')
const s2SoftA = has(s2b, '座钟')
const s3PassCore = has(s3b, '灰布鞋')
const s1Diff = s1b !== s1a
const s2Diff = s2b !== s2a
const s3Diff = s3b !== s3a

console.log('\n=== 判据 ===')
console.log(`S1 方向修正（风铃→黄布伞）：final2 含「黄布伞」=${s1PassCore}，仍提「琉璃风铃」=${s1SoftA}，与 T1 结果不同=${s1Diff}`)
console.log(`S2 方向修正（座钟→蜡烛）：final2 含「蜡烛」=${s2PassCore}，仍提「座钟」=${s2SoftA}，与 T1 结果不同=${s2Diff}`)
console.log(`S3 追加要求（灰布鞋）：final2 含「灰布鞋」=${s3PassCore}，与 T1 结果不同=${s3Diff}`)
const pass = s1PassCore && s2PassCore && s3PassCore && s1Diff && s2Diff && s3Diff
console.log(pass ? '\nFOLLOWUP-ADAPT-LIVE OK' : '\nFOLLOWUP-ADAPT-LIVE FAILED')

const report = [
  '=== 织卷 · 追问敏锐度真模型探针报告（2026-09-24 智能层轮，v1）===',
  '模型：本机 vLLM + 真边车（runChat 全链：织卷smoke 副本，追问轮带【对话历史】= 真机排队续发后的第二问形态）',
  '业界语义：Claude Code 官方 interactive-mode——生成中发消息=排队不打断；工具调用间隙同轮送入/轮尾续发；Esc/Ctrl+Enter 即发（v2.1.275+）；织卷 v1=轮尾续发（本探针验证模型侧采纳）',
  '',
  `【S1 方向修正】T1=${s1a.length}字，T2=${s1b.length}字`,
  `-- T1（${s1a.length}字）--\n${s1a}`,
  `-- T2（${s1b.length}字）--\n${s1b}`,
  `判据：含「褪色的黄布伞」=${s1PassCore}；仍提「琉璃风铃」=${s1SoftA}；不同结果=${s1Diff}`,
  '',
  `【S2 方向修正】T1=${s2a.length}字，T2=${s2b.length}字`,
  `-- T1（${s2a.length}字）--\n${s2a}`,
  `-- T2（${s2b.length}字）--\n${s2b}`,
  `判据：含「半截烧焦的蜡烛」=${s2PassCore}；仍提「老式座钟」=${s2SoftA}；不同结果=${s2Diff}`,
  '',
  `【S3 追加要求】T1=${s3a.length}字，T2=${s3b.length}字`,
  `-- T1（${s3a.length}字）--\n${s3a}`,
  `-- T2（${s3b.length}字）--\n${s3b}`,
  `判据：含「窗台上晾着一双灰布鞋」=${s3PassCore}；不同结果=${s3Diff}`,
  '',
  '结论：' + (pass ? 'PASS（追问方向被采纳，最新用户指令优先于前轮指令）' : 'FAIL（追问未被采纳/方向漂移→登记候选：注入「最新用户指令优先」纪律或打断重写机制）')
].join('\n')
writeFileSync('/tmp/zj-followup-report.txt', report)
console.log('\nREPORT saved /tmp/zj-followup-report.txt')
rmSync(tmp, { recursive: true, force: true })
process.exit(pass ? 0 : 2)
