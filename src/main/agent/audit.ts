// ===== 织卷 · 全卷检查子任务（agent-first：一致性巡查 / 冷读报告） =====
// 主进程把作品全卷的正文（截段）与全部设定档案整理成材料包，喂给写作引擎一次**写**结构化 JSON，
// 供 UI 渲染成可逐条转提案的检查报告。和 runSync 同构：独立的 session、无提问、离线出结果。
import { readDoc, listChapters, listDocs, writeDoc } from '../store'
import { presenceCheck, unusedAliasCheck, parseAliases, listedFrom, unlistedInBody, chapterMissingFromRaw } from '../../shared/presence'
import { nameFormCheck, nameMixCheck } from '../../shared/nameform'
import { actGapsCheck } from '../../shared/actGaps'
import { extractFrontMatter } from '../../shared/fmatter'
import { chapterOrderCheck } from '../../shared/chapterorder'
import { sliceSectionOrderCheck } from '../../shared/sliceorder'
import { registerCapability, runSubtask, type SubtaskDef } from './subtask'
import { auditDocMarkdown } from '../../shared/auditDoc'
import type {
  ChapterEntry,
  AuditItem,
  AuditResult,
  AuditKind,
  ChapterCheckKind,
  ChapterCheckResult,
  ChapterCheckItem,
  RevisionLayer,
  UnlistedHit,
  MissingHit
} from '../../shared/types'

export type { AuditKind, AuditItem, AuditResult }

// ===== 审读存档（2026-09-09）：全卷审计结论自动落盘 大纲/ 区 =====
// 调研结论（docs/agent-调研与优化-日志.md）：同类 agent-native 长篇工具把「AI Review/审读结果」当项目持久资产
// （可回查、可对比），审读一次即弃=重跑重花时间且无法回答「上次说过什么、改了吗」。
// 设计：覆盖式（每类一个文件，最新一次为准）、写作副产物直写（与章卡/导演板同约定）、空结果也留档证明跑过。
const AUDIT_NAMES: Record<AuditKind, string> = {
  consistency: '一致性巡查',
  review: '冷读报告',
  perspectives: '多视角审视',
  presence: '人物在场核查',
  order: '切片时序核查',
  unused: '人物档案腐坏核查',
  actgaps: '正文缺段核查',
  sliceord: '档案切片核查',
  nameform: '称谓发现核查',
  mixform: '称谓混用核查'
}

/** 审计结果存档的相对路径：大纲/审读_<名>.md */
export function auditReportRel(kind: AuditKind): string {
  return '大纲/审读_' + AUDIT_NAMES[kind] + '.md'
}

// ===== 人物在场核查（本地规则层，零模型、秒级） =====
// 读全卷正文 + 人物档案题名 → presenceCheck → AuditResult（与审计抽屉同构展示，不落盘）。
/** 读全部人物档案：题名（knownChars，滤总览/索引）+ 登记别名（aliasMap） */
export function readCharIndex(projectId: string): { knownChars: string[]; aliasMap: Record<string, string[]> } {
  const knownChars: string[] = []
  const aliasMap: Record<string, string[]> = {}
  for (const d of listDocs(projectId, '人物')) {
    // 文件可能带子目录（人物/某组/角色.md），取末段；过滤总览/索引类
    const base = d.file.split('/').pop() ?? d.file
    const name = base.replace(/\.md$/i, '').trim()
    if (name && !['总览', '索引'].includes(name)) {
      knownChars.push(name)
      const raw = readDoc(projectId, '人物/' + d.file) ?? ''
      const al = parseAliases(extractFrontMatter(raw).fm)
      if (al.length) aliasMap[name] = al
    }
  }
  return { knownChars, aliasMap }
}

/** 读全部正文章节 raw（跳过空文件） */
function readVolumeChapters(projectId: string): { file: string; raw: string }[] {
  const chapters: { file: string; raw: string }[] = []
  for (const d of listDocs(projectId, '正文')) {
    const file = '正文/' + d.file
    const raw = readDoc(projectId, file) ?? ''
    if (raw.trim()) chapters.push({ file, raw })
  }
  return chapters
}

export function runPresence(
  projectId: string
): { ok: true; result: AuditResult } | { ok: false; error: string } {
  try {
    const { knownChars, aliasMap } = readCharIndex(projectId)
    const chapters = readVolumeChapters(projectId)
    return { ok: true, result: presenceCheck({ knownChars, chapters, aliasMap }) }
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) }
  }
}

/**
 * 单章「名单外出场」快检（保存正文的前置提示用）：
 * 读本章约定头「涉及人物」+ 人物档案题名/登记别名，与 presence 同一口径（也复用同一 conflict 规则），
 * 零模型、单章、秒级；只给命中清单，不做任何写入。
 */
