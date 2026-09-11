// ===== 织卷 V2 · 文档式 fileStore（模块设计 §2.4 / §四） =====
// 所有项目数据都是明文文件；本模块只做：扫描、骨架、读写、监听（设置见 settings.ts，工作区见 workspace.ts）。
import { shell } from 'electron'
import { join, relative, basename, dirname, resolve } from 'path'
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
import { countWords } from '../shared/count'
import { PROJ_FILE, SKELETON_DIRS, DEFAULT_FILES, DOT_DIR } from '../shared/paths'
import { sanitizeFile } from '../shared/paths'
import { isNovelRel, snapDirFor, writeSnapshot } from './history'
import { migrateChapter, invalidateChapter } from './proposals'
import { libraryRoot } from './settings'
import { applyTemplate } from './templates'
import type { ChapterEntry, ChapterFrontMatter, FsEvent, ProjectMeta, ProjectStats, ProjectSummary, ImportResult } from '../shared/types'

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
    [DEFAULT_FILES.charsOverview, '# 人物 · 总览\n\n> 本文件是角色目录：每个角色一个 `人物/<角色名>.md`。在正文创作里保存章节后，这里会通过提案制得到更新。\n'],
    [DEFAULT_FILES.worldOverview, '# 世界观 · 总纲\n\n> 长期不变的世界设定写在这里；每个时间切片的世界状态写在 `世界观/切片_<切片名>.md`。\n'],
    [DEFAULT_FILES.libIndex, '# 素材库 · 索引\n\n> 按类别分类存放，每个素材一个 `素材库/<类别>/<素材>.md`。采集任务先落 `素材库/采集池/`。\n']
  ]
  for (const [rel, tpl] of templates) {
    const f = join(root, rel)
    if (!existsSync(f)) writeFileSync(f, tpl, 'utf-8')
  }
}

const newProjectBody = `\n## 时间线总纲\n\n（本作品的故事时间线。每个章节 = 一个时间切片，切片名写在该章正文的约定头里。）\n\n## 目录约定\n\n- 正文：\`正文/第NN章_题名.md\`，每章开头有一段 front matter（章号/题名/切片/涉及人物）。\n- 人物：每角色一个 \`人物/<角色名>.md\`，基础设定 + 按切片的状态小节。\n- 世界观：\`世界观/总纲.md\` + 每个切片的 \`世界观/切片_<切片名>.md\`。\n- 素材库：按类别目录存放素材文档；联网采集的原始任务在 \`素材库/采集池/\`。\n- 工具数据（提案、会话）在 \`.zhijuan/\`，不是设定本体。\n`

// ---------- 项目操作 ----------
export function createProject(name: string, description: string, template?: string): ProjectSummary | null {
  const root = libraryRoot()
  ensureDir(root)
  let id = sanitizeFile(name)
  if (existsSync(join(root, id))) id = `${id}_${Date.now().toString(36).slice(-4)}`
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
  // 正文版本历史：写盘前把旧内容存档（仅正文、且内容有变化时；见 docs/正文版本历史-产品规划-2026-09-10.md）
  if (isNovelRel(rel) && existsSync(f)) {
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
function numOf(name: string): number {
  const m = name.match(/第(\d+)章/)
  return m ? Number(m[1]) : Infinity
}
export function listChapters(id: string): ChapterEntry[] {
  const docs = listDocs(id, '正文')
  return docs
    .map((d) => {
      const text = readDoc(id, join('正文', d.file)) ?? ''
      const { fm } = extractFrontMatter(text)
      const c = fm as unknown as ChapterFrontMatter | null
      // 约定头键是中文（章号/切片…）；有任一关键字段才算合法约定头
      const ok = !!c && (c['章号'] !== undefined || c['切片'] !== undefined || c['题名'] !== undefined)
      if (ok && c) {
        // extractFrontMatter 一律按字符串返回；章号在此**归一成数值**一次（与类型 章号?: number 对齐），
        // 下游按数值比较才有意义（acts 找上一章、devShim 早就是数字，真机此前一直是字符串——对照线的老坑）
        const n = Number(c['章号'])
        if (Number.isFinite(n)) c['章号'] = n
      }
      return {
        file: d.file,
        name: d.name,
        fm: ok ? c : null,
        wordCount: countWords(text),
        mtime: d.mtime,
        hasPendingProposal: false
      }
    })
    .sort((a, b) => numOf(a.name) - numOf(b.name))
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

export interface RenameChapterResult {
  ok: boolean
  newRel?: string
  error?: string
}

/**
 * 章节重命名（模块设计 §6.2「重命名：改题名与文件名」）：改约定头 `题名` + 文件名 slug 同步。
 * 引用面（2026-09-11 调研后拍板）：
 *  - 大纲/ 下 <章名>.md 与 <章名>_*.md（章卡/导演板/分幕）→ 同步改名（存在才动，best-effort）；
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
  const oldName = basename(rel)
  const newBase = chapterNewBase(oldName, t) + '.md'
  const newRel = '正文/' + newBase
  const newText = setFrontMatterField(raw, '题名', t)
  if (newBase === oldName) {
    // 文件名没变（题名清洗后同形）：只改约定头内容
    writeDoc(id, rel, newText)
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
  return { ok: true, newRel }
}

/** 删除章节：先删 大纲/ 下同名写作副产物（走系统废纸篓，可恢复），再删正文本身。
 * 引用面（2026-09-12 审计补齐，与 renameChapter 的引用面镜像）：
 *  - .zhijuan/history/正文/<章名>/ 版本历史入口 → 与正文同命运走系统废纸篓（避免「删除→重建同名章」旧快照混入新章；可恢复）；
 *  - .zhijuan/proposals 指向本章的 pending 提案 → 置 stale（该章提议不再适用；复用「已过期」展示，apply 拒绝，见 proposals.invalidateChapter）。 */
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

