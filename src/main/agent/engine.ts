// ===== 织卷 · agent 引擎（主进程） =====
// 把 dsh 写作引擎的会话能力翻译成渲染层事件；提供聊天与切片同步两条任务；支持展示性取消。
// 会话模型：每一轮用全新 session id（避免 SDK 高层续轮坑），可见历史由渲染层带进 prompt，
// 上下文完全可控；工具读文件由写作引擎完成。
import { driveSession, cancelTurn, type DriveEvent } from './runtime'
import { projectDir, listDocs } from '../store'
import { workspaceDir } from '../settings'
import { buildWritingContext, buildProjectContext } from './context'
import { expandAtRefs } from './refs'
import { trimHistoryMessage } from '../../shared/historyTrim'
import { summarizeToolArgs, serializeToolArgs } from '../../shared/toolArgs'
import { normalizeSyncItems, ensureWorldSliceFile, guardPersonTargets, classifySyncRaw } from './syncAnchor'
import { appendSyncLog, clipLogError } from './syncLog'
import { extractFrontMatter } from '../../shared/fmatter'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { ProposalItem } from '../../shared/types'
import { toolResultFailed } from '../../shared/toolResult'
import { listSkills } from '../skills'
import { SKILL_CAPS } from '../../shared/contextCaps'
import { skillListing, resolveSkillInjection, type SkillMeta } from '../../shared/skills'

// 关停入口（应用退出 / 冒烟脚本收尾用）
export { closeHarness as shutdown } from './runtime'

// ---------- 事件协议 ----------
export type AgentOutEvent =
  | { requestId: string; type: 'delta'; text: string } // 模型文本增量
  | { requestId: string; type: 'think'; text: string } // 模型思考增量（reasoning 块）
  | { requestId: string; type: 'meta'; tool: string; args?: string; argsJson?: string } // 工具开始（参数摘要 + 完整参数 JSON，供细节展开）
  | { requestId: string; type: 'meta-done'; tool: string; message: string; ok?: boolean; result?: string } // 工具结果摘要（ok=false=工具失败）+ 结果全文（供细节展开）
  | { requestId: string; type: 'edit'; file: string; edits: import('../../shared/types').EditItem[] } // 正文修改提案（IDE 前/>后，待采纳）
  | { requestId: string; type: 'final'; text: string } // 本轮最终答复
  | { requestId: string; type: 'done' }
  | { requestId: string; type: 'aborted' } // 用户点了停止（模型可能在边上跑完）
  | { requestId: string; type: 'error'; message: string }
  | { requestId: string; type: 'todo'; items: import('../../shared/types').TodoItem[] } // 模型更新任务清单
  | { requestId: string; type: 'ask'; questions: import('../../shared/types').AskQuestion[]; batch: string } // 模型在问用户

// ---------- 展示性取消 → 真中断（2026-09-14） ----------
// 停止请求 = 置位（渲染层立即不再转发事件） + 立即请引擎中止本轮（省 token 省时）；
// SDK 无公开中断口时 cancelTurn 静默返回 false，自动降级为原「模型跑完才收尾」行为。
const active: Map<string, { aborted: boolean; sid?: string }> = new Map()
export function abortRequest(requestId: string) {
  const r = active.get(requestId)
  if (!r) return
  r.aborted = true
  if (r.sid) void cancelTurn(r.sid).catch(() => {})
}

let runSeq = 0
const newSid = (projectId: string) => 'zj-' + Date.now().toString(36) + '-' + (runSeq++).toString(36) + '-' + projectId

