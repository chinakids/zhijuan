import { describe, expect, it } from 'vitest'
import { tools } from '../../src/plugins/zj-core'

// 工具描述与实现口径一致性守卫（2026-09-18 智能层，Anthropic《Writing effective tools
// for agents》：工具描述载入 agent 上下文、会引导工具调用行为——描述与实际行为不一致
// 会让模型按错误心智行事；此处锁定「描述引导 offset 续读 / zj_search 无排序」不被回退）
describe('zj 工具描述与实现口径一致（描述会引导模型行为）', () => {
  const readDoc = tools.find((t) => t.name === 'zj_read_doc')!
  const search = tools.find((t) => t.name === 'zj_search')!

  it('zj_read_doc 描述引导 offset 续读而非 maxChars 一次大读', () => {
    const d = readDoc.description
    expect(d).toContain('offset 续读')
    // 不得再出现诱导模型自己算偏移的写法
    expect(d).not.toContain('全文长度-目标长度')
    const maxChars = readDoc.parameters.maxChars.description
    expect(maxChars).toContain('优先按提示的 offset 续读')
  })

  it('zj_search 描述如实说明子串匹配与顺序（无相关性排序）', () => {
    const d = search.description
    expect(d).toContain('子串匹配')
    expect(d).toContain('无相关性排序')
  })
})
