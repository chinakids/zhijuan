// ===== 织卷 · 正文版本历史（M3）=====
// 形态：自动快照制（Scrivener Snapshots + JetBrains Local History 混合，方向见 docs/正文版本历史-产品规划-2026-09-10.md）。
// 挂接点：store.writeDoc 写正文前，若目标已存在且内容不同，先把旧内容存档一版到 .zhijuan/history/<rel>/<ts>.md。
// 不依赖 git：项目库可能是普通目录；用户自管 git 时快照与其互不干扰（纯文件、可入 git 或自行 ignore）。
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { DOT_DIR } from '../shared/paths'

export const HISTORY_DIR = `${DOT_DIR}/history`
/** 每文件保留的版本数上限（超出删最旧；默认值先行，设置化留给后续轮） */
export const HISTORY_LIMIT = 50
const NOVEL_PREFIX = '正文/'

export function isNovelRel(rel: string): boolean {
  return rel.startsWith(NOVEL_PREFIX)
}

/** 版本文件名：yyyyMMdd-HHmmss-SSS（可排序、肉眼可读；同 ms 冲突由 writeSnapshot 追加序号） */
export function snapName(ts: number): string {
  const d = new Date(ts)
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${p(d.getMilliseconds(), 3)}`
}

/** 版本目录：.zhijuan/history/<rel 去掉 .md>/（保留原目录层级，避免同名正文冲突） */
export function snapDirFor(rel: string): string {
  return join(HISTORY_DIR, rel.replace(/\.md$/, ''))
}

/**
 * 写入一版快照（内容 = 写盘前的旧正文）。返回文件名；非正文 rel 返回 null。
 * projectRoot = 项目根绝对路径。
 */
export function writeSnapshot(projectRoot: string, rel: string, content: string, ts = Date.now()): string | null {
  if (!isNovelRel(rel)) return null
  const dir = join(projectRoot, snapDirFor(rel))
  mkdirSync(dir, { recursive: true })
  let name = `${snapName(ts)}.md`
  let f = join(dir, name)
  let i = 1
  while (existsSync(f)) {
    name = `${snapName(ts)}-${i++}.md`
    f = join(dir, name)
  }
  writeFileSync(f, content, 'utf-8')
  prune(projectRoot, rel)
  return name
}

/** 版本文件名的解析键：ts 毫秒 + 同 ms 序号（-N 后缀，越大越新）；无法解析的排最后 */
export function snapOrderKey(name: string): { ts: number; seq: number } | null {
  const m = name.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-(\d{3})(?:-(\d+))?\.md$/)
  if (!m) return null
  const ts = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]), Number(m[7])).getTime()
  return { ts, seq: m[8] ? Number(m[8]) : 0 }
}

/** 列出某正文文档的版本（新→旧）。排序按文件名时间戳（权威；同 ms 的 -N 序号大者新），文件 mtime 不作排序依据 */
export function listSnapshots(projectRoot: string, rel: string): { name: string; mtimeMs: number; size: number }[] {
  const dir = join(projectRoot, snapDirFor(rel))
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((n) => n.endsWith('.md'))
    .map((n) => {
      const s = statSync(join(dir, n))
      return { name: n, size: s.size, mtimeMs: s.mtimeMs }
    })
    .sort((a, b) => {
      const ka = snapOrderKey(a.name)
      const kb = snapOrderKey(b.name)
      if (ka && kb) return kb.ts - ka.ts || kb.seq - ka.seq
      return b.name.localeCompare(a.name)
    })
}

/** 读取某一版内容；不存在返回 null */
export function readSnapshot(projectRoot: string, rel: string, name: string): string | null {
  const f = join(projectRoot, snapDirFor(rel), name)
  if (!existsSync(f)) return null
  return readFileSync(f, 'utf-8')
}

/** 裁剪：保留最新 HISTORY_LIMIT 版，删更旧的 */
export function prune(projectRoot: string, rel: string): void {
  const all = listSnapshots(projectRoot, rel)
  if (all.length <= HISTORY_LIMIT) return
  const dir = join(projectRoot, snapDirFor(rel))
  for (const v of all.slice(HISTORY_LIMIT)) rmSync(join(dir, v.name), { force: true })
}
