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
// 预检：逐脚本提取 ZJ_SMOKE_BASE 默认端口 / const PORT / localhost 字面量，fetch 探活。
//       脚本引用 9224 时探 CDP /json/version。不通 → 标 FAIL 并给出启动提示，不执行该脚本。
//       内容级（2026-09-15 22:30）：对 renderer 服务（非 9224/8810）额外 fetch /index.html 与本地
//       out/renderer/index.html 比对引用面（拦截服务指向旧构建/别的目录=整轮假绿）；全局另做构建
//       新鲜度检查（src 晚于产物=改了没 build）。详见函数注释与 docs/模块推进/03-平台层.md。
// 可选环境：8810（zj-bridge 真引擎桥）缺失标 SKIP 不计失败（--live 才可能全绿）。
// CDP tab 治理（2026-09-16 19:30 平台层轮，候选 1 观察项收口）：
//   背景：~101/138 个引用 9224 的冒烟脚本开 tab 从不关闭（跨轮残留实态 32 个），--all 长跑持续
//   累积——9-15 22:30 / 9-16 16:30 两轮全量实踩：约 [148/155] 后 CDP 失联（9 项环境失败，重启
//   agent_browser 即恢复，与 tab 累积强相关）。
//   调研依据：codeables（headless Chrome 长跑内存增长：tab 不关=renderer 进程累积，处置=用完即关+
//   浏览器回收）；16yun 博客（100 个未关闭 tab ≈ 300-500 进程）；chrome-devtools-mcp #1921（30~400
//   tab 起 CPU/内存暴涨、2000 tab 直接崩溃）。官方 legacy HTTP 端点 `PUT /json/close/<id>` 实证
//   可用（404=目标已不存在，容错）。
//   处置（零侵入，不改 101 个脚本本身）：① 起点清理——织卷本地页 tab 数超过 CDP_TAB_HIGH 先回收一批
//   （治跨轮残留）；② 跑后收尾——关闭每个使用 CDP 的脚本运行期间新增的 page target（治长跑累积，
//   tab 数全程恒定）；③ 观测——每脚本前后 tab 数与清理数落行，汇总报尾态。
// CDP 协议面看护（2026-09-16 22:30 平台层轮，观察项㉜收口）：
//   背景：tab 治理（19:30 轮）后全量 157 全程无 tab 累积失联，但全量结束约 2-3 分钟后 9224 协议面
//   挂死（Chrome 主进程活、DevTools HTTP 不响应；float-kbd 因此 TIMEOUT，agent_browser 重启后 3/3
//   PASS 定非回归）——与 16:30「[148/155] 后失联」、9-13 22:30「9 天钙化」疑同根因＝高频 target
//   创建/关闭后内部泄漏（进程级，tab 治理管不到）。
//   处置＝活性探测 + 自动重启 + 有界重试（Playwright test-retries 先例：间歇失败自动重跑、可配置；
//   playwright.dev/docs/test-retries；背景另见 19:30 轮归档 codeables/16yun/chrome-devtools-mcp #1921）：
//   ① 主动探测——每 CDP_WATCH_EVERY 个脚本 ping 一次 /json/version，挂了立即重启（提前恢复，后续
//   useCdp 脚本不白跑）；② 预检恢复——useCdp 脚本预检发现「CDP 未起」不直接标 FAIL，先自动重启一次
//   再重预检；③ 失败重试——脚本失败且协议面已死（挂死典型症状）→ 自动重启 + 重跑 1 次（有界，不无限
//   循环；重试通过计 PASS 并统计）。重启＝agent_browser.sh stop+start（幂等，进程级挂死/死亡都覆盖），
//   就绪轮询 ≤60s；重启失败才按环境 FAIL 计。
// 模型类口径（2026-09-15 16:30 收口）：真模型驱动的 smoke 依赖算力池 vLLM（127.0.0.1）忙闲，
//   非织卷代码红/绿判据——门禁（--all）若包含它们会因模型侧波动恒红，违背「改动后一切如常」的
//   确定性（基线 2026-09-15 13:30 实锤：acts/engine-sync 全量 300s 被杀=误杀）。
//   处置=显式名单 MODEL_SCRIPTS 声明身份（对应 Playwright @slow/tag 语义：测试自己声明而非路径猜测），
//   --all 跳过计 SKIP，--live 或单独指名运行。名单启动自检（防脚本删除后名单腐化）。
//   漏网守卫（2026-09-16 07:30 接入）：--all 主流程自动跑 scripts/smoke-model-audit.mjs 的审计（非 strict，
//     健康显示一行、疑似漏网提示清单——默认不阻断；CI 阻断=node scripts/smoke-model-audit.mjs --strict）。
//   userData 契约守卫（2026-09-17 01:30 接入）：--all 主流程自动跑 scripts/smoke-userdata-check.mjs 的审计
//     （引用 electron-stub 的冒烟必须带独立 clean userData——共享默认目录残留 settings 会假绿；默认不阻断）。
//   文本点击断链审计（2026-09-17 19:30 接入）：--all 主流程自动跑 scripts/textclick-audit.mjs 的审计
//     （UI 收敛后冒烟仍按按钮文本查找=静默断链；零命中=健康一行，疑似=清单，默认不阻断；CI 阻断=直接跑该工具）。
// 退出码 = FAIL 数（0=全绿）。
// 参考：npm-run-all 生态缺口（api.github.com/repos/mysticatea/npm-run-all/contents/README.md）、
//       Playwright test-cli --list/-x（playwright.dev/docs/test-cli）、
//       Playwright Annotations test.slow/fixme/@fast/@slow + --grep（playwright.dev/docs/test-annotations）

