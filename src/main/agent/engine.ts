// ===== 织卷 · agent 引擎（主进程） =====
// 把 dsh 写作引擎的会话能力翻译成渲染层事件；提供聊天与切片同步两条任务；支持展示性取消。
// 会话模型：每一轮用全新 session id（避免 SDK 高层续轮坑），可见历史由渲染层带进 prompt，
// 上下文完全可控；工具读文件由写作引擎完成。
import { driveSession, type DriveEvent } from './runtime'
import { projectDir } from '../store'
import type { ProposalItem } from '../../shared/types'

// 关停入口（应用退出 / 冒烟脚本收尾用）
export { closeHarness as shutdown } from './runtime'

// ---------- 事件协议 ----------
export type AgentOutEvent =
  | { requestId: string; type: 'delta'; text: string } // 模型文本增量
  | { requestId: string; type: 'meta'; tool: string } // 工具开始
  | { requestId: string; type: 'meta-done'; tool: string; message: string } // 工具结果摘要
  | { requestId: string; type: 'final'; text: string } // 本轮最终答复
  | { requestId: string; type: 'done' }
  | { requestId: string; type: 'aborted' } // 用户点了停止（模型可能在边上跑完）
  | { requestId: string; type: 'error'; message: string }
  | { requestId: string; type: 'todo'; items: import('../../shared/types').TodoItem[] } // 模型更新任务清单
  | { requestId: string; type: 'ask'; questions: import('../../shared/types').AskQuestion[]; batch: string } // 模型在问用户

// ---------- 展示性取消 ----------
const active: Map<string, { aborted: boolean }> = new Map()
export function abortRequest(requestId: string) {
  const r = active.get(requestId)
  if (r) r.aborted = true
}

let runSeq = 0
const newSid = (projectId: string) => 'zj-' + Date.now().toString(36) + '-' + (runSeq++).toString(36) + '-' + projectId

function envBlock(projectId: string, chapterRel: string | null): string {
  const base = projectDir(projectId)
  const lines = [
    '【作品根目录】' + base,
    '【当前打开章节】' + (chapterRel || '（未打开）'),
    '提示 web_client 工作：需要资料时用 zj_* 工具读，不要猜测。base 永远是上下文给出的【作品根目录】，不要自己编。'
  ]
  return lines.join('\n')
}

// ---------- 聊天 ----------
export interface ChatInput {
  requestId: string
  projectId: string
  chapterRel: string | null
  chapterTitle: string
  prompt: string
  quote?: string | null
  /** 最近对话可见历史（角色 + 内容），由渲染层携带 */
  history?: { role: 'user' | 'assistant'; content: string }[]
}

export async function runChat(input: ChatInput, emit: (e: AgentOutEvent) => void): Promise<void> {
  const run = active.get(input.requestId) ?? { aborted: false }
  const parts: string[] = []
  parts.push('你是「织卷」创作工作台的创作 agent，协助作者（用户）写作。')
  parts.push(envBlock(input.projectId, input.chapterRel))
  if (input.history && input.history.length) {
    const sliced = input.history.slice(-20) // 最多带最近 20 条可见历史
    parts.push('【对话历史】\n' + sliced.map((m) => `${m.role === 'user' ? '用户' : '织卷'}：${m.content.slice(0, 4000)}`).join('\n'))
  }
  if (input.quote?.trim()) {
    parts.push(`（引用自《${input.chapterTitle}》的选中段落）\n> ${input.quote.replace(/\n/g, '\n> ')}`)
  }
  parts.push(input.prompt)
  const sid = newSid(input.projectId)
  try {
    const text = await driveSession(
      sid,
      parts.join('\n\n'),
      {
        maxMs: 8 * 60 * 1000,
        onEvent: (n) => {
          if (run.aborted) return
          translate(n, input.requestId, emit)
        }
      }
    )
    emit({ requestId: input.requestId, type: 'final', text })
    emit({ requestId: input.requestId, type: 'done' })
  } catch (e: any) {
    if (run.aborted) {
      emit({ requestId: input.requestId, type: 'aborted' })
    } else {
      emit({ requestId: input.requestId, type: 'error', message: String(e?.message ?? e).slice(0, 300) })
    }
  } finally {
    active.delete(input.requestId)
  }
}

