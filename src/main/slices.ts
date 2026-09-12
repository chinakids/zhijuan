// ===== 织卷 V2 · 时间切片清单（模块设计 §14之 / 评审 D2） =====
// 把「切片」从章头字符串升格为可枚举实体：正文仍是唯一源，本模块每次现扫章头 front matter；
// writeSliceRegistry 把结果登记为 .zhijuan/slices.json 索引，供时间线 / 跨切片巡检 / 切片对比直接读，随时可重建。
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { listSliceEntries } from '../shared/slices'
import { DOT_DIR } from '../shared/paths'
import type { SliceEntry } from '../shared/types'

/** 枚举项目内全部时间切片（解析/排序口径在 shared/slices，真机与 devShim 共用；读不到的文件跳过） */
export function listSlices(projectDir: string): SliceEntry[] {
  const novel = join(projectDir, '正文')
  if (!existsSync(novel)) return []
  const sources: { file: string; text: string; updatedAt: number }[] = []
  for (const f of readdirSync(novel)) {
    if (!f.endsWith('.md')) continue
    let text = ''
    try {
      text = readFileSync(join(novel, f), 'utf-8')
    } catch {
      continue
    }
    let updatedAt = 0
    try {
      updatedAt = statSync(join(novel, f)).mtimeMs
    } catch {
      /* 读不到 mtime 用 0（仅透传） */
    }
    sources.push({ file: f, text, updatedAt })
  }
  return listSliceEntries(sources)
}

/** 把切片清单登记为 .zhijuan/slices.json（索引；正文为源，缓存可随时重建） */
export function writeSliceRegistry(projectDir: string, entries: SliceEntry[]): string {
  const f = join(projectDir, DOT_DIR, 'slices.json')
  mkdirSync(dirname(f), { recursive: true })
  writeFileSync(f, JSON.stringify({ updatedAt: Date.now(), slices: entries }, null, 2), 'utf-8')
  return f
}
