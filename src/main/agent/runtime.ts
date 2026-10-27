// ===== 织卷 · dsh 写作引擎运行时管理（主进程） =====
// 定位 dsh-runtime（vendored 引擎）、懒启动 SDK 写作引擎、按设置动态覆写 LLM 端点、会话管理。
import { app } from 'electron'
import { createRequire } from 'module'
import { execFileSync } from 'child_process'
import { mkdirSync, readFileSync, existsSync, readdirSync, cpSync, renameSync, rmSync } from 'fs'
import { writeFileAtomic } from '../fsutil'
import { resolve, dirname, join, win32 } from 'path'
import { homedir } from 'os'
import { pathToFileURL } from 'url'
import { getSettings } from '../settings'
import { activeProvider, buildLlmOverrideYml } from '../../shared/providers'

// ===== 织卷对“写作引擎”的薄接口（模块设计 §14之 / 评审 E2）=====
// 现状实现是 dsh（runtime 下面所有函数）；以后实验别的 agent 框架 = 换一个实现，调用方通过本接口访问不感知差异。
export interface EnginePort {
  /** 确保引擎在跑；失败返回原因串，成功 undefined */
  ensureHarness(): Promise<string | undefined>
  /** 重启引擎（关闭旧子进程后重新拉起；失败返回诊断串） */
  restartHarness(): Promise<string | undefined>
  /** 低阶驱动一轮（发提示并泵取事件直到回合结束；isAborted＝外部取消信号，为 true 立即收尾；
   * maxTokens＝本轮输出预算（仅首次创建该会话的 agent 时生效，dsh 会话懒创建；undefined＝SDK 全局档 12288） */
  driveSession(sid: string, text: string, opts?: { onEvent?: (n: DriveEvent) => void; maxMs?: number; isAborted?: () => boolean; maxTokens?: number }): Promise<string>
  /** 真中断：请求引擎立即取消指定会话的活动轮次（SDK 无公开中断口，走 session/cancel 补丁；未就绪时静默返回 false） */
  cancelTurn(sessionId: string): Promise<boolean>
  /** 关闭引擎（应用退出时） */
  closeHarness(): Promise<void>
  /** 拿到（或创建）一个会话句柄 */
  sessionHandle(key: string): Promise<unknown>
  /** 引擎是否已在跑 */
  isRuntimeCreated(): boolean
  /** 用户问答回灌目录 */
  answerDir(): string
  chatSessionId(projectId: string): string
  syncSessionId(projectId: string): string
}

export interface DriveEvent {
  method: string
  params: Record<string, any>
}

/** 运行时根目录（**只读**引擎树）：dev=<appPath>/dsh-runtime；打包后=dsh-runtime 在 extraResources（resourcesPath），asar 内不可 spawn。
 * 注意：这里只放不可变运行时（node_modules / sdk bin / dshhome 模板），**不要往这里写任何东西**——见 writableRoot。 */
function runtimeDir(): string {
  if (process.env.ZHJUAN_DSH_RUNTIME) return process.env.ZHJUAN_DSH_RUNTIME
  if (app.isPackaged) return resolve(process.resourcesPath, 'dsh-runtime')
  return resolve(app.getAppPath(), 'dsh-runtime')
}

/** 可写根（2026-10-27 迁移）：打包后＝userData，把引擎的可变状态搬出 .app。
 * 旧实现把 DSH_HOME（引擎会话/设置）与 run/（LLM、工具 override patch）都写在 resources/dsh-runtime 内：
 *  ① 首启写入破坏 .app 的签名封条（打出的包 CodeResources 有 3 万条来自 dsh-runtime）；
 *  ② /Applications 非属主时写入直接 EACCES。
 * dev 保持引擎树内（探针脚本、dsh-boot-check、既有 run/ 路径全部沿用，行为零变化；
 * ZHJUAN_DSH_RUNTIME 也在 dev 下生效，因为 runtimeDir 已尊重它）。 */
function writableRoot(): string {
  if (!app.isPackaged) return runtimeDir()
  return app.getPath('userData')
}