/** 把写作引擎 session.event 翻译成渲染层事件 */
function translate(n: DriveEvent, requestId: string, emit: (e: AgentOutEvent) => void) {
  if (n.method !== 'session.event') return
  const ev = n.params?.event as any
  const t = ev?.type
  const d = ev?.data ?? {}
  if (t === 'assistant/chunk') {
    const c = d.chunk
    if (c?.type === 'text-delta' && c.text) emit({ requestId, type: 'delta', text: c.text })
  } else if (t === 'tool/call') {
    emit({ requestId, type: 'meta', tool: String(d.name ?? d.callId ?? '工具') })
  } else if (t === 'tool/result') {
    const blocks = d.message?.content ?? []
    const summary =
      blocks
        .map((b: any) => b.content)
        .flat()
        .filter((x: any) => x?.type === 'text')
        .map((x: any) => x.text)
        .join(' ')
        .slice(0, 80) || '完成'
    emit({ requestId, type: 'meta-done', tool: String(d.callId ?? ''), message: summary })
  } else if (t === 'todo/write') {
    const todos = Array.isArray(d.todos)
      ? d.todos.map((x: any) => ({ content: String(x?.content ?? ''), status: x?.status }))
      : []
    emit({ requestId, type: 'todo', items: todos })
  } else if (t === 'zj/user-ask') {
    const qs = Array.isArray(d.questions)
      ? d.questions.map((q: any) => ({
          id: String(q?.id ?? ''),
          question: String(q?.question ?? ''),
          header: q?.header,
          options: Array.isArray(q?.options)
            ? q.options.map((o: any) => ({ label: String(o?.label ?? ''), description: o?.description }))
            : undefined,
          multiSelect: !!q?.multiSelect
        }))
      : []
    emit({ requestId, type: 'ask', questions: qs, batch: String(d?.batch ?? '') })
  }
}

// ---------- 切片同步（走 harness，模型可用工具读设定）----------
function syncSystem(): string {
  return (
    '你是织卷的「时间切片同步器」。根据章节正文，把这一章对应时间切片的人物状态、世界观变化、环境状态，写成一份设定补丁。\n' +
    '要求：\n' +
    '1. 先用 zj_read_doc 读当前章节正文（路径见环境块），再用 zj_* 工具读取相关人物档案与世界观切片，确认变化。\n' +
    '2. 只在正文确有变化时输出；没有任何变化就输出 []。\n' +
    '3. 每条补丁为：{"target":"相对项目根的文件路径","anchor":"要更新小节对应的标题文本（目标文档无此小节则填空串，我们把它作为新小节追加）","kind":"upsert-section","before":"原状态的一句话要点","after":"本小节要写入的完整新内容（markdown 列表即可）","reason":"一句话理由"}\n' +
    '4. target 优先：人物档案用 人物/<姓名>.md；世界/环境变化用 世界观/<切片名>.md。只允许这两个目录里已有的文件。\n' +
    '5. after 是该小节完整的新内容，不含标题行。\n' +
    '6. 只输出 JSON 数组本身：不加注释、不加 markdown 围栏、不加任何前后缀文字。\n' +
    '7. 不要用 ask_user_question 或任何提问工具：本任务离线执行，直接按文件决定即可。'
  )
}

export async function runSync(
  projectId: string,
  chapterRel: string
): Promise<{ ok: true; items: ProposalItem[] } | { ok: false; error: string }> {
  const parts: string[] = []
  parts.push(syncSystem())
  parts.push(envBlock(projectId, chapterRel))
  parts.push(`当前需要同步的章节：${chapterRel}。请按上面的要求输出设定补丁 JSON。`)
  try {
    const text = await driveSession(newSid(projectId), parts.join('\n\n'), { maxMs: 10 * 60 * 1000 })
    const items = extractItems(text)
    return { ok: true, items }
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e).slice(0, 300) }
  }
}

/** 从模型回复里稳健提取补丁 JSON 数组 */
export function extractItems(text: string): ProposalItem[] {
  const clean = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
  try {
    const arr = JSON.parse(clean)
    if (Array.isArray(arr)) return sanitize(arr)
  } catch {}
  const a = clean.indexOf('[')
  const b = clean.lastIndexOf(']')
  if (a >= 0 && b > a) {
    try {
      const arr = JSON.parse(clean.slice(a, b + 1))
      if (Array.isArray(arr)) return sanitize(arr)
    } catch {}
  }
  return []
}

function sanitize(arr: unknown[]): ProposalItem[] {
  return (arr as any[])
    .filter((x) => x && typeof x === 'object' && typeof x.target === 'string' && typeof x.after === 'string')
    .map((x) => ({
      target: x.target,
      anchor: typeof x.anchor === 'string' ? x.anchor : '',
      kind: x.kind === 'append' ? 'append' : 'upsert-section',
      before: typeof x.before === 'string' ? x.before : '',
      after: x.after,
      reason: typeof x.reason === 'string' ? x.reason : ''
    }))
}
