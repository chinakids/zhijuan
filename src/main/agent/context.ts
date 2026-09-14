// ===== 织卷 · 创作上下文装配（主进程；模块设计 §11.1「系统侧写自动带上」在 harness 下的真正落地） =====
// 给 harness 的创作路径（runChat / runSync）在系统侧**直接注入 ** 当前章相关的写作半径：
// 当前章正文 + 上一章尾部 + 涉及人物档案 + 当前切片世界观 + 本章章卡 + 本章导演板 + 素材库索引。
// 模型开写就有事实，不必每轮都靠 zj_* 工具现读；要看更多细节仍可再读对应文件。
// 预算硬控（沿 ROADMAP M1.3）：正文 ≤8000、前情 ≤3000、人物 ≤4000、切片 ≤4000、章卡 ≤2000、素材索引 ≤1200。
// 装配口径（2026-09-11）：所有块注入前统一剥离 HTML 注释（`<!-- … -->`＝元信息/说明，非故事事实，
// 见 shared/comments.ts）；不占预算；注释原文模型可 zj_read_doc 现读。
import { readDoc, listChapters, listDocs } from '../store'
import { extractFrontMatter } from '../../shared/fmatter'
import { worldSliceFile } from '../../shared/paths'
import { stripHtmlComments } from '../../shared/comments'
import { matchActPlaceholders } from '../../shared/actsSeg'
import { WCTX_CAPS as CAP } from '../../shared/contextCaps'

export interface WritingContext {
  blocks: string[]
  sources: string[]
}