export function runChapterUnlisted(
  projectId: string,
  chapterRel: string
): { ok: true; items: UnlistedHit[] } | { ok: false; error: string } {
  try {
    const raw = readDoc(projectId, chapterRel)
    if (raw === null) return { ok: false, error: '章节文档不存在' }
    const { fm, body } = extractFrontMatter(raw)
    const { knownChars, aliasMap } = readCharIndex(projectId)
    return {
      ok: true,
      items: unlistedInBody({ body, listed: listedFrom(fm ?? {}), knownChars, aliasMap })
    }
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) }
  }
}

/**
 * 单章「列入未出场」快检（保存正文的前置提示用，missing 侧；与 runChapterUnlisted 同构）：
 * 约定头「涉及人物」列了、但正文（达到最小有效字数阈值后）未出现本名/登记别名 → 命中清单。
 * 阈值见 CHAPTER_MISSING_MIN_BODY（开写中章节天然缺署名为常态，低于阈值不提示）。
 */
export function runChapterMissing(
  projectId: string,
  chapterRel: string
): { ok: true; items: MissingHit[] } | { ok: false; error: string } {
  try {
    const raw = readDoc(projectId, chapterRel)
    if (raw === null) return { ok: false, error: '章节文档不存在' }
    const { aliasMap } = readCharIndex(projectId)
    return { ok: true, items: chapterMissingFromRaw({ raw, aliasMap }) }
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) }
  }
}

// ===== 人物档案腐坏核查（本地规则层，零模型、秒级） =====
// 机械层第四块：档案登记了别名但全卷正文（剥约定头）从未出现 → 冗余声明（改名残留/过度声明）。
// 与 presence/order 同策略：不落盘、高频可重跑；复用 readCharIndex 的 aliasMap 一次扫描。
export function runUnusedAliases(
  projectId: string
): { ok: true; result: AuditResult } | { ok: false; error: string } {
  try {
    const { aliasMap } = readCharIndex(projectId)
    return { ok: true, result: unusedAliasCheck({ aliasMap, chapters: readVolumeChapters(projectId) }) }
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) }
  }
}

// ===== 切片时序核查（本地规则层，零模型、秒级） =====
// 读全卷正文 → chapterOrderCheck → AuditResult（同构展示，不落盘；与 presence 同策略）。
export function runChapterOrder(
  projectId: string
): { ok: true; result: AuditResult } | { ok: false; error: string } {
  try {
    return { ok: true, result: chapterOrderCheck({ chapters: readVolumeChapters(projectId) }) }
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) }
  }
}

// ===== 正文缺段核查（本地规则层，零模型、秒级） =====
// 机械层第五块：扫描全卷正文的「分幕草稿缺第 N 段」占位注释（actsSeg 断链标记），
// 提示哪些章节还留着没补齐的缺段。与 presence/order/unused 同策略：不落盘、高频可重跑。
export function runActGaps(
  projectId: string
): { ok: true; result: AuditResult } | { ok: false; error: string } {
  try {
    return { ok: true, result: actGapsCheck({ chapters: readVolumeChapters(projectId) }) }
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) }
  }
}

// ===== 档案切片核查（本地规则层，零模型、秒级） =====
// 机械层第六块：人物档「## 切片：<名>」小节顺序 vs 切片对应章序（同步按「命中替换／未命中文末追加」
// 落盘，追加顺序≠故事顺序——先写后章再补前章会倒挂）。与 presence/order/unused/actgaps 同策略。
export function runSliceOrder(
  projectId: string
): { ok: true; result: AuditResult } | { ok: false; error: string } {
  try {
    const characters: { file: string; raw: string }[] = []
    for (const d of listDocs(projectId, '人物')) {
      // 与 readCharIndex 同过滤：总览/索引不是人物档案；子目录取末段不影响「读全文」范围
      const base = d.file.split('/').pop() ?? d.file
      const name = base.replace(/\.md$/i, '').trim()
      if (name && !['总览', '索引'].includes(name)) {
        const raw = readDoc(projectId, '人物/' + d.file) ?? ''
        if (raw.trim()) characters.push({ file: '人物/' + d.file, raw })
      }
    }
    return { ok: true, result: sliceSectionOrderCheck({ characters, chapters: readVolumeChapters(projectId) }) }
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) }
  }
}

