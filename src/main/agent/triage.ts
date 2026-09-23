// ===== 织卷 · 素材→设定升格（agent-first：素材库按语境归类 + 判可否入档） =====
// 把素材库正式类别下的素材卡按语境逐条归类，并判每条「可入档与否」，给出建议去向；
// 结果为结构化 JSON，UI 渲染成清单，可把 verdict=promote 且有 target 的条目一键转提案（沿用提案需确认再写入）。
import { readDoc, listDocs } from '../store'
import { registerCapability, runSubtask, clip, type SubtaskDef } from './subtask'
import type { TriageResult, TriageVerdict } from '../../shared/types'

/** 素材库正式类别下的素材清单（排除采集池任务卡与索引） */
function materialList(projectId: string): { file: string; name: string }[] {
  return listDocs(projectId, '素材库')
    .filter((d) => !d.file.startsWith('采集池') && d.file !== '索引.md')
    .map((d) => ({ file: '素材库/' + d.file, name: d.name }))
}

/** 现有设定档案清单（人物/世界观），给模型挑 target 用 */
function settingList(projectId: string): string[] {
  const out: string[] = []
  for (const dir of ['人物', '世界观']) {
    for (const d of listDocs(projectId, dir)) out.push(dir + '/' + d.file)
  }
  return out
}

function triageSystem(): string {
  return (
    '你是织卷的「素材升格师」。下面给出素材库里的素材卡（文件路径 + 内容节选），以及作品现有的设定档案清单（人物 / 世界观）。\n' +
    '请为每条素材做一次「可入档」判断：\n' +
    '- verdict：promote（信息完整、足够具体，值得直接升格进设定档案，让写作时被召回）/ reference（写法或细节可借鉴，保持素材即可）/ skip（用处不大）；\n' +
    '- category：这条素材应当归属的素材库类别（可沿用已有类别名，如 桥段 / 人物原型 / 环境 / 器物）；\n' +
    '- what：素材核心内容的一句话说明；\n' +
    '- suggestion：一句可操作的建议（升格后写什么、或怎么用）；\n' +
    '- target：当 verdict=promote 时，给出建议入档的设定文件——必须是下面清单里已有的文件（格式如 人物/韩青.md 或 世界观/总纲.md）；给不出合适的就不带 target。\n' +
    '要求：只根据下面材料判断，不要臆测；每条素材都给出 verdict。\n' +
    '输出且只输出一个 JSON 对象（不要 markdown 围栏、不要任何前后缀文字）：\n' +
    '{"summary":"一段话总结素材库当前的整体情况与最值得先入档的一条","items":[' +
    '{"file":"素材库/路径.md","verdict":"promote|reference|skip","category":"…","what":"…","suggestion":"…","target":"人物/….md"}]}'
  )
}

/** 从模型回复里稳健提取升格清单；只保留入参里真实存在的素材文件，防模型编造条目 */
export function extractTriage(text: string, known: Set<string>): TriageResult {
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
  const verdicts: TriageVerdict[] = ['promote', 'reference', 'skip']
  const items = Array.isArray(obj?.items)
    ? (obj.items as any[])
        .filter((x) => x && typeof x?.file === 'string' && known.has(x.file))
        .map((x) => ({
          file: x.file,
          name: x.file.replace(/\.md$/, '').split('/').pop() ?? x.file,
          verdict: verdicts.includes(x.verdict) ? (x.verdict as TriageVerdict) : 'reference',
          category: typeof x.category === 'string' ? x.category : '',
          what: typeof x.what === 'string' ? x.what : '',
          suggestion: typeof x.suggestion === 'string' ? x.suggestion : '',
          ...(typeof x.target === 'string' && x.target ? { target: x.target } : {})
        }))
    : []
  return { summary: typeof obj?.summary === 'string' ? obj.summary : '', items }
}

const triageDef: SubtaskDef<TriageResult> = {
  id: 'triage',
  title: '素材升格',
  description: '把素材库正式类下的素材卡按语境归类并判可否入档',
  maxMs: 7 * 60 * 1000,
  buildParts: (c) => {
    const mats = materialList(c.projectId)
    if (!mats.length) throw new Error('素材库还没有正式素材卡（采集池里的任务卡不算）。')
    const known = mats.map((m) => m.file)
    const settings = settingList(c.projectId)
    c.args = { ...c.args, known, settings }
    const parts: string[] = [triageSystem()]
    parts.push('【素材库素材卡】')
    for (const m of mats) {
      const t = readDoc(c.projectId, m.file) ?? ''
      if (!t.trim()) continue
      parts.push(`\n### ${m.file}\n${clip(t)}`)
    }
    parts.push('\n【现有设定档案清单】')
    parts.push(settings.map((f) => '- ' + f).join('\n') || '（暂无人物/世界观档案）')
    parts.push('请给出素材升格清单 JSON。')
    return parts
  },
  parse: (text, c) => extractTriage(text, new Set((c.args?.known as string[]) ?? [])),
  postprocess: (result, c) => {
    // 校验：target 必须是现有设定档案（防模型编造或写错路径）
    if (result.items.length) {
      const settings = new Set((c.args?.settings as string[]) ?? [])
      result.items = result.items.map((it) => (it.target && settings.has(it.target) ? it : { ...it, target: undefined }))
    }
    return result
  }
}
registerCapability(triageDef as never)

export async function runMaterialTriage(
  projectId: string
): Promise<{ ok: true; result: TriageResult; lastRaw?: string } | { ok: false; error: string }> {
  return runSubtask(triageDef, projectId)
}
