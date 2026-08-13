import { ipcMain } from 'electron'
import type { Project, Chapter } from '../shared/types'
import { buildAssembledContext, describeComposition } from '../shared/composer'
import { makeDirectorBoard, renderDirectorBoard } from '../shared/director'
import { planActs, renderActDirective, joinActs, truncateActs, prevActState, type ActPlan } from '../shared/acts'

interface GenOpts {
  baseUrl: string
  model: string
  apiKey: string
}

/** 用组配器产出的上下文包（AssembledContext）拼 Prompt —— 取代过去的「整包硬塞」 */
function buildPrompt(
  ctx: ReturnType<typeof buildAssembledContext>,
  chapter: Chapter,
  projectName: string,
  actCtx?: { act: ActPlan; prevState: string; idx: number; total: number }
): string {
  const chars = ctx.chars.length
    ? ctx.chars
        .map(
          (i, idx) =>
            `【人物${idx + 1}】${i.target.name}（${i.target.role}，${i.target.age}岁${i.target.isProtagonist ? '，主角' : ''}）\n` +
            `  此刻（第 ${ctx.currentNum} 章）的设定状态：\n${indent(i.excerpt)}`
        )
        .join('\n\n')
    : '（本章无人出场）'

  const elems = ctx.elements.length
    ? ctx.elements
        .map((i) => `【设定·${i.target.name}】（${i.target.kind}）\n${indent(i.excerpt)}`)
        .join('\n\n')
    : '（无额外设定被召回）'

  const recent = ctx.recent.length
    ? ctx.recent.map((r) => `第${r.chapterNum}章：${r.summary}`).join('\n')
    : '（本章为开篇或尚未生成前情记录）'

  const fh = ctx.openForeshadows.length
    ? ctx.openForeshadows.join('\n')
    : '（无）'

  // 分幕模式：导演板只给本幕的段 + 上一幕末状态；整章模式：全板
  const director = actCtx
    ? renderActDirective(projectName, actCtx.act, { prevState: actCtx.prevState })
    : renderDirectorBoard(projectName, makeDirectorBoard(chapter.curves, chapter.beats))

  const beats = chapter.beats.length
    ? chapter.beats.map((b) => `   ${b.at}%处: ${b.label} — ${b.note}`).join('\n')
    : '   无'

  const scopeNote = actCtx
    ? `\n【写作约定】现在只写第 ${actCtx.idx + 1} / ${actCtx.total} 幕。${actCtx.prevState ? '下面给出上一幕的结尾（你紧接它往下写，人物的处境、体位、现场细节都要顺着来，不要跳戏、不要重开）：\n' + indent(actCtx.prevState) : '这是第一幕，先把场布起来，人物带进来。'}本幕结束时把人物状态、现场情境定格清楚，下一幕将以此继续。只输出本幕的正文本身。`
    : ''

  return `你是网文作家，正在写一部都市小说。以下是本项目的世界观骨干、本章出场的设定与人物状态、前情摘要与未兑现伏笔。
请严格按曲线的情绪走向推进本章，在对应位置落实情节点，并按人物曲线的状态变化塑造人物。
风格要求：感官细节为主，动作直白，血肉充分；避免抽象修辞堆砌；情节要在曲线给出的节奏上起伏。请直接输出正文本身，不要输出任何解释、注释或标题。

【世界观骨干】
${ctx.worldSummary}

【本章出场人物的当前设定状态】
${chars}

【本章相关的设定条目】
${elems}

【前情摘要（本章之前的剧情，久远的已压缩）】
${recent}

【未兑现伏笔（必须要有交代，至少要有推进）】
${fh}

【本章要素（必须逐条落实）】
${chapter.elements || '（暂无）'}

【本章梗概】
${chapter.premise || '（暂无）'}

【导演指令（这是硬命令：本幕每一段的强度与走向都必须被满足）】
${director}

【关键情节点（位置已用百分比标出，到点必须落）】
${beats}
${scopeNote}

现在，写这一段的正文本体：
`
}

function indent(s: string): string {
  return s
    .split('\n')
    .map((line) => '  ' + line)
    .join('\n')
}

let _abort: AbortController | null = null

async function callLLM(prompt: string, opts: GenOpts): Promise<string> {
  _abort?.abort()
  _abort = new AbortController()

  const url = opts.baseUrl.replace(/\/$/, '') + '/chat/completions'
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + opts.apiKey
    },
    body: JSON.stringify({
      model: opts.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.8,
      max_tokens: 4000,
      stream: false
    }),
    signal: _abort.signal
  })
  if (!res.ok) throw new Error(`LLM 请求失败: ${res.status} ${await res.text()}`)
  const data = (await res.json()) as {
    choices?: { message?: { content?: string; reasoning?: string } }[]
  }
  const msg = data.choices?.[0]?.message
  let text = msg?.content ?? ''
  // 推理模型陷阱：max_tokens 不足时正文会整个落在 reasoning 字段，content 为 null
  if (!text && msg?.reasoning) {
    text = msg.reasoning
  }
  if (!text) throw new Error('LLM 返回为空')
  return text
}

/**
 * 分幕生成：把本章按导演板切成 3~6 幕，逐幕单独请求；幕与幕之间靠「上一幕末状态」承接，
 * 让曲线契约整章贯彻。fromAct > 0 时表示「回滚到第 fromAct 幕重写」——前面幕的正文保留，
 * 从 fromAct 起重新请求。
 */
async function generateByActs(
  project: Project,
  chapter: Chapter,
  opts: GenOpts,
  fromAct = 0,
  onAct?: (idx: number, total: number) => void
): Promise<{ text: string; acts: string[]; prompt: string; composition: string }> {
  const ctx = buildAssembledContext(project, chapter)
  const plans = makeDirectorBoard(chapter.curves, chapter.beats)
  const actPlans = planActs(plans)
  const base = (Array.isArray(chapter.acts) ? chapter.acts : []).slice()
  // 回滚前：保留 fromAct 之前的幕（内容 + 用于承接的结尾），后面重写
  const acts = truncateActs(base, fromAct)
  const prompts: string[] = []

  for (let i = fromAct; i < actPlans.length; i++) {
    onAct?.(i, actPlans.length)
    const prev = prevActState(acts, i)
    const prompt = buildPrompt(ctx, chapter, project.name, { act: actPlans[i], prevState: prev, idx: i, total: actPlans.length })
    prompts.push(prompt)
    const text = await callLLM(prompt, opts)
    acts.push(text)
  }

  return {
    text: joinActs(acts),
    acts,
    prompt: prompts.join('\n\n------ 幕分隔 ------'),
    composition: describeComposition(ctx)
  }
}

function abort() {
  _abort?.abort()
}

/** ---------- IPC ---------- */
export function registerGenIpc() {
  ipcMain.handle(
    'gen:generate',
    async (
      _e,
      project: Project,
      chapter: Chapter,
      opts: GenOpts,
      fromAct?: number
    ) => {
      try {
        return { ok: true as const, ...(await generateByActs(project, chapter, opts, fromAct ?? 0)) }
      } catch (err) {
        return { ok: false as const, error: (err as Error).message }
      }
    }
  )
  ipcMain.handle('gen:abort', () => abort())
}