/** DSH_HOME 基础层复制清单（模板＝<runtimeDir>/dshhome，随包只带不可变部分）：
 * settings.yaml + profiles/{sdk,headless}（dsh --profile sdk 读 DSH_HOME/profiles/sdk）。
 * sessions/ 与 profiles/node_modules* 不属基础层：前者机器相关（旧安装升级时另作可选层搬一次），
 * 后者是构建机的绝对 symlink（打包已排，引擎会自行重建）。 */
const DSH_BASE_ENTRIES = ['settings.yaml', 'profiles/sdk', 'profiles/headless']
/** 可选层（有就带上、失败不影响基础层）：profiles/node_modules（模板里通常是 symlink）
 * 与 sessions（把旧安装写在 .app 内的引擎会话历史搬到 userData，避免升级后上下文断档）。 */
const DSH_OPTIONAL_ENTRIES = ['profiles/node_modules', 'sessions']

export interface HomeBootstrap {
  /** 生效的 DSH_HOME（引擎进程实际使用的目录） */
  home: string
  /** 可写根（run/ 与 dshhome 的父目录） */
  root: string
  /** 是否刚从只读模板复制过基础层（首启） */
  copied: boolean
  /** 回退/降级说明（诊断用；正常/已就位时为空） */
  note?: string
}

let homeBootstrap: HomeBootstrap | null = null
let bootWarned = false

/** 确保 DSH_HOME 在可写根就位（首启从只读模板复制基础层），返回生效路径。
 * 幂等、缓存；**失败一律回退旧路径**（引擎可用性优先于签名洁净），回退原因写进 note，
 * 由 startFailureDiag 一并展示。复制经 staging 目录 + rename：避免半成品 dshhome 让下次启动误判「已就位」。 */
export function ensureWritableHome(): HomeBootstrap {
  if (homeBootstrap) return homeBootstrap
  const root = writableRoot()
  const template = join(runtimeDir(), 'dshhome')
  const home = join(root, 'dshhome')
  // dev（或 ZHJUAN_DSH_RUNTIME 指向的树）：可写根就是引擎树，DSH_HOME 天然可写＝老路径
  if (root === runtimeDir()) {
    try {
      mkdirSync(home, { recursive: true })
      homeBootstrap = { home, root, copied: false }
    } catch (e: any) {
      homeBootstrap = { home, root, copied: false, note: `DSH_HOME 目录不可写（${String(e?.message || e).slice(0, 100)}）` }
    }
    return homeBootstrap
  }
  // 已就位（含上次首启复制成功 / 老用户升级前就存在）
  if (existsSync(home)) {
    homeBootstrap = { home, root, copied: false }
    return homeBootstrap
  }
  try {
    if (!existsSync(template)) throw new Error(`运行时模板缺失：${template}`)
    const staging = `${home}.boot-${process.pid}`
    rmSync(staging, { recursive: true, force: true })
    mkdirSync(staging, { recursive: true })
    let n = 0
    for (const rel of DSH_BASE_ENTRIES) {
      const src = join(template, rel)
      if (!existsSync(src)) continue
      cpSync(src, join(staging, rel), { recursive: true, force: true, preserveTimestamps: true })
      n++
    }
    if (!n) throw new Error('模板里没有 settings.yaml / profiles，基础层为空')
    for (const rel of DSH_OPTIONAL_ENTRIES) {
      const src = join(template, rel)
      if (!existsSync(src)) continue
      try {
        cpSync(src, join(staging, rel), { recursive: true, force: true, preserveTimestamps: true })
      } catch {
        /* 可选层：node_modules 的坏 symlink / 会话历史过大都只降级，不影响引擎启动 */
      }
    }
    try {
      renameSync(staging, home)
    } catch (e) {
      // 并发（另一实例/上次残留）已就位：以现存目录为准，别把自己的 staging 留在用户目录里
      rmSync(staging, { recursive: true, force: true })
      if (!existsSync(home)) throw e
    }
    homeBootstrap = { home, root, copied: true }
    return homeBootstrap
  } catch (e: any) {
    const why = String(e?.message || e).slice(0, 140)
    homeBootstrap = {
      home: template,
      root: runtimeDir(),
      copied: false,
      note: `首启复制 DSH_HOME 失败（${why}）→ 回退引擎树内 DSH_HOME（只读安装时可能 EACCES）`
    }
    return homeBootstrap
  }
}

