// ===== 织卷 · 全卷检查子任务（agent-first：一致性巡查 / 冷读报告） =====
// 主进程把作品全卷的正文（截段）与全部设定档案整理成材料包，喂给写作引擎一次**写**结构化 JSON，
// 供 UI 渲染成可逐条转提案的检查报告。和 runSync 同构：独立的 session、无提问、离线出结果。
import { driveSession } from './runtime'
import { readDoc, listChapters, listDocs } from '../store'
import type {
  ChapterEntry,
  AuditItem,
  AuditResult,
  AuditKind,
  ChapterCheckKind,
  ChapterCheckResult,
  ChapterCheckItem,
  RevisionLayer
} from '../../shared/types'

export type { AuditKind, AuditItem, AuditResult }

let runSeq = 0
const newSid = (projectId: string) => 'aud-' + Date.now().toString(36) + '-' + (runSeq++).toString(36) + '-' + projectId

/** 正文去掉 front matter（约定头） */
function stripFm(raw: string): string {
  const m = raw.match(/^---\n[\s\S]*?\n---\n/)
  return m ? raw.slice(m[0].length) : raw
}

/** 超长段落取 前段+要空+尾段，保证素材包可控 */
function clip(text: string, head = 2400, tail = 1400): string {
  if (text.length <= head + tail) return text
  return text.slice(0, head) + '\n……（此处为节省篇幅省略中部）……\n' + text.slice(-tail)
}

/** 组装“当前全卷”材料包：全部章节（每章节段式）+ 人物 · 世界观全档（截段） */
function volumeBrief(projectId: string): string {
  const parts: string[] = []
  parts.push('【全部章节正文（按章节顺序，可能节段）】')
  for (const c of listChapters(projectId)) {
    const raw = readDoc(projectId, '正文/' + c.file) ?? ''
    const body = stripFm(raw)
    if (!body.trim()) continue
    parts.push(`\n### ${chapterHead(c)}\n${clip(body)}`)
  }
  parts.push('\n【当前设定档案】')
  for (const dir of ['人物', '世界观']) {
    for (const d of listDocs(projectId, dir)) {
      const t = readDoc(projectId, dir + '/' + d.file) ?? ''
      if (!t.trim()) continue
      parts.push(`\n### ${dir}/${d.file}\n${clip(t, 1800, 800)}`)
    }
  }
  return parts.join('\n')
}

function chapterHead(c: ChapterEntry): string {
  const no = c.fm?.['章号']
  const t = c.fm?.['题名']
  return no !== undefined ? `第${no}章${t ? ' · ' + t : ''}（正文/${c.file}）` : `（正文/${c.file}）`
}

function auditSystem(kind: AuditKind): string {
  if (kind === 'consistency') {
    return (
      '你是织卷的「一致性巡查员」。下面给出了作品的全卷正文摘录与当前全部设定档案。\n' +
      '请按设定逐条对照正文，找出并只列出确有依据的问题：\n' +
      '- 设定冲突：正文某处写的与人物档案或世界观一致（颜色、年龄、称谓、器物、地点、能力等）；\n' +
      '- 时间线破损：先后顺序、时长、日期的矛盾；\n' +
      '- 伏笔异状：某句话或物件像是伏笔却无处回收，或前文已埋的本应在这里呼应却忘了；\n' +
      '- 人物漂移：性格、说话方式、关系与档案或与前文明显相悖。\n' +
      '要求：只根据上面材料判断，不要臆测；每条都要能在材料里有对应依据；不要提出材料里没有的“改进建议”。\n' +
      '输出且只输出一个 JSON 对象（不要 markdown 围栏、不要任何前后缀文字）：\n' +
      '{"summary":"一段话总结当前最刺眼的一到两个问题","items":[' +
      '{"severity":"high|medium|low","type":"setting-conflict|timeline|foreshadow|character-drift",' +
      '"where":"出现位置（章节名或文件，尽量给到能定位的信息）","what":"问题的一句话现象",' +
      '"suggest":"可落地修改的一句话建议","target":"建议写进的目标文件（如 人物/林西.md；给不出则不带这个字段）"}]}\n' +
      '没有发现就 items 空数组。'
    )
  }
  return (
    '你是织卷的「资深外审」：一位严格但共情的职业编辑。下面给出了这部作品的全卷正文摘录。\n' +
      '请写下本可在工作台使用的“冷读报告”：先从结构、节奏、可信度给出整体判断，再列出具体可操作的发现。\n' +
      '要求：说人话、给作者改变的依据；指出问题也要给出做法的方向；不客套；每条都要能回到材料。\n' +
      '输出且只输出一个 JSON 对象（不要 markdown 围栏、不要任何前后缀文字）：\n' +
      '{"summary":"一句话：这本书现在最需要动的一次是什么","items":[' +
      '{"severity":"high|medium|low","type":"structure|pacing|character|prose|foreshadow",' +
      '"where":"哪一章或哪一处最能说明","what":"一句话的问题","suggest":"一句话的改法",' +
      '"target":"若这条建议关联到某个设定文件给路径（人物/… 或 世界观/…），否则省略"}]}\n' +
      '没有发现就 items 空数组。'
  )
}