import { spawn, spawnSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MODEL_SCRIPTS, MODEL_SKIP_REASON } from './model-scripts.mjs' // 名单单源（2026-09-16 平台层轮抽取；判据与维护契约看该文件头注）
import { analyze, report as auditReport } from './smoke-model-audit.mjs' // 门禁自动审计（2026-09-16 07:30 平台层轮接入——同进程复用 analyze/report，免子进程文本解析）
import { analyze as udAnalyze, report as udAuditReport } from './smoke-userdata-check.mjs' // 数据层 userData 契约审计（2026-09-17 01:30 平台层轮接入——同进程复用，单名调试不跑审计=设计如此）
import { analyze as tcAnalyze, report as tcAuditReport } from './textclick-audit.mjs' // 文本点击断链审计（2026-09-17 19:30 平台层轮接入——同进程复用；扫描「按钮文本查找」调用点 vs ICON_ONLY_LEXICON 词库，健康一行/疑似清单）

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url)) // scripts/（fileURLToPath 避免中文路径被 URL 编码）
const repoRoot = resolve(SCRIPTS_DIR, '..')
const CDP = 'http://127.0.0.1:9224'
const PING_TIMEOUT_MS = 2000
// 可选环境：zj-bridge 真引擎桥（8810）——agent-cancel-*-smoke 专属依赖，常规回归不要求，
// 缺失标 SKIP 不计 FAIL（否则 --all 恒红 2 个）；8123/8899/CDP 为必选，缺失标 FAIL。
const OPTIONAL_PORTS = new Set(['8810'])

// 模型类冒烟显式名单取自 scripts/model-scripts.mjs（单源，2026-09-16 抽取——原名单与判据备注已迁入，
// 维护契约见该文件头注：新增真模型冒烟必须登记；漏网守卫=scripts/smoke-model-audit.mjs）

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
const isSmoke = (f) => /smoke/i.test(f) && f !== 'smoke-ui.mjs' && f !== 'smoke-gate-check.mjs' && f !== 'smoke-model-audit.mjs' && f !== 'smoke-userdata-check.mjs' // 入口自排除：本文件也含 smoke，不排除则 --all 把它自己排进去（无参运行恒 exit 2）；门禁自检=元测试（2026-09-16，跑在 --all 之前单独执行），模型类审计=元审计（2026-09-16 07:30，门禁主流程自动跑），userData 契约审计=元审计（2026-09-17 01:30，同前），均不属页面冒烟集合
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

