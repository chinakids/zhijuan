// ===== 织卷 V2 · 时间切片清单（模块设计 §14之 / 评审 D2） =====
// 把「切片」从章头字符串升格为可枚举实体：正文仍是唯一源，本模块每次现扫章头 front matter；
// writeSliceRegistry 把结果登记为 .zhijuan/slices.json 索引，供时间线 / 跨切片巡检 / 切片对比直接读，随时可重建。
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { extractFrontMatter } from '../shared/fmatter'
import { DOT_DIR } from '../shared/paths'
import type { SliceEntry } from '../shared/types'

/** 章头 涉及人物 字段（安全取数组） */
function chapterChars(fm: Record<string, unknown> | null): string[] {
  const v = fm?.['涉及人物']
  return Array.isArray(v) ? v.map(String).filter(Boolean) : []
}

/** 枚举项目内全部时间切片（按来源章节名自然排序；读不到的文件跳过） */
export function listSlices(projectDir: string): SliceEntry[] {
  const novel = join(projectDir, '正文')
  if (!existsSync(novel)) return []
  const out: SliceEntry[] = []
  for (const f of readdirSync(novel)) {
    if (!f.endsWith('.md')) continue
    let text = ''
    try {
      text = readFileSync(join(novel, f), 'utf-8')
    } catch {
      continue
    }
    const { fm } = extractFrontMatter(text)
    const name = String(fm?.['切片'] ?? '').trim()
    if (!name) continue
    out.push({
      name,
      chapter: f.replace(/\.md$/, ''),
      time: String(fm?.['时间'] ?? '').trim() || undefined,
      chars: chapterChars(fm),
      updatedAt: statSync(join(novel, f)).mtimeMs
    })
  }
  // 按章号数值排序（第2章 在 第10章 前）；同号或解析不出时按文件名兜底
  const noOf = (s: SliceEntry): number => {
    const m = s.chapter.match(/第\s*(\d+)/)
    return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER
  }
  out.sort((a, b) => {
    const na = noOf(a)
    const nb = noOf(b)
    if (na !== nb) return na - nb
    return a.chapter.localeCompare(b.chapter, 'zh')
  })
  return out
}

/** 把切片清单登记为 .zhijuan/slices.json（索引；正文为源，缓存可随时重建） */
export function writeSliceRegistry(projectDir: string, entries: SliceEntry[]): string {
  const f = join(projectDir, DOT_DIR, 'slices.json')
  mkdirSync(dirname(f), { recursive: true })
  writeFileSync(f, JSON.stringify({ updatedAt: Date.now(), slices: entries }, null, 2), 'utf-8')
  return f
}