// ===== 称谓发现核查（本地规则层，零模型、秒级） =====
// 机械层第七块：正文出现「姓+常见称谓后缀 / 老·小·阿·大+姓」但人物档案未登记 → 疑似新称呼未登记。
// 与 presence/order/unused/actgaps/sliceord 同策略：不落盘、高频可重跑；复用 readCharIndex 一次扫描。
export function runNameForms(
  projectId: string
): { ok: true; result: AuditResult } | { ok: false; error: string } {
  try {
    const { knownChars, aliasMap } = readCharIndex(projectId)
    return { ok: true, result: nameFormCheck({ knownChars, aliasMap, chapters: readVolumeChapters(projectId) }) }
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) }
  }
}

// ===== 称谓混用核查（本地规则层，零模型、秒级） =====
// 机械层第八块：同章叙述层（引号外）同一人物交替使用多个称呼（全名/登记别名/姓+称谓/老·小·阿·大+姓）
// ≥3 次 → 提示（措辞「可能刻意」）。与 presence/order/nameform 同策略：不落盘、高频可重跑。
export function runNameMix(
  projectId: string
): { ok: true; result: AuditResult } | { ok: false; error: string } {
  try {
    const { knownChars, aliasMap } = readCharIndex(projectId)
    return { ok: true, result: nameMixCheck({ knownChars, aliasMap, chapters: readVolumeChapters(projectId) }) }
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) }
  }
}

/** 审计结果 → 可入 git 的 markdown 存档（纯函数，可单测；模板单源在 shared/auditDoc.ts，devShim 同用） */
export function auditToMarkdown(
  result: AuditResult,
  kind: AuditKind,
  opts: { now?: string } = {}
): string {
  return auditDocMarkdown(result, AUDIT_NAMES[kind], opts)
}

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

const auditDef: SubtaskDef<AuditResult> = {
  id: 'audit',
  title: '全卷检查',
  description: '一致性巡查 / 冷读报告：跨全卷对照设定找问题',
  maxMs: 8 * 60 * 1000,
  buildParts: (c) => {
    const kind = c.args?.kind as AuditKind
    return [auditSystem(kind), volumeBrief(c.projectId), kind === 'consistency' ? '请给出巡查报告 JSON。' : '请给出冷读报告 JSON。']
  },
  parse: (text) => extractAudit(text)
}
registerCapability(auditDef as never)

export async function runAudit(
  projectId: string,
  kind: AuditKind
): Promise<{ ok: true; result: AuditResult; savedReport?: string; lastRaw?: string } | { ok: false; error: string }> {
  // 人物在场核查 / 切片时序核查 / 档案腐坏核查：本地规则层（零模型、秒级），不走写作引擎，也不落盘（高频重跑，噪音大；与本章小环同策略）
  if (kind === 'presence') return runPresence(projectId)
  if (kind === 'order') return runChapterOrder(projectId)
  if (kind === 'unused') return runUnusedAliases(projectId)
  if (kind === 'actgaps') return runActGaps(projectId)
  if (kind === 'sliceord') return runSliceOrder(projectId)
  if (kind === 'nameform') return runNameForms(projectId)
  if (kind === 'mixform') return runNameMix(projectId)
  // 多视角审视是独立能力，参数不同（无 kind），单独路由
  const r =
    kind === 'perspectives'
      ? await runSubtask(perspectiveDef, projectId)
      : await runSubtask(auditDef, projectId, { kind })
  if (!r.ok) return r
  // 审读存档：结论落盘（覆盖式），失败不阻断审计结果本身
  let savedReport: string | undefined
  try {
    const rel = auditReportRel(kind)
    writeDoc(projectId, rel, auditToMarkdown(r.result, kind))
    savedReport = rel
  } catch {
    /* 盘写失败不阻断 */
  }
  return savedReport
    ? { ok: true, result: r.result, savedReport, ...(r.lastRaw ? { lastRaw: r.lastRaw } : {}) }
    : { ok: true, result: r.result, ...(r.lastRaw ? { lastRaw: r.lastRaw } : {}) }
}

