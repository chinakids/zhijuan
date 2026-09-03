// ===== 织卷 · dsh 边车运行时管理（主进程） =====
// 定位 dsh-runtime（vendored 引擎）、懒启动 SDK 边车、按设置动态覆写 LLM 端点、会话管理。
import { app } from 'electron'
import { createRequire } from 'module'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { resolve, dirname, join } from 'path'
import { getSettings } from '../store'

// 运行时根目录：默认 <appPath>/dsh-runtime（env 可覆盖，便于无头测试指向临时副本）
function runtimeDir(): string {
  if (process.env.ZHJUAN_DSH_RUNTIME) return process.env.ZHJUAN_DSH_RUNTIME
  return resolve(app.getAppPath(), 'dsh-runtime')
}

const dshHome = () => join(runtimeDir(), 'dshhome')
const sdkBin = () => join(runtimeDir(), 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')

// 动态加载 SDK client（从 dsh-runtime 的依赖树读，主库零新依赖）
let harnessCtor: any = null
function loadSdk() {
  if (harnessCtor) return harnessCtor
  const req = createRequire(join(runtimeDir(), 'package.json'))
  const mod = req('@deepseek-ai/dsh-sdk-client')
  harnessCtor = mod.DeepSeekHarness
  return harnessCtor
}

/** 边车是否已创建（用于设置变更时重启） */
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

const LLM_DEFAULTS = { baseUrl: 'http://127.0.0.1:8888', model: 'deepseek-v4-flash-0731' }

/** 按当前设置的 LLM 端点生成动态 patch（与默认不同才写盘）；返回需追加的 --patch 参数 */
function llmOverrideArgs(): string[] {
  const s = getSettings()
  const llm = s.llm ?? ({} as any)
  const baseUrl = (llm.baseUrl || LLM_DEFAULTS.baseUrl).replace(/\/+$/, '')
  const model = llm.model || LLM_DEFAULTS.model
  if (baseUrl === LLM_DEFAULTS.baseUrl && model === LLM_DEFAULTS.model) return []
  const run = join(runtimeDir(), 'run')
  mkdirSync(run, { recursive: true })
  const patch = join(run, 'llm.override.patch.yml')
  const body =
    '- id: llm-pi-ai\n' +
    '  config:\n' +
    '    providers:\n' +
    '      local-vllm:\n' +
    '        api: openai-completions\n' +
    `        baseURL: ${baseUrl}/v1\n` +
    '        apiKeyEnv: LOCAL_LLM_KEY\n' +
    '        compat:\n' +
    '          supportsDeveloperRole: false\n' +
    '          maxTokensField: max_tokens\n' +
    '        models:\n' +
    `          - id: ${JSON.stringify(model)}\n` +
    '- id: agent-default-model\n' +
    '  config:\n' +
    '    provider: local-vllm\n' +
    `    model: ${JSON.stringify(model)}\n`
  if (readFileSync(patch, 'utf-8') !== body) writeFileSync(patch, body, 'utf-8')
  return ['--patch', patch]
}

/** 确保边车在跑；失败返回原因字符串，成功返回 undefined */
export async function ensureHarness(): Promise<string | undefined> {
  if (harness) return undefined
  const Sdk = loadSdk()
  const s = getSettings()
  const llm = s.llm ?? ({} as any)
  const provider = 'local-vllm'
  const model = llm.model || LLM_DEFAULTS.model
  const apiKey = process.env.LOCAL_LLM_KEY ?? (llm.apiKey || 'local')
  const launch: any = {
    command: process.execPath,
    args: [sdkBin(), '--profile', 'sdk', ...llmOverrideArgs()],
    cwd: runtimeDir(),
    requestTimeoutMs: 1_200_000
  }
  // 子进程环境：父环境 + DSH_HOME + LLM key（env 传对象会整体替换父环境）
  launch.env = { ...process.env, DSH_HOME: dshHome(), LOCAL_LLM_KEY: String(apiKey) }
  try {
    harness = new Sdk({ launch, provider, model, maxTokens: 8192 })
    await harness.start()
    bootArgs = { provider, model }
    failCount = 0
    return undefined
  } catch (e: any) {
    const msg = String(e?.message || e)
    try { await harness?.close() } catch {}
    harness = null
    failCount += 1
    return `边车启动失败（${msg.slice(0, 200)}）`
  }
}

// 拿到（或创建）一个会话句柄
async function sessionHandle(key: string) {
  const err = await ensureHarness()
  if (err) throw new Error(err)
  return harness.session(key)
}

/** 低阶驱动一轮：发 prompt 并用订阅泵取事件，直到本轮 turn 结束（含历史回放也会被正确跳过）。 */
export interface DriveEvent {
  method: string
  params: Record<string, any>
}

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
      if (Date.now() > deadline) throw new Error('边车驱动超时')
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

/** 关闭边车（应用退出时） */
export async function closeHarness() {
  if (!harness) return
  const h = harness
  harness = null
  try { await h.close() } catch {}
}

export { sessionHandle, runtimeDir, dshHome }
