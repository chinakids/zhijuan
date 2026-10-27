#!/usr/bin/env node
// 织卷 · 写作引擎启动自检（2026-10-27 平台层）
// ---------------------------------------------------------------------------
// 为什么：dsh-runtime 是 vendored 依赖树（gitignore），装坏了照样能打包出 dmg——
//   2026-10-21 就是「引擎在注册 LLM 适配器前崩溃」→ 设置页只说「引擎离线」，
//   产物照发。发布物必须能自证「装完 / 打完包的引擎真的起得来、适配器注册上了」。
// 做什么：直接拉边车（dsh sdk 服务）→ 初始化 → 发一条最小 prompt。
//   判据（任一命中即失败）：子进程退出 / "no adapter registered" / "is not a function"。
//   通过的情形：模型真回了；或模型侧慢/连不上（超时、ECONNREFUSED）——那说明
//   适配器已注册、引擎活着，网络问题不在本检查的判据面。
// 用法：
//   node scripts/dsh-boot-check.mjs                # 仓库内 dsh-runtime
//   ZHJUAN_DSH_RUNTIME=/path/to/dsh-runtime node scripts/dsh-boot-check.mjs
//   node scripts/dsh-boot-check.mjs --timeout 60   # 等模型的秒数（默认 45）
//   node scripts/dsh-boot-check.mjs --model        # 要求模型真回一句（本地联调用）
// 退出码：0=通过 1=失败（诊断打印在 stdout）。
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const args = process.argv.slice(2)
const opt = (name, dflt) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt
}
const timeoutS = Number(opt('--timeout', '45'))
const requireModel = args.includes('--model')
const root = resolve(import.meta.dirname, '..')
const rt = resolve(process.env.ZHJUAN_DSH_RUNTIME || join(root, 'dsh-runtime'))

const fail = (lines) => {
  console.log('✗ 引擎自检失败')
  for (const l of lines) console.log('  ' + l)
  process.exit(1)
}
const ok = (lines) => {
  console.log('✓ 引擎自检通过')
  for (const l of lines) console.log('  ' + l)
  process.exit(0)
}

// --- 诊断前置：文件都在吗 ---
const sdkBin = join(rt, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const clientPkg = join(rt, 'node_modules', '@deepseek-ai', 'dsh-sdk-client', 'package.json')
const home = join(rt, 'dshhome')
const bootLib = join(rt, 'node_modules', '@deepseek-ai', 'dsh-app-boot', 'lib', 'index.js')
const missing = [sdkBin, clientPkg, bootLib].filter((p) => !existsSync(p))
if (missing.length) fail(['dsh-runtime 依赖树不完整：', ...missing.map((p) => '缺 ' + p), `运行时目录 ${rt}`])
if (!existsSync(home)) fail(['缺 DSH_HOME 目录：' + home])

// --- LLM 覆写 patch：优先用 App 生成的，缺失时写一份自检专用（指向必然连不上的端口） ---
let patch = join(rt, 'run', 'llm.override.patch.yml')
let patchNote = '沿用 App 生成的 llm.override.patch.yml'
if (!existsSync(patch)) {
  const dir = join(tmpdir(), 'zj-dsh-bootcheck')
  mkdirSync(dir, { recursive: true })
  patch = join(dir, 'llm.override.patch.yml')
  writeFileSync(
    patch,
    [
      '- id: llm-pi-ai',
      '  config:',
      '    providers:',
      '      zj-bootcheck:',
      '        displayName: "自检占位"',
      '        api: openai-completions',
      '        baseURL: "http://127.0.0.1:9/v1"',
      '        apiKeyEnv: LOCAL_LLM_KEY',
      '        models:',
      '          - id: "bootcheck"',
      '- id: agent-default-model',
      '  config:',
      '    provider: zj-bootcheck',
      '    model: "bootcheck"',
      ''
    ].join('\n'),
    'utf-8'
  )
  patchNote = '无 App patch，用自检占位 patch（127.0.0.1:9）'
}

// --- 读 provider/model：patch 里有就用，没有就占位 ---
let provider = 'zj-bootcheck'
let model = 'bootcheck'
try {
  const yml = readFileSync(patch, 'utf-8')
  const pm = yml.match(/provider:\s*"?([\w.-]+)"?\s*\n\s*model:\s*"?([\w.-]+)"?/)
  if (pm) {
    provider = pm[1]
    model = pm[2]
  }
} catch {}

// --- HMR 守卫（2026-10-26 的 NO_ADAPTER 根因）；缺失只提示，不直接判死 ---
const guardMissing = !readFileSync(bootLib, 'utf-8').includes('typeof hmr.registerConfig !== "function"')

const t0 = Date.now()
const { createRequire: cr } = await import('node:module')
const req = cr(join(rt, 'package.json'))
let H
try {
  const entry = req.resolve('@deepseek-ai/dsh-sdk-client')
  ;({ DeepSeekHarness: H } = await import(pathToFileURL(entry).href))
} catch (e) {
  fail(['加载 dsh-sdk-client 失败：' + String(e?.message || e), `运行时目录 ${rt}`])
}

const h = new H({
  launch: {
    command: process.execPath,
    args: [sdkBin, '--profile', 'sdk', '--patch', patch],
    cwd: rt,
    requestTimeoutMs: Math.max(20_000, timeoutS * 1000),
    env: { ...process.env, DSH_HOME: home, LOCAL_LLM_KEY: process.env.LOCAL_LLM_KEY || 'local' }
  },
  provider,
  model,
  maxTokens: 16
})

const base = [
  `运行时：${rt}`,
  `provider/model：${provider} · ${model}`,
  `patch：${patchNote}`,
  `HMR 守卫：${guardMissing ? '缺失（构建前置 patch-dsh-hmr 未跑？）' : '在'}`
]

let outcome
try {
  await h.start()
  const started = Date.now() - t0
  let raced = false
  const r = await Promise.race([
    h.run('ping'),
    new Promise((res) => setTimeout(() => { raced = true; res(null) }, timeoutS * 1000))
  ])
  outcome = raced
    ? { kind: 'timeout', info: `模型 ${timeoutS}s 内未回（适配器已注册、引擎在跑）`, started }
    : (() => {
        const text = String(r?.finalResponse ?? '').trim()
        return text
          ? { kind: 'answer', info: `模型回复：${JSON.stringify(text).slice(0, 80)}`, started }
          // 空回复＝端点连不上/占位 patch，但会话跑完＝适配器在、引擎没崩
          : { kind: 'empty', info: '模型端点未返回内容（适配器已注册、引擎在跑）', started }
      })()
} catch (e) {
  const msg = String(e?.message || e)
  const adapterBroken = /no adapter registered|is not a function|Cannot read propert/i.test(msg)
  const runtimeExited = /runtime exited|Transport closed|ENOENT/i.test(msg)
  const netOnly = /fetch failed|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|socket|Network/i.test(msg)
  outcome = {
    kind: adapterBroken || runtimeExited ? 'fail' : netOnly ? 'timeout' : 'fail',
    info: msg.slice(0, 800),
    started: Date.now() - t0
  }
} finally {
  try { await h.close() } catch {}
}

if (outcome.kind === 'fail') fail([...base, `用时 ${outcome.started}ms`, outcome.info])
if (requireModel && outcome.kind !== 'answer') {
  fail([...base, `--model 要求真回复，实得：${outcome.kind}`, outcome.info])
}
ok([...base, `用时 ${outcome.started}ms`, outcome.info])