// ===== 织卷 · 创作上下文装配（主进程；模块设计 §11.1「系统侧写自动带上」在 harness 下的真正落地） =====
// 给 harness 的创作路径（runChat / runSync）在系统侧**直接注入 ** 当前章相关的写作半径：
// 当前章正文 + 上一章尾部 + 涉及人物档案 + 当前切片世界观 + 本章章卡 + 素材库索引。
// 模型开写就有事实，不必每轮都靠 zj_* 工具现读；要看更多细节仍可再读对应文件。
// 预算硬控（沿 ROADMAP M1.3）：正文 ≤8000、前情 ≤3000、人物 ≤4000、切片 ≤4000、章卡 ≤2000、素材索引 ≤1200。
import { readDoc, listChapters } from '../store'
import { extractFrontMatter } from '../../shared/fmatter'

export interface WritingContext {
  blocks: string[]
  sources: string[]
}

const CAP = { chapter: 8000, prevTail: 3000, char: 4000, slice: 4000, card: 2000, material: 1200, maxChars: 4 }

function firstLineName(rel: string): string {
  return rel.replace(/^(正文|大纲)\//, '').replace(/\.md$/, '')
}

/** 只读装配；任何一步读不到都跳过，绝不因此打断创作 */
export async function buildWritingContext(projectId: string, chapterRel: string): Promise<WritingContext> {
  const blocks: string[] = []
  const sources: string[] = []
  const read = (rel: string): string => {
    try {
      return readDoc(projectId, rel) ?? ''
    } catch {
      return ''
    }
  }

  // 1. 当前章节正文（去 front matter；章首「本章故事要素」块随正文一起带上）
  let chRaw = chapterRel ? read(chapterRel) : ''
  const { fm } = extractFrontMatter(chRaw)
  chRaw = stripFrontMatter(chRaw)
  if (chRaw.trim()) {
    blocks.push(`【当前章节：${chapterRel}】\n${chRaw.slice(0, CAP.chapter)}`)
    sources.push(chapterRel)
  }

  // 2. 上一章尾部（承接前情，续写不断片）
  const prev = previousChapter(projectId, chapterRel)
  if (prev) {
    const tail = stripFrontMatter(read(prev)).slice(-CAP.prevTail)
    if (tail.trim()) {
      blocks.push(`【上一章尾部：${firstLineName(prev)}】（前文略，以下为上一章结尾，用于承接）\n${tail}`)
      sources.push(prev)
    }
  }

  // 3. 本章涉及人物档案（最多 CAP.maxChars 位）
  const cast: string[] = Array.isArray(fm?.['涉及人物']) ? (fm?.['涉及人物'] as string[]) : []
  for (const c of cast.slice(0, CAP.maxChars)) {
    const t = read(`人物/${c}.md`)
    if (t.trim()) {
      blocks.push(`【人物档案：${c}】\n${t.slice(0, CAP.char)}`)
      sources.push(`人物/${c}.md`)
    }
  }

  // 4. 当前时间切片设定
  const slice = String(fm?.['切片'] ?? '')
  if (slice) {
    const t = read(`世界观/${slice}.md`)
    if (t.trim()) {
      blocks.push(`【当前切片设定：${slice}】\n${t.slice(0, CAP.slice)}`)
      sources.push(`世界观/${slice}.md`)
    }
  }

  // 5. 本章章卡（若有：一句话定位 / 关键事件 / 钩子 → 写作时记得要还的债）
  if (chapterRel) {
    const cardRel = '大纲/' + chapterRel.replace(/^正文\//, '')
    const t = read(cardRel)
    if (t.trim()) {
      blocks.push(`【本章章卡：${firstLineName(chapterRel)}】\n${t.slice(0, CAP.card)}`)
      sources.push(cardRel)
    }
  }

  // 6. 素材库索引（只给路标，细节仍 zj_* 现读）
  const idx = read('素材库/索引.md')
  if (idx.trim()) {
    blocks.push(`【素材库索引】\n${idx.slice(0, CAP.material)}`)
    sources.push('素材库/索引.md')
  }

  return { blocks, sources }
}

function stripFrontMatter(raw: string): string {
  const m = raw.match(/^---\n[\s\S]*?\n---\n/)
  return m ? raw.slice(m[0].length) : raw
}

/** 按章号顺序找上一章；当前章不在列表或已是第一章时返回 null */
function previousChapter(projectId: string, chapterRel: string): string | null {
  const cur = chapterRel.replace(/^正文\//, '')
  const all = listChapters(projectId)
    .map((c) => c.file)
    .sort(byChapterNo(projectId))
  const i = all.indexOf(cur)
  return i > 0 ? '正文/' + all[i - 1] : null
}

function byChapterNo(projectId: string) {
  const noOf = (file: string): number => {
    try {
      const fm = extractFrontMatter(readDoc(projectId, '正文/' + file) ?? '').fm as Record<string, unknown>
      const n = Number(fm?.['章号'])
      return Number.isFinite(n) ? n : 1e9
    } catch {
      return 1e9
    }
  }
  return (a: string, b: string) => noOf(a) - noOf(b)
}
