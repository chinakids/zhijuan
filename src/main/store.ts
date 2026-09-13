// ===== 织卷 V2 · 文档式 fileStore（模块设计 §2.4 / §四） =====
// 所有项目数据都是明文文件；本模块只做：扫描、骨架、读写、监听（设置见 settings.ts，工作区见 workspace.ts）。
import { shell } from 'electron'
import { join, relative, basename, dirname, resolve, sep } from 'path'
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
  renameSync,
  statSync,
  cpSync,
  watch,
  FSWatcher
} from 'fs'
import { extractFrontMatter, serializeFrontMatter, setFrontMatterField } from '../shared/fmatter'
import { isOutlineCardRel, outlineIndexDoc, parseOutlineCard, syncChapterNameInDoc, syncChapterSliceInDoc } from '../shared/outline'
import { listChapterEntries } from '../shared/chapters'
import { PROJ_FILE, SKELETON_DIRS, DEFAULT_FILES, DOT_DIR } from '../shared/paths'
import { sanitizeFile } from '../shared/paths'
import { isVersionedRel, snapDirFor, writeSnapshot } from './history'
import { migrateChapter, invalidateChapter, staleSliceSyncByChapter } from './proposals'
import { libraryRoot } from './settings'
import { applyTemplate } from './templates'
import { nextProjectId } from '../shared/projects'
import type { ChapterEntry, FsEvent, OutlineCard, ProjectMeta, ProjectStats, ProjectSummary, ImportResult, ExportResult } from '../shared/types'

// ---------- 设置与工作区路径已拆到 settings.ts（参见 docs/架构评审与调整-2026-09-04.md §二） ----------
export function projectDir(id: string): string {
  return join(libraryRoot(), id)
}
export function projectFile(id: string): string {
  return join(projectDir(id), PROJ_FILE)
}

export function abs(id: string, rel: string): string {
  return join(projectDir(id), rel)
}
function ensureDir(p: string) {
  mkdirSync(p, { recursive: true })
}

// ---------- project.md 读写 ----------
function readProjectMeta(id: string): ProjectMeta | null {
  const f = projectFile(id)
  if (!existsSync(f)) return null
  const text = readFileSync(f, 'utf-8')
  const { fm } = extractFrontMatter(text)
  if (!fm) return null
  const name = String(fm.name ?? id)
  return {
    id,
    name,
    description: String(fm.description ?? ''),
    createdAt: Number(fm.createdAt ?? 0),
    updatedAt: Number(fm.updatedAt ?? statSync(f).mtimeMs)
  }
}
function writeProjectMeta(m: ProjectMeta) {
  const fm = { name: m.name, description: m.description, createdAt: m.createdAt, updatedAt: m.updatedAt }
  const f = projectFile(m.id)
  ensureDir(dirname(f))
  let body = ''
  if (existsSync(f)) body = extractFrontMatter(readFileSync(f, 'utf-8')).body
  writeFileSync(f, serializeFrontMatter(fm) + body, 'utf-8')
}

// ---------- 骨架 ----------
export function ensureSkeleton(id: string) {
  const root = projectDir(id)
  ensureDir(root)
  for (const d of SKELETON_DIRS) ensureDir(join(root, d))
  // 缺省模板文件（不覆盖已有内容）
  const templates: [string, string][] = [
    [DEFAULT_FILES.charsOverview, '# 人物 · 总览\n\n> 本文件是人物目录：每个人物一个 `人物/<人物名>.md`。在正文创作里保存章节后，这里会通过提案制得到更新。\n'],
    [DEFAULT_FILES.worldOverview, '# 世界观 · 总纲\n\n> 长期不变的世界设定写在这里；每个时间切片的世界状态写在 `世界观/切片_<切片名>.md`。\n'],
    [DEFAULT_FILES.libIndex, '# 素材库 · 索引\n\n> 按类别分类存放，每个素材一个 `素材库/<类别>/<素材>.md`。采集任务先落 `素材库/采集池/`。\n']
  ]
  for (const [rel, tpl] of templates) {
    const f = join(root, rel)
    if (!existsSync(f)) writeFileSync(f, tpl, 'utf-8')
  }
  ensureGitignore(id)
}

