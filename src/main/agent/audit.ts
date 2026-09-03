// ===== 织卷 · 全卷检查子任务（agent-first：一致性巡查 / 冷读报告） =====
// 主进程把作品全卷的正文（截段）与全部设定档案整理成材料包，喂给写作引擎一次**写**结构化 JSON，
// 供 UI 渲染成可逐条转提案的检查报告。和 runSync 同构：独立的 session、无提问、离线出结果。
import { driveSession } from './runtime'
import { readDoc, listChapters, listDocs } from '../store'
import type { ChapterEntry, AuditItem, AuditResult, AuditKind } from '../../shared/types'

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
