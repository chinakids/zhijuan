// ===== 织卷 agent · 按当前章节装配上下文（模块设计 §11.1） =====
import { extractFrontMatter } from '../../../../shared/fmatter'

export interface AgentContext {
  prompt: string
  sources: string[]
}

/** 上下文 = 当前章正文 + 涉及人物档案 + 当前切片世界观 + 素材库索引（前三者有则带） */
export async function buildAgentContext(projectId: string, chapterRel: string): Promise<AgentContext> {
  const read = (rel: string) => window.zhijuan.readDoc(projectId, rel)
  const chRaw = (await read(chapterRel)) ?? ''
  const { fm } = extractFrontMatter(chRaw)
  const slice = String((fm as Record<string, unknown>)?.['切片'] ?? '')
  const cast = (fm as Record<string, unknown>)?.['涉及人物']
  const chars: string[] = Array.isArray(cast) ? (cast as string[]) : []

  const sources: string[] = []
  const parts: string[] = []
  parts.push(`【当前章节：${chapterRel}】\n${chRaw.slice(0, 8000)}`)
  for (const c of chars) {
    const t = await read(`人物/${c}.md`)
    if (t) {
      parts.push(`【人物档案：${c}】\n${t.slice(0, 4000)}`)
      sources.push(`人物/${c}.md`)
    }
  }
  if (slice) {
    const t = await read(`世界观/${slice}.md`)
    if (t) {
      parts.push(`【当前时间切片设定：${slice}】\n${t.slice(0, 4000)}`)
      sources.push(`世界观/${slice}.md`)
    }
  }
  const idx = await read('素材库/索引.md')
  if (idx) {
    parts.push(`【素材库索引】\n${idx.slice(0, 1500)}`)
    sources.push('素材库/索引.md')
  }

  const prompt =
    '你是「织卷」创作 agent，协助作者（主人）写作。下面是当前的语境资料。请只基于这些资料回答；' +
    '需要给出正文时用 markdown；不要把自己加进故事；结尾用一句简短说明即可。\n\n' +
    parts.join('\n\n')
  return { prompt, sources }
}
