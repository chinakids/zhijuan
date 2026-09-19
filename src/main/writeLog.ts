// ===== 正文写盘审计日志（2026-09-19 创作层；P1 F-20260917-10 排查支撑）=====
// .zhijuan/write-log.jsonl：一行一条 WriteLogEntry（JSONL 追加，O(1)，崩溃最多丢半行，损坏行跳过），
// 上限 WRITE_LOG_CAP 条（超出重写保最新）。
// 记录条件与版本历史快照同口径（isVersionedRel 且内容有变化）——凡产生 history 快照的写盘都有本记录。
// 背景：2026-09-19「切片同步清空」P1 现场，正文被写成「仅约定头 92B」而写盘调用方只能事后靠
// history 快照时间戳推断（快照只留旧内容不留新内容/新长度）。写入时刻+新旧长度+新内容头部留档后，
// 再演即可直接从 write-log 拿到写盘事实（时间/长度剧变即异常信号），无需猜测与恢复前抢拍。
// 旁路记录：appendWriteLog 全 try/catch 包裹，绝不改变写盘链路结果（writeDoc 调用方无感）。
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { libraryRoot } from './settings'
import { DOT_DIR } from '../shared/paths'

/** 与 store.projectDir 同构（避免 store↔writeLog 循环依赖） */
function projectDir(id: string): string {
  return join(libraryRoot(), id)
}

/** 写盘审计条目 */
export interface WriteLogEntry {
  time: number
  rel: string
  prevLen: number
  newLen: number
  /** 新内容头部（前 120 字符；异常写盘（清空/截断）从这里一眼可辨） */
  head: string
}

/** 日志上限（防无限膨胀；500 条 ≈ 数百次保存周期的回溯量，与 sync-log 同档） */
export const WRITE_LOG_CAP = 500

/** 新内容头部保留长度 */
const HEAD_LEN = 120

export function writeLogPath(projectId: string): string {
  return join(projectDir(projectId), DOT_DIR, 'write-log.jsonl')
}

/** 追加一条写盘审计日志（任何异常都被吞掉，仅旁路记录） */
export function appendWriteLog(projectId: string, entry: WriteLogEntry): void {
  try {
    const p = writeLogPath(projectId)
    mkdirSync(join(projectDir(projectId), DOT_DIR), { recursive: true })
    appendFileSync(p, JSON.stringify(entry) + '\n', 'utf-8')
    // 超限裁剪：重写保最新 WRITE_LOG_CAP 条（低频路径）
    const raw = readFileSync(p, 'utf-8')
    const lines = raw.split('\n').filter((l) => l.trim().length > 0)
    if (lines.length > WRITE_LOG_CAP) {
      writeFileSync(p, lines.slice(-WRITE_LOG_CAP).join('\n') + '\n', 'utf-8')
    }
  } catch {
    // 旁路：不干扰写盘本体
  }
}

/** 读取写盘审计（最新在前；损坏行跳过；文件不存在/异常返回 []） */
export function listWriteLog(projectId: string, relPrefix?: string): WriteLogEntry[] {
  try {
    const raw = readFileSync(writeLogPath(projectId), 'utf-8')
    const out: WriteLogEntry[] = []
    for (const l of raw.split('\n')) {
      const s = l.trim()
      if (!s) continue
      try {
        const e = JSON.parse(s) as WriteLogEntry
        if (e && typeof e.time === 'number' && typeof e.rel === 'string' && typeof e.newLen === 'number') {
          out.push(e)
        }
      } catch {
        // 半行/损坏行跳过
      }
    }
    const filtered = relPrefix ? out.filter((e) => e.rel.startsWith(relPrefix)) : out
    return filtered.slice(-WRITE_LOG_CAP).reverse()
  } catch {
    return []
  }
}

export { HEAD_LEN }
