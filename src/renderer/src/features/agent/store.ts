import { create } from 'zustand'
import type { TodoItem, AskQuestion, EditItem } from '../../../../shared/types'

export interface AgentMsg {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  quote?: string
  applied?: boolean
  error?: boolean
  /** 思考过程（本轮 assistant 消息上可折叠展示） */
  thinking?: string
  /** tool 角色的卡片类型 */
  kind?: 'todo' | 'ask' | 'meta' | 'edit'
  items?: TodoItem[]
  questions?: AskQuestion[]
  batch?: string
  /** meta 卡：工具名与参数展示 */
  tool?: string
  toolArgs?: string
  /** meta 卡：完整参数 JSON 与完整结果正文（「细节展开」用，默认折叠） */
  toolArgsJson?: string
  toolResult?: string
  done?: boolean
  /** meta 卡：工具结果是否成功（done 后才有意义；false=失败态） */
  toolOk?: boolean
  /** meta 卡：工具开始时刻（performance.now）与耗时（meta-done 时计算，ms） */
  startedAt?: number
  elapsedMs?: number
  /** 轮次以停止/错误终了时该卡未收尾（中性「已取消」终态）：meta=工具未返回结果（停转圈），
   *  ask=问题未作答（冻结交互），todo=清单未全部完成（冻结未完成项） */
  cancelled?: boolean
  /** edit 卡：目标文件与修改条目 */
  file?: string
  edits?: EditItem[]
  /** ask 卡是否已提交 */
  answered?: boolean
  /** edit 卡：采纳/拒绝态 */
  editState?: 'pending' | 'applied' | 'rejected' | 'error'
  editError?: string
  /**
   * 本轮错误文案（2026-09-16 智能层候选3）：错误时 content 保留已流式内容/思考，错误文案独立存这里；
   * 旧「append 错误」路径（巡查/导演等直接 append）无此字段——content 即错误文案（bare 路径）。
   */
  errorText?: string
  /** 错误时可一键重试的载荷（原 prompt/quote/focus），仅在 send 路径的错误上存在 */
  errorRetry?: { prompt: string; quote: QuoteRef | null; focus: boolean }
  /** 错误气泡已被手动重试过（按钮置「已重试」，防连点重复发轮） */
  retried?: boolean
  /** 轮次终态标记（2026-09-26 体验层从 content 剥离为独立状态元素）：
   *  stopped=用户主动停止（中性，预期结果）；truncated=输出被 token 上限截断（警示）。
   *  content 保持纯模型文本——标记不再拼进正文，避免被当正文/污染后续轮次历史载荷。 */
  terminalMark?: 'stopped' | 'truncated'
}

/** 划词引用载荷（2026-09-23 体验层）：文本 + 来源显示名（正文章节=「第N章 · 题名」，其他文档=「类别·名称」，如「人物·阿七」）。
 * src 为空=旧通道/来源未知，发送文案落回面板正文章节名兜底。 */
export interface QuoteRef {
  text: string
  src?: string
}

/**
 * 会话级消息按项目分桶（体验层 2026-09-22，F-20260916-06 遗留观察项→收口）：
 * Agent 上下文装配按当前项目（context.ts），若消息列表跨项目共享，切项目后会出现
 * 「装配是 B 项目、列表却是 A 项目对话」的错位（作者反馈观察项，04-体验层.md 五-候选 3）。
 * 业界基线=VS Code Copilot Chat「session list is scoped to your current workspace」（官方文档）。
 * 实现=store 内 messages 仍是「当前项目桶」的视图（消费方零改动），byProject 持久各桶；
 * 所有按 id 的 mutation 先按 id 定位归属桶（流式事件在切项目后到达时不会写错桶）。
 * 会话内有效（不落盘）；streaming 全局唯一，一次只允许一个项目在生成。
 */