// 项目根 .gitignore：工具派生的本地数据（正文版本快照/一次性迁移备份）默认忽略；
// 作品本体（正文/人物/世界观/素材 markdown + 约定头）均为明文，可整库入 git（ROADMAP 信条「纯本地明文可入 git」）。
const GITIGNORE = '# 织卷 · 工具派生的本地数据（版本快照/迁移备份），作品正文与设定均为明文可入 git\n.zhijuan/history/\n.zhijuan/migrate-backup-*/\n'
function ensureGitignore(id: string) {
  const f = join(projectDir(id), '.gitignore')
  if (!existsSync(f)) writeFileSync(f, GITIGNORE, 'utf-8')
}

const newProjectBody = `\n## 时间线总纲\n\n（本作品的故事时间线。每个章节 = 一个时间切片，切片名写在该章正文的约定头里。）\n\n## 目录约定\n\n- 正文：\`正文/第NN章_题名.md\`，每章开头有一段 front matter（章号/题名/切片/涉及人物）。\n- 人物：每个人物一个 \`人物/<人物名>.md\`，基础设定 + 按切片的状态小节。\n- 世界观：\`世界观/总纲.md\` + 每个切片的 \`世界观/切片_<切片名>.md\`。\n- 素材库：按类别目录存放素材文档；联网采集的原始任务在 \`素材库/采集池/\`。\n- 工具数据（提案、会话）在 \`.zhijuan/\`，不是设定本体；其中版本快照（\`.zhijuan/history/\`）与迁移备份默认可被项目根 \`.gitignore\` 忽略，作品正文与设定均为明文可入 git。\n`

// ---------- 项目操作 ----------
export function createProject(name: string, description: string, template?: string): ProjectSummary | null {
  const root = libraryRoot()
  ensureDir(root)
  const id = nextProjectId(name, (i) => existsSync(join(root, i)))
  const now = Date.now()
  writeProjectMeta({ id, name, description, createdAt: now, updatedAt: now })
  // project.md 正文模板
  const f = projectFile(id)
  writeFileSync(f, readFileSync(f, 'utf-8') + newProjectBody, 'utf-8')
  ensureSkeleton(id)
  // 「初始内容」模板：补充复制示例/用户模板文档（跳过已存在文件，不覆盖骨架与 project.md）
  if (template) applyTemplate(template, projectDir(id))
  return summarize(id)
}

function countFiles(id: string, relDir: string): number {
  const dir = join(projectDir(id), relDir)
  if (!existsSync(dir)) return 0
  let n = 0
  const walk = (p: string) => {
    for (const e of readdirSync(p, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue
      const fp = join(p, e.name)
      if (e.isDirectory()) walk(fp)
      else if (e.name.endsWith('.md')) n++
    }
  }
  try {
    walk(dir)
  } catch {
    /* 只读目录也可能读失败，忽略 */
  }
  return n
}

function summarize(id: string): ProjectSummary | null {
  const meta = readProjectMeta(id)
  if (!meta) return null
  const rel = (r: string) => join(projectDir(id), r)
  const chars = countFiles(id, '人物') - (existsSync(rel('人物/总览.md')) ? 1 : 0)
  const world = countFiles(id, '世界观') - (existsSync(rel('世界观/总纲.md')) ? 1 : 0)
  const stats: ProjectStats = {
    chapters: countFiles(id, '正文'),
    characters: Math.max(0, chars),
    worldviewFiles: Math.max(0, world),
    materials: countFiles(id, '素材库') - (existsSync(rel('素材库/采集池')) ? countFiles(id, '素材库/采集池') : 0)
  }
  const lastChapter = listChapters(id)[0]?.name
  return { ...meta, stats, lastChapter }
}

export function listProjects(): ProjectSummary[] {
  const root = libraryRoot()
  ensureDir(root)
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(root, d.name, PROJ_FILE)))
    .map((d) => summarize(d.name))
    .filter((p): p is ProjectSummary => p !== null)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export function removeProject(id: string): { ok: boolean; error?: string } {
  try {
    shell.trashItem(projectDir(id))
    return { ok: true }
  } catch (e) {
    // 废纸篓失败就硬删兜底
    try {
      rmSync(projectDir(id), { recursive: true, force: true })
      return { ok: true }
    } catch (e2) {
      return { ok: false, error: String(e2) }
    }
  }
}

