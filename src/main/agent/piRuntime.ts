// ===== 织卷 · pi 内核运行时（@earendil-works/pi-coding-agent，进程内）=====
// 与 runtime.ts（dsh 子进程）同形的对外接口：ensureHarness / restartHarness / driveSession /
// cancelTurn / closeHarness / sessionHandle / isRuntimeCreated / runtimeState / answerDir。
// 由 runtime.ts 按 AppSettings.engineCore 分发（'pi' 默认 / 'dsh' 回退），调用方（engine.ts、
// subtask.ts、ipc.ts）不感知差异。
//
// 设计要点（Phase 2）：
//   1) 无子进程：ModelRuntime + AgentSession 都在主进程内；「启动」= 解析 pi SDK + 注册当前厂商为
//      pi provider（id 沿用 shared/providers.routeId 的 zj-<厂商>）+ 解析出 model。重启 = dispose 会话 + 重建。
//   2) 动态加载 ESM：pi 是 "type":"module"（>=Node 22.19，Electron 38 已满足）。main 产物是 CJS，
//      故用 createRequire().resolve 找到入口再 import(pathToFileURL(入口))；type-only import 供 tsc。
//      打包后（resources/pi-runtime）与 dev（appPath/node_modules）都走同一解析顺序，可用
//      ZHJUAN_PI_ROOT 覆盖（探针/多版本并存）。
//   3) 模型：activeProvider() 的 baseUrl/apiKey/model/preset.api（'openai-completions' 或
//      'anthropic-messages'，与 pi 的 Api 枚举同名）直接映射成 pi 的 ProviderConfigInput；
//      preset.compat（如本地 vLLM 的 chat_template_kwargs.thinking=false）原样透传，保住「关思考」行为。
//   4) 会话持久化：SessionManager.create(cwd, userData/pi-sessions) —— pi 自己的文件后端（每会话一个
//      jsonl，格式见 pi docs/session-format.md）。织卷每次 runChat/runSync 都用新 sid，因此每次
//      落一个文件；文件清理（保留 N 天）留给平台层，见「未完成」。
//   5) 事件映射：pi 的 AgentEvent → dsh 形态 DriveEvent（method='session.event'，event.type=
//      'assistant/chunk' | 'tool/call' | 'tool/result' | 'turn/start' | 'turn/end' | 'todo/write' |
//      'zj/user-ask'），engine.ts 的 translate() 零改动复用。
import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { pathToFileURL } from 'url'
import { getSettings } from '../settings'
import { activeProvider } from '../../shared/providers'
import { buildPiTools } from './piTools'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { DriveEvent } from './runtime' // type-only：运行时无环

/** pi 全局档输出预算（与 dsh SDK initialize 的 12288 同口径；会话级 maxTokens 目前不支持） */
const PI_MAX_TOKENS = 12_288
/** 上下文窗口声明（只影响 pi 的 compaction 估算，本文件已关 compaction；按常见 128k 保守值） */
const PI_CONTEXT_WINDOW = 128_000
/** 同时保留的会话数（每个 sid 一个 pi 会话；超限按插入序 dispose 最老的） */
const MAX_SESSIONS = 6

/** 织卷内建 system prompt：pi 默认是 coding agent 提示词（read/bash/edit），写作场景需要收敛。
 *  engine.ts 的用户提示已带角色/技能/输出格式，这里只交代工具与路径纪律。 */
const SYSTEM_PROMPT = [
  '你是织卷（长篇小说创作工作台）的写作 agent，用中文工作。',
  '',
  '可用工具：zj_workspace（作品结构）、zj_list_docs（列目录）、zj_read_doc（读文档片段）、',
  'zj_search（全文搜索）、zj_edit_doc（生成正文修改方案，不写盘）、zj_collect_suggest（素材采集建议），',
  '以及（按设置开启的）todo_write、ask_user_question。',
  '',
  '纪律：',
  '1. 一切路径参数 base 都用上下文给出的【作品根目录】/【工作区根目录】绝对路径；文件用相对路径。',
  '2. 改任何文字都走 zj_edit_doc（作者采纳后才写入），不要在回复里贴整篇替换文本。',
  '3. 需要资料先 zj_read_doc/zj_search 取证，别凭记忆编造原文；长文档按返回里的 offset 续读。',
  '4. 只读工具之间可以并行调用；拿到结果后简短说明你做了什么，再给结论。',
  '5. 不要执行 shell 命令，不要创建文件；所有落盘动作交给工具或作者。'
].join('\n')

