// ===== 切片同步历史日志（2026-09-16 创作层；候选「同步历史日志」落地）=====
// .zhijuan/sync-log.jsonl：一行一条 SyncLogEntry（JSONL 追加 O(1)、崩溃最多丢半行、损坏行跳过），
// 上限 SYNC_LOG_CAP 条（超出重写保最新）。
// 旁路记录：appendSyncLog 全 try/catch 包裹，绝不改变同步链路结果（runSync 调用方无感）。
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { writeFileAtomic } from '../fsutil'
import { join } from 'node:path'
import { projectDir } from '../store'
import { DOT_DIR } from '../../shared/paths'
import type { SyncLogEntry } from '../../shared/types'

/** 日志上限（防无限膨胀；500 条 ≈ 数百次保存周期的回溯量） */
export const SYNC_LOG_CAP = 500

export function syncLogPath(projectId: string): string {
  return join(projectDir(projectId), DOT_DIR, 'sync-log.jsonl')
}

/** 追加一条同步日志（任何异常都被吞掉，仅旁路记录） */
export function appendSyncLog(projectId: string, entry: SyncLogEntry): void {
  try {
    const p = syncLogPath(projectId)
    mkdirSync(join(projectDir(projectId), DOT_DIR), { recursive: true })
    appendFileSync(p, JSON.stringify(entry) + '\n', 'utf-8')
    // 超限裁剪：重写保最新 SYNC_LOG_CAP 条（低频路径）
    const raw = readFileSync(p, 'utf-8')
    const lines = raw.split('\n').filter((l) => l.trim().length > 0)
    if (lines.length > SYNC_LOG_CAP) {
      writeFileAtomic(p, lines.slice(-SYNC_LOG_CAP).join('\n') + '\n')
    }
  } catch {
    // 旁路：不干扰同步本体
  }
}

/** 读取同步历史（最新在前；损坏行跳过；文件不存在/异常返回 []） */
export function listSyncLog(projectId: string): SyncLogEntry[] {
  try {
    const raw = readFileSync(syncLogPath(projectId), 'utf-8')
    const out: SyncLogEntry[] = []
    for (const l of raw.split('\n')) {
      const s = l.trim()
      if (!s) continue
      try {
        const e = JSON.parse(s) as SyncLogEntry
        if (e && typeof e.time === 'number' && typeof e.chapter === 'string') out.push(e)
      } catch {
        // 半行/损坏行跳过
      }
    }
    return out.slice(-SYNC_LOG_CAP).reverse()
  } catch {
    return []
  }
}

/** 错误摘要截断（单一源已迁 shared/syncLogShared.ts，main 与 devShim 共用同口径；re-export 保持 import 图稳定） */
export { clipLogError } from '../../shared/syncLogShared'
