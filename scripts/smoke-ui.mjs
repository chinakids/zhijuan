#!/usr/bin/env node
// 织卷冒烟一键回归入口（平台层 2026-09-15，docs/模块推进/03-平台层.md 第 23 轮候选 1）
// ---------------------------------------------------------------------------
// 背景：scripts/*.mjs（实测 168：145 个 smoke + 11 个 *-live 真模型长跑 + 12 个辅助）零统一入口，
//       「没跑」与「跑过」无法一眼区分；本机端口（8123/8899）与 CDP 9224 缺服务时脚本裸超时/假绿。
// 用法：
//   node scripts/smoke-ui.mjs --all [--live] [--timeout <s>] [-x] [-v] [--list]
//   node scripts/smoke-ui.mjs <name> [name2 ...]
//     <name> 可省 scripts/ 前缀与 .mjs 后缀；支持子串唯一匹配（如 'states' -> states-smoke.mjs）
//     --all     = 全部冒烟（文件名含 smoke；模型类脚本默认跳过计 SKIP——见 MODEL_SCRIPTS）
//     --live    = 追加 *-live.mjs 真模型长跑 **与模型类 smoke**（默认跳过；单个常需 300-500s+，
//                 建议 --timeout 900 或 0=不限）
//     --list    = 只列出将执行的脚本并预检，不运行（Playwright --list 先例）
//     --timeout = 每脚本超时秒数（默认 0=不限；--all（非 live）建议 300——不含模型类后此档够用）
//     -x        = 首个失败即停（Playwright --max-failures=1 先例；默认失败继续，回归要全览）
//     -v        = 子进程输出透传（默认收集，失败时打印尾部）
// 预检：逐脚本提取 ZJ_SMOKE_BASE 默认端口 / const PORT / localhost 字面量，fetch 探活；
//       脚本引用 9224 时探 CDP /json/version。不通 → 标 FAIL 并给出启动提示，不执行该脚本。
// 可选环境：8810（zj-bridge 真引擎桥）缺失标 SKIP 不计失败（--live 才可能全绿）。
// 模型类口径（2026-09-15 16:30 收口）：真模型驱动的 smoke 依赖算力池 vLLM（127.0.0.1）忙闲，
//   非织卷代码红/绿判据——门禁（--all）若包含它们会因模型侧波动恒红，违背「改动后一切如常」的
//   确定性（基线 2026-09-15 13:30 实锤：acts/engine-sync 全量 300s 被杀=误杀）。
//   处置=显式名单 MODEL_SCRIPTS 声明身份（对应 Playwright @slow/tag 语义：测试自己声明而非路径猜测），
//   --all 跳过计 SKIP，--live 或单独指名运行。名单启动自检（防脚本删除后名单腐化）。
// 退出码 = FAIL 数（0=全绿）。
// 参考：npm-run-all 生态缺口（api.github.com/repos/mysticatea/npm-run-all/contents/README.md）、
//       Playwright test-cli --list/-x（playwright.dev/docs/test-cli）、
//       Playwright Annotations test.slow/fixme/@fast/@slow + --grep（playwright.dev/docs/test-annotations）

import { spawn } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url)) // scripts/（fileURLToPath 避免中文路径被 URL 编码）
const repoRoot = resolve(SCRIPTS_DIR, '..')
const CDP = 'http://127.0.0.1:9224'
const PING_TIMEOUT_MS = 2000
// 可选环境：zj-bridge 真引擎桥（8810）——agent-cancel-*-smoke 专属依赖，常规回归不要求，
// 缺失标 SKIP 不计 FAIL（否则 --all 恒红 2 个）；8123/8899/CDP 为必选，缺失标 FAIL。
const OPTIONAL_PORTS = new Set(['8810'])

// 模型类冒烟显式名单（2026-09-15 16:30 收口，判定依据逐条核对过调用面，见档案本轮迭代日志）：
//   共同特征=走真实边车/真模型（runChat/runSync/runSubtask/runDirector/runActs/引擎聊天 或 zj-bridge 桥注入），
//   与 8810 可选环境无关——即使桥起着，--all 门禁也不应包含（依赖算力池忙闲，非代码判据）。
//   判据核对备注：sync-produce-loop-smoke 注释自证「无模型调用」故不在名单；context-cast/context-char-tail
//   无 LLM_KEY 字面量但注释明示「真模型 runChat 走查」（走默认 local 配置）；engine-sync 无字面量但基线
//   13:30 实锤真模型（runSync 出真实提案）。
const MODEL_SCRIPTS = new Set([
  'acts-smoke.mjs',
  'agent-cancel-live-smoke.mjs',
  'agent-cancel-live-ui-smoke.mjs',
  'context-cast-smoke.mjs',
  'context-char-tail-smoke.mjs',
  'context-realmodel-smoke.mjs',
  'director-check-smoke.mjs',
  'director-smoke.mjs',
  'engine-smoke.mjs',
  'engine-sync-smoke.mjs',
  'subtasks-smoke.mjs',
  'zj-edit-smoke.mjs',
])
const MODEL_SKIP_REASON = '模型类：真模型驱动（依赖 vLLM 算力池），--all 门禁不包含——--live 或单独跑'