function envBlock(projectId: string, chapterRel: string | null): string {
  const base = projectDir(projectId)
  const lines = [
    '【作品根目录】' + base,
    '【工作区根目录】' + workspaceDir(),
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
  /** 焦点改稿任务（如审读条目「让 agent 改」）：放宽预算到 FOCUS_MAX_MS，防边界截断丢收尾（2026-09-15） */
  focus?: boolean
}

/** 常规对话预算 12min（主人 2026-09-18：长正文输出耗时较长，8min 会误超时；重试机制由 ErrorNotice 提供）；「让 agent 改」类焦点任务放宽到 15min */
const CHAT_MAX_MS = 12 * 60 * 1000
const FOCUS_MAX_MS = 15 * 60 * 1000

export async function runChat(input: ChatInput, emit: (e: AgentOutEvent) => void): Promise<void> {
  // 登记本请求——abortRequest 依赖 active 里的条目置位；sid 提前创建供真中断使用（2026-09-14）
  const sid = newSid(input.projectId)
  const run = { aborted: false, sid }
  active.set(input.requestId, run)
  const parts: string[] = []
  // 系统身份 + 输出纪律（2026-09-22 智能层轮，候选 1「聊天输出纯度」）：
  // 18:00 轮 insights-draft-live 实测模型续写必带元说明（「几点处理思路」「——约 120 字」「未使用…」），
  // 正文混说明=作者侧对话流噪音；业界（Novelcrafter 官方默认 prompt）把输出纯度/文风纪律写进 prompt 层，
  // 且本机实测「只输出正文」指令有效（v2 探针对照）。仅聊天域（runChat）加纪律；子任务/检查域不动。
  parts.push('你是「织卷」创作工作台的创作 agent，协助作者（用户）写作。')
  parts.push(
    '【输出纪律】用户请求是续写、扩写、改写、润色、按要点成文等创作行动时：只输出正文本身，' +
      '不加任何说明、解释、思路、字数标注、标题或前后缀；用户请求是提问、评价、讨论、规划（如「这段怎样」「哪里要改」）时：正常给出分析。' +
      '说明性文字会混入正文、需要作者手动删除，所以拿不准时默认按创作行动输出正文。'
  )
  parts.push(envBlock(input.projectId, input.chapterRel))
  // 技能清单注入（2026-09-21 skill 运行层）：描述常驻、正文按需（渐进披露第一层）；失败不阻断创作
  let skills: SkillMeta[] = []
  try {
    skills = listSkills()
    const listing = skillListing(skills, SKILL_CAPS.perLine, SKILL_CAPS.listing)
    if (listing) parts.push(listing)
  } catch {
    /* 技能读取失败不阻断创作 */
  }
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
  } else {
    // 未打开章节（项目页/新建项目后）——给项目级概览，避免 agent 对作品零认知纯靠工具现读（2026-09-11）
    try {
      const pctx = await buildProjectContext(input.projectId)
      if (pctx.blocks.length) {
        parts.push(
          '【项目概览】当前未打开具体章节，以下是本项目的基本信息与文档结构，可直接作为事实使用；需要看完整文件时再用 zj_* 工具读取对应的【作品根目录】下路径。\n' +
            pctx.blocks.join('\n\n')
        )
      }
    } catch {
      // 装配失败不阻断创作
    }
  }
  if (input.history && input.history.length) {
    const sliced = input.history.slice(-20) // 最多带最近 20 条可见历史
    parts.push('【对话历史】\n' + sliced.map((m) => `${m.role === 'user' ? '用户' : '织卷'}：${trimHistoryMessage(m.content)}`).join('\n'))
  }
  if (input.quote?.trim()) {
    parts.push(`（引用自《${input.chapterTitle}》的选中段落）\n> ${input.quote.replace(/\n/g, '\n> ')}`)
  }
  // @ 引用展开（2026-09-11）：用户消息里的 〔类型·名称｜路径〕 标记 → 读对应文档内容注入本轮上下文
  try {
    const at = await expandAtRefs(input.projectId, input.prompt)
    if (at.block) parts.push(at.block)
  } catch {
    // 引用展开失败不阻断创作（与上下文装配同级兜底）
  }
  // 技能激活注入（2026-09-21 skill 运行层）：显式 /技能名 优先，其次关键词自动匹配（≤2 条）；
  // 组装逻辑在 shared/skills.resolveSkillInjection（纯函数，可单测）；失败不阻断创作
  let userPrompt = input.prompt
  let skillActivated = false
  try {
    const inj = resolveSkillInjection(skills, input.prompt, input.quote ?? null, SKILL_CAPS.body)
    for (const b of inj.blocks) parts.push(b)
    userPrompt = inj.userPrompt
    // 技能命中即走 low 思考档（2026-09-23 智能层，候选 1）：B 显式 /技能名 曾两次 12min 超时，
    // 会话日志实锤最终生成步 380s 纯 think/正文 0 字符；skill-b-effort-probe 同 prompt 直调对照
    // default 4096 tokens 全吃思考（144.9s/length）vs low 46.4s/stop/1039 字符正文（质量等价）。
    // A（触发词自动激活）注入面相同、无 low 时同样 think 无度（09-23 全量实测 8.5min+ 未收尾）——
    // 技能=执行步骤型任务，正文已给方法，无需深 think；凡技能命中一律 low（cheap 档只降 think 不降正文质量）。
    skillActivated = inj.blocks.length > 0
  } catch {
    /* 技能失败不阻断创作 */
  }
  parts.push(userPrompt)
  try {
    const text = await driveSession(
      sid,
      parts.join('\n\n'),
      {
        maxMs: input.focus ? FOCUS_MAX_MS : CHAT_MAX_MS,
        reasoningEffort: skillActivated ? 'low' : undefined,
        isAborted: () => run.aborted,
        onEvent: (n) => {
          if (run.aborted) return
          translate(n, input.requestId, emit)
        }
      }
    )
    if (run.aborted) {
      // 用户已点停止：成功路径不再发 final/done（避免「停止后仍显示整篇完整回复」与「已停止」标记冲突），
      // 渲染层保留已展示的部分增量 + 「（已停止）」
      emit({ requestId: input.requestId, type: 'aborted' })
    } else {
      emit({ requestId: input.requestId, type: 'final', text })
      emit({ requestId: input.requestId, type: 'done' })
    }
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
    emit({ requestId, type: 'meta', tool: name, args: summarizeToolArgs(d.arguments), argsJson: serializeToolArgs(d.arguments) })
  } else if (t === 'tool/result') {
    const blocks = d.message?.content ?? []
    const text = blocks
      .map((b: any) => b.content)
      .flat()
      .filter((x: any) => x?.type === 'text')
      .map((x: any) => x.text)
      .join(' ')
    const failed = toolResultFailed(d)
    const name = lastToolName.get(requestId) ?? String(d.callId ?? '')
    // zj_edit_doc：把结构化结果转成正文修改提案（数据来自工具内的 JSON 标记，见 zj-core）
    if (name === 'zj_edit_doc' && !failed) {
      const json = extractEditPayload(text)
      if (json) {
        emit({ requestId, type: 'edit', file: String(json.file ?? ''), edits: json.edits })
        emit({ requestId, type: 'meta-done', tool: name, message: `已生成正文修改方案（${json.edits?.length ?? 0} 处），采纳后写入`, result: text.slice(0, 4000) })
        return
      }
    }
    emit({
      requestId,
      type: 'meta-done',
      tool: name,
      message: text.slice(0, 80) || (failed ? '失败' : '完成'),
      ok: !failed,
      result: text.slice(0, 4000) // 完整结果正文（失败时含完整报错，展开可查）
    })
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
function syncSystem(known: { files: string[]; cast: string[]; noFile: string[] }): string {
  return (
    '你是织卷的「时间切片同步器」。根据章节正文，把这一章对应时间切片的人物状态、世界观变化、环境状态，写成一份设定补丁。\n' +
    '要求：\n' +
    '1. 当前章节与相关设定已作为【当前创作上下文】直接给出，据此判断变化；如需核对更完整内容，再用 zj_read_doc 读取对应文件。\n' +
    '2. 只在正文确有变化时输出；没有任何变化就输出 []。若当前章节正文为空（只有约定头），直接输出 []。\n' +
    '   不得把人物档案/切片小节中已有的信息当作「新动向」复述——只有正文中发生了与已记录设定不同的新事态，才输出补丁。\n' +
    '3. 每条补丁为：{"target":"相对项目根的文件路径","anchor":"要写入的小节标题文本（不含#号）","kind":"upsert-section","before":"原状态的一句话要点（无则空串）","after":"本小节要写入的完整新内容（markdown 列表即可）","reason":"一句话理由"}\n' +
    '4. target 与 anchor 规则（重要）：\n' +
    '   - 人物状态：target=人物/<姓名>.md（只许用 人物/ 下真实存在的文件）；anchor 一律为「切片：<本片切片名>」——人物档案里该小节已存在则整节替换，不存在则作为新小节追加；**禁止把「基础档案」「基础设定」「成长轨迹」「定位」等长期小节当 anchor**（那是作者手动维护的只读区，你的产物写进去会覆盖别人的设定）。\n' +
    '   - 世界/环境变化：target=世界观/切片_<本片切片名>.md（系统会在同步前自动确保该文件存在，直接使用）；anchor 同上为「切片：<本片切片名>」。**不要写 世界观/总纲.md**（总纲是长期不变项）。\n' +
    '   - 本切片切片名以【当前打开章节】约定头里的「切片」字段为准。\n' +
    `   - 本项目现有人物档案清单（person target 只能从这里面挑，按档案文件名里的本名写）：${known.files.join('、') || '（暂无）'}\n` +
    `   - 本章涉及人物：${known.cast.join('、') || '（无）'}${known.noFile.length ? `；其中「${known.noFile.join('、')}」尚未建档（不得作为 target 写入，请留给作者建档）` : ''}\n` +
    '5. after 是该小节完整的新内容（仅该小节），不含标题行。\n' +
    '6. 只输出 JSON 数组本身：不加注释、不加 markdown 围栏、不加任何前后缀文字。\n' +
    '7. 不要用 ask_user_question 或任何提问工具：本任务离线执行，直接按文件决定即可。'
  )
}

export async function runSync(
  projectId: string,
  chapterRel: string
): Promise<
  | {
      ok: true
      items: ProposalItem[]
      guard?: { issues: import('../../shared/types').SyncIssue[] }
      /** 本次比对基准（无设定变化时的可信呈现，2026-09-14 21:45） */
      evidence?: import('../../shared/types').SyncEvidence
    }
  | { ok: false; error: string }
> {
  // 先读约定头拿切片名：世界状态一律进 世界观/切片_<切片名>.md（不存在则创建模板），anchor 也按它归一
  let sliceName = ''
  let castAll: string[] = []
  let bodyLen = 0
  let bodyRead = false // 章节读取成功标记：短路门只在「确实读到正文为空」时生效，不掩盖读失败
  try {
    const ch = readFileSync(join(projectDir(projectId), chapterRel), 'utf-8')
    const fm = extractFrontMatter(ch).fm ?? {}
    sliceName = String(fm['切片'] ?? '')
    castAll = Array.isArray(fm['涉及人物']) ? (fm['涉及人物'] as string[]) : []
    // P1 F-20260917-10 取证字段：同步时刻正文本体长度（剥约定头后；0=正文为空——「同步照跑但正文已被清空」的形态在 sync-log 一眼可辨）
    bodyLen = extractFrontMatter(ch).body.length
    bodyRead = true
  } catch {
    // 章节读不到就不做切片文件；不影响同步本身
  }
  // 现有 人物/ 档案清单（guard 防线 + 提示词清单；listDocs 剥 .md 与真机口径一致）
  let knownFiles: string[] = []
  try {
    knownFiles = listDocs(projectId, '人物').map((d) => d.name)
  } catch {
    // listDocs 对不存在目录返回 []（不抛）；真抛说明项目目录异常——knownFiles 为空时 guard 会把
    // 人物 target 全拦下并记 issues（安全方向：宁可提示也不越权新建档案，不会错写盘）
  }
  if (sliceName) ensureWorldSliceFile(projectDir(projectId), sliceName)
  // 未建档人物（比对盲区计数；与 syncSystem 提示词共用同一口径）
  const noFile = castAll.filter((c) => !knownFiles.includes(c))
  // 严格性修复（2026-09-20 创作层；F-20260917-10 P1 现场形态实测）：正文为空=没有可提取的设定变化，
  // 提示词「只在正文确有变化时输出」是软约束——P1 证据（92B 仅约定头 + 完整人物档案）模型仍会产出
  // 基于档案/章卡的「动向」提案（设定流噪音）。本地短路（lazy-gate：廉价判据先于昂贵模型调用）：
  // 零模型调用、零提案噪音；sync-log 照记（bodyLen=0 一眼可辨），证据小字明示「正文为空，未比对」。
  if (bodyRead && bodyLen === 0) {
    appendSyncLog(projectId, {
      time: Date.now(),
      chapter: chapterRel,
      slice: sliceName,
      castCount: castAll.length,
      fileCount: knownFiles.length,
      itemCount: 0,
      guardCount: 0,
      ok: true,
      bodyLen
    })
    return {
      ok: true,
      items: [],
      evidence: {
        slice: sliceName,
        castCount: castAll.length,
        knownFiles: knownFiles.length,
        unarchived: noFile.length,
        bodyEmpty: true
      }
    }
  }
  const parts: string[] = []
  parts.push(syncSystem({ files: knownFiles, cast: castAll, noFile }))
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
    let text = await driveSession(newSid(projectId), parts.join('\n\n'), { maxMs: 10 * 60 * 1000 })
    let items = extractItems(text)
    // 产出解析健康（候选 2f）：「非空但解析失败 / 解析出数组但条目全无效」不能按「无变化」默过——
    // 那是模型跑偏的信号（散文/对象/围栏外文本），设定流断链要显性报错，不带提醒静默重来。
    if (items.length === 0 && classifySyncRaw(text) !== 'empty') {
      text = await driveSession(newSid(projectId) + '-r', parts.join('\n\n') + SYNC_RETRY_NOTE, { maxMs: 10 * 60 * 1000 })
      items = extractItems(text)
      if (items.length === 0 && classifySyncRaw(text) !== 'empty') {
        appendSyncLog(projectId, {
          time: Date.now(),
          chapter: chapterRel,
          slice: sliceName,
          castCount: castAll.length,
          fileCount: knownFiles.length,
          itemCount: 0,
          guardCount: 0,
          ok: false,
          bodyLen,
          error: clipLogError(`模型回复未能解析为设定 JSON 数组（已重试一次仍失败）——原文节选：${excerptSyncRaw(text)}`)
        })
        return {
          ok: false,
          error: `模型回复未能解析为设定 JSON 数组（已重试一次仍失败）——原文节选：${excerptSyncRaw(text)}`
        }
      }
    }
    const normalized = normalizeSyncItems(items, sliceName)
    // 防线（候选 2e）：人物 target 必须落现有档案；纠错/丢弃记入 issues 供 UI 提示
    const g = guardPersonTargets(normalized, { knownFiles, chapterCast: castAll })
    const res: {
      ok: true
      items: ProposalItem[]
      guard?: { issues: import('../../shared/types').SyncIssue[] }
      evidence?: import('../../shared/types').SyncEvidence
    } = {
      ok: true,
      items: g.items,
      // 比对基准证据（零额外 IO）：本次切片名/涉及人物数/人档基数/未建档盲区
      evidence: {
        slice: sliceName,
        castCount: castAll.length,
        knownFiles: knownFiles.length,
        unarchived: noFile.length
      }
    }
    if (g.issues.length) res.guard = { issues: g.issues }
    appendSyncLog(projectId, {
      time: Date.now(),
      chapter: chapterRel,
      slice: sliceName,
      castCount: castAll.length,
      fileCount: knownFiles.length,
      itemCount: g.items.length,
      guardCount: g.issues.length,
      ok: true,
      bodyLen
    })
    return res
  } catch (e: any) {
    appendSyncLog(projectId, {
      time: Date.now(),
      chapter: chapterRel,
      slice: sliceName,
      castCount: castAll.length,
      fileCount: knownFiles.length,
      itemCount: 0,
      guardCount: 0,
      ok: false,
      bodyLen,
      error: clipLogError(String(e?.message ?? e))
    })
    return { ok: false, error: String(e?.message ?? e).slice(0, 300) }
  }
}

/** 同步重试提醒（候选 2f）：附加在原始材料包之后，强令只输出 JSON 数组 */
const SYNC_RETRY_NOTE =
  '\n\n你上次的回答没有被解析成 JSON 数组（不符合要求 6：只输出 JSON 数组本身，不加任何前后缀文字）。这次只输出一个 JSON 数组：先写左中括号 [，不要解释、不要注释。'

/** 错误文案带原文节选（压空白，留前 60 字符） */
function excerptSyncRaw(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > 60 ? t.slice(0, 60) + '…' : t || '（空回复）'
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
