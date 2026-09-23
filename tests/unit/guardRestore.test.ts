import { describe, it, expect } from 'vitest'
import { shouldBlockEmptyRestore } from '../../src/renderer/src/features/sync/guardRestore'

const FM = '---\n章号: 1\n题名: 雾港栈桥\n切片: 第一幕_夜\n涉及人物: [陈默, 林晓]\n---\n'
const BODY = '凌晨两点，雾把栈桥吞了一半。\n'

describe('guardRestore.shouldBlockEmptyRestore（恢复空版本防线判据，P1 F-20260917-10）', () => {
  it('旧版仅约定头、现盘有正文 → 拦截（P1 92B 形态）', () => {
    expect(shouldBlockEmptyRestore(FM, FM + BODY)).toBe(true)
  })
  it('旧版有正文、现盘有正文 → 放行（正常恢复）', () => {
    expect(shouldBlockEmptyRestore(FM + BODY, FM + '新正文。\n')).toBe(false)
  })
  it('旧版仅约定头、现盘也仅约定头 → 放行（恢复空版本属合法「清空」操作）', () => {
    expect(shouldBlockEmptyRestore(FM, FM)).toBe(false)
  })
  it('无约定头文档（审读等）→ 不拦（零回归）', () => {
    expect(shouldBlockEmptyRestore('## 审读\n无正文', '## 审读\n有正文')).toBe(false)
  })
  it('旧版空串 → 不拦（历史读不到/空档），由其他路径兜底', () => {
    expect(shouldBlockEmptyRestore('', FM + BODY)).toBe(false)
  })
})