interface AgentState {
  messages: AgentMsg[]
  streaming: boolean
  quote: QuoteRef | null
  /** 当前激活的项目（AgentPanel 经 setProject 同步）；null=尚未进入项目页 */
  project: string | null
  /** 各项目消息桶（会话内存，id→桶映射见 bucketOf） */
  byProject: Record<string, AgentMsg[]>
  /** 各项目引用载荷（quote 同桶语义，防切项目把上一项目的划词引用带过来） */
  quoteByProject: Record<string, QuoteRef | null>
  /** 切换项目：保存当前桶→加载目标桶；同 id 幂等 */
  setProject: (id: string | null) => void
  setStreaming: (v: boolean) => void
  setQuote: (q: QuoteRef | null) => void
  append: (m: Omit<AgentMsg, 'id'>, opts?: { project?: string }) => void
  patch: (id: string, content: string) => void
  setError: (id: string, text: string, retryMeta?: { prompt: string; quote: QuoteRef | null; focus: boolean }) => void
  /** 标记某条错误消息已被手动重试（重试按钮置「已重试」） */
  markRetried: (id: string) => void
  markApplied: (id: string) => void
  /** 向消息追加思考增量（assistant 消息；仅在存在时追加） */
  appendThinking: (id: string, text: string) => void
  /** 标记轮次终态（stopped=用户停止 / truncated=输出截断）；终态与 content 分离存 */
  markTerminal: (id: string, mark: 'stopped' | 'truncated') => void
  /** upsert 一个 tool 消息（按 id）：todo 用全量替换，ask 用新增，meta 标记工具活动，edit 落正文修改卡 */
  upsertTool: (m: Omit<AgentMsg, 'role' | 'id' | 'content'> & { id: string; content?: string; project?: string }) => void
  /** 标记某个编辑卡的状态 */
  setEditState: (id: string, state: 'applied' | 'rejected' | 'error', error?: string) => void
  markAsked: (id: string) => void
  /** 清空当前项目的对话（其他项目桶不受影响） */
  reset: () => void
  /** 「让 agent 改」注册槽（AgentPanel 挂载时注册本页发送函数；审计抽屉等经此把审读发现发给 agent——F-20260916-05 迁移补链） */
  sendHandler: ((text: string) => void) | null
  setSendHandler: (h: ((text: string) => void) | null) => void
}

let n = 0
const nid = () => 'm' + Date.now().toString(36) + (n++).toString(36)

/** 按消息 id 定位归属项目（流式事件跨项目到达时不写错桶）；找不到返回 null */
function projectOf(s: Pick<AgentState, 'byProject' | 'project' | 'messages'>, id: string): string | null {
  for (const [p, msgs] of Object.entries(s.byProject)) {
    if (msgs.some((m) => m.id === id)) return p
  }
  // 未分桶的旧消息（project 尚未初始化时期）也视为当前项目
  if (s.project && s.messages.some((m) => m.id === id)) return s.project
  return null
}

/**
 * 公开查询：消息 id 归属的项目（答案可答、无副作用）。
 * 分桶语义的可答面——错误重试/排队续发须把新轮次落入「原消息归属桶」而不是「当前面板所在项目」
 * （2026-09-23 体验层，04-体验层.md 五候选1）：作者在 A 项目发起的轮次，重试结果必须回到 A 项目对话，
 * 否者拆散原对话且污染另一项目的装配上下文。无归属（未分桶时期）返回 null，调用方回退面板项目。
 */
export function messageProject(id: string): string | null {
  return projectOf(useAgentStore.getState(), id)
}

type BucketFn = (bucket: AgentMsg[]) => AgentMsg[]

/** 对 id 所在桶做变换；id 无归属时按 projHint → 当前项目桶。返回的 partial 直接并入 set()。 */
function mutateBucket(s: AgentState, id: string | null, fn: BucketFn, projHint?: string | null): Partial<AgentState> | undefined {
  let proj: string | null = null
  if (id) proj = projectOf(s, id)
  if (proj === null) proj = projHint ?? s.project
  if (proj === null) {
    // 尚无项目上下文（极端时序）：仅操作视图片段，不分桶
    return { messages: fn(s.messages) }
  }
  const bucket = proj === s.project ? s.messages : s.byProject[proj] ?? []
  const next = fn(bucket)
  if (next === bucket) return undefined
  const byProject = { ...s.byProject, [proj]: next }
  if (proj === s.project) return { messages: next, byProject }
  return { byProject }
}

