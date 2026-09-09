// ===== 织卷 · agent 引擎（主进程） =====
// 把 dsh 写作引擎的会话能力翻译成渲染层事件；提供聊天与切片同步两条任务；支持展示性取消。
// 会话模型：每一轮用全新 session id（避免 SDK 高层续轮坑），可见历史由渲染层带进 prompt，
// 上下文完全可控；工具读文件由写作引擎完成。
import { driveSession, type DriveEvent } from './runtime'
import { projectDir } from '../store'
import { buildWritingContext } from './context'
import { normalizeSyncItems, ensureWorldSliceFile } from './syncAnchor'
import { extractFrontMatter } from '../../shared/fmatter'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { ProposalItem } from '../../shared/types'

// 关停入口（应用退出 / 冒烟脚本收尾用）
export { closeHarness as shutdown } from './runtime'

// ---------- 事件协议 ----------
export type AgentOutEvent =
  | { requestId: string; type: 'delta'; text: string } // 模型文本增量
  | { requestId: string; type: 'think'; text: string } // 模型思考增量（reasoning 块）
  | { requestId: string; type: 'meta'; tool: string; args?: string } // 工具开始（带参数摘要）
  | { requestId: string; type: 'meta-done'; tool: string; message: string } // 工具结果摘要
  | { requestId: string; type: 'edit'; file: string; edits: import('../../shared/types').EditItem[] } // 正文修改提案（IDE 前/>后，待采纳）
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
    '提示 web_client 工作：需要资料时用 zj_* 工具读，不要猜测。base 永远是上下文给出的【作品根目录】，不要自己编。',
    '要修改或新增正文内容时，用 zj_edit_doc 生成“修改方案”（不写盘，作者在界面上采纳后才会写入）；不要在答复里给出整篇替换文本让作者自己复制。' 
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
  if (input.chapterRel) {
    try {
      const ctx = await buildWritingContext(input.projectId, input.chapterRel)
      if (ctx.blocks.length) {
        parts.push(
          '【当前创作上下文】以下是当前章节与其相关设定的装配内容，可直接作为事实使用；需要看更完整的文件时再用 zj_* 工具读取对应的【作品根目录】下路径。\n' +
            ctx.blocks.join('\n\n')
        )
      }
    } catch {
      // 装配失败不阻断创作
    }
  }
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
const lastToolName = new Map<string, string>() // requestId → 最近一次工具名（tool/result 认领用）
function toolArgs(args: unknown): string | undefined {
  if (!args) return undefined
  let obj: any = args
  if (typeof args === 'string') {
    try { obj = JSON.parse(args) } catch { return String(args).slice(0, 60) }
  }
  if (typeof obj !== 'object' || obj === null) return undefined
  // 展示最有用的一两个参数：读文件的展示 file，搜索展示 query，其余取前几个键值
  const pick = obj.file ?? obj.query ?? obj.dir
  if (pick !== undefined) return String(pick)
  const keys = Object.keys(obj).filter((k) => !['base'].includes(k))
  if (!keys.length) return undefined
  const k = keys[0]
  const v = obj[k]
  return typeof v === 'string' || typeof v === 'number' ? `${k}=${v}` : k
}
function translate(n: DriveEvent, requestId: string, emit: (e: AgentOutEvent) => void) {
  if (n.method !== 'session.event') return
  const ev = n.params?.event as any
  const t = ev?.type
  const d = ev?.data ?? {}
  if (t === 'assistant/chunk') {
    const c = d.chunk
    if (c?.type === 'text-delta' && c.text) emit({ requestId, type: 'delta', text: c.text })
    else if (c?.type === 'reasoning-delta' && c.text) emit({ requestId, type: 'think', text: c.text })
  } else if (t === 'tool/call') {
    const name = String(d.name ?? d.callId ?? '工具')
    lastToolName.set(requestId, name)
    emit({ requestId, type: 'meta', tool: name, args: toolArgs(d.arguments) })
  } else if (t === 'tool/result') {
    const blocks = d.message?.content ?? []
    const text = blocks
      .map((b: any) => b.content)
      .flat()
      .filter((x: any) => x?.type === 'text')
      .map((x: any) => x.text)
      .join(' ')
    const name = lastToolName.get(requestId) ?? String(d.callId ?? '')
    // zj_edit_doc：把结构化结果转成正文修改提案（数据来自工具内的 JSON 标记，见 zj-core）
    if (name === 'zj_edit_doc') {
      const json = extractEditPayload(text)
      if (json) {
        emit({ requestId, type: 'edit', file: String(json.file ?? ''), edits: json.edits })
        emit({ requestId, type: 'meta-done', tool: name, message: `已生成正文修改方案（${json.edits?.length ?? 0} 处），采纳后写入` })
        return
      }
    }
    emit({ requestId, type: 'meta-done', tool: name, message: text.slice(0, 80) || '完成' })
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

/** 从 zj_edit_doc 的返回文本里提取结构化载荷（工具会把 JSON 包在 ★ZJ_EDIT★ … ★END★ 里） */
function extractEditPayload(text: string): { file: string; edits: import('../../shared/types').EditItem[] } | null {
  const m = text.match(/★ZJ_EDIT★\n([\s\S]*?)\n★ZJ_END★/)
  const raw = m ? m[1] : text
  const a = raw.indexOf('{')
  const b = raw.lastIndexOf('}')
  if (a < 0 || b <= a) return null
  try {
    const obj = JSON.parse(raw.slice(a, b + 1))
    if (!Array.isArray(obj.edits)) return null
    return { file: String(obj.file ?? ''), edits: obj.edits }
  } catch {
    return null
  }
}

// ---------- 切片同步（走 harness，模型可用工具读设定）----------
function syncSystem(): string {
  return (
    '你是织卷的「时间切片同步器」。根据章节正文，把这一章对应时间切片的人物状态、世界观变化、环境状态，写成一份设定补丁。\n' +
    '要求：\n' +
    '1. 当前章节与相关设定已作为【当前创作上下文】直接给出，据此判断变化；如需核对更完整内容，再用 zj_read_doc 读取对应文件。\n' +
    '2. 只在正文确有变化时输出；没有任何变化就输出 []。\n' +
    '3. 每条补丁为：{"target":"相对项目根的文件路径","anchor":"要写入的小节标题文本（不含#号）","kind":"upsert-section","before":"原状态的一句话要点（无则空串）","after":"本小节要写入的完整新内容（markdown 列表即可）","reason":"一句话理由"}\n' +
    '4. target 与 anchor 规则（重要）：\n' +
    '   - 人物状态：target=人物/<姓名>.md（只许用 人物/ 下真实存在的文件）；anchor 一律为「切片：<本片切片名>」——人物档案里该小节已存在则整节替换，不存在则作为新小节追加；**禁止把「基础档案」「基础设定」「成长轨迹」「定位」等长期小节当 anchor**（那是作者手动维护的只读区，你的产物写进去会覆盖别人的设定）。\n' +
    '   - 世界/环境变化：target=世界观/切片_<本片切片名>.md（系统会在同步前自动确保该文件存在，直接使用）；anchor 同上为「切片：<本片切片名>」。**不要写 世界观/总纲.md**（总纲是长期不变项）。\n' +
    '   - 本切片切片名以【当前打开章节】约定头里的「切片」字段为准。\n' +
    '5. after 是该小节完整的新内容（仅该小节），不含标题行。\n' +
    '6. 只输出 JSON 数组本身：不加注释、不加 markdown 围栏、不加任何前后缀文字。\n' +
    '7. 不要用 ask_user_question 或任何提问工具：本任务离线执行，直接按文件决定即可。'
  )
}

export async function runSync(
  projectId: string,
  chapterRel: string
): Promise<{ ok: true; items: ProposalItem[] } | { ok: false; error: string }> {
  // 先读约定头拿切片名：世界状态一律进 世界观/切片_<切片名>.md（不存在则创建模板），anchor 也按它归一
  let sliceName = ''
  try {
    const ch = readFileSync(join(projectDir(projectId), chapterRel), 'utf-8')
    sliceName = String(extractFrontMatter(ch).fm?.['切片'] ?? '')
  } catch {
    // 章节读不到就不做切片文件；不影响同步本身
  }
  if (sliceName) ensureWorldSliceFile(projectDir(projectId), sliceName)
  const parts: string[] = []
  parts.push(syncSystem())
  parts.push(envBlock(projectId, chapterRel))
  try {
    const ctx = await buildWritingContext(projectId, chapterRel)
    if (ctx.blocks.length) {
      parts.push('【当前创作上下文】（以下是当前章节与其相关设定的装配内容，可直接作为事实；需要核对时用 zj_* 工具读取对应文件）\n' + ctx.blocks.join('\n\n'))
    }
  } catch {
    // 装配失败不阻断同步
  }
  parts.push(`当前需要同步的章节：${chapterRel}。请按上面的要求输出设定补丁 JSON。`)
  try {
    const text = await driveSession(newSid(projectId), parts.join('\n\n'), { maxMs: 10 * 60 * 1000 })
    const items = normalizeSyncItems(extractItems(text), sliceName)
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