export function importProject(dir: string): ImportResult {
  if (!dir || !dir.trim()) return { ok: false, error: '目录路径为空' }
  const src = resolve(dir.trim())
  if (!existsSync(src) || !statSync(src).isDirectory()) {
    return { ok: false, error: `目录不存在或不是文件夹：${src}` }
  }
  const id = basename(src)
  const dst = projectDir(id)
  let copied = false
  if (resolve(dst) !== src) {
    if (!existsSync(dst)) {
      // 外部目录 → 复制进项目库（跳过 git 元数据/系统杂物），原目录不动
      cpSync(src, dst, {
        recursive: true,
        filter: (p) => !['.git', '.DS_Store', 'node_modules'].includes(basename(p))
      })
      copied = true
    }
  }
  // 补骨架与 project.md（不覆盖已有内容）
  ensureSkeleton(id)
  const f = projectFile(id)
  if (!existsSync(f)) {
    const now = Date.now()
    writeProjectMeta({ id, name: id, description: '', createdAt: now, updatedAt: now })
    writeFileSync(f, readFileSync(f, 'utf-8') + newProjectBody, 'utf-8')
  }
  const summary = summarize(id)
  if (!summary) return { ok: false, error: '导入后未生成项目元数据' }
  return { ok: true, summary, copied }
}

/**
 * 导出项目：把项目目录完整复制到用户选择的位置（模块设计 §四 A「打开目录 / 导出 / 删除」）。
 * - 名称沿用项目目录名（与导入的 id=basename 口径一致，导出物可直接再导入）；
 * - 跳过 git 元数据/系统杂物（与导入同 skip 列表）；
 * - 目标已存在同名文件夹 → 报错不覆盖（导出是可逆操作，不偷偷合并/覆盖）。
 */
export function exportProject(id: string, destParent: string): ExportResult {
  const src = projectDir(id)
  if (!existsSync(join(src, PROJ_FILE))) return { ok: false, error: `项目不存在：${id}` }
  const parent = resolve(destParent ?? '')
  if (!parent) return { ok: false, error: '导出位置为空' }
  const name = basename(src)
  const dest = join(parent, name)
  // 防呆：目标不得是项目自身或位于项目内部（否则 cpSync 边抄边抄自身）
  const srcRes = resolve(src)
  if (dest === srcRes) return { ok: false, error: '导出位置不能是项目自身' }
  if (dest.startsWith(srcRes + sep)) return { ok: false, error: '导出位置不能位于项目内部' }
  if (existsSync(dest)) return { ok: false, error: `该位置已有同名文件夹「${name}」，请换个位置` }
  try {
    ensureDir(parent)
    cpSync(src, dest, {
      recursive: true,
      filter: (p) => !['.git', '.DS_Store', 'node_modules'].includes(basename(p))
    })
    return { ok: true, dest }
  } catch (e) {
    return { ok: false, error: String((e as Error).message ?? e) }
  }
}

// ---------- 文档读写（相对项目根） ----------
export function readDoc(id: string, rel: string): string | null {
  const f = abs(id, rel)
  if (!existsSync(f)) return null
  try {
    return readFileSync(f, 'utf-8')
  } catch {
    return null
  }
}
export function writeDoc(id: string, rel: string, content: string) {
  const f = abs(id, rel)
  ensureDir(dirname(f))
  // 版本历史快照：写盘前把旧内容存档（仅版本化 rel：正文/ 与 大纲/审读_*，且内容有变化时；见 docs/正文版本历史-产品规划-2026-09-10.md、docs/审读存档版本化-产品规划-2026-09-12.md）
  if (isVersionedRel(rel) && existsSync(f)) {
    const prev = readFileSync(f, 'utf-8')
    if (prev !== content) writeSnapshot(projectDir(id), rel, prev)
  }
  writeFileSync(f, content, 'utf-8')
}

