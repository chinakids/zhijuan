import type { DirectorCheckResult } from '../../../../shared/types'

/** 非绿灯计数：未兑现弧段 + 漂移/没写的轴 + 被破红线 + 仍悬着钩子（新埋=导演板预期，中性不计） */
export function countTrouble(r: DirectorCheckResult): number {
  return (
    r.arcs.filter((x) => x.status !== 'done').length +
    r.axes.filter((x) => x.status !== 'aligned').length +
    r.redlines.filter((x) => x.status !== 'kept').length +
    r.hooks.filter((x) => x.status !== 'paid' && x.status !== 'new').length
  )
}