function firstLineName(rel: string): string {
  return rel.replace(/^(正文|大纲)\//, '').replace(/\.md$/, '')
}

/**
 * 世界切片文件是否只是「模板空壳」：内容只剩标题与 ensureWorldSliceFile 写的固定说明行（无任何事实条目）。
 * 空壳文件不等于「已有设定」——若把它当有基准，会挡住 §6.5 回退链（模型只看到说明行，看不到上一幕的雾），
 * 2026-09-10 修复：readWorldState 对空壳继续回看旧名/回退链。
 */
export function isTemplateShell(text: string): boolean {
  // 剥离 HTML 注释（模板/说明文字以 <!-- … --> 承载，2026-09-11）；注释不算「已有设定」
  const stripped = stripHtmlComments(text)
  return (
    stripped
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
      // 装配前剥离 HTML 注释（元信息非设定，2026-09-11）：模板说明/占位提示/作者备忘不进模型上下文；
      // 注释不占用预算（先剥后截）；模型要看注释原文可 zj_read_doc 现读（工具直读原文）。
      return stripHtmlComments(readDoc(projectId, rel) ?? '')
    } catch {
      return ''
    }
  }

  // 1. 当前章节正文（去 front matter；章首「本章故事要素」块随正文一起带上）
  //    预算硬控边：超长时装配**结尾**（续写/巡查最需要的是刚写到的部分；开头可用 zj_read_doc 现读），
  //    而非默认从头截断——从头截会把「刚写到哪里」裁掉（2026-09-10 上下文审计修复）。
  //    2026-09-12 缺段占位补齐闭环第一步：占位注释（<!-- 分幕草稿缺第 N 段… -->）剥掉前先识别，
  //    提示行随正文块注入——模型要知道「正文断链」，续写/润色才不会把洞当正常衔接去缝合。
  let chRaw = ''
  let actGaps: number[] = []
  if (chapterRel) {
    try {
      const raw = readDoc(projectId, chapterRel) ?? ''
      actGaps = matchActPlaceholders(raw)
      chRaw = stripHtmlComments(raw)
    } catch {
      chRaw = ''
    }
  }
  const { fm } = extractFrontMatter(chRaw)
  chRaw = stripFrontMatter(chRaw)
  if (chRaw.trim() || actGaps.length > 0) {
    const over = chRaw.length - CAP.chapter
    const body =
      over > 0
        ? `（本章正文已超 ${CAP.chapter} 字符预算：装配的是**结尾**部分，前文 ${over} 字符已省略；要看前面内容请用 zj_read_doc 读取本文件）\n…\n${chRaw.slice(-CAP.chapter)}`
        : chRaw
    const gapWarn = actGaps.length
      ? `（⚠️ 本章正文含分幕缺段占位：第 ${actGaps.join('、')} 段未写成（正文断链）——续写/润色请正视此缺口，勿当正常衔接，可建议作者先补齐）\n`
      : ''
    blocks.push(`【当前章节：${chapterRel}】\n${gapWarn}${body}`)
    sources.push(chapterRel)
  }

  // 2. 上一章尾部（承接前情，续写不断片）
  //    2026-09-13 断链承接闭环：与第 1 步当前章同口径——占位注释被剥前先识别，
  //    上一章存在缺段时提示行随「上一章尾部」块注入（承接方模型感知「上一章没写完」；
  //    否则上一章尾部看起来是完整衔接，续写/承接会把断链当正常剧情接续——同「被剥掉
  //    的信息=模型视角的不存在」口径，缺段提示已是上下文第四处省略/缺口明示）。
  const prev = previousChapter(projectId, chapterRel)
  if (prev) {
    let prevRaw = ''
    let prevGaps: number[] = []
    try {
      prevRaw = readDoc(projectId, prev) ?? ''
      prevGaps = matchActPlaceholders(prevRaw)
    } catch {
      prevRaw = ''
    }
    const tail = stripFrontMatter(stripHtmlComments(prevRaw)).slice(-CAP.prevTail)
    const gapWarn = prevGaps.length
      ? `（⚠️ 上一章正文含分幕缺段占位：第 ${prevGaps.join('、')} 段未写成（正文断链）——承接续写请正视此缺口，勿当正常衔接，可建议作者先补齐）\n`
      : ''
    if (tail.trim() || prevGaps.length > 0) {
      blocks.push(`【上一章尾部：${firstLineName(prev)}】（前文略，以下为上一章结尾，用于承接）\n${gapWarn}${tail}`)
      sources.push(prev)
    }
  }

  // 3. 本章涉及人物档案（最多 CAP.maxChars 位）
  //    2026-09-10 审计修复：超 4 位时不能静默裁掉——模型会误以为本章只有 4 人（多人局直接伤创作），
  //    名单本身很便宜，全量给出并注明哪些未附档案（档案仍可 zj_read_doc 现读）。
  //    2026-09-11 预算口径修复：超预算时装配**结尾**——切片同步把最新状态追写在文末
  //    （「## 切片：<切片名>」小节，见 syncAnchor 约定），头部是低频静态的基础档案；
  //    与正文「超长装结尾」同构（创作最需要最新状态），开头可用 zj_read_doc 现读。
  const castAll: string[] = Array.isArray(fm?.['涉及人物']) ? (fm?.['涉及人物'] as string[]) : []
  const cast = castAll.slice(0, CAP.maxChars)
  for (const c of cast) {
    const t = read(`人物/${c}.md`)
    if (t.trim()) {
      const over = t.length - CAP.char
      const body =
        over > 0
          ? `（人物档案已超 ${CAP.char} 字符预算：装配的是**结尾**（最近切片状态）部分，开头 ${over} 字符已省略；要看基础档案请用 zj_read_doc 读取本文件）\n…\n${t.slice(-CAP.char)}`
          : t
      blocks.push(`【人物档案：${c}】\n${body}`)
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
    // 旧名也是空壳/不存在 → 返回空文本，让调用方继续走回退链（模板空壳不挡回退，2026-09-10 修复；
    // 2026-09-13 第三轮审计：旧名分支此前漏判空壳——旧名残留模板（只含说明行）会被当设定注入并挡回退链）。
    const rel = worldSliceFile(name)
    let text = read(rel) ?? ''
    let actual = rel
    if (isTemplateShell(text)) {
      text = read(`世界观/${name}.md`) ?? ''
      actual = `世界观/${name}.md`
      if (isTemplateShell(text)) text = ''
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
    // 2026-09-12 切片装配口径审计收口：世界切片文件=「当刻状态」快照，写入走 applyAnchor 命中
    // H1 整节替换（syncAnchor 归一 target→切片_<名>.md、anchor→「切片：<名>」），无人物档那种
    // 「切片小节追写文末」的追加式结构 → 不存在「最新在尾部」语义，超限**保头**（与正文/人物
    // 的「超长装结尾」不同）；但超限必须给提示（与正文/人物口径同构：模型知道被截、可现读）。
    const over = world.text.length - CAP.slice
    const body =
      over > 0
        ? `（当前切片设定已超 ${CAP.slice} 字符预算：装配的是**开头**部分，末尾 ${over} 字符已省略；要看完整设定请用 zj_read_doc 读取本文件）\n…\n${world.text.slice(0, CAP.slice)}`
        : world.text
    blocks.push(`${world.label}\n${body}`)
    sources.push(world.rel)
  }

  // 5. 本章章卡（若有：一句话定位 / 关键事件 / 钩子 → 写作时记得要还的债）
  if (chapterRel) {
    const cardRel = '大纲/' + chapterRel.replace(/^正文\//, '')
    const t = read(cardRel)
    if (t.trim()) {
      blocks.push(`【本章章卡：${firstLineName(chapterRel)}】\n${capHead(t, CAP.card, '本章章卡', cardRel)}`)
      sources.push(cardRel)
    }
  }

  // 5b. 本章导演板（若有：情绪弧分段 + 行为轴 + 写作红线 + 钩子 → 硬指令：正文必须沿它走）
  if (chapterRel) {
    const dirRel = '大纲/' + chapterRel.replace(/^正文\//, '').replace(/\.md$/, '') + '_导演.md'
    const t = stripFrontMatter(read(dirRel))
    if (t.trim()) {
      blocks.push(`【本章导演板：${firstLineName(chapterRel)}】（硬指令：本段正文的情绪推进、人物行为必须沿导演板的情绪弧分段与行为轴写，红线不许破，钩子到结尾要还）\n${capHead(t, CAP.director, '导演板', dirRel)}`)
      sources.push(dirRel)
    }
  }

  // 6. 素材库索引（只给路标，细节仍 zj_* 现读）
  const idx = read('素材库/索引.md')
  if (idx.trim()) {
    blocks.push(`【素材库索引】\n${capHead(idx, CAP.material, '素材库索引', '素材库/索引.md')}`)
    sources.push('素材库/索引.md')
  }

  return { blocks, sources }
}

/**
 * 项目级上下文（2026-09-11 上下文管理收尾）：未打开章节（chapterRel=null）时 agent 对作品零认知
 * （只有作品根目录路径），首轮全靠 zj_* 现读、回复质量差且浪费轮次。装配三块：
 * 作品总纲 project.md（≤3000，保头——总纲是概要型文档，开头信息密度最高；与正文「保尾」口径不同）、
 * 世界观总纲（≤2000）、各目录文档清单（路标 ≤1200，细节 zj_* 现读）。
 * 只做路标不复制全量：打开的章节上下文仍走 buildWritingContext（本章半径），两者互不干扰。
 */
export async function buildProjectContext(projectId: string): Promise<WritingContext> {
  const blocks: string[] = []
  const sources: string[] = []
  const read = (rel: string): string => {
    try {
      return stripHtmlComments(readDoc(projectId, rel) ?? '')
    } catch {
      return ''
    }
  }
  const proj = read('project.md')
  if (proj.trim()) {
    blocks.push(`【作品总纲】\n${capHead(proj, 3000, '作品总纲', 'project.md')}`)
    sources.push('project.md')
  }
  const world = read('世界观/总纲.md')
  if (world.trim()) {
    blocks.push(`【世界观总纲】\n${capHead(world, 2000, '世界观总纲', '世界观/总纲.md')}`)
    sources.push('世界观/总纲.md')
  }
  const LIST_CAP = 12
  const lines = ['【文档清单】']
  for (const dir of ['正文', '人物', '世界观', '素材库']) {
    const docs = listDocs(projectId, dir)
    const names = docs.slice(0, LIST_CAP).map((d) => d.name)
    const suffix = docs.length > LIST_CAP ? ` 等 ${docs.length} 篇` : ''
    lines.push(`- ${dir}/：${docs.length} 篇${names.length ? '：' + names.join('、') + suffix : ''}`)
  }
  blocks.push(lines.join('\n'))
  return { blocks, sources }
}

function stripFrontMatter(raw: string): string {
  const m = raw.match(/^---\n[\s\S]*?\n---\n/)
  return m ? raw.slice(m[0].length) : raw
}

/**
 * 概要/指令型块的预算截断（保头）+ 超限注明：模型必须知道「这块被截了、还有更多可现读」
 * （2026-09-13 上下文审计第二轮收口：章卡/导演板/素材索引/总纲曾静默截断无提示——模型会把被截块当完整内容）。
 * 与切片「超限保头+注明+可现读」同口径；正文/人物档是「最新在尾部」语义走保尾，不走这里。
 */
function capHead(text: string, cap: number, what: string, rel: string): string {
  const over = text.length - cap
  if (over <= 0) return text
  return `（${what}已超 ${cap} 字符预算：装配的是**开头**部分，末尾 ${over} 字符已省略；要看完整${what}请用 zj_read_doc 读取 ${rel}）\n…\n${text.slice(0, cap)}`
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