export const useAgentStore = create<AgentState>((set) => ({
  messages: [],
  streaming: false,
  quote: null,
  project: null,
  byProject: {},
  quoteByProject: {},
  setProject: (id) =>
    set((s) => {
      if (s.project === id) return s
      // 切走前把视图片段落桶（防御未初始化时期产生的消息）
      const saved = s.messages
      const byProject = { ...s.byProject }
      if (s.project && saved.length > 0) byProject[s.project] = saved
      if (id !== null && saved.length > 0 && !s.project) {
        // project 首次设置前的消息归入首个目标项目
        byProject[id] = byProject[id] ? [...byProject[id], ...saved] : saved
      }
      // 引用同桶语义：未分桶（AgentPanel 未挂载页划词，如人物/素材页）的引用并入首个目标项目桶——
      // 否则划词后回正文 setProject 会按桶读到 null，引用静默丢失（2026-09-23 体验层场景B实锤）。
      const quoteByProject = { ...s.quoteByProject }
      if (id !== null && !s.project && s.quote) {
        if (!quoteByProject[id]) quoteByProject[id] = s.quote
      }
      return {
        project: id,
        messages: id === null ? [] : (byProject[id] ?? []),
        quote: id === null ? null : (quoteByProject[id] ?? null),
        byProject,
        quoteByProject
      }
    }),
  setStreaming: (v) => set({ streaming: v }),
  setQuote: (q) =>
    set((s) => {
      const quoteByProject = { ...s.quoteByProject }
      if (s.project) quoteByProject[s.project] = q
      return { quote: q, quoteByProject }
    }),
  append: (m, opts?: { project?: string }) =>
    set((s) => {
      const partial = mutateBucket(s, null, (bucket) => [...bucket, { ...m, id: nid() }], opts?.project)
      return partial ?? {}
    }),
  patch: (id, content) =>
    set((s) => {
      const partial = mutateBucket(s, id, (bucket) => bucket.map((x) => (x.id === id ? { ...x, content } : x)))
      return partial ?? {}
    }),
  setError: (id, text, retryMeta) =>
    set((s) => {
      const partial = mutateBucket(s, id, (bucket) =>
        bucket.map((x) =>
          x.id === id
            ? { ...x, error: true, errorText: text, ...(retryMeta ? { errorRetry: retryMeta } : {}) }
            : x
        )
      )
      return partial ?? {}
    }),
  markRetried: (id) =>
    set((s) => {
      const partial = mutateBucket(s, id, (bucket) => bucket.map((x) => (x.id === id ? { ...x, retried: true } : x)))
      return partial ?? {}
    }),
  markTerminal: (id, mark) =>
    set((s) => {
      const partial = mutateBucket(s, id, (bucket) => bucket.map((x) => (x.id === id ? { ...x, terminalMark: mark } : x)))
      return partial ?? {}
    }),
  markApplied: (id) =>
    set((s) => {
      const partial = mutateBucket(s, id, (bucket) => bucket.map((x) => (x.id === id ? { ...x, applied: true } : x)))
      return partial ?? {}
    }),
  appendThinking: (id, text) =>
    set((s) => {
      const partial = mutateBucket(s, id, (bucket) =>
        bucket.map((x) => (x.id === id ? { ...x, thinking: (x.thinking ?? '') + text } : x))
      )
      return partial ?? {}
    }),
  upsertTool: (m) =>
    set((s) => {
      const partial = mutateBucket(s, m.id, (bucket) => {
        const idx = bucket.findIndex((x) => x.id === m.id)
        const { project: _dropProject, ...rest } = m
        const next = { ...rest, role: 'tool' as const, content: m.content ?? '' }
        if (idx >= 0) {
          const copy = bucket.slice()
          copy[idx] = { ...copy[idx], ...next }
          return copy
        }
        return [...bucket, next]
      }, m.project)
      return partial ?? {}
    }),
  setEditState: (id, state, error) =>
    set((s) => {
      const partial = mutateBucket(s, id, (bucket) =>
        bucket.map((x) => (x.id === id ? { ...x, editState: state, editError: error } : x))
      )
      return partial ?? {}
    }),
  markAsked: (id) =>
    set((s) => {
      const partial = mutateBucket(s, id, (bucket) => bucket.map((x) => (x.id === id ? { ...x, answered: true } : x)))
      return partial ?? {}
    }),
  reset: () =>
    set((s) => {
      if (!s.project) return { messages: [], quote: null }
      const byProject = { ...s.byProject, [s.project]: [] }
      return { messages: [], byProject, quote: null, quoteByProject: { ...s.quoteByProject, [s.project]: null } }
    }),
  sendHandler: null,
  setSendHandler: (h) => set({ sendHandler: h })
}))
