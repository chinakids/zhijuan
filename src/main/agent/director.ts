// ===== 织卷 · 章节导演（V1 导演引擎回接到 V2 的第一块） =====
// 「先设定后成文」的引擎核心：动笔前先用写作引擎把一章导成一张「导演板」——
// 情绪弧分段 + 每段的戏剧任务 + 波峰定位 + 涉事人物的行为轴要求 + 写作红线 + 要还的钩子。
// 与章卡同一约定：结果作为写作副产物**直写**到 大纲/<章>_导演.md，设定类改动才走提案制。
// 素材装配复用 buildWritingContext（与 runChat / runSync 同一创作半径，一处装配多处消费）。
import { readDoc, listChapters, writeDoc } from '../store'
import { extractFrontMatter } from '../../shared/fmatter'
import { buildWritingContext } from './context'
import { registerCapability, runSubtask, type SubtaskDef } from './subtask'
import type { ChapterEntry, DirectorSheet } from '../../shared/types'

export type { DirectorSheet }

export type DirectorResult =
  | { ok: true; written: string; sheet: DirectorSheet; /** 诊断：导演板仍为空时附模型原始回复 */ lastRaw?: string }
  | { ok: false; error: string }

const TASKS = ['推进', '白热化', '拉锯', '低谷'] as const
const LEVELS = ['被压', '试探', '放开'] as const
const MAX_ARCS = 5
const MAX_REDLINES = 5
const MAX_HOOKS = 3

/** 导演板落盘位置：大纲/<章名>_导演.md（与章卡平级，写作副产物） */
export function directorRel(c: ChapterEntry): string {
  return '大纲/' + c.name + '_导演.md'
}

function directorSystem(cast: string[]): string {
  return (
    '你是织卷的「章节导演」。任务：给**一章还没写（或刚开始写）的正文**先导出一张导演板，\n' +
    '让接下来的写作有明确的戏剧任务与红线，而不是自由发挥。你**只导演，不写正文**。\n' +
    '只依据下面材料里的事实论断，材料里没有的写成“待定”，不要编造事件。\n' +
    (cast.length ? `涉及人物（axes 的 character 只能从这里挑，每个涉事人物最多一条）：${cast.join('、')}\n` : '') +
    '\n输出且只输出一个 JSON 对象；不要 markdown 围栏，不要任何前后缀文字，一个字都不要写在 JSON 之外。\n' +
    '严格用这个结构（每个字段各用一句自然话说清，不要展开成段落，最多给规定的条数）：\n' +
    '{\n' +
    '  "premise": "本章戏剧任务一句话：这一章在全书里干什么、要把人物推到什么位置",\n' +
    '  "arcs": [{"task":"推进|白热化|拉锯|低谷", "goal":"这一段要让故事走到哪里（一句具体的话）"}],\n' +
    '  "climax": {"at": 波峰所在段序号(从 1 起), "idea": "一个具体的波峰事件建议（一句）"},\n' +
    '  "axes": [{"character":"人物名", "line":"该人物本章的行动轴一句话", "level":"被压|试探|放开"}],\n' +
    '  "redlines": ["写作红线，最多 5 条，例如不要把谁写崩、别提前揭穿什么"],\n' +
    '  "hooks": ["本章应当响应的旧钩子或可新埋的钩子，最多 3 条"]\n' +
    '}\n' +
    '要求：arcs 最多 5 段，按从铺垫到结果的方向排；task 只能从 推进/白热化/拉锯/低谷 里选；\n' +
    'climax.at 落在 arcs 的范围内；没有涉及人物时 axes 给空数组。'
  )
}

/** 从模型回复里稳健提取导演板（白名单清洗 + 条数上限；axes 人物只在已知清单里留） */
export function extractDirector(text: string, cast?: string[]): DirectorSheet {
  let obj: any = null
  try {
    obj = JSON.parse(text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim())
  } catch {}
  if (!obj) {
    const a = text.indexOf('{')
    const b = text.lastIndexOf('}')
    if (a >= 0 && b > a) {
      try {
        obj = JSON.parse(text.slice(a, b + 1))
      } catch {}
    }
  }
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
  const known = cast ? new Set(cast) : null
  const arcs = (Array.isArray(obj?.arcs) ? obj.arcs : [])
    .map((a: any) => ({ task: str(a?.task), goal: str(a?.goal).slice(0, 120) }))
    .filter((a: { task: string; goal: string }) => (TASKS as readonly string[]).includes(a.task) && a.goal)
    .slice(0, MAX_ARCS)
  let at = Number(obj?.climax?.at)
  if (!Number.isFinite(at)) at = arcs.length > 0 ? arcs.length : 1
  const axes = (Array.isArray(obj?.axes) ? obj.axes : [])
    .map((a: any) => ({ character: str(a?.character), line: str(a?.line).slice(0, 120), level: str(a?.level) }))
    .filter(
      (a: { character: string; level: string }) =>
        a.character && (!known || known.has(a.character)) && (LEVELS as readonly string[]).includes(a.level)
    )
    .slice(0, 8)
  const arr = (v: unknown, n: number) =>
    (Array.isArray(v) ? v : [])
      .map((x) => str(x).slice(0, 100))
      .filter(Boolean)
      .slice(0, n)
  return {
    premise: str(obj?.premise).slice(0, 300),
    arcs,
    climax: { at: Math.max(1, Math.min(arcs.length, at)), idea: str(obj?.climax?.idea).slice(0, 200) },
    axes,
    redlines: arr(obj?.redlines, MAX_REDLINES),
    hooks: arr(obj?.hooks, MAX_HOOKS)
  }
}