// ===== 多视角审视（agent-first P2）：三种立场的读者各通读一遍，交叉找问题 =====
// 一个人的盲区往往正是另一个人的执念：角色粉看人设、设定党看自洽、节奏读者看可读性。
// 与巡查同骨架（独立 session + 结构化 JSON），复用 volumeBrief 材料包，零新接线。
function perspectiveSystem(): string {
  return (
    '你是织卷的「多视角审读团」。下面给出了这部作品的正文摘录与现有设定档案。\n' +
      '请以三种立场，各自代表一位真实读者把全文各读一遍，找出这种立场下最值得写的问题：\n' +
      '- viewer=角色粉：只关心人物立不立得住——行为是否与档案相符、动机是否牵强、关系是否写得含糊；\n' +
      '- viewer=设定党：只关心设定自洽——设定冲突、时间线破损、伏笔不回收；\n' +
      '- viewer=节奏读者：只关心读得顺不顺——节奏拖沓、信息重复、该收不收。\n' +
      '要求：每条都要能回到上面材料，不要臆测；同一条只归到最合适的一位；每条各字段用一句自然话说清，不要展开成段落；最多给 10 条。\n' +
      '格式纪律（重要）：你的整个回答只能是下面这个 JSON 对象，一个字都不要写在 JSON 之外（不要 markdown 围栏、不要开头结尾的话）：\n' +
      '{"summary":"一句话：三重眼光看完后全书最值得先处理的一件事","items":[' +
      '{"viewer":"角色粉|设定党|节奏读者","severity":"high|medium|low",' +
      '"type":"character|setting|pacing|structure|foreshadow",' +
      '"where":"出现位置（尽量给到能定位的信息）","what":"问题的一句话现象","suggest":"一句话改法",' +
      '"target":"若这条关联到某个设定文件给路径（人物/… 或 世界观/…），否则给空串"}]}\n' +
      '没有发现就整体输出 {"summary":"","items":[]}。'
  )
}

/** 从模型回复里稳健提取多视角审读 JSON（viewer 保留；target 只在现有设定档案里才留，防编造） */
export function extractPerspective(text: string, knownTargets?: Set<string>): AuditResult {
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
  const viewers = ['角色粉', '设定党', '节奏读者']
  const items = Array.isArray(obj?.items)
    ? (obj.items as any[])
        .filter((x) => x && typeof x === 'object' && typeof x.what === 'string')
        .map((x) => ({
          severity: x.severity === 'high' ? 'high' : x.severity === 'low' ? 'low' : 'medium',
          type: typeof x.type === 'string' ? x.type : 'misc',
          ...(x.viewer ? { viewer: String(x.viewer) } : {}),
          where: typeof x.where === 'string' ? x.where : '',
          what: x.what,
          suggest: typeof x.suggest === 'string' ? x.suggest : '',
          ...(typeof x.target === 'string' && x.target && (!knownTargets || knownTargets.has(x.target)) ? { target: x.target } : {})
        })) as AuditItem[]
    : []
  return { summary: typeof obj?.summary === 'string' ? obj.summary : '', items }
}

const perspectiveDef: SubtaskDef<AuditResult> = {
  id: 'perspectives',
  title: '多视角审视',
  description: '以角色粉 / 设定党 / 节奏读者三种立场各通读一遍，交叉找问题',
  maxMs: 8 * 60 * 1000,
  buildParts: (c) => [perspectiveSystem(), volumeBrief(c.projectId), '请给出多视角审读报告 JSON。'],
  parse: (text, c) => extractPerspective(text, new Set(settingList(c.projectId))),
  retry: {
    check: (r) => !r.summary && !r.items.length,
    prompt:
      '【提醒】上一次回答没有解析成要求的 JSON。这次请只原样输出一个 JSON 对象，先输出左花括号 {，别的什么也不要写。'
  }
}
registerCapability(perspectiveDef as never)

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

const chapterCheckDef: SubtaskDef<ChapterCheckResult> = {
  id: 'chapter-check',
  title: '本章检查',
  description: '每章短巡查 / 分层修订：沿写作线的小环兜底',
  maxMs: 6 * 60 * 1000,
  buildParts: (c) => {
    const chapterRel = String(c.args?.chapterRel ?? '')
    const kind = c.args?.kind as ChapterCheckKind
    const raw = readDoc(c.projectId, chapterRel) ?? ''
    const body = stripFm(raw)
    if (!body.trim()) throw new Error('当前章节还没有内容，先写一点再检查。')
    return [
      chapterCheckSystem(kind),
      chapterBrief(c.projectId, chapterRel, body),
      kind === 'chapter' ? '请给出本章短巡查报告 JSON。' : '请给出分层修订单 JSON。'
    ]
  },
  parse: (text, c) => extractChapterCheck(text, new Set(settingList(c.projectId))),
  retry: {
    check: (r) => !r.summary && !r.items.length,
    prompt:
      '【提醒】上一次回答没有解析成要求的 JSON。这次请只原样输出一个 JSON 对象，先输出左花括号 {，别的什么也不要写。'
  }
}
registerCapability(chapterCheckDef as never)

export async function runChapterCheck(
  projectId: string,
  chapterRel: string,
  kind: ChapterCheckKind
): Promise<{ ok: true; result: ChapterCheckResult; lastRaw?: string } | { ok: false; error: string }> {
  return runSubtask(chapterCheckDef, projectId, { chapterRel, kind })
}
