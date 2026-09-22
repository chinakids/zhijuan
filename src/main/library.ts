// ===== 织卷 V2 · 素材库域逻辑（模块设计 §九；类别枚举/创建 + 全文搜索） =====
// 依赖 store 的 projectDir 解析（纯路径），自身负责文件枚举与读取；store 保持「项目+文件+watcher」不动。
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, type Dirent } from 'fs'
import { join } from 'path'
import { projectDir } from './store'
import { sanitizeFile } from '../shared/paths'
import { posixRel } from '../shared/relpath'
import { finalizeSearchHits, SEARCH_DEFAULT_LIMIT } from '../shared/searchHits'
import type { LibraryCategory, RecentLibraryDoc, SearchHit } from '../shared/types'

/** 素材库下「工具目录」：采集池任务卡不属于素材，一律不参与类别/搜索 */
const COLLECTION_DIR = '采集池'

function countMd(dir: string): number {
  let n = 0
  const walk = (p: string) => {
    let es: Dirent[]
    try {
      es = readdirSync(p, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of es) {
      if (e.name.startsWith('.')) continue
      const fp = join(p, e.name)
      if (e.isDirectory()) walk(fp)
      else if (e.name.endsWith('.md')) n++
    }
  }
  walk(dir)
  return n
}

/** 一级类别清单（目录=类别；不含采集池，空目录也列出）；按中文名排序 */
export function listLibraryCategories(id: string): LibraryCategory[] {
  const dir = join(projectDir(id), '素材库')
  if (!existsSync(dir)) return []
  const out: LibraryCategory[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith('.') || e.name === COLLECTION_DIR) continue
    out.push({ name: e.name, count: countMd(join(dir, e.name)) })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
}

/** 新建一级类别（目录）；已存在/名非法 → error（不覆盖、不破坏数据） */
export function createLibraryCategory(id: string, name: string): { ok: boolean; error?: string } {
  const trimmed = (name ?? '').trim()
  if (!trimmed) return { ok: false, error: '名称不能为空' }
  const safe = sanitizeFile(trimmed)
  const dir = join(projectDir(id), '素材库', safe)
  if (existsSync(dir)) return { ok: false, error: `类别「${safe}」已存在` }
  try {
    mkdirSync(dir, { recursive: true })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

function snippetOf(text: string, terms: string[]): string {
  const lower = text.toLowerCase()
  let idx = -1
  for (const t of terms) {
    const i = lower.indexOf(t)
    if (i >= 0 && (idx < 0 || i < idx)) idx = i
  }
  if (idx < 0) return ''
  // 找所在行（往前到行首），行内容截断 80 字
  const start = text.lastIndexOf('\n', idx) + 1
  let end = text.indexOf('\n', idx)
  if (end < 0) end = text.length
  const line = text.slice(start, end).trim()
  return line.length > 80 ? line.slice(0, 80) + '…' : line
}

/**
 * 目录内全文搜索（文件名 + 正文；空格分词 AND；大小写不敏感）。
 * @param relDir 相对项目根的目录（如 `素材库`）
 * @param opts.excludePrefix 相对项目根的排除前缀数组（如 `素材库/采集池/`）
 * @param opts.limit 最多返回条数（默认 50）
 * file 返回**相对项目根**路径（readDoc/编辑直接用）。
 */
export function searchDocs(id: string, relDir: string, query: string, opts?: { excludePrefix?: string[]; limit?: number }): SearchHit[] {
  const q = (query ?? '').trim()
  if (!q) return []
  const terms = q
    .split(/\s+/)
    .map((t) => t.toLowerCase())
    .filter(Boolean)
  const root = join(projectDir(id), relDir)
  if (!existsSync(root)) return []
  const exclude = opts?.excludePrefix ?? []
  const limit = opts?.limit ?? SEARCH_DEFAULT_LIMIT
  const hits: SearchHit[] = []
  const walk = (p: string, prefix: string) => {
    let es: Dirent[]
    try {
      es = readdirSync(p, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of es) {
      if (e.name.startsWith('.')) continue
      const fp = join(p, e.name)
      if (e.isDirectory()) {
        walk(fp, posixRel(prefix, e.name))
        continue
      }
      if (!e.name.endsWith('.md')) continue
      const rel = posixRel(prefix, e.name)
      const relFromRoot = (relDir ? relDir + '/' : '') + rel
      if (exclude.some((pre) => relFromRoot.startsWith(pre))) continue
      const name = e.name.replace(/\.md$/, '')
      if (terms.every((t) => name.toLowerCase().includes(t))) {
        hits.push({ file: relFromRoot, name, mtime: statSync(fp).mtimeMs, field: 'name', snippet: name })
        continue
      }
      let text = ''
      try {
        text = readFileSync(fp, 'utf-8')
      } catch {
        continue
      }
      const lower = text.toLowerCase()
      if (terms.every((t) => lower.includes(t))) {
        hits.push({ file: relFromRoot, name, mtime: statSync(fp).mtimeMs, field: 'content', snippet: snippetOf(text, terms) })
      }
    }
  }
  walk(root, '')
  // 2026-09-23：全收集后再排序截断（finalizeSearchHits，真机/devShim 同口径）——
  // 旧实现按 readdir 枚举序先截断（字母序会把最新写入的命中挤出 limit），
  // 与 UI 层 mtime 展示排序不一致；现「limit 内 = 最近修改的 N 条」。
  return finalizeSearchHits(hits, limit)
}

/** 最近修改的素材（同一枚举口径：素材库 / 排除采集池与隐藏；按 mtime 新→旧，最多 n 条）。 */
export function recentLibraryDocs(id: string, n = 5): RecentLibraryDoc[] {
  const relDir = '素材库'
  const root = join(projectDir(id), relDir)
  if (!existsSync(root)) return []
  const out: RecentLibraryDoc[] = []
  const walk = (p: string, prefix: string) => {
    let es: Dirent[]
    try {
      es = readdirSync(p, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of es) {
      if (e.name.startsWith('.')) continue
      const fp = join(p, e.name)
      if (e.isDirectory()) {
        walk(fp, posixRel(prefix, e.name))
        continue
      }
      if (!e.name.endsWith('.md')) continue
      const rel = posixRel(prefix, e.name)
      const relFromRoot = relDir + '/' + rel
      if (relFromRoot.startsWith(relDir + '/' + COLLECTION_DIR + '/')) continue
      let mtime = 0
      try {
        mtime = statSync(fp).mtimeMs
      } catch {
        continue
      }
      out.push({ file: relFromRoot, name: e.name.replace(/\.md$/, ''), mtime })
    }
  }
  walk(root, '')
  out.sort((a, b) => b.mtime - a.mtime || a.file.localeCompare(b.file, 'zh'))
  return out.slice(0, n)
}