// ---------- 参数解析 ----------
const args = process.argv.slice(2)
const names = []
let all = false, live = false, list = false, verbose = false, failFast = false
let timeoutSec = 0
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === '--all') all = true
  else if (a === '--live') live = true
  else if (a === '--list') list = true
  else if (a === '-v' || a === '--verbose') verbose = true
  else if (a === '-x' || a === '--fail-fast') failFast = true
  else if (a === '--timeout') timeoutSec = Number(args[++i]) || 0
  else if (a.startsWith('--timeout=')) timeoutSec = Number(a.split('=')[1]) || 0
  else names.push(a)
}
if (!all && names.length === 0) {
  console.error('用法：node scripts/smoke-ui.mjs --all [--live] [--timeout <s>] [-x] [-v] [--list]')
  console.error('      node scripts/smoke-ui.mjs <name> [name2 ...]')
  process.exit(2)
}

// ---------- 脚本收集 ----------
const allFiles = readdirSync(SCRIPTS_DIR).filter((f) => f.endsWith('.mjs')).sort()
const isSmoke = (f) => /smoke/i.test(f) && f !== 'smoke-ui.mjs' // 入口自排除：本文件也含 smoke，不排除则 --all 把它自己排进去（无参运行恒 exit 2）
const isLive = (f) => /-live\.mjs$/.test(f)

function resolveName(param) {
  if (param.includes('/') || param.includes('\\') || param.endsWith('.mjs')) {
    const p = param.startsWith('scripts/') ? param.slice('scripts/'.length) : param
    if (allFiles.includes(p)) return p
    if (p.endsWith('.mjs') && allFiles.includes(p)) return p
  }
  const hits = allFiles.filter((f) => f.includes(param))
  if (hits.length === 1) return hits[0]
  if (hits.length > 1) throw new Error(`「${param}」匹配 ${hits.length} 个脚本：${hits.join(', ')}`)
  throw new Error(`找不到脚本「${param}」（scripts/ 下无匹配）`)
}

let targets = []
const modelSkipped = [] // 门禁跳过的模型类（汇总脚注，--live 时为空）
if (all) {
  // 名单自检：脚本被删除/改名后名单腐化必须有信号，不许静默（否则 --live 少跑一个模型类也无人知）
  const missing = [...MODEL_SCRIPTS].filter((f) => !allFiles.includes(f))
  if (missing.length > 0) {
    console.error(`模型类名单含不存在的脚本：${missing.join(', ')}（请同步 scripts/ 实况或更新 MODEL_SCRIPTS）`)
    process.exit(2)
  }
  targets = allFiles.filter(isSmoke)
  if (!live) {
    // 门禁口径：模型类不进 --all（计 SKIP 有显示、不计失败）；--live 才包含
    targets = targets.filter((f) => {
      if (MODEL_SCRIPTS.has(f)) {
        modelSkipped.push(f)
        console.log(` ⏭ SKIP：${f} — ${MODEL_SKIP_REASON}`)
        return false
      }
      return true
    })
  }
  if (live) targets = targets.concat(allFiles.filter(isLive))
} else {
  for (const n of names) targets.push(resolveName(n))
}
if (all && live) targets = targets.filter((f, i) => targets.indexOf(f) === i) // 去重（live 不含 smoke，安全去重）