/** 生效的 DSH_HOME（打包版＝userData/dshhome；dev＝引擎树/dshhome） */
const dshHome = () => ensureWritableHome().home
/** 引擎启动 patch 的落盘目录（用户数据，不在 .app 内） */
const runDir = () => join(ensureWritableHome().root, 'run')
const sdkBin = () => join(runtimeDir(), 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')

/** 用户回答的回灌目录（写作引擎插件轮询这里读答案 JSON） */
export function answerDir(): string {
  return join(app.getPath('userData'), 'agent-answers')
}

// 动态加载 SDK client（从 dsh-runtime 的依赖树读，主库零新依赖）。
// 注意：dsh-sdk-client 是 ESM-only（package type: module），主进程是 CJS，必须用动态 import() 加载；
// 用 require() 会抛 “require() of ES modules”（2026-09-04 修复）。
let harnessCtor: any = null
async function loadSdk() {
  if (harnessCtor) return harnessCtor
  const req = createRequire(join(runtimeDir(), 'package.json'))
  const entry = req.resolve('@deepseek-ai/dsh-sdk-client')
  const mod = (await import(pathToFileURL(entry).href)) as any
  harnessCtor = mod.DeepSeekHarness
  if (!harnessCtor) throw new Error('SDK 客户端未找到 DeepSeekHarness 导出')
  return harnessCtor
}

/** 写作引擎是否已创建（用于设置变更时重启）；崩溃的子进程算「没跑」（2026-10-27） */
export function isRuntimeCreated() {
  return !!harness && harnessAlive(harness)
}

export interface RuntimeInfo {
  online: boolean
  dirty: boolean
  message?: string
}

let harness: any = null // DeepSeekHarness 实例
let bootArgs = { provider: '', model: '' }
let failCount = 0
let lastFailAt = 0 // 上次启动失败的时刻（退避用）
let lastFailMsg = '' // 上次启动失败原因（退避期诊断里回显）
/** 引擎子进程最近一次非主动退出（崩溃）记录：设置页/状态点据此说明「不是没起过，是挂了」 */
let lastExit: { code: number | null; signal: string | null; at: number } | null = null

/** 引擎启动超时（2026-10-27 鲁棒性）：SDK 的 start() 没有超时参数，握手挂住时 ensureHarness 永久悬挂
 * （打包机用 Electron 当 node 时实测干等过）。超时即回收子进程并返回诊断，不再让调用方无限等。 */
const START_TIMEOUT_MS = 45_000
/** 连续失败后的最短重试间隔（按 failCount 取档，越界取末档）：0 → 5s → 15s → 30s。
 * 起因：EngineBadge/agent:status 每 20s 轮询，引擎起不来时旧实现每次都全量 spawn（起进程风暴）。 */
const RETRY_BACKOFF_MS = [0, 5_000, 15_000, 30_000]

/** 连续失败 fails 次后要求的最短重试间隔 */
function retryBackoffMs(fails: number): number {
  if (fails <= 0) return 0
  return RETRY_BACKOFF_MS[Math.min(fails, RETRY_BACKOFF_MS.length - 1)]
}

/** 取引擎子进程句柄（node ChildProcess）。
 * 依据：dsh-sdk-client 的 `DeepSeekHarness.client` 是公开 getter → `HarnessClient`；其 `child` 字段
 * 在类型声明里是 `private child`（lib/types/client.d.ts），但运行时只是普通实例属性
 * （lib/index.js `HarnessClient.start()`：`const child = spawn(...); this.child = child;`），
 * 因此可读；SDK 没有公开的 exit 事件/存活查询口（`exitCode` 同样是 private），故走 `any` 取。 */
function engineChild(h: any): any {
  try {
    return h?.client?.child ?? null
  } catch {
    return null
  }
}

/** 句柄是否真的活着：子进程已退出（exitCode/signalCode 落定）即死。
 * 拿不到子进程句柄时按「活」处理，交给 RPC 自己报 TransportClosedError。 */
function harnessAlive(h: any): boolean {
  if (!h) return false
  const child = engineChild(h)
  if (!child) return true
  if (child.exitCode !== null && child.exitCode !== undefined) return false
  if (child.signalCode) return false
  return true
}

/** 子进程退出 → 立即置 harness=null，让 agent:status 立刻报离线（旧实现只判句柄非空，崩溃后永远绿灯）。
 * 限制：SDK 未公开 exit 事件，这里直接挂 node ChildProcess 的 'exit'；若日后 SDK 不再暴露 child，
 * 由 ensureHarness 开头的 harnessAlive 探活兜底（每次调用都会检查，功能等价、只是响应延迟一次调用）。 */
function watchEngineExit(h: any) {
  const child = engineChild(h)
  if (!child || typeof child.once !== 'function') return
  child.once('exit', (code: number | null, signal: string | null) => {
    if (harness !== h) return // 已被 closeHarness/restart 主动替换：不要覆盖新实例
    harness = null
    lastExit = { code: code ?? null, signal: signal ?? null, at: Date.now() }
  })
}

/** 带超时的启动：race 只是放弃等待，start() 自身仍会落定——挂 .catch 防 unhandledRejection；
 * 超时后 ensureHarness 的 catch 会 close 句柄，走 SDK 的 EOF→SIGTERM→SIGKILL 阶梯真收掉子进程。 */
async function startWithTimeout(h: any, ms = START_TIMEOUT_MS): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const started: Promise<void> = Promise.resolve().then(() => h.start())
  started.catch(() => {})
  try {
    await Promise.race([
      started,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`引擎启动超时（${Math.round(ms / 1000)}s）`)), ms)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** 结构化启动诊断（恒 6 行；设置页原样展示可复制）。启动链路任一步（加载 SDK / 可写性 / patch 生成）
 * 失败都走这里，不再 throw 到 IPC 边界。 */
function startFailureDiag(msg: string, launchCmd = ''): string {
  let dir = ''
  let home = ''
  let homeNote = ''
  let sdkPath = ''
  try {
    dir = runtimeDir()
    // 首启迁移：DSH_HOME 应在可写根（userData）；失败回退时 note 会说明原因
    const boot = ensureWritableHome()
    home = boot.home
    homeNote = boot.note
      ? `（降级：${boot.note}）`
      : boot.home === join(runtimeDir(), 'dshhome')
        ? '（引擎树内 · dev）'
        : '（用户数据目录 · .app 外，可写）'
    sdkPath = sdkBin()
  } catch {}
  let sdkOk = false
  try {
    sdkOk = !!sdkPath && existsSync(sdkPath)
  } catch {}
  let providerLine = '服务商：（设置读取失败）'
  try {
    const cfg = activeProvider(getSettings())
    providerLine = `服务商：${cfg.preset.name} · ${cfg.model}`
  } catch {}
  const usingElectron = !!launchCmd && launchCmd === process.execPath
  return [
    `写作引擎启动失败：${String(msg).slice(0, 200)}`,
    `node：${launchCmd || '（未解析到宿主 node）'}${usingElectron ? '（Electron 兜底 ELECTRON_RUN_AS_NODE）' : ''}`,
    `SDK 入口：${sdkOk ? '存在' : '缺失 → ' + (sdkPath || sdkBin())}`,
    `运行时目录（只读）：${dir}`,
    `DSH_HOME：${home}${homeNote}`,
    providerLine
  ].join('\n')
}

/** 按当前活跃的模型厂商生成动态 patch（默认本地也会写，幂等，一次路径）；返回需追加的 --patch 参数 */
function llmOverrideArgs(): string[] {
  const cfg = activeProvider(getSettings())
  const run = runDir() // 用户数据（打包版＝userData/run）；旧实现写在 .app 内，破坏签名
  mkdirSync(run, { recursive: true })
  const patch = join(run, 'llm.override.patch.yml')
  const body = buildLlmOverrideYml(cfg)
  let cur = ''
  try { cur = readFileSync(patch, 'utf-8') } catch {}
  if (cur !== body) writeFileAtomic(patch, body)
  return ['--patch', patch]
}

/** 按设置的常用工具开关生成工具 override（只含要关的项；全开时无文件无参数） */
function toolsOverrideArgs(): string[] {
  const t = getSettings().agentTools ?? {}
  const rows: string[] = []
  if (t.todo === false) rows.push('- id: tool-todo\n  disabled: true\n')
  if (t.askUser === false) rows.push('- id: tool-ask-user\n  disabled: true\n')
  if (!rows.length) return []
  const run = runDir()
  mkdirSync(run, { recursive: true })
  const patch = join(run, 'tools.override.patch.yml')
  const body = rows.join('')
  let cur = ''
  try { cur = readFileSync(patch, 'utf-8') } catch {}
  if (cur !== body) writeFileAtomic(patch, body)
  return ['--patch', patch]
}

/**
 * Windows 上系统 node 的候选绝对路径（纯路径拼接，无 fs 无 electron——单测锁定拼接与优先级）。
 * 顺序=优先级：nvm（%APPDATA%\nvm\versions\node\<v>\node.exe，versions 由调用方按优先级传入）→
 * Program Files 两位。mac/linux 不走这里（unix 探测见 nodeBin）。
 */
export function winNodeBinCandidateList(env: NodeJS.ProcessEnv, home: string, versions: string[]): string[] {
  // 恒用 win32.join：这是「win 平台路径」的纯拼接，与 relpath.ts posixRel 同思路——
  // 任何平台跑都产出反斜杠（单测可锁定），不随宿主 platform 变。
  const nvmRoot = win32.join(env.APPDATA || home, 'nvm', 'versions', 'node')
  return [
    ...versions.map((v) => win32.join(nvmRoot, v, 'node.exe')),
    'C:\\Program Files\\nodejs\\node.exe',
    'C:\\Program Files (x86)\\nodejs\\node.exe'
  ]
}

/** 引擎子进程的宿主可执行：优先用上真正的 node——别用 Electron 当 node，它在此环境会吞子进程输出、
 * 让 SDK 握手干等到超时（2026-09 实测）。探测顺序（unix）：PATH 的 node（dev 下即 nvm）→ 常见位置 → nvm
 * 最新版本 → electron 兜底；win：where node → nvm + Program Files（winNodeBinCandidateList）→ electron 兜底。 */
function nodeBin(): string {
  if (process.platform === 'win32') {
    try {
      execFileSync('where', ['node'], { stdio: 'ignore' })
      return 'node' // spawn 会沿 PATH 找到
    } catch {}
    let versions: string[] = []
    try {
      versions = readdirSync(join(process.env.APPDATA || homedir(), 'nvm', 'versions', 'node')).sort()
    } catch {}
    for (const c of winNodeBinCandidateList(process.env, homedir(), versions)) {
      if (existsSync(c)) return c
    }
    return process.execPath
  }
  try {
    execFileSync('which', ['node'], { stdio: 'ignore' })
    return 'node' // spawn 会沿 PATH 找到（含 dev 的 nvm）
  } catch {}
  for (const c of ['/usr/local/bin/node', '/opt/homebrew/bin/node', '/usr/bin/node']) {
    if (existsSync(c)) return c
  }
  try {
    const nvmDir = join(homedir(), '.nvm', 'versions', 'node')
    const vs = readdirSync(nvmDir).sort()
    for (let i = vs.length - 1; i >= 0; i--) {
      const p = join(nvmDir, vs[i], 'bin', 'node')
      if (existsSync(p)) return p
    }
  } catch {}
  return process.execPath
}

/** 确保写作引擎在跑；失败返回结构化诊断串（6 行），成功返回 undefined。
 * 2026-10-27 鲁棒性：①整链包 try（加载 SDK / patch 生成 / spawn / 握手 任一步失败都返诊断，不 throw）；
 * ②启动 45s 超时；③句柄非空 ≠ 活着（探活 + exit 监听）；④连续失败退避（限流轮询触发的重复 spawn）。 */
export async function ensureHarness(): Promise<string | undefined> {
  // 崩溃（子进程退出）后 harness 已由 watchEngineExit 置空；这里再兜一层，防 SDK 不暴露 child 的降级路径
  if (harness && !harnessAlive(harness)) {
    harness = null
    lastExit = lastExit ?? { code: null, signal: null, at: Date.now() }
  }
  if (harness) return undefined
  // 退避：短时间内的重复探测（EngineBadge 每 20s、agent:status）不再全量 spawn
  const sinceFail = Date.now() - lastFailAt
  const wait = retryBackoffMs(failCount)
  if (failCount > 0 && sinceFail < wait) {
    const again = Math.max(1, Math.ceil((wait - sinceFail) / 1000))
    return startFailureDiag(
      `连续启动失败 ${failCount} 次，${again}s 后可重试（退避中，未再次启动）` + (lastFailMsg ? `；上次原因：${lastFailMsg}` : '')
    )
  }
  let launchCmd = ''
  try {
    // 首启迁移（2026-10-27）：DSH_HOME 基础层从只读运行时模板复制到可写根（打包版＝userData）。
    // 失败不 throw：ensureWritableHome 内部已回退引擎树内旧路径，原因写进诊断串。
    const boot = ensureWritableHome()
    if (boot.note && !bootWarned) {
      bootWarned = true
      console.warn('[runtime] ' + boot.note)
    }
    const Sdk = await loadSdk()
    const cfg = activeProvider(getSettings())
    // key 优先级：设置里填的 → 宿主环境已有 → 本地给占位 'local'
    const apiKey = cfg.apiKey || process.env[cfg.apiKeyEnv] || (cfg.preset.kind === 'local' ? 'local' : '')
    const launch: any = {
      command: nodeBin(),
      args: [sdkBin(), '--profile', 'sdk', ...llmOverrideArgs(), ...toolsOverrideArgs()],
      cwd: runtimeDir(),
      requestTimeoutMs: 1_200_000
    }
    launchCmd = launch.command
    // 子进程环境：父环境 + DSH_HOME + 当前厂商 key（按 apiKeyEnv 注入）+ 用户问答回灌目录（env 传对象会整体替换父环境）
    launch.env = {
      ...process.env,
      DSH_HOME: dshHome(),
      [cfg.apiKeyEnv]: String(apiKey),
      ZJ_USER_ANSWER_DIR: answerDir(),
      // 打包机无系统 node：兜底 Electron 自身当 node（官方 ELECTRON_RUN_AS_NODE 纯 Node 模式，
      // 与旧「Electron 当 node 吞输出」问题不同，2026-09-12 发布冲刺实测项）
      ...(launch.command === process.execPath ? { ELECTRON_RUN_AS_NODE: '1' } : {})
    }
    // maxTokens 输出预算（2026-09-19 智能层）：8192→12288——deep-pass 全卷巡查（audit/perspectives，
    // 15min 档、8.5 万字符材料包）实证：模型逐章对照推理耗光 8192（含 reasoning），最终 turn 无 text
    // 输出=报告恒空（items=[]），真模型三次复现；12288 留出 JSON 正文空间；runChat 8min 档不受影响
    // （输出上限变大仅当模型真的生成超过 8192 时才体现，成本增益可控）。
    const h: any = new Sdk({ launch, provider: cfg.route, model: cfg.model, maxTokens: 12288 })
    harness = h
    await startWithTimeout(h)
    watchEngineExit(h) // 起成功后挂 exit：崩溃即置空，agent:status 立刻转 offline
    bootArgs = { provider: cfg.route, model: cfg.model }
    failCount = 0
    lastFailAt = 0
    lastFailMsg = ''
    return undefined
  } catch (e: any) {
    lastFailMsg = String(e?.message || e)
    try { await harness?.close() } catch {} // 超时/握手失败：走 SDK 阶梯真收掉子进程
    harness = null
    failCount += 1
    lastFailAt = Date.now()
    return startFailureDiag(lastFailMsg, launchCmd)
  }
}

/** 重启写作引擎（2026-10-27）：关闭旧句柄 → 清失败计数/退避 → 重新拉起。设置页「重启引擎」用；
 * 返回 undefined=成功，否则与 ensureHarness 同格式的诊断串。 */
export async function restartHarness(): Promise<string | undefined> {
  await closeHarness()
  failCount = 0
  lastFailAt = 0
  lastFailMsg = ''
  lastExit = null
  return ensureHarness()
}

/** 引擎运行时状态（设置页/状态点判断用）：running=真的活着；lastExit=最近一次崩溃 */
export function runtimeState(): { running: boolean; lastExit: { code: number | null; signal: string | null; at: number } | null } {
  return { running: !!harness && harnessAlive(harness), lastExit }
}

// 拿到（或创建）一个会话句柄
async function sessionHandle(key: string) {
  const err = await ensureHarness()
  if (err) throw new Error(err)
  return harness.session(key)
}

/** 低阶驱动一轮：发 prompt 并用订阅泵取事件，直到本轮 turn 结束（含历史回放也会被正确跳过）。
 * isAborted：外部取消信号（如用户点停止）——每次事件后检查，为 true 立即收尾（不等待侧引擎收尾事件）。
 * maxTokens（2026-09-19 智能层）：本轮输出预算——dsh 会话懒创建于首次 prompt，这里用低阶
 * session/prompt 携带 maxTokens；server 侧 per-agent 应用（vendored 补丁 patch-server-maxtokens）。
 * 不携带时 = SDK 全局档（initialize 12288），runChat/runSync 等既有调用零行为变化。
 * reasoningEffort（2026-09-20 智能层）：本轮思考档位（'off'|'low'|'high'|'max'）——session/prompt 携带，
 * server 侧经 createSession 的 setup 安装模型选择（vendored 补丁 patch-server-reasoning；dsh-headless 同款
 * 公开模式）；不携带 = 模型默认档（不传参），既有调用零行为变化。 */
export async function driveSession(
  sid: string,
  text: string,
  opts?: { onEvent?: (n: DriveEvent) => void; maxMs?: number; isAborted?: () => boolean; maxTokens?: number; reasoningEffort?: string }
): Promise<string> {
  const err = await ensureHarness()
  if (err) throw new Error(err)
  const client = harness.client
  const sub = client.subscribeSessionTree(sid)
  let acc = ''
  let stage: 'awaiting-prompt' | 'in-turn' | 'done' = 'awaiting-prompt'
  let finished = false
  let timedOut = false
  let timeoutMsg = ''
  // 超时必须由独立时钟驱动（2026-09-14）：事件泵在引擎静默时（无任何通知）for await 不迭代，
  // 旧实现把 deadline 检查放在事件分支，静默时 maxMs 永不触发（driveSession 永久悬挂）。
  // 到点后：① 真取消引擎侧轮次（cancelTurn——SDK 无公开中断口，走 session/cancel 补丁；失败降级）；
  // ② 关闭订阅唤醒挂起的 next()（close 会 reject 全部 waiter），catch 里统一翻成超时文案。
  const guard = setTimeout(() => {
    if (finished) return
    timedOut = true
    void (async () => {
      const cancelled = await cancelTurn(sid).catch(() => false)
      timeoutMsg = cancelled
        ? '写作引擎驱动超时（已中止引擎本轮）'
        : '写作引擎驱动超时（引擎侧未能中止，任务可能仍在后台运行）'
      if (!finished) {
        try { sub.close() } catch {}
      }
    })()
  }, Math.max(1, opts?.maxMs ?? 10 * 60 * 1000))
  try {
    // 低阶 session/prompt（2026-09-19）：SDK 高层 prompt() 不带 maxTokens；低阶口可附
    // per-session 输出预算（与 cancelTurn 同法；server 端 vendored 补丁应用）。
    await client.request('session/prompt', {
      sessionId: sid,
      contentBlocks: [{ type: 'text', text }],
      ...(opts?.maxTokens !== undefined ? { maxTokens: opts.maxTokens } : {}),
      ...(opts?.reasoningEffort !== undefined ? { reasoningEffort: opts.reasoningEffort } : {})
    })
    for await (const n of sub) {
      opts?.onEvent?.(n)
      if (opts?.isAborted?.()) break // 外部已取消：尽快收尾（awaiting-prompt 阶段引擎可能已清队列、不再发事件）
      if (n.method !== 'session.event') {
        if (n.method === 'session.status' && n.params?.sessionId === sid && n.params?.status === 'idle' && stage === 'done') break
        continue
      }
      const ev = n.params?.event as any
      const t = ev?.type
      if (t === 'turn/start' && stage === 'awaiting-prompt') stage = 'in-turn'
      else if (t === 'assistant/chunk') {
        const c = ev.data?.chunk
        if (c?.type === 'text-delta') acc += c.text
        else if (c?.type === 'block-end' && c.block?.type === 'text') acc = c.block.text // block-end 带整块权威全文
      } else if (t === 'turn/end') {
        if (stage === 'in-turn') stage = 'done'
      }
    }
  } catch (e: any) {
    if (timedOut) {
      // 等取消结果落定（RPC 毫秒级；竞态窗口极小）再抛统一文案——调用方（runSubtask/runSync/runChat）
      // 的错误提示必须让用户知道引擎侧是否已中止，不能裸抛 "notification subscription closed"。
      for (let i = 0; i < 50 && !timeoutMsg; i++) await new Promise((r) => setTimeout(r, 50))
      throw new Error(timeoutMsg || '写作引擎驱动超时（引擎侧中止状态未知）')
    }
    throw e
  } finally {
    finished = true
    clearTimeout(guard)
    try { sub.close() } catch {}
  }
  return acc
}


/** 常驻会话 id */
export const chatSessionId = (projectId: string) => `zj-chat-${projectId}`
export const syncSessionId = (projectId: string) => `zj-sync-${projectId}`

/** 真中断（2026-09-14）：请写作引擎立即取消指定会话的活动轮次，不再等模型跑完。
 * 实现：harness.client.request('session/cancel') —— 低阶口公开；server 侧需要 vendored 补丁
 * （dsh-runtime/scripts/patch-server-cancel.mjs，install.sh 自动重放）。SDK 无公开中断口
 * （HarnessClient 注释明言无 wire-level cancel），未开机时静默降级（返回 false，调用方按展示性取消兜底）。 */
export async function cancelTurn(sessionId: string): Promise<boolean> {
  const err = await ensureHarness()
  if (err) return false
  const client = (harness as any)?.client
  if (!client?.request) return false
  try {
    const res = (await client.request('session/cancel', { sessionId })) as any
    return !!res?.cancelled
  } catch {
    return false
  }
}

/** 关闭写作引擎（应用退出时） */
export async function closeHarness() {
  if (!harness) return
  const h = harness
  harness = null
  try { await h.close() } catch {}
}

export { sessionHandle, runtimeDir, dshHome, runDir, writableRoot }

/** E2：以 EnginePort 形式暴露当前 dsh 实现（调用方走接口；以后换引擎 = 换这个单例的实现） */
export const engine: EnginePort = {
  ensureHarness,
  restartHarness,
  driveSession,
  cancelTurn,
  closeHarness,
  sessionHandle,
  isRuntimeCreated,
  answerDir,
  chatSessionId,
  syncSessionId
}