/**
 * 删除项目内文档（markdown，相对项目根）。
 * 走系统废纸篓（可恢复——与 removeProject 同先例），废纸篓失败兜底硬删。
 * 防御：只收 `.md`、拒绝空/绝对/带 `..` 段的路径（readDoc 只做 join 不防穿越，删除同样不能放开口子）。
 */
export async function deleteDoc(id: string, rel: string): Promise<{ ok: boolean; error?: string }> {
  const bad = !rel || !rel.endsWith('.md') || rel.startsWith('/') || rel.split('/').some((s) => s === '..')
  if (bad) return { ok: false, error: '路径不合法' }
  const f = abs(id, rel)
  if (!existsSync(f)) return { ok: false, error: '文档不存在' }
  try {
    await shell.trashItem(f)
    return { ok: true }
  } catch {
    try {
      rmSync(f, { force: true })
      return { ok: true }
    } catch (e2) {
      return { ok: false, error: String(e2) }
    }
  }
}

export function listDocs(id: string, relDir: string): { file: string; name: string; mtime: number }[] {
  const dir = join(projectDir(id), relDir)
  if (!existsSync(dir)) return []
  const out: { file: string; name: string; mtime: number }[] = []
  const walk = (p: string, prefix: string) => {
    for (const e of readdirSync(p, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue
      const fp = join(p, e.name)
      if (e.isDirectory()) walk(fp, join(prefix, e.name))
      else if (e.name.endsWith('.md')) {
        const rel = join(prefix, e.name)
        out.push({ file: rel, name: e.name.replace(/\.md$/, ''), mtime: statSync(fp).mtimeMs })
      }
    }
  }
  walk(dir, '')
  return out.sort((a, b) => b.mtime - a.mtime)
}

// ---------- 章节列表（解析约定头） ----------
export function listChapters(id: string): ChapterEntry[] {
  // 解析/排序口径在 shared/chapters（真机与 devShim 共用，2026-09-12）；这里只负责收集文件与原文
  return listChapterEntries(
    listDocs(id, '正文').map((d) => ({
      file: d.file,
      name: d.name,
      text: readDoc(id, join('正文', d.file)) ?? '',
      mtime: d.mtime
    }))
  )
}

// ---------- 章节管理（重命名 / 删除 · 联动大纲副产物与版本历史） ----------

/** 章节重命名后的文件名基础：保留旧文件名「第一个 _ 」之前的前缀（如「第01章_」），换上新题名 slug。
 * 无下划线前缀（手工改名过）则直接用新题名；与建章文件名的回旋钩同口径（sanitizeFile 见 shared/paths）。 */
export function chapterNewBase(oldName: string, newTitle: string): string {
  const t = sanitizeFile(newTitle)
  const idx = oldName.indexOf('_')
  const prefix = idx >= 0 ? oldName.slice(0, idx + 1) : ''
  return prefix + t
}

/** 大纲/ 下与某章同名的写作副产物（章卡/导演板/分幕等）：<章名>.md 与 <章名>_*.md */
function siblingMatches(dirEntries: string[], base: string): string[] {
  return dirEntries.filter((e) => {
    if (!e.endsWith('.md')) return false
    const name = e.replace(/\.md$/, '')
    return name === base || name.startsWith(base + '_')
  })
}

/** 重命名章后同步 大纲/ 下同名写作副产物**内容**（已知旧/新题名与正文新路径时）；
 * 章卡（fm 题名/H1/对应正文行）、导演板/分幕（同三点）一视同仁，其余原文一律保留（best-effort）。 */
function syncOutlineSiblingsContent(id: string, base: string, oldTitle: string, newTitle: string, newChapterRel: string): void {
  const dir = join(projectDir(id), '大纲')
  if (!existsSync(dir)) return
  for (const e of siblingMatches(readdirSync(dir), base)) {
    const f = join(dir, e)
    try {
      const raw = readFileSync(f, 'utf-8')
      const next = syncChapterNameInDoc(raw, oldTitle, newTitle, newChapterRel)
      if (next !== raw) writeDoc(id, '大纲/' + e, next)
    } catch { /* best-effort */ }
  }
}

/** 大纲索引与章卡文件对齐：以现存章卡文件为权威重建 大纲/索引.md（剔除已删章条目、修正计数、更新题名）。
 * 删除/重命名章后调用（章卡文件已随动）；best-effort：索引是预览文档，失败不影响主操作。 */
function refreshOutlineIndex(id: string): void {
  const cards: OutlineCard[] = []
  for (const d of listDocs(id, '大纲')) {
    const rel = '大纲/' + d.file // listDocs 返回相对 relDir 的路径，调用方自己拼前缀
    if (!isOutlineCardRel(rel)) continue
    const card = parseOutlineCard(readFileSync(abs(id, rel), 'utf-8'), rel)
    if (card) cards.push(card)
  }
  cards.sort((a, b) => (a.no ?? 1e9) - (b.no ?? 1e9))
  writeDoc(id, '大纲/索引.md', outlineIndexDoc(cards))
}

export interface RenameChapterResult {
  ok: boolean
  newRel?: string
  error?: string
}

/**
 * 章节重命名（模块设计 §6.2「重命名：改题名与文件名」）：改约定头 `题名` + 文件名 slug 同步。
 * 引用面（2026-09-11 调研后拍板）：
 *  - 大纲/ 下 <章名>.md 与 <章名>_*.md（章卡/导演板/分幕）→ 同步改名（存在才动，best-effort）；
 *  - 大纲/索引.md → 重命名成功后整体重建（章卡为权威：题名/对应路径随之更新，best-effort）；
 *  - .zhijuan/history/正文/<章名>/（版本历史入口）→ 同步改名（存在才动，best-effort）；
 *  - .zhijuan/slices.json 无写入调用（listSlices 每次现扫）→ 无需处理；
 *  - .zhijuan/proposals/*.json 的 chapter 字段（展示 + stale 判定键）→ 重命名时同步迁移（best-effort，见 proposals.migrateChapter）。
 * 顺序：先写新文件（目标不存在 → 不触发版本快照）→ 移动引用面 → 删旧文件，任一失败抛错前旧文件仍在。
 */
export function renameChapter(id: string, rel: string, newTitle: string): RenameChapterResult {
  const bad = !rel || !rel.startsWith('正文/') || !rel.endsWith('.md') || rel.startsWith('/') || rel.split('/').some((s) => s === '..')
  if (bad) return { ok: false, error: '路径不合法' }
  const t = (newTitle ?? '').trim()
  if (!t) return { ok: false, error: '题名不能为空' }
  const oldAbs = abs(id, rel)
  if (!existsSync(oldAbs)) return { ok: false, error: '章节不存在' }
  const raw = readFileSync(oldAbs, 'utf-8')
  const { fm } = extractFrontMatter(raw)
  if (!fm) return { ok: false, error: '该文件没有约定头，不是织卷章节' }
  const oldTitle = String(fm['题名'] ?? '')
  const oldName = basename(rel)
  const newBase = chapterNewBase(oldName, t) + '.md'
  const newRel = '正文/' + newBase
  const newText = setFrontMatterField(raw, '题名', t)
  if (newBase === oldName) {
    // 文件名没变（题名清洗后同形）：只改约定头内容；若题名确实变了，同步大纲副产物内容与索引（best-effort）
    writeDoc(id, rel, newText)
    if (oldTitle && oldTitle !== t) {
      try { syncOutlineSiblingsContent(id, oldName.replace(/\.md$/, ''), oldTitle, t, rel) } catch { /* best-effort */ }
      try { refreshOutlineIndex(id) } catch { /* best-effort */ }
    }
    return { ok: true, newRel: rel }
  }
  if (existsSync(abs(id, newRel))) return { ok: false, error: '目标文件名已存在：' + newBase }
  // 1) 写新文件（目标不存在 → 不触发版本快照；经 watcher 广播界面刷新）
  writeDoc(id, newRel, newText)
  // 2) 大纲/ 副产物同步改名（best-effort；同名目标已存在则保留旧的）
  const dir = join(projectDir(id), '大纲')
  if (existsSync(dir)) {
    for (const e of siblingMatches(readdirSync(dir), oldName.replace(/\.md$/, ''))) {
      const nf = join(dir, e.replace(oldName.replace(/\.md$/, ''), newBase.replace(/\.md$/, '')))
      if (existsSync(nf)) continue
      try { renameSync(join(dir, e), nf) } catch { /* best-effort */ }
    }
  }
  // 3) 版本历史目录迁移（保留历史入口）
  try {
    const hOld = join(projectDir(id), snapDirFor(rel))
    const hNew = join(projectDir(id), snapDirFor(newRel))
    if (existsSync(hOld) && !existsSync(hNew)) renameSync(hOld, hNew)
  } catch { /* best-effort */ }
  // 3.5) proposals.chapter 引用迁移（stale 判定键 + 抽屉展示；锚点写入不依赖它，仅同步指针）
  try { migrateChapter(libraryRoot(), id, rel, newRel) } catch { /* best-effort */ }
  // 4) 删除旧文件（内容已迁移）
  rmSync(oldAbs, { force: true })
  // 5) 大纲副产物内容同步（fm 题名/H1/对应正文 → 新题名与新路径；其余原文保留）+ 索引重建（章卡为权威，best-effort）
  try { syncOutlineSiblingsContent(id, newBase.replace(/\.md$/, ''), oldTitle, t, newRel) } catch { /* best-effort */ }
  try { refreshOutlineIndex(id) } catch { /* best-effort */ }
  return { ok: true, newRel }
}

export interface EditChapterSliceResult {
  ok: boolean
  oldSlice?: string
  newSlice?: string
  /** 大纲副产物（章卡/导演板/分幕）fm「切片」字段同步条数 */
  synced?: number
  /** 该章 slice-sync pending 提案置 stale 条数 */
  staled?: number
  error?: string
}

/**
 * 章节「切片」改名（约定头唯一半结构化约定的字段编辑收口：题名有重命名入口、涉及人物有
 * 补入/移出 quick-fix，唯切片名建章后无入口——此前只能外部盲改 YAML）：改正文约定头 `切片` 值。
 * 引用面（2026-09-13 审计静态排查后收口）：
 *  - 大纲/ 下同名写作副产物（章卡/导演板/分幕）fm `切片` 字段 → best-effort 同步新值
 *    （syncChapterSliceInDoc：切片名不出现在副产物 H1/正文行；索引文档不展示切片 → 不重建）；
 *  - .zhijuan/proposals 该章 slice-sync pending → 置 stale（其 items 锚点/世界文件 target 携带旧
 *    切片名，改名后 apply 锚点命中不到会按「文末追加 H2」落盘，堆积近重复小节——syncAnchor
 *    白名单要防的形态）；annotation-sync 等与切片名无关的提案保留 pending（staleSliceSyncByChapter 按 source 收口）；
 *  - 世界观/切片_<旧名>.md 与人物档旧切片小节 → 保留为历史（时间切片语义＝历史快照，不自动迁移/搬家）。
 * 不触发切片同步：新切片名的设定流按「正文为源」由下一次保存正文触发（runSliceSync）。
 */
export function editChapterSlice(id: string, rel: string, newSlice: string): EditChapterSliceResult {
  const bad = !rel || !rel.startsWith('正文/') || !rel.endsWith('.md') || rel.startsWith('/') || rel.split('/').some((s) => s === '..')
  if (bad) return { ok: false, error: '路径不合法' }
  const s = (newSlice ?? '').trim()
  if (!s) return { ok: false, error: '切片名不能为空' }
  const oldAbs = abs(id, rel)
  if (!existsSync(oldAbs)) return { ok: false, error: '章节不存在' }
  const raw = readFileSync(oldAbs, 'utf-8')
  const { fm } = extractFrontMatter(raw)
  if (!fm) return { ok: false, error: '该文件没有约定头，不是织卷章节' }
  const oldSlice = String(fm['切片'] ?? '')
  if (oldSlice === s) return { ok: true, oldSlice, newSlice: s }
  writeDoc(id, rel, setFrontMatterField(raw, '切片', s))
  let synced = 0
  const dir = join(projectDir(id), '大纲')
  if (existsSync(dir)) {
    const base = basename(rel).replace(/\.md$/, '')
    for (const e of siblingMatches(readdirSync(dir), base)) {
      try {
        const f = join(dir, e)
        const cur = readFileSync(f, 'utf-8')
        const next = syncChapterSliceInDoc(cur, s)
        if (next !== cur) {
          writeDoc(id, '大纲/' + e, next)
          synced++
        }
      } catch { /* best-effort */ }
    }
  }
  let staled = 0
  try { staled = staleSliceSyncByChapter(libraryRoot(), id, rel) } catch { /* best-effort */ }
  return { ok: true, oldSlice, newSlice: s, synced, staled }
}

/** 删除章节：先删 大纲/ 下同名写作副产物（走系统废纸篓，可恢复），再删正文本身。
 * 引用面（2026-09-12 审计补齐，与 renameChapter 的引用面镜像）：
 *  - .zhijuan/history/正文/<章名>/ 版本历史入口 → 与正文同命运走系统废纸篓（避免「删除→重建同名章」旧快照混入新章；可恢复）；
 *  - .zhijuan/proposals 指向本章的 pending 提案 → 置 stale（该章提议不再适用；复用「已过期」展示，apply 拒绝，见 proposals.invalidateChapter）；
 *  - 大纲/索引.md → 删除成功后整体重建（章卡为权威，剔除已删章条目并修正计数）。 */
export async function deleteChapter(id: string, rel: string): Promise<{ ok: boolean; error?: string; cleaned?: number }> {
  const bad = !rel || !rel.startsWith('正文/') || !rel.endsWith('.md') || rel.startsWith('/') || rel.split('/').some((s) => s === '..')
  if (bad) return { ok: false, error: '路径不合法' }
  const base = basename(rel).replace(/\.md$/, '')
  let cleaned = 0
  const dir = join(projectDir(id), '大纲')
  if (existsSync(dir)) {
    for (const e of siblingMatches(readdirSync(dir), base)) {
      const r = await deleteDoc(id, '大纲/' + e)
      if (r.ok) cleaned++
    }
  }
  const r = await deleteDoc(id, rel)
  if (r.ok) {
    try {
      const h = join(projectDir(id), snapDirFor(rel))
      if (existsSync(h)) {
        try {
          await shell.trashItem(h)
        } catch { /* best-effort：废纸篓失败保留（下次同名章仍可能混入，但可恢复优先） */ }
      }
    } catch { /* best-effort */ }
    try { invalidateChapter(libraryRoot(), id, rel) } catch { /* best-effort */ }
    // 索引重建：章卡文件已随删除移除 → 剔行并修正计数（best-effort）
    try { refreshOutlineIndex(id) } catch { /* best-effort */ }
  }
  return r.ok ? { ok: true, cleaned } : r
}

// ---------- 项目目录监听（广播给渲染层） ----------
let watcher: FSWatcher | null = null
let watchedProject: string | null = null
let refreshCb: ((evt: FsEvent) => void) | null = null

export function watchProject(id: string, onEvent: (evt: FsEvent) => void): () => void {
  if (watcher) {
    watcher.close()
    watcher = null
  }
  watchedProject = id
  refreshCb = onEvent
  const root = projectDir(id)
  if (!existsSync(root)) return () => {}
  try {
    watcher = watch(root, { recursive: true }, (_evt, filename) => {
      if (!filename) return
      const rel = relative(root, String(filename))
      if (!rel || rel.startsWith(DOT_DIR)) return // 工具目录变化不刷外部界面
      const kind = mapEvt(_evt)
      refreshCb?.({ projectId: id, kind, path: rel })
    })
  } catch {
    // recursive watch 不可用时（少见），退化为不监听，界面每次操作主动刷新
  }
  return () => {
    if (watcher) {
      watcher.close()
      watcher = null
    }
    watchedProject = null
  }
}
function mapEvt(t: string): FsEvent['kind'] {
  if (t === 'rename') return 'change'
  return 'change'
}

export function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