// ---------- 预检：端口提取（正则覆盖全部历史形态） ----------
function collectPorts(content) {
  const ports = new Set()
  // ① ZJ_SMOKE_BASE || '<url>' / "..." / `...`
  const m = content.match(/ZJ_SMOKE_BASE\s*\|\|\s*([`'"])([^`'"]*)\1/)
  if (m) {
    let url = m[2]
    if (url.includes('${')) {
      const pv = content.match(/const\s+PORT\s*=\s*(\d+)/)
      if (pv) url = url.replace(/\$\{PORT\}/, pv[1])
    }
    const pm = url.match(/^(https?):\/\/([^:/]+)(?::(\d+))?/)
    if (pm) ports.add(`${pm[1]}://${pm[2]}:${pm[3] || (pm[1] === 'https' ? 443 : 80)}`)
  }
  // ② 兜底：正文一切 localhost/127.0.0.1:PORT 字面量（含 const PORT = N 组装）
  for (const pm2 of content.matchAll(/(?:localhost|127\.0\.0\.1):(\d{2,5})/g)) {
    const p = Number(pm2[1])
    ports.add(`http://localhost:${p}`)
  }
  const pv2 = content.match(/const\s+PORT\s*=\s*(\d+)/)
  if (pv2 && content.includes('${PORT}')) ports.add(`http://localhost:${pv2[1]}`)
  return [...ports]
}

async function pingUrl(url) {
  try {
    const r = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(PING_TIMEOUT_MS), redirect: 'follow' })
    return r.status > 0 // 任何 HTTP 响应即服务在
  } catch {
    return false
  }
}

async function precheck(file) {
  const content = readFileSync(join(SCRIPTS_DIR, file), 'utf8')
  const issues = []
  const skipped = []
  const ports = collectPorts(content)
  for (const u of ports) {
    if (!(await pingUrl(u))) {
      const opt = OPTIONAL_PORTS.has(new URL(u).port)
      ;(opt ? skipped : issues).push(`服务未起：${u}`)
    }
  }
  if (/:9224/.test(content) && !(await pingUrl(CDP + '/json/version'))) {
    issues.push(`CDP 未起：${CDP}（本机专用无头 Chrome）`)
  }
  return { issues, skipped }
}

const serveHint = (issues) => {
  for (const it of issues) {
    const pm = it.match(/(?:localhost|127\.0\.0\.1):(\d+)/)
    if (pm && pm[1] !== '9224') return `请先启动：node scripts/serve-renderer.mjs ${pm[1]}（默认 8123，可用 ZJ_SMOKE_BASE 覆盖）＋CDP 9224 就绪。`
  }
  return `请先启动：node scripts/serve-renderer.mjs 8123（默认，可用 ZJ_SMOKE_BASE 覆盖）＋CDP 9224 就绪。`
}

// ---------- 执行 ----------
function runScript(file, timeoutMs) {
  return new Promise((res) => {
    const p = spawn(process.execPath, [join(SCRIPTS_DIR, file)], {
      cwd: repoRoot,
      env: process.env,
      stdio: verbose ? ['ignore', 'inherit', 'inherit'] : ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    let killed = false
    const timer = timeoutMs > 0 ? setTimeout(() => { killed = true; p.kill('SIGKILL') }, timeoutMs) : null
    if (!verbose) {
      p.stdout.on('data', (d) => { out += d; if (out.length > 400000) out = out.slice(-200000) })
      p.stderr.on('data', (d) => { out += d; if (out.length > 400000) out = out.slice(-200000) })
    }
    p.on('close', (code) => {
      if (timer) clearTimeout(timer)
      res({ code: code ?? -1, killed, out })
    })
  })
}

// ---------- 主流程 ----------
console.log(`织卷冒烟回归 · ${targets.length} 个脚本${all ? '（--all' + (live ? ' + live' : '') + '）' : ''}`)
if (list) console.log('--list：仅预检，不运行\n')

const results = []
const t0 = Date.now()
for (let i = 0; i < targets.length; i++) {
  const file = targets[i]
  const label = `[${i + 1}/${targets.length}] ${file}`
  if (list || all) process.stdout.write(`${label} ...`)
  const { issues, skipped } = await precheck(file)
  if (issues.length > 0) {
    results.push({ file, ok: false, env: true, reason: issues.join('；') })
    if (!list) console.log(` ✗ 环境：${issues.join('；')}`)
    else console.log(' ✗ ' + issues.join('；'))
    if (!list) console.log(`        ${serveHint(issues)}`)
    if (failFast && !list) break
    continue
  }
  if (skipped.length > 0) {
    results.push({ file, ok: true, skip: true, reason: skipped.join('；') })
    console.log(` ⏭ SKIP：${skipped.join('；')}（可选环境，不计失败）`)
    continue
  }
  if (list) { console.log(' ✓'); results.push({ file, ok: true }); continue }
  console.log(' ✓ 预检通过')
  const { code, killed, out } = await runScript(file, timeoutSec * 1000)
  const ok = code === 0 && !killed
  results.push({ file, ok, reason: killed ? `超时（>${timeoutSec}s，已杀）` : code !== 0 ? `退出码 ${code}` : '' })
  console.log(`    → ${ok ? 'PASS' : 'FAIL'} ${killed ? `(超时 ${timeoutSec}s)` : code !== 0 ? `(exit ${code})` : ''} ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  if (!ok && out) console.log(out.slice(-2500))
  if (failFast && !ok) { console.log('    -x：首个失败，停止。'); break }
}

// ---------- 汇总 ----------
const fail = results.filter((r) => !r.ok)
const skip = results.filter((r) => r.ok && r.skip)
const pass = results.filter((r) => r.ok && !r.skip)
console.log('\n========== 汇总 ==========')
console.log(`PASS ${pass.length} · SKIP ${skip.length} · FAIL ${fail.length} · 共 ${results.length}（${((Date.now() - t0) / 1000).toFixed(1)}s）`)
if (modelSkipped.length > 0) console.log(`（另：模型类门禁跳过 ${modelSkipped.length} 个——--live 或单独跑：${modelSkipped.join('、')}）`)
for (const r of fail) console.log(`✗ ${r.file}${r.env ? ' [环境]' : ''} — ${r.reason}`)
for (const r of skip) console.log(`⏭ ${r.file} — ${r.reason}`)
for (const r of pass) console.log(`✓ ${r.file}`)
const reds = fail.length
console.log(reds === 0 ? '全绿 ✅' : `${reds} 个失败 ❌（退出码 = ${Math.min(reds, 255)}）`)
process.exit(Math.min(reds, 255))