export async function runAudit(
  projectId: string,
  kind: AuditKind
): Promise<{ ok: true; result: AuditResult } | { ok: false; error: string }> {
  const parts: string[] = []
  parts.push(auditSystem(kind))
  parts.push(volumeBrief(projectId))
  parts.push(kind === 'consistency' ? '请给出巡查报告 JSON。' : '请给出冷读报告 JSON。')
  try {
    const text = await driveSession(newSid(projectId), parts.join('\n\n'), { maxMs: 8 * 60 * 1000 })
    const result = extractAudit(text)
    return { ok: true, result }
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e).slice(0, 300) }
  }
}

/** 从模型回复里稳健提取审计 JSON 对象 */
export function extractAudit(text: string): AuditResult {
  const clean = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
  let obj: any = null
  try {
    obj = JSON.parse(clean)
  } catch {}
  if (!obj) {
    const a = clean.indexOf('{')
    const b = clean.lastIndexOf('}')
    if (a >= 0 && b > a) {
      try {
        obj = JSON.parse(clean.slice(a, b + 1))
      } catch {}
    }
  }
  const items = Array.isArray(obj?.items)
    ? (obj.items as any[])
        .filter((x) => x && typeof x === 'object' && typeof x.what === 'string')
        .map((x) => ({
          severity: x.severity === 'high' ? 'high' : x.severity === 'low' ? 'low' : 'medium',
          type: typeof x.type === 'string' ? x.type : 'misc',
          where: typeof x.where === 'string' ? x.where : '',
          what: x.what,
          suggest: typeof x.suggest === 'string' ? x.suggest : '',
          ...(typeof x.target === 'string' && x.target ? { target: x.target } : {})
        })) as AuditItem[]
    : []
  return { summary: typeof obj?.summary === 'string' ? obj.summary : '', items }
}

// ===== 本章级小环：每章短巡查（chapter）/ 分层修订（revision） =====
// 与全卷检查同构（driveSession 一次结构化 JSON），但参数 reduced：目标单章 + 更省的材料包，
// 只带本章全文与现有设定档案的小截段，跑得轻，沿写作线随时可兜底。

/** 本章材料包：本章全文（整段不省略）+ 人物 · 世界观档案（小截段）+ 素材库目录名（给修订时参考） */
function chapterBrief(projectId: string, chapterRel: string, body: string): string {
  const parts: string[] = []
  parts.push(`【当前章节】（正文/${chapterRel}）\n${body.slice(0, 9000)}`)
  if (body.length > 9000) parts[parts.length - 1] += '\n……（本章更长，已截前段）……'
  parts.push('\n【当前设定档案（节选）】')
  for (const dir of ['人物', '世界观']) {
    for (const d of listDocs(projectId, dir)) {
      const t = readDoc(projectId, dir + '/' + d.file) ?? ''
      if (!t.trim()) continue
      parts.push(`\n### ${dir}/${d.file}\n${clip(t, 1200, 500)}`)
    }
  }
  parts.push('\n【素材库现有类别】')
  const cats = new Set<string>()
  for (const d of listDocs(projectId, '素材库')) {
    if (d.file.startsWith('采集池') || d.file === '索引.md') continue
    const top = d.file.split('/')[0]
    if (top && top !== d.file) cats.add(top)
    else cats.add('（根目录散卡）')
  }
  parts.push(cats.size ? [...cats].join('、') : '（暂无正式类别）')
  return parts.join('\n')
}

