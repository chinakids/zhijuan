// ===== 织卷 · 导演板新旧判断（纯约定，无 fs） =====
// 「先设定后成文」的一环护栏：正文先写、导演板后到是正常节奏；
// 若导演板比正文更旧（正文在导演之后又被改过），兑现检查对照的是旧承诺，应在 UI 给轻提示。

/** 容差：正文与导演板写入时间差小于该值视为“同一轮”，不算偏旧（毫秒） */
export const STALE_TOLERANCE_MS = 5000

/** 导演板是否比对应正文更旧（boardMtime / bodyMtime 为各自文件的最后修改时间戳） */
export function isBoardStale(boardMtime: number, bodyMtime: number, toleranceMs = STALE_TOLERANCE_MS): boolean {
  return bodyMtime - boardMtime > toleranceMs
}