type PiSdk = any
let sdkCache: { sdk: PiSdk; entry: string } | null = null
let sdkLoading: Promise<{ sdk: PiSdk; entry: string }> | null = null
let modelRuntime: any = null
let modelRef: any = null
let diag: PiDiag = { ok: false }
let lastFailMsg = ''
let lastFailAt = 0

export interface PiDiag {
  ok: boolean
  entry?: string
  agentDir?: string
  sessionDir?: string
  provider?: string
  model?: string
  baseUrl?: string
  api?: string
  thinking?: string
  note?: string
}

interface PiSessionWrap {
  sid: string
  session: any
  sink: ((n: DriveEvent) => void) | null
  thinkingLevel: string
}

const sessions = new Map<string, PiSessionWrap>()

/** 用户问答回灌目录（与 dsh 同目录：主进程 agent:answer 写 <batch>.json；zj-questions 用 env 覆盖） */
export function answerDir(): string {
  if (process.env.ZJ_USER_ANSWER_DIR) return process.env.ZJ_USER_ANSWER_DIR
  return join(app.getPath('userData'), 'agent-answers')
}

export const chatSessionId = (projectId: string) => `zj-chat-${projectId}`
export const syncSessionId = (projectId: string) => `zj-sync-${projectId}`

// ---------- SDK 动态加载 ----------
function piRootCandidates(): string[] {
  const out: string[] = []
  if (process.env.ZHJUAN_PI_ROOT) out.push(process.env.ZHJUAN_PI_ROOT)
  if (app.isPackaged) out.push(join(process.resourcesPath, 'pi-runtime'))
  out.push(app.getAppPath())
  return out
}

/** 定位 pi 包目录：exports 只声明了 import 条件（无 require/default），createRequire().resolve 会报
 *  "No exports main defined"；故按 node_modules 目录向上查找 package.json，再取 exports['.'].import。 */
function findPiPackageJson(root: string): string | null {
  let dir = resolve(root)
  for (let depth = 0; depth < 12; depth++) {
    const cand = join(dir, 'node_modules', '@earendil-works', 'pi-coding-agent', 'package.json')
    if (existsSync(cand)) return cand
    const up = dirname(dir)
    if (up === dir) break
    dir = up
  }
  return null
}

async function loadSdk(): Promise<{ sdk: PiSdk; entry: string }> {
  if (sdkCache) return sdkCache
  if (sdkLoading) return sdkLoading
  sdkLoading = (async () => {
    const errors: string[] = []
    for (const root of piRootCandidates()) {
      try {
        const pkgJson = findPiPackageJson(root)
        if (!pkgJson) throw new Error('未找到 @earendil-works/pi-coding-agent/package.json')
        const pkg = JSON.parse(readFileSync(pkgJson, 'utf-8'))
        const entry =
          (typeof pkg.exports === 'object' ? pkg.exports?.['.']?.import ?? pkg.exports?.['.']?.default : undefined) ??
          pkg.module ??
          pkg.main
        if (typeof entry !== 'string') throw new Error('package.json 未声明 ESM 入口（exports["."].import）')
        const sdk = await import(pathToFileURL(resolve(dirname(pkgJson), entry)).href)
        if (typeof sdk.createAgentSession !== 'function' || typeof sdk.ModelRuntime?.create !== 'function') {
          throw new Error('pi SDK 入口缺少 createAgentSession / ModelRuntime')
        }
        sdkCache = { sdk, entry: resolve(dirname(pkgJson), entry) }
        return sdkCache
      } catch (e: any) {
        errors.push(`${root}: ${String(e?.message ?? e)}`)
      }
    }
    throw new Error('找不到可用的 pi SDK（' + errors.join(' | ') + '）')
  })()
  try {
    return await sdkLoading
  } finally {
    sdkLoading = null
  }
}

// ---------- 模型注册 ----------
function agentDir(): string {
  return join(app.getPath('userData'), 'pi-agent')
}
function sessionDir(): string {
  return join(app.getPath('userData'), 'pi-sessions')
}

