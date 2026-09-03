// ===== 织卷 S4 · 切片同步：保存正文后把当前切片的设定那几处也一并推进 =====
import type { ProposalItem } from '../../../../shared/types'
import { extractFrontMatter } from '../../../../shared/fmatter'
import { completeJson } from '../agent/llm'
import { useAppStore } from '../../store/app'
import { useProposalStore } from '../../store/proposals'

export async function runSliceSync(projectId: string, chapterRel: string): Promise<{ ok: boolean; items: number; error?: string }> {
  const llm = useAppStore.getState().settings?.llm
  if (!llm?.baseUrl) return { ok: false, items: 0, error: '未配置 LLM，跳过切片同步' }
  const read = (rel: string) => window.zhijuan.readDoc(projectId, rel)
  const ch = (await read(chapterRel)) ?? ''
  const { fm } = extractFrontMatter(ch)
  const slice = String(fm?.['切片'] ?? '')
  const cast = Array.isArray(fm?.['涉及人物']) ? (fm?.['涉及人物'] as string[]) : []
  const parts: string[] = []
  parts.push('【章节正文】' + chapterRel + '\n' + ch)
  for (const c of cast) {
    const t = await read('人物/' + c + '.md')
    if (t) parts.push('【人物档案 ' + c + '】\n' + t)
  }
  if (slice) {
    const t = await read('世界观/' + slice + '.md')
    if (t) parts.push('【世界观切片 ' + slice + '】\n' + t)
  }
  const idx = (await read('素材库/索引.md')) ?? ''
  const sys = [
    '你是织卷的「时间切片同步器」。根据章节正文，把该章对应时间切片的人物状态、世界观变化、环境状态，写成一份“设定补丁”。',
    '要求：',
    '1. 只在正文确有变化时输出；没有任何变化就输出 []。',
    '2. 每条补丁为：{"target":"相对项目根的文件路径","anchor":"要更新小节对应的标题文本（精确到切片名，如：第一幕_雾港之夜；目标文档无此小节则填空串，我们会把它作为新的一小节追加）","kind":"upsert-section","before":"原状态的一句话要点","after":"本小节要写入的完整新内容（markdown 列表即可）","reason":"一句话理由"}',
    '3. target 优先：人物档案 用 人物/<姓名>.md；世界/环境变化用 世界观/<切片名>.md。只允许这两个目录和它们下面已有的文件。',
    '4. after 是“该小节完整的新内容”，不含标题行。人物状态落在其档案里时，内容是几条要点即可。',
    '5. 只输出 JSON 数组本身：不加注释、不加 markdown 围栏、不加任何前后缀文字。',
    '',
    ...parts
  ].join('\n')
  try {
    const items = await completeJson({ baseUrl: llm.baseUrl, model: llm.model, apiKey: llm.apiKey, messages: [{ role: 'system', content: sys }], temperature: 0.2 })
    const clean: ProposalItem[] = (Array.isArray(items) ? items : []).filter((x) => x && x.target && x.after)
    if (!clean.length) return { ok: true, items: 0 }
    const created = await window.zhijuan.createProposals(projectId, 'slice-sync', chapterRel, slice, clean)
    useProposalStore.getState().refresh(projectId)
    return { ok: true, items: created.length }
  } catch (e) {
    return { ok: false, items: 0, error: String((e as Error).message || e) }
  }
}
