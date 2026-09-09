// ===== 织卷 V2 · 文档式 fileStore（模块设计 §2.4 / §四） =====
// 所有项目数据都是明文文件；本模块只做：扫描、骨架、读写、监听（设置见 settings.ts，工作区见 workspace.ts）。
import { shell } from 'electron'
import { join, relative, basename, dirname } from 'path'
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync, rmSync, statSync, watch, FSWatcher } from 'fs'
import { extractFrontMatter, serializeFrontMatter } from '../shared/fmatter'
import { countWords } from '../shared/count'
import { PROJ_FILE, SKELETON_DIRS, DEFAULT_FILES, DOT_DIR } from '../shared/paths'
import { sanitizeFile } from '../shared/paths'
import { libraryRoot } from './settings'
import { applyTemplate } from './templates'
import type { ChapterEntry, ChapterFrontMatter, FsEvent, ProjectMeta, ProjectStats, ProjectSummary } from '../shared/types'

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

export function importProject(dir: string): ProjectSummary | null {
  if (!existsSync(dir)) return null
  const id = basename(dir)
  ensureSkeleton(id)
  const f = projectFile(id)
  if (!existsSync(f)) {
    const now = Date.now()
    writeProjectMeta({ id, name: id, description: '', createdAt: now, updatedAt: now })
    writeFileSync(f, readFileSync(f, 'utf-8') + newProjectBody, 'utf-8')
  }
  return summarize(id)
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
  writeFileSync(f, content, 'utf-8')
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