/** 把 activeProvider 注册成 pi provider（幂等：重复注册 id 会替换）。 */
async function registerProvider(sdk: PiSdk): Promise<void> {
  const p = activeProvider(getSettings())
  const key = p.apiKey || (p.apiKeyEnv ? process.env[p.apiKeyEnv] : '') || 'zj-local'
  const modelEntry = p.modelEntry
  const reasoning = modelEntry?.reasoningEfforts !== false
  const baseModel = {
    type: 'chat' as const,
    id: p.model,
    name: p.model,
    reasoning,
    input: ['text' as const],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: PI_CONTEXT_WINDOW,
    maxTokens: PI_MAX_TOKENS
  }
  const cfg: any = {
    name: p.preset.name,
    baseUrl: p.baseUrl,
    api: p.preset.api,
    apiKey: key,
    models: [{ ...baseModel, ...(p.preset.compat ? { compat: p.preset.compat } : {}) }]
  }
  try {
    modelRuntime.registerProvider(p.route, cfg)
  } catch (e) {
    // compat 字段与 api 不匹配（如 anthropic 通道喂了 openai 的 compat）：退化为不带 compat 注册
    delete cfg.models[0].compat
    modelRuntime.registerProvider(p.route, cfg)
  }
  try {
    await modelRuntime.setRuntimeApiKey(p.route, key)
  } catch {
    /* 本地服务常无 key：auth 状态取 env/fallback 即可 */
  }
  const model = modelRuntime.getModel(p.route, p.model)
  if (!model) throw new Error(`pi 无法解析模型 ${p.route}/${p.model}（baseUrl=${p.baseUrl}）`)
  modelRef = model
  diag = {
    ok: true,
    provider: p.route,
    model: p.model,
    baseUrl: p.baseUrl,
    api: p.preset.api,
    agentDir: agentDir(),
    sessionDir: sessionDir(),
    ...(sdkCache ? { entry: sdkCache.entry } : {})
  }
}

/** 确保引擎就绪：解析 SDK → 建 ModelRuntime → 注册当前厂商 → 解析 model。失败返回诊断串。 */
export async function ensureHarness(): Promise<string | undefined> {
  if (modelRuntime && modelRef) return undefined
  try {
    const { sdk, entry } = await loadSdk()
    mkdirSync(agentDir(), { recursive: true })
    mkdirSync(sessionDir(), { recursive: true })
    modelRuntime = await sdk.ModelRuntime.create({
      authPath: join(agentDir(), 'auth.json'),
      // 不读 ~/.pi/models.json：织卷的厂商目录只有 shared/providers 一处权威源
      modelsPath: null
    })
    await registerProvider(sdk)
    diag.entry = entry
    lastFailMsg = ''
    return undefined
  } catch (e: any) {
    lastFailMsg = String(e?.message ?? e)
    lastFailAt = Date.now()
    modelRuntime = null
    modelRef = null
    diag = { ok: false, note: lastFailMsg, ...(sdkCache ? { entry: sdkCache.entry } : {}) }
    return startFailureDiag(lastFailMsg)
  }
}

function startFailureDiag(msg: string): string {
  return (
    `pi 引擎启动失败：${msg}\n` +
    `· pi 入口：${sdkCache?.entry ?? '（未解析）'}\n` +
    `· node：${process.versions.node}（pi 要求 >=22.19）\n` +
    `· 厂商：${activeProvider(getSettings()).route} / ${activeProvider(getSettings()).model} @ ${activeProvider(getSettings()).baseUrl}\n` +
    `· 会话目录：${sessionDir()}`
  )
}

/** 引擎运行时状态（设置页/状态点）：pi 是进程内运行时，lastExit 恒 null（无子进程可崩） */
export function runtimeState(): { running: boolean; lastExit: null } {
  return { running: !!modelRuntime && !!modelRef, lastExit: null }
}

export function isRuntimeCreated(): boolean {
  return !!modelRuntime
}

/** 诊断快照（设置页/诊断导出用；不含 apiKey） */
export function piRuntimeDiag(): PiDiag & { running: boolean; lastFailAt: number; lastFailMsg: string; sessions: number } {
  return { ...diag, running: !!modelRuntime, lastFailAt, lastFailMsg, sessions: sessions.size }
}

// ---------- 会话 ----------
function mapThinking(effort?: string): string {
  switch (effort) {
    case 'off':
      return 'off'
    case 'low':
    case 'minimal':
      return 'low'
    case 'high':
      return 'high'
    case 'max':
    case 'xhigh':
      return 'max'
    default:
      return 'medium'
  }
}