/** 导演板 → markdown（随章卡一起落在 大纲/ 目录，供正文页左侧查看） */
export function directorToDoc(sheet: DirectorSheet, c: ChapterEntry): string {
  const no = c.fm?.['章号'] as number | undefined
  const title = (c.fm?.['题名'] as string | undefined) ?? c.name
  const slice = ((c.fm?.['切片'] as string | undefined) ?? '')
  const lines = [
    '---',
    `章号: ${no ?? ''}`,
    `题名: ${title}`,
    `切片: ${slice}`,
    '状态: 已生成',
    '---',
    '',
    `# 导演板 · 第${no ?? '?'}章 ${title}`,
    '',
    '> 对应正文：正文/' + c.file,
    '',
    '## 本章戏剧任务',
    '',
    sheet.premise || '（待定）',
    '',
    '## 情绪弧分段',
    ''
  ]
  if (!sheet.arcs.length) lines.push('（待定）', '')
  for (let i = 0; i < sheet.arcs.length; i++) {
    lines.push(`${i + 1}. **${sheet.arcs[i].task}**：${sheet.arcs[i].goal}`)
  }
  lines.push('', '## 波峰', '', `第 ${sheet.climax.at} 段 · ${sheet.climax.idea || '（待定）'}`, '', '## 人物行为轴', '')
  if (!sheet.axes.length) lines.push('（待定）', '')
  for (const a of sheet.axes) {
    lines.push(`- **${a.character}（${a.level}）**：${a.line}`)
  }
  lines.push('', '## 写作红线（不许破）', '')
  if (!sheet.redlines.length) lines.push('（待定）', '')
  for (const r of sheet.redlines) lines.push(`- ${r}`)
  lines.push('', '## 钩子（要还的债 / 可新埋）', '')
  if (!sheet.hooks.length) lines.push('（待定）', '')
  for (const h of sheet.hooks) lines.push(`- ${h}`)
  lines.push('')
  return lines.join('\n')
}

const directorDef: SubtaskDef<DirectorSheet> = {
  id: 'director',
  title: '章节导演',
  description: '动笔前先出一张本章导演板（情绪弧分段＋行为轴＋红线），落 大纲/<章>_导演.md',
  maxMs: 6 * 60 * 1000,
  buildParts: async (c) => {
    const chapterRel = String(c.args?.chapterRel ?? '')
    const cast = Array.isArray(c.args?.cast) ? (c.args?.cast as string[]).filter(Boolean) : []
    const req = String((c.args?.requirement as string | undefined) ?? '').trim()
    const ctx = await buildWritingContext(c.projectId, chapterRel)
    const parts = [directorSystem(cast)]
    // 作者要求（/导演 参数）：紧跟系统指令、先于材料，钉在权威位置（2026-09-12 接线，此前参数被静默丢弃）
    if (req) parts.push('【作者要求】' + req)
    for (const b of ctx.blocks) parts.push(b)
    if (ctx.blocks.length === 0) parts.push('【材料】没有可用的章节材料：请在最前面写上“先生成章节要素再导演”。')
    return parts
  },
  parse: (text, c) => extractDirector(text, Array.isArray(c.args?.cast) ? (c.args?.cast as string[]) : []),
  retry: {
    check: (r) => !r.premise || !r.arcs.length,
    prompt: '上次输出没有被解析成要求的 JSON。这次只输出一个 JSON 对象，先写左花括号 {，字段务必齐全（premise 必有、arcs 至少一段），不要任何前后缀文字。'
  }
}
registerCapability(directorDef as never)

/**
 * 进行中导演任务的取消标记（按 token；2026-09-12 对话流收尾）。
 * 语义与 chat 的「展示性取消」同源：只能保证「不再等你、不再落资产」，
 * 底层模型请求已发出时会在边上跑完（dsh 边车无外部中断口，与 runChat 同局限）。
 */
const directorCancels = new Map<string, boolean>()
export function cancelDirector(token: string): void {
  if (directorCancels.has(token)) directorCancels.set(token, true)
}

/** 导出一章的导演板并落盘（由 IPC 呼叫方挂起等待；结果可随时重导覆盖） */
export async function runDirector(projectId: string, chapterRel: string, requirement?: string, cancelToken?: string): Promise<DirectorResult> {
  const rel = chapterRel.replace(/^正文\//, '')
  const ch = listChapters(projectId).find((x) => x.file === rel)
  if (!ch) return { ok: false, error: '找不到该章节。' }
  const fm = extractFrontMatter(readDoc(projectId, chapterRel) ?? '').fm as Record<string, unknown>
  const cast = Array.isArray(fm?.['涉及人物']) ? (fm?.['涉及人物'] as string[]) : []
  if (cancelToken) directorCancels.set(cancelToken, false)
  try {
    const out = await runSubtask(directorDef as never, projectId, {
      chapterRel,
      cast,
      requirement: (requirement ?? '').trim() || undefined
    })
    if (!out.ok) return { ok: false, error: out.error }
    // 取消语义：用户已点停止 → 不再落资产（导演板不进 大纲/）
    if (cancelToken && directorCancels.get(cancelToken)) return { ok: false, error: '已取消' }
    const sheet = out.result as DirectorSheet
    const written = directorRel(ch)
    writeDoc(projectId, written, directorToDoc(sheet, ch))
    return { ok: true, written, sheet, ...(out.lastRaw ? { lastRaw: out.lastRaw } : {}) }
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e).slice(0, 300) }
  } finally {
    if (cancelToken) directorCancels.delete(cancelToken)
  }
}
