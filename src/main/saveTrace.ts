// ===== 渲染层保存动作取证日志（2026-09-19 创作层；P1 F-20260917-10 残余）=====
// .zhijuan/save-trace.jsonl：一行一条 SaveTraceEntry（JSONL 追加，O(1)，崩溃最多丢半行，损坏行跳过），
// 上限 SAVE_TRACE_CAP 条（超出重写保最新）。
// 与 write-log（main/writeLog.ts，主进程 writeDoc 写盘侧事实）互补：write-log 有写盘事实（长度/内容头），
// 本记录有保存动作侧状态（mdLen/status/epoch/confirmEmpty/action）——
// P1 现场「09:30:13 保存时编辑器 body 为空」渲染层侧无痕（写盘方钉死后只剩渲染层根因未定位），
// 下次再现直接从 save-trace 回放保存时刻的编辑器状态，无需猜测。
// 旁路记录：appendSaveTrace 全 try/catch 包裹，绝不改变保存链路结果（doSave 调用方无感）。
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { libraryRoot } from './settings'
import { DOT_DIR } from '../shared/paths'
import type { SaveTraceEntry } from '../shared/types'

/** 与 store.projectDir 同构（避免 store↔saveTrace 循环依赖） */
function projectDir(id: string): string {
  return join(libraryRoot(), id)
}

/** 落盘条目 = 渲染层输入 + rel（由调用方（IPC handler）合成，与 WriteLogEntry 同构） */
export interface SaveTraceLine extends SaveTraceEntry {
  rel: string
}

/** 日志上限（防无限膨胀；500 条 ≈ 数百次保存动作的回溯量，与 write-log 同档） */
export const SAVE_TRACE_CAP = 500

export function saveTracePath(projectId: string): string {
  return join(projectDir(projectId), DOT_DIR, 'save-trace.jsonl')
}

/** 追加一条保存动作取证（任何异常都被吞掉，仅旁路记录） */
export function appendSaveTrace(projectId: string, rel: string, entry: SaveTraceEntry): void {
  try {
    const line: SaveTraceLine = { ...entry, rel }
    const p = saveTracePath(projectId)
    mkdirSync(join(projectDir(projectId), DOT_DIR), { recursive: true })
    appendFileSync(p, JSON.stringify(line) + '\n', 'utf-8')
    // 超限裁剪：重写保最新 SAVE_TRACE_CAP 条（低频路径）
    const raw = readFileSync(p, 'utf-8')
    const lines = raw.split('\n').filter((l) => l.trim().length > 0)
    if (lines.length > SAVE_TRACE_CAP) {
      writeFileSync(p, lines.slice(-SAVE_TRACE_CAP).join('\n') + '\n', 'utf-8')
    }
  } catch {
    // 旁路：不干扰保存本体
  }
}

/** 读取保存取证（最新在前；损坏/字段缺失行跳过；文件不存在/异常返回 []；action 可选过滤） */
export function listSaveTrace(projectId: string, action?: SaveTraceEntry['action']): SaveTraceLine[] {
  try {
    const raw = readFileSync(saveTracePath(projectId), 'utf-8')
    const out: SaveTraceLine[] = []
    for (const l of raw.split('\n')) {
      const s = l.trim()
      if (!s) continue
      try {
        const e = JSON.parse(s) as Partial<SaveTraceLine>
        if (
          e && typeof e.time === 'number' && typeof e.rel === 'string' &&
          typeof e.mdLen === 'number' && typeof e.status === 'string' &&
          typeof e.epoch === 'number' && typeof e.confirmEmpty === 'boolean' &&
          typeof e.diskBodyLen === 'number' && typeof e.action === 'string'
        ) {
          out.push(e as SaveTraceLine)
        }
      } catch {
        // 半行/损坏行跳过
      }
    }
    const filtered = action ? out.filter((e) => e.action === action) : out
    return filtered.slice(-SAVE_TRACE_CAP).reverse()
  } catch {
    return []
  }
}