function resourceLoader() {
  // 最小 loader：不发现 AGENTS.md / skills / 扩展，system prompt 完全由本文件决定
  return {
    getExtensions: () => ({ extensions: [], errors: [], runtime: (sdkCache?.sdk.createExtensionRuntime ? sdkCache!.sdk.createExtensionRuntime() : {}) }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => (process.env.ZHJUAN_PI_SYSTEM_PROMPT || SYSTEM_PROMPT),
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {},
    reload: async () => {}
  }
}

function chunkEvent(chunk: Record<string, unknown>): DriveEvent {
  return { method: 'session.event', params: { event: { type: 'assistant/chunk', data: { chunk } } } }
}

/** pi AgentEvent → dsh 形态 DriveEvent（engine.translate 的输入契约）。返回 null = 不透传。 */
function toDriveEvent(ev: any): DriveEvent[] {
  const evt = (e: any) => ({ method: 'session.event', params: { event: e } })
  switch (ev?.type) {
    case 'turn_start':
      return [evt({ type: 'turn/start', data: {} })]
    case 'message_update': {
      const a = ev.assistantMessageEvent
      if (a?.type === 'text_delta' && a.delta) return [chunkEvent({ type: 'text-delta', text: a.delta })]
      if (a?.type === 'thinking_delta' && a.delta) return [chunkEvent({ type: 'reasoning-delta', text: a.delta })]
      return []
    }
    case 'tool_execution_start': {
      const out: DriveEvent[] = [evt({ type: 'tool/call', data: { name: ev.toolName, callId: ev.toolCallId, arguments: ev.args ?? {} } })]
      // 交互类：直接把问题抛给主进程（dsh 由 zj-questions 插件 session.append 发同名事件）
      if (ev.toolName === 'ask_user_question') {
        out.push(evt({ type: 'zj/user-ask', data: { batch: ev.toolCallId, questions: ev.args?.questions ?? [] } }))
      }
      return out
    }
    case 'tool_execution_end': {
      const blocks = Array.isArray(ev.result?.content) ? ev.result.content : []
      const textBlocks = blocks
        .filter((b: any) => b?.type === 'text')
        .map((b: any) => ({ type: 'text', text: String(b.text ?? '') }))
      const failed = !!ev.isError || !!ev.result?.isError
      const out: DriveEvent[] = [
        evt({
          type: 'tool/result',
          data: {
            callId: ev.toolCallId,
            name: ev.toolName,
            message: { content: [{ type: 'tool-result', content: textBlocks, isError: failed }] },
            ...(failed ? { error: { name: 'ToolError' } } : {})
          }
        })
      ]
      if (ev.toolName === 'todo_write') {
        const todos = ev.result?.details?.todos ?? ev.args?.todos ?? []
        out.push(evt({ type: 'todo/write', data: { todos: Array.isArray(todos) ? todos : [] } }))
      }
      return out
    }
    case 'turn_end': {
      const msg = ev.message?.role === 'assistant' ? ev.message : null
      const kind = msg?.stopReason === 'length' ? 'max-tokens' : msg?.stopReason === 'error' ? 'error' : msg?.stopReason === 'aborted' ? 'aborted' : 'stop'
      return [evt({ type: 'turn/end', data: { reason: { kind } } })]
    }
    default:
      return []
  }
}

async function createSession(sid: string, thinkingLevel: string): Promise<PiSessionWrap> {
  const { sdk } = await loadSdk()
  if (!modelRuntime || !modelRef) throw new Error('pi 运行时未就绪')
  const settings = getSettings()
  const tools = buildPiTools({
    answerDir,
    interactive: { todo: settings.agentTools?.todo !== false, askUser: settings.agentTools?.askUser !== false }
  }) as ToolDefinition[]
  const cwd = sessionDir() // 仅用于会话头；织卷工具全靠 base 绝对路径，不依赖 cwd
  const { session } = await sdk.createAgentSession({
    cwd,
    agentDir: agentDir(),
    model: modelRef,
    thinkingLevel,
    modelRuntime,
    resourceLoader: resourceLoader(),
    // 关掉 pi 内建 read/bash/edit/write：写作域只用 zj_* 工具（noTools:'builtin' 保留 customTools 启用）
    noTools: 'builtin',
    customTools: tools,
    sessionManager: sdk.SessionManager.create(cwd, sessionDir()),
    settingsManager: sdk.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: true, maxRetries: 1 } })
  })
  const wrap: PiSessionWrap = { sid, session, sink: null, thinkingLevel }
  session.subscribe((ev: any) => {
    const sink = wrap.sink
    if (!sink) return
    for (const n of toDriveEvent(ev)) {
      try {
        sink(n)
      } catch {
        /* 消费方异常不影响引擎循环 */
      }
    }
  })
  sessions.set(sid, wrap)
  // LRU 上限：pi 会话持有完整消息历史，长期不 dispose 会吃内存
  while (sessions.size > MAX_SESSIONS) {
    const oldest = sessions.keys().next().value as string | undefined
    if (!oldest || oldest === sid) break
    const w = sessions.get(oldest)
    sessions.delete(oldest)
    try {
      w?.session.dispose()
    } catch {
      /* dispose 失败不影响新会话 */
    }
  }
  return wrap
}