// ---------- 预检：构建新鲜度（2026-09-15 22:30 平台层轮） ----------
// 门禁判据 1：out/renderer/index.html 的 mtime 必须不早于 src/ 内任何源文件与 electron.vite.config.*——
//   拦截「改了源码没 npm run build，服务还停在旧 bundle」的经典假绿（技能实踩坑：源码改动不重新编译不生效）。
//   容差 1000ms 吸收同秒粒度；只对门禁（--all/--list）整体检查一次，不逐脚本重复。
function checkBuildFreshness() {
  const idx = join(repoRoot, 'out', 'renderer', 'index.html')
  let idxM
  try {
    idxM = statSync(idx).mtimeMs
  } catch {
    return { ok: false, reason: `本地无构建产物 ${idx}——请先 npm run build 再跑冒烟（门禁按失败计）` }
  }
  let maxM = 0
  let latest = ''
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.isFile()) {
        const ms = statSync(p).mtimeMs
        if (ms > maxM) { maxM = ms; latest = p }
      }
    }
  }
  walk(join(repoRoot, 'src'))
  for (const cfg of ['electron.vite.config.ts', 'electron.vite.config.mjs', 'electron.vite.config.js']) {
    const p = join(repoRoot, cfg)
    try {
      const ms = statSync(p).mtimeMs
      if (ms > maxM) { maxM = ms; latest = p }
    } catch { /* 不存在即跳过 */ }
  }
  if (maxM > idxM + 1000) {
    return { ok: false, reason: `构建过期：${latest.replace(repoRoot + '/', '')}（${new Date(maxM).toLocaleString()}）晚于 out/renderer/index.html——请 npm run build 后重跑` }
  }
  return { ok: true }
}

// ---------- 预检：服务内容一致性（2026-09-15 22:30 平台层轮） ----------
// 门禁判据 2：端口探活=「服务在」，但服务可能起在**旧构建/别的目录**（本机实态：/tmp/spa_server.py 历史
//   硬编码 ROOT、python http.server --directory 起错目录）——145 个脚本会整轮跑在旧 bundle 上仍输出
//   「全绿」＝假绿。判据：对 renderer 静态服务（非 9224/8810）fetch /index.html，提取构建引用面
//   （script/link src），与本地 out/renderer/index.html 比对（本地是唯一构建事实源）；不等=FAIL 并给
//   双方资产清单。参考：Playwright webServer.url 健康检查也只是状态码级（2xx/3xx/400-403 即就绪，
//   playwright.dev/docs/test-webserver）——行业无内容级标准，本机特化补上。
const contentCheckCache = new Map() // URL -> { ok, note?, detail? }
function localIndexRefs() {
  const p = join(repoRoot, 'out', 'renderer', 'index.html')
  try {
    const t = readFileSync(p, 'utf8')
    return { ok: true, refs: [...t.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]), path: p }
  } catch {
    return { ok: false, refs: [], path: p }
  }
}
async function contentCheck(u) {
  if (contentCheckCache.has(u)) return contentCheckCache.get(u)
  let res
  try {
    const r = await fetch(u + '/index.html', { signal: AbortSignal.timeout(PING_TIMEOUT_MS) })
    const body = await r.text()
    const ct = r.headers.get('content-type') || ''
    if (!/text\/html|xhtml/i.test(ct) && !/<html/i.test(body.slice(0, 2048))) {
      res = { ok: true, note: '非 HTML 服务，跳过内容校验' }
    } else {
      const local = localIndexRefs()
      if (!local.ok) {
        res = { ok: true, note: '本地无构建参考（以全局构建检查为准）' }
      } else {
        const remote = [...body.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1])
        if (JSON.stringify(remote) !== JSON.stringify(local.refs)) {
          const port = new URL(u).port
          res = { ok: false, detail: `服务内容与本地构建不一致（疑似旧构建/别的目录）：远端 assets=[${remote.join(', ')}] vs 本地=[${local.refs.join(', ')}]——请 npm run build 后重启 node scripts/serve-renderer.mjs ${port}` }
        } else {
          res = { ok: true }
        }
      }
    }
  } catch (e) {
    res = { ok: false, detail: `内容探活失败：${e.message}` }
  }
  contentCheckCache.set(u, res)
  return res
}

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
      continue
    }
    const port = new URL(u).port
    if (port === '9224' || port === '8810') continue // CDP / 桥：各自语义（/json/version、可选 SKIP）
    const cc = await contentCheck(u)
    if (!cc.ok) issues.push(`内容校验：${cc.detail}`)
  }
  if (/:9224/.test(content) && !(await pingUrl(CDP + '/json/version'))) {
    issues.push(`CDP 未起：${CDP}（本机专用无头 Chrome）`)
  }
  return { issues, skipped, useCdp: /:9224/.test(content) }
}

