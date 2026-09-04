// ===== 织卷 · dsh 写作引擎运行时管理（主进程） =====
// 定位 dsh-runtime（vendored 引擎）、懒启动 SDK 写作引擎、按设置动态覆写 LLM 端点、会话管理。
import { app } from 'electron'
import { createRequire } from 'module'
import { execFileSync } from 'child_process'
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'fs'
import { resolve, dirname, join } from 'path'
import { homedir } from 'os'
import { pathToFileURL } from 'url'
import { getSettings } from '../settings'
import { activeProvider, buildLlmOverrideYml } from '../../shared/providers'

// ===== 织卷对“写作引擎”的薄接口（模块设计 §14之 / 评审 E2）=====
// 现状实现是 dsh（runtime 下面所有函数）；以后实验别的 agent 框架 = 换一个实现，调用方通过本接口访问不感知差异。
export interface EnginePort {
  /** 确保引擎在跑；失败返回原因串，成功 undefined */
  ensureHarness(): Promise<string | undefined>
  /** 低阶驱动一轮（发提示并泵取事件直到回合结束） */
  driveSession(sid: string, text: string, opts?: { onEvent?: (n: DriveEvent) => void; maxMs?: number }): Promise<string>
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

/** 运行时根目录：默认 <appPath>/dsh-runtime（env 可覆盖，便于无头测试指向临时副本） */
function runtimeDir(): string {
  if (process.env.ZHJUAN_DSH_RUNTIME) return process.env.ZHJUAN_DSH_RUNTIME
  return resolve(app.getAppPath(), 'dsh-runtime')
}

const dshHome = () => join(runtimeDir(), 'dshhome')
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

/** 写作引擎是否已创建（用于设置变更时重启） */
export function isRuntimeCreated() {
  return !!harness
}

export interface RuntimeInfo {
  online: boolean
  dirty: boolean
  message?: string
}

let harness: any = null // DeepSeekHarness 实例
let bootArgs = { provider: '', model: '' }
let failCount = 0

/** 按当前活跃的模型厂商生成动态 patch（默认本地也会写，幂等，一次路径）；返回需追加的 --patch 参数 */
function llmOverrideArgs(): string[] {
  const cfg = activeProvider(getSettings())
  const run = join(runtimeDir(), 'run')
  mkdirSync(run, { recursive: true })
  const patch = join(run, 'llm.override.patch.yml')
  const body = buildLlmOverrideYml(cfg)
  let cur = ''
  try { cur = readFileSync(patch, 'utf-8') } catch {}
  if (cur !== body) writeFileSync(patch, body, 'utf-8')
  return ['--patch', patch]
}

/** 按设置的常用工具开关生成工具 override（只含要关的项；全开时无文件无参数） */
function toolsOverrideArgs(): string[] {
  const t = getSettings().agentTools ?? {}
  const rows: string[] = []
  if (t.todo === false) rows.push('- id: tool-todo\n  disabled: true\n')
  if (t.askUser === false) rows.push('- id: tool-ask-user\n  disabled: true\n')
  if (!rows.length) return []
  const run = join(runtimeDir(), 'run')
  mkdirSync(run, { recursive: true })
  const patch = join(run, 'tools.override.patch.yml')
  const body = rows.join('')
  let cur = ''
  try { cur = readFileSync(patch, 'utf-8') } catch {}
  if (cur !== body) writeFileSync(patch, body, 'utf-8')
  return ['--patch', patch]
}

/** 引擎子进程的宿主可执行：优先用上真正的 node——别用 Electron 当 node，它在此环境会吞子进程输出、
 * 让 SDK 握手干等到超时（2026-09 实测）。探测顺序：PATH 的 node（dev 下即 nvm）→ 常见位置 → nvm
 * 最新版本 → electron 兜底。 */
function nodeBin(): string {
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

/** 确保写作引擎在跑；失败返回原因字符串，成功返回 undefined */
export async function ensureHarness(): Promise<string | undefined> {
  if (harness) return undefined
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
  // 子进程环境：父环境 + DSH_HOME + 当前厂商 key（按 apiKeyEnv 注入）+ 用户问答回灌目录（env 传对象会整体替换父环境）
  launch.env = {
    ...process.env,
    DSH_HOME: dshHome(),
    [cfg.apiKeyEnv]: String(apiKey),
    ZJ_USER_ANSWER_DIR: answerDir()
  }
  try {
    harness = new Sdk({ launch, provider: cfg.route, model: cfg.model, maxTokens: 8192 })
    await harness.start()
    bootArgs = { provider: cfg.route, model: cfg.model }
    failCount = 0
    return undefined
  } catch (e: any) {
    const msg = String(e?.message || e)
    try { await harness?.close() } catch {}
    harness = null
    failCount += 1
    return `写作引擎启动失败（${msg.slice(0, 200)}）`
  }
}

// 拿到（或创建）一个会话句柄
async function sessionHandle(key: string) {
  const err = await ensureHarness()
  if (err) throw new Error(err)
  return harness.session(key)
}

/** 低阶驱动一轮：发 prompt 并用订阅泵取事件，直到本轮 turn 结束（含历史回放也会被正确跳过）。 */

export async function driveSession(
  sid: string,
  text: string,
  opts?: { onEvent?: (n: DriveEvent) => void; maxMs?: number }
): Promise<string> {
  const err = await ensureHarness()
  if (err) throw new Error(err)
  const client = harness.client
  const sub = client.subscribeSessionTree(sid)
  let acc = ''
  let stage: 'awaiting-prompt' | 'in-turn' | 'done' = 'awaiting-prompt'
  const deadline = Date.now() + (opts?.maxMs ?? 10 * 60 * 1000)
  try {
    await client.prompt(sid, [{ type: 'text', text }])
    for await (const n of sub) {
      if (Date.now() > deadline) throw new Error('写作引擎驱动超时')
      opts?.onEvent?.(n)
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
  } finally {
    try { sub.close() } catch {}
  }
  return acc
}


/** 常驻会话 id */
export const chatSessionId = (projectId: string) => `zj-chat-${projectId}`
export const syncSessionId = (projectId: string) => `zj-sync-${projectId}`

/** 关闭写作引擎（应用退出时） */
export async function closeHarness() {
  if (!harness) return
  const h = harness
  harness = null
  try { await h.close() } catch {}
}

export { sessionHandle, runtimeDir, dshHome }

/** E2：以 EnginePort 形式暴露当前 dsh 实现（调用方走接口；以后换引擎 = 换这个单例的实现） */
export const engine: EnginePort = {
  ensureHarness,
  driveSession,
  closeHarness,
  sessionHandle,
  isRuntimeCreated,
  answerDir,
  chatSessionId,
  syncSessionId
}