/** 拿到（或创建）一个会话句柄（同名 key 复用同一 pi 会话，历史延续）。 */
export async function sessionHandle(key: string): Promise<unknown> {
  const err = await ensureHarness()
  if (err) throw new Error(err)
  const hit = sessions.get(key)
  if (hit) return hit.session
  const wrap = await createSession(key, mapThinking(undefined))
  return wrap.session
}

/** 低阶驱动一轮：prompt + subscribe 映射事件，直到 agent 收尾（agent_end / abort / 超时）。
 * 与 dsh 版行为对齐：isAborted 轮询 → session.abort()；maxMs 超时 → abort 并抛统一文案；
 * 返回累积正文（跨工具步骤的 assistant 文本，与 dsh 的 acc 同口径）。
 * maxTokens：pi 的会话级输出预算在 model.maxTokens（全局 12288），此参数暂忽略（见「未完成」）。 */
export async function driveSession(
  sid: string,
  text: string,
  opts?: { onEvent?: (n: DriveEvent) => void; maxMs?: number; isAborted?: () => boolean; maxTokens?: number; reasoningEffort?: string }
): Promise<string> {
  const err = await ensureHarness()
  if (err) throw new Error(err)
  let wrap = sessions.get(sid)
  if (!wrap) wrap = await createSession(sid, mapThinking(opts?.reasoningEffort))

  let acc = ''
  let finished = false
  let timedOut = false
  let cancelled = false

  const sink = (n: DriveEvent) => {
    if (finished) return
    const ev = n.params?.event
    if (ev?.type === 'assistant/chunk') {
      const c = ev.data?.chunk
      if (c?.type === 'text-delta' && c.text) acc += c.text
    }
    opts?.onEvent?.(n)
  }
  wrap.sink = sink

  // 外部取消（用户点停止）→ 轮询 + 真中断；dsh 版靠事件泵检查，pi 侧静默期没有事件，故用时钟。
  const abortPoll = setInterval(() => {
    if (finished || cancelled) return
    if (opts?.isAborted?.()) {
      cancelled = true
      void wrap!.session.abort().catch(() => {})
    }
  }, 250)

  const guard = setTimeout(() => {
    if (finished) return
    timedOut = true
    void wrap!.session.abort().catch(() => {})
  }, Math.max(1, opts?.maxMs ?? 10 * 60 * 1000))

  try {
    await wrap.session.prompt(text)
    await wrap.session.waitForIdle().catch(() => {})
    if (timedOut) throw new Error('写作引擎驱动超时（已中止引擎本轮）')
    // pi 把模型/网络错误收进 assistant.stopReason='error'（不抛异常）；此处翻成引擎错误，与 dsh 报错面一致
    const lastAssistant = [...(wrap.session.messages ?? [])].reverse().find((m: any) => m?.role === 'assistant')
    if (!cancelled && lastAssistant?.stopReason === 'error' && !acc) {
      throw new Error(`模型请求失败：${lastAssistant.errorMessage || '未知错误'}`)
    }
  } finally {
    finished = true
    clearInterval(abortPoll)
    clearTimeout(guard)
    if (wrap.sink === sink) wrap.sink = null
  }
  if (!acc) {
    // 无 text_delta（如模型只回工具调用后结束）时退回最后一条 assistant 正文
    const msgs = wrap.session.messages ?? []
    const last = [...msgs].reverse().find((m: any) => m?.role === 'assistant')
    const textOut = Array.isArray(last?.content)
      ? last.content.filter((c: any) => c?.type === 'text').map((c: any) => c.text).join('')
      : ''
    if (textOut) acc = textOut
  }
  return acc
}

/** 真中断：abort 指定会话的活动轮次（pi 的 abort 会等 run 收尾）。未开机/无此会话返回 false。 */
export async function cancelTurn(sessionId: string): Promise<boolean> {
  const wrap = sessions.get(sessionId)
  if (!wrap) return false
  try {
    await wrap.session.abort()
    return true
  } catch {
    return false
  }
}

/** 重启引擎：dispose 全部会话 + 重建 ModelRuntime（设置改了厂商/模型后走这里）。 */
export async function restartHarness(): Promise<string | undefined> {
  await closeHarness()
  lastFailMsg = ''
  lastFailAt = 0
  return ensureHarness()
}

/** 关闭引擎（应用退出时） */
export async function closeHarness(): Promise<void> {
  for (const [, w] of sessions) {
    try {
      w.session.dispose()
    } catch {
      /* 单会话 dispose 失败不阻断整体关闭 */
    }
  }
  sessions.clear()
  modelRuntime = null
  modelRef = null
  diag = { ok: false }
}