// ---------- CDP tab 治理（2026-09-16 19:30 平台层轮）----------
// 官方 legacy HTTP 端点：PUT /json/close/<targetId>（实证 200 "Target is closing"；404=已不存在，容错）
const CDP_TAB_HIGH = 40 // 织卷本地页 tab 阈值：超过即起点清理（常态 ≤5-10；40 留足并发余量）
// 本地页判据（host ∈ localhost/127.0.0.1）：织卷冒烟只开本机服务页；外部抓取（主人调研等）开的是
// 外域 URL，不会被误清。专用隔离浏览器无用户数据，清理安全。
const isLocalPage = (t) => /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\//i.test(t.url)

async function cdpPages() {
  try {
    const r = await fetch(CDP + '/json/list', { signal: AbortSignal.timeout(3000) })
    if (!r.ok) return []
    const list = await r.json()
    return Array.isArray(list) ? list.filter((t) => t.type === 'page') : []
  } catch {
    return []
  }
}
async function cdpPagesLocal() {
  return (await cdpPages()).filter(isLocalPage)
}
async function cdpClose(id) {
  try {
    await fetch(CDP + '/json/close/' + id, { method: 'PUT', signal: AbortSignal.timeout(3000) })
  } catch { /* 已关闭/网络抖动：容错，不影响主流程 */ }
}
// 起点清理：织卷本地页 tab 数超过阈值 → 全部回收（治跨轮残留；服务性动作，不标 FAIL）
async function sweepStaleTabs() {
  const local = await cdpPagesLocal()
  if (local.length <= CDP_TAB_HIGH) return { closed: 0, left: local.length }
  let closed = 0
  for (const t of local) await cdpClose(t.id)
  closed = local.length
  return { closed, left: 0 }
}
// 跑后收尾：关闭「快照之后新增」的 page target（治长跑累积；脚本自关的已不在新增集，重复关 404 容错）
async function cdpReap(beforeIds) {
  const after = await cdpPages()
  const added = after.filter((t) => !beforeIds.has(t.id))
  for (const t of added) await cdpClose(t.id)
  return { cleaned: added.length, before: beforeIds.size, after: after.length }
}

// ---------- CDP 协议面看护（2026-09-16 22:30 平台层轮；动机与依据见头注释） ----------
const CDP_WATCH_EVERY = 10 // 主动探测频率：每 N 个脚本 ping 一次 /json/version（提前发现协议面挂死）
const CDP_PING_MS = 3000
const CDP_RESTART_TIMEOUT_MS = 60000
const AGENT_BROWSER_SH = join(process.env.HOME || '', '.hermes', 'scripts', 'agent_browser.sh') // 本机专用无头浏览器启动器（幂等 start/stop）

