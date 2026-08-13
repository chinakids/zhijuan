import { ipcMain } from 'electron'
import type { Project, Chapter } from '../shared/types'
import { buildAssembledContext, describeComposition } from '../shared/composer'
import { makeDirectorBoard, renderDirectorBoard } from '../shared/director'

/** 用组配器产出的上下文包（AssembledContext）拼 Prompt —— 取代过去的「整包硬塞」 */
function buildPrompt(ctx: ReturnType<typeof buildAssembledContext>, chapter: Chapter, projectName: string): string {
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

  const director = renderDirectorBoard(projectName, makeDirectorBoard(chapter.curves, chapter.beats))

  const beats = chapter.beats.length
    ? chapter.beats.map((b) => `   ${b.at}%处: ${b.label} — ${b.note}`).join('\n')
    : '   无'

  return `你是网文作家，正在写一部都市小说。以下是本项目的世界观骨干、本章出场的设定与人物状态、前情摘要与未兑现伏笔。
请严格按曲线的情绪走向推进本章，在对应位置落实情节点，并按人物曲线的状态变化塑造人物。
风格要求：感官细节为主，动作直白，血肉充分；避免抽象修辞堆砌；情节要在曲线给出的节奏上起伏。字数尽可能多（3000字以上）。请直接输出正文本身，不要输出任何解释、注释或标题。

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

【导演板（以下是本章每一段的硬指令：强度、走向、落差与情节点位置。曲线是命令不是参考，每一场戏都要配得上所在段的要求）】
${chapter.curves.length ? director : '（本章未绘制曲线）——请仍然让本章拥有自己的起伏、层次与一次像样的高潮'}

【关键情节点（它们出现在段落中的位置已用百分比标出）】
${beats}

现在，请写这一章的正文本体：
`
}

function indent(s: string): string {
  return s
    .split('\n')
    .map((line) => '  ' + line)
    .join('\n')
}

let _abort: AbortController | null = null

async function generate(
  project: Project,
  chapter: Chapter,
  opts: { baseUrl: string; model: string; apiKey: string }
): Promise<{ text: string; prompt: string; composition: string }> {
  const ctx = buildAssembledContext(project, chapter)
  const prompt = buildPrompt(ctx, chapter, project.name)
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
      max_tokens: 8000,
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
  return { text, prompt, composition: describeComposition(ctx) }
}

function abort() {
  _abort?.abort()
}

/** ---------- IPC ---------- */
export function registerGenIpc() {
  ipcMain.handle('gen:generate', async (_e, project: Project, chapter: Chapter, opts: { baseUrl: string; model: string; apiKey: string }) => {
    try {
      return { ok: true as const, ...(await generate(project, chapter, opts)) }
    } catch (err) {
      return { ok: false as const, error: (err as Error).message }
    }
  })
  ipcMain.handle('gen:abort', () => abort())
}
