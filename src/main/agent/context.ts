// ===== 织卷 · 创作上下文装配（主进程；模块设计 §11.1「系统侧写自动带上」在 harness 下的真正落地） =====
// 给 harness 的创作路径（runChat / runSync）在系统侧**直接注入 ** 当前章相关的写作半径：
// 当前章正文 + 上一章尾部 + 涉及人物档案 + 当前切片世界观 + 本章章卡 + 本章导演板 + 素材库索引。
// 模型开写就有事实，不必每轮都靠 zj_* 工具现读；要看更多细节仍可再读对应文件。
// 预算硬控（沿 ROADMAP M1.3）：正文 ≤8000、前情 ≤3000、人物 ≤4000、切片 ≤4000、章卡 ≤2000、素材索引 ≤1200。
import { readDoc, listChapters } from '../store'
import { extractFrontMatter } from '../../shared/fmatter'
import { worldSliceFile } from '../../shared/paths'

export interface WritingContext {
  blocks: string[]
  sources: string[]
}

const CAP = { chapter: 8000, prevTail: 3000, char: 4000, slice: 4000, card: 2000, director: 2500, material: 1200, maxChars: 4 }

function firstLineName(rel: string): string {
  return rel.replace(/^(正文|大纲)\//, '').replace(/\.md$/, '')
}

/**
 * 世界切片文件是否只是「模板空壳」：内容只剩标题与 ensureWorldSliceFile 写的固定说明行（无任何事实条目）。
 * 空壳文件不等于「已有设定」——若把它当有基准，会挡住 §6.5 回退链（模型只看到说明行，看不到上一幕的雾），
 * 2026-09-10 修复：readWorldState 对空壳继续回看旧名/回退链。
 */
export function isTemplateShell(text: string): boolean {
  return (
    text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && !l.startsWith('> 本切片的世界状态'))
      .length === 0
  )
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
  //    预算硬控边：超长时装配**结尾**（续写/巡查最需要的是刚写到的部分；开头可用 zj_read_doc 现读），
  //    而非默认从头截断——从头截会把「刚写到哪里」裁掉（2026-09-10 上下文审计修复）。
  let chRaw = chapterRel ? read(chapterRel) : ''
  const { fm } = extractFrontMatter(chRaw)
  chRaw = stripFrontMatter(chRaw)
  if (chRaw.trim()) {
    const over = chRaw.length - CAP.chapter
    const body =
      over > 0
        ? `（本章正文已超 ${CAP.chapter} 字符预算：装配的是**结尾**部分，前文 ${over} 字符已省略；要看前面内容请用 zj_read_doc 读取本文件）\n…\n${chRaw.slice(-CAP.chapter)}`
        : chRaw
    blocks.push(`【当前章节：${chapterRel}】\n${body}`)
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
  //    2026-09-10 审计修复：超 4 位时不能静默裁掉——模型会误以为本章只有 4 人（多人局直接伤创作），
  //    名单本身很便宜，全量给出并注明哪些未附档案（档案仍可 zj_read_doc 现读）。
  const castAll: string[] = Array.isArray(fm?.['涉及人物']) ? (fm?.['涉及人物'] as string[]) : []
  const cast = castAll.slice(0, CAP.maxChars)
  for (const c of cast) {
    const t = read(`人物/${c}.md`)
    if (t.trim()) {
      blocks.push(`【人物档案：${c}】\n${t.slice(0, CAP.char)}`)
      sources.push(`人物/${c}.md`)
    }
  }
  if (castAll.length > cast.length) {
    blocks.push(
      `【涉及人物补充】本章「涉及人物」共 ${castAll.length} 位：${castAll.join('、')}。已附前 ${cast.length} 位档案；其余未附档案——若写到时需要其设定，请用 zj_read_doc 读取 人物/<姓名>.md。`
    )
  }

  // 4. 当前时间切片设定（文件名约定 世界观/切片_<切片名>.md；兼容早期无「切片_」前缀的文件）
  //    本切片尚无设定文件时按模块设计 §6.5 逐级回退：上一章切片状态 → 总纲（长期不变项），
  //    保证「先文沉淀」的世界状态能从上一章流进本章上下文（否则第二幕建模时看不到第一幕的雾）。
  const slice = String(fm?.['切片'] ?? '')
  const readWorldState = (name: string): { text: string; rel: string } => {
    // 新名优先；新名若是「模板空壳」（只有 ensureWorldSliceFile 写的标题+说明行，无事实）则回看旧无前缀名，
    // 两者皆空壳/不存在 → 返回空文本，让调用方继续走回退链（模板空壳不挡回退，2026-09-10 修复）。
    const rel = worldSliceFile(name)
    let text = read(rel) ?? ''
    let actual = rel
    if (isTemplateShell(text)) {
      text = read(`世界观/${name}.md`) ?? ''
      actual = `世界观/${name}.md`
    }
    return { text, rel: actual }
  }
  let world: { text: string; rel: string; label: string } | null = null
  if (slice) {
    const w = readWorldState(slice)
    if (w.text.trim()) world = { text: w.text, rel: w.rel, label: `【当前切片设定：${slice}】` }
  }
  if (!world && prev) {
    const prevFm = extractFrontMatter(read(prev) ?? '').fm as Record<string, unknown>
    const prevSlice = String(prevFm?.['切片'] ?? '')
    if (prevSlice) {
      const w = readWorldState(prevSlice)
      if (w.text.trim()) world = { text: w.text, rel: w.rel, label: `【上一切片设定：${prevSlice}】（本切片设定尚未落档，以前一切片为基准）` }
    }
  }
  if (!world) {
    const t = read('世界观/总纲.md')
    if (t.trim()) world = { text: t, rel: '世界观/总纲.md', label: '【世界观总纲】（本切片无设定文件，以长期设定为基准）' }
  }
  if (world) {
    blocks.push(`${world.label}\n${world.text.slice(0, CAP.slice)}`)
    sources.push(world.rel)
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

  // 5b. 本章导演板（若有：情绪弧分段 + 行为轴 + 写作红线 + 钩子 → 硬指令：正文必须沿它走）
  if (chapterRel) {
    const dirRel = '大纲/' + chapterRel.replace(/^正文\//, '').replace(/\.md$/, '') + '_导演.md'
    const t = stripFrontMatter(read(dirRel))
    if (t.trim()) {
      blocks.push(`【本章导演板：${firstLineName(chapterRel)}】（硬指令：本段正文的情绪推进、人物行为必须沿导演板的情绪弧分段与行为轴写，红线不许破，钩子到结尾要还）\n${t.slice(0, CAP.director)}`)
      sources.push(dirRel)
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