async function cdpAlive(timeoutMs = CDP_PING_MS) {
  try {
    const r = await fetch(CDP + '/json/version', { signal: AbortSignal.timeout(timeoutMs) })
    return r.ok
  } catch {
    return false
  }
}
// 重启＝stop+start（start 幂等自带 5s 就绪探测）；本函数再轮询到 ≤60s；返回就绪耗时（秒），失败 null
async function cdpRestart() {
  const t0 = Date.now()
  spawnSync('sh', [AGENT_BROWSER_SH, 'stop'], { stdio: 'ignore' })
  spawnSync('sh', [AGENT_BROWSER_SH, 'start'], { stdio: 'ignore' })
  while (Date.now() - t0 < CDP_RESTART_TIMEOUT_MS) {
    if (await cdpAlive(2000)) return (Date.now() - t0) / 1000
    await new Promise((res) => setTimeout(res, 1500))
  }
  return null
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

// 全局构建检查：src 有任何文件晚于 out/renderer/index.html = 构建过期（改了没 build）按环境失败计
const freshness = checkBuildFreshness()
if (!freshness.ok) {
  console.error(`⚠️  ${freshness.reason}`)
}

// 模型类名单审计（2026-09-16 07:30 接入，候选 1）：门禁模式自动跑一次（非 strict）——新增真模型冒烟
//   未登记=漏网，--all 会把它跑进门禁=因 vLLM 算力池忙闲恒红误杀（基线实锤 acts 480s），漏网当刻现形。
//   默认只提示不阻断（continue-on-error 语义：step 失败不阻断 job——docs.github.com/en/actions/reference/
//   workflows-and-actions/workflow-syntax 官方原语）；CI 要阻断用独立脚本 node scripts/smoke-model-audit.mjs --strict。
let auditNote = ''
if (all) {
  if (!auditReport(analyze())) {
    auditNote = '模型类审计不健康（疑似漏网/名单腐化，清单见上）——默认不阻断；CI 阻断用 node scripts/smoke-model-audit.mjs --strict'
    console.error(`⚠️  ${auditNote}`)
  }
  // 数据层 userData 契约审计（2026-09-17 01:30 接入，候选 2 资产化）：引用 electron-stub 的冒烟必须带
  //   独立 clean userData（共享默认目录残留 settings → libraryRoot 空路径/readDoc null=假绿，9-11 实踩）；
  //   默认只提示不阻断（continue-on-error 语义同模型审计）；CI 阻断用 node scripts/smoke-userdata-check.mjs --strict。
  if (!udAuditReport(udAnalyze())) {
    const udNote = '数据层 userData 契约审计不健康（硬缺口清单见上）——默认不阻断；CI 阻断用 node scripts/smoke-userdata-check.mjs --strict'
    auditNote = auditNote ? `${auditNote}；${udNote}` : udNote
    console.error(`⚠️  ${udNote}`)
  }
  // 文本点击断链审计（2026-09-17 19:30 接入，候选 4）：UI 收敛（icon-only/菜单化/删除）后冒烟脚本若仍按
  //   按钮文本查找会静默断链（toast-ui 在 f535050 后断链 2h 才被发现，16:30 轮工具化）——接入门禁元审计，
  //   扫描 scripts/ 文本查找调用点 vs ICON_ONLY_LEXICON；零命中=一行健康、有命中=清单+提示；默认只提示不阻断。
  if (!tcAuditReport(tcAnalyze())) {
    const tcNote = '文本点击审计不健康（疑似断链清单见上）——默认不阻断；CI 阻断用 node scripts/textclick-audit.mjs'
    auditNote = auditNote ? `${auditNote}；${tcNote}` : tcNote
    console.error(`⚠️  ${tcNote}`)
  }
}

const results = []
const t0 = Date.now()
// CDP 起点清理（仅实跑模式）：跨轮残留的织卷本地页 tab 超过阈值即回收（2026-09-16 治理接入）
let sweepInfo = { closed: 0, left: 0 }
if (all && !list) {
  sweepInfo = await sweepStaleTabs()
  if (sweepInfo.closed > 0) console.log(`🧹 CDP 起点清理：回收 ${sweepInfo.closed} 个残留织卷 tab（阈值 ${CDP_TAB_HIGH}，现余 ${sweepInfo.left}）`)
}
let cdCleanedTotal = 0
let cdObsLines = 0
// CDP 看护统计（2026-09-16 22:30 接入）
let watchRestarts = 0
let watchRetried = []
for (let i = 0; i < targets.length; i++) {
  const file = targets[i]
  const label = `[${i + 1}/${targets.length}] ${file}`
  if (list || all) process.stdout.write(`${label} ...`)
  // 主动探测：协议面挂死早期发现、提前恢复（不打断当前脚本；挂死=进程活/DevTools HTTP 死）
  if (!list && i > 0 && i % CDP_WATCH_EVERY === 0 && !(await cdpAlive())) {
    console.log('      🩺 CDP 看护：主动探测发现协议面未响应 → 自动重启浏览器…')
    const secs = await cdpRestart()
    if (secs !== null) {
      watchRestarts++
      console.log(`      🩺 CDP 看护：重启就绪（${secs.toFixed(1)}s）`)
    } else {
      console.log('      🩺 CDP 看护：重启失败（60s 未就绪），后续预检会再尝试')
    }
  }
  let { issues, skipped, useCdp } = await precheck(file)
  // 预检发现 CDP 未起（该脚本用 9224）：环境型可恢复——先自动重启一次再重预检，而非直接标 FAIL
  if (!list && useCdp && issues.some((s) => s.startsWith('CDP 未起'))) {
    console.log('      🩺 CDP 看护：预检发现协议面未起 → 自动重启浏览器…')
    const secs = await cdpRestart()
    if (secs !== null) {
      watchRestarts++
      console.log(`      🩺 CDP 看护：重启就绪（${secs.toFixed(1)}s）→ 重新预检`)
      const again = await precheck(file)
      issues = again.issues
      skipped = again.skipped
      useCdp = again.useCdp
    } else {
      console.log('      🩺 CDP 看护：重启失败（60s 内未就绪）→ 按环境失败计')
    }
  }
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
  // CDP 观测/跑后收尾：使用 9224 的脚本在运行前后各拍一次 tab 快照，跑后关闭新增 target
  const cdpBefore = useCdp ? await cdpPages() : null
  const cdpBeforeIds = cdpBefore ? new Set(cdpBefore.map((t) => t.id)) : null
  let { code, killed, out } = await runScript(file, timeoutSec * 1000)
  let ok = code === 0 && !killed
  // 失败且协议面已死（挂死典型症状）→ 环境型：自动重启 + 有界重试 1 次（Playwright retries 先例）
  if (!ok && useCdp && !(await cdpAlive())) {
    console.log('      🩺 CDP 看护：脚本失败且协议面未响应 → 自动重启浏览器并重试 1 次（有界）')
    const secs = await cdpRestart()
    if (secs !== null) {
      watchRestarts++
      console.log(`      🩺 CDP 看护：重启就绪（${secs.toFixed(1)}s）→ 重试 ${file}`)
      const r2 = await runScript(file, timeoutSec * 1000)
      code = r2.code
      killed = r2.killed
      out = r2.out
      ok = code === 0 && !killed
      if (ok) {
        watchRetried.push(file)
        console.log('      🩺 CDP 看护：重试通过（原失败=协议面挂死，非产品回归）')
      } else {
        console.log('      🩺 CDP 看护：重试仍失败，按原结果计')
      }
    } else {
      console.log('      🩺 CDP 看护：重启失败（60s 内未就绪），按原结果计')
    }
  }
  results.push({ file, ok, reason: killed ? `超时（>${timeoutSec}s，已杀）` : code !== 0 ? `退出码 ${code}` : '' })
  console.log(`    → ${ok ? 'PASS' : 'FAIL'} ${killed ? `(超时 ${timeoutSec}s)` : code !== 0 ? `(exit ${code})` : ''} ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  if (cdpBeforeIds) {
    const reap = await cdpReap(cdpBeforeIds)
    cdCleanedTotal += reap.cleaned
    if (reap.cleaned > 0 || reap.after > CDP_TAB_HIGH) {
      console.log(`      CDP 观测：tab ${reap.before} → ${reap.after}（清理 ${reap.cleaned}）`)
      cdObsLines++
    }
  }
  if (!ok && out) console.log(out.slice(-2500))
  if (failFast && !ok) { console.log('    -x：首个失败，停止。'); break }
}

// ---------- 汇总 ----------
if (!freshness.ok) {
  // 构建过期=环境级失败：计入退出码，门禁必须红（否则「改了没 build」仍输出全绿=假绿）
  results.push({ file: '（构建检查）', ok: false, env: true, reason: freshness.reason })
}
const fail = results.filter((r) => !r.ok)
const skip = results.filter((r) => r.ok && r.skip)
const pass = results.filter((r) => r.ok && !r.skip)
console.log('========== 汇总 ==========')
console.log(`PASS ${pass.length} · SKIP ${skip.length} · FAIL ${fail.length} · 共 ${results.length}（${((Date.now() - t0) / 1000).toFixed(1)}s）`)
if (sweepInfo.closed > 0 || cdCleanedTotal > 0) {
  console.log(`CDP tab 治理：起点回收 ${sweepInfo.closed} · 跑后清理累计 ${cdCleanedTotal} · 观测行 ${cdObsLines}（尾态 ${(await cdpPagesLocal()).length} 个织卷页，阈值 ${CDP_TAB_HIGH}）`)
}
if (watchRestarts > 0 || watchRetried.length > 0) {
  console.log(`🩺 CDP 协议面看护：自动重启 ${watchRestarts} 次 · 重试后通过 ${watchRetried.length} 个${watchRetried.length > 0 ? '（' + watchRetried.join('、') + '）' : ''}`)
}
if (modelSkipped.length > 0) console.log(`（另：模型类门禁跳过 ${modelSkipped.length} 个——--live 或单独跑：${modelSkipped.join('、')}）`)
if (auditNote) console.log(`（另：${auditNote}）`)
for (const r of fail) console.log(`✗ ${r.file}${r.env ? ' [环境]' : ''} — ${r.reason}`)
for (const r of skip) console.log(`⏭ ${r.file} — ${r.reason}`)
for (const r of pass) console.log(`✓ ${r.file}`)
const reds = fail.length
console.log(reds === 0 ? '全绿 ✅' : `${reds} 个失败 ❌（退出码 = ${Math.min(reds, 255)}）`)
process.exit(Math.min(reds, 255))