function chapterCheckSystem(kind: ChapterCheckKind): string {
  if (kind === 'chapter') {
    return (
      '你是织卷的「本章快查员」。写作进行中，下面给出了当前这一章的正文，以及人物 / 世界观档案的节选。\n' +
      '请做一次**短巡查**：对照设定档案，只列本章确有依据的刺点（设定冲突、时间线破损、伏笔异状、人物漂移），\n' +
      '以及会立刻影响读者可信度的小硬伤。不必全卷扫描，专注本章。只根据上面材料判断，不要臆测。\n' +
      '输出且只输出一个 JSON 对象（不要 markdown 围栏、不要任何前后缀文字）：\n' +
      '{"summary":"一段话总结本章现在最需要处理的一到两个点","items":[' +
      '{"severity":"high|medium|low","type":"setting-conflict|timeline|foreshadow|character-drift",' +
      '"where":"出现位置（尽量给到能定位的一句话）","what":"问题的一句话现象",' +
      '"suggest":"可落地修改的一句话建议","target":"建议写进的目标设定文件（人物/… 或 世界观/…；给不出则不带"}]}\n' +
      '没有发现就 items 空数组。'
    )
  }
  return (
    '你是织卷的「分层修订师」。下面给出了当前章节全文与设定档案节选。\n' +
      '请按**故事层 → 场景层 → 词句层**的顺序给出本章的修订单（改稿时先定大方向，再进细节）：\n' +
      '- story：这一章的定位、动机、冲突、取舍是否有问题，怎么收才让全篇更好；\n' +
      '- scene：单个场景的进入/退出、切换、节奏、可信度、连续性问题；\n' +
      '- prose：具体到句子的改法（也可以直接给出替换后的写法片段）。\n' +
      '要求：只依据上面材料；每条都给出能操作的改法（suggest），不要空谈；同一条只归到最合适的一层；最多给 8 条。\n' +
      '格式纪律（重要）：你的整个回答只能是下面这个 JSON 对象，一个字都不要写在 JSON 之外（不要 markdown 围栏、不要开头结尾的话）；每条记录的各字段各用一句自然话说清，不要展开成段落，suggest 要具体但简短：\n' +
      '{"summary":"一句话：这一章现在最值得先改的是什么","items":[' +
      '{"severity":"high|medium|low","layer":"story|scene|prose","where":"正文中的位置（尽量给到句子级定位）",' +
      '"what":"问题的一句话现象","suggest":"可执行的修改指令或一两句替换写法",' +
      '"target":"若这条关联到某个设定文件给路径（人物/… 或 世界观/…），否则省略"}]}\n' +
      '如果没有值得写的就整体输出 {"summary":"","items":[]}。'
    )
}

/** 从模型回复里稳健提取本章检查 JSON */
/** 现有设定档案清单（人物/世界观），给模型挑 target 用 */
export function settingList(projectId: string): string[] {
  const out: string[] = []
  for (const dir of ['人物', '世界观']) {
    for (const d of listDocs(projectId, dir)) out.push(dir + '/' + d.file)
  }
  return out
}

export function extractChapterCheck(text: string, knownTargets?: Set<string>): ChapterCheckResult {
  const clean = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
  let obj: any = null
  try {
    obj = JSON.parse(clean)
  } catch {}
  if (!obj) {
    const a = clean.indexOf('{')
    const b = clean.lastIndexOf('}')
    if (a >= 0 && b > a) {
      try {
        obj = JSON.parse(clean.slice(a, b + 1))
      } catch {}
    }
  }
  const layers: RevisionLayer[] = ['story', 'scene', 'prose']
  const items = Array.isArray(obj?.items)
    ? (obj.items as any[])
        .filter((x) => x && typeof x === 'object' && typeof x.what === 'string')
        .map((x) => ({
          severity: x.severity === 'high' ? 'high' : x.severity === 'low' ? 'low' : 'medium',
          type: typeof x.type === 'string' ? x.type : 'misc',
          ...(layers.includes(x.layer) ? { layer: x.layer as RevisionLayer } : {}),
          where: typeof x.where === 'string' ? x.where : '',
          what: x.what,
          suggest: typeof x.suggest === 'string' ? x.suggest : '',
          ...(typeof x.target === 'string' && x.target && (!knownTargets || knownTargets.has(x.target)) ? { target: x.target } : {})
        })) as ChapterCheckItem[]
    : []
  return { summary: typeof obj?.summary === 'string' ? obj.summary : '', items }
}

export async function runChapterCheck(
  projectId: string,
  chapterRel: string,
  kind: ChapterCheckKind
): Promise<{ ok: true; result: ChapterCheckResult } | { ok: false; error: string }> {
  const raw = readDoc(projectId, chapterRel) ?? ''
  const body = stripFm(raw)
  if (!body.trim()) return { ok: false, error: '当前章节还没有内容，先写一点再检查。' }
  const parts: string[] = [chapterCheckSystem(kind)]
  parts.push(chapterBrief(projectId, chapterRel, body))
  parts.push(kind === 'chapter' ? '请给出本章短巡查报告 JSON。' : '请给出分层修订单 JSON。')
  try {
    let text = await driveSession(newSid(projectId) + '-ch', parts.join('\n\n'), { maxMs: 6 * 60 * 1000 })
    let result = extractChapterCheck(text, new Set(settingList(projectId)))
    // 空结果（即模型跑偏成非 JSON 的散文）时，重试一次并强令只输出 JSON
    if (!result.summary && !result.items.length) {
      text = await driveSession(newSid(projectId) + '-ch2', parts.join('\n\n') + '\n\n【提醒】上一次回答没有解析成要求的 JSON。这次请只原样输出一个 JSON 对象，先输出左花括号 {，别的什么也不要写。', { maxMs: 4 * 60 * 1000 })
      result = extractChapterCheck(text, new Set(settingList(projectId)))
    }
    return { ok: true, result }
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e).slice(0, 300) }
  }
}
