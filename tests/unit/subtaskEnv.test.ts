import { describe, expect, it } from 'vitest'
import { subtaskEnvBlock } from '../../src/main/agent/subtask'

describe('subtaskEnvBlock（子任务会话基座：zj_* 工具的「作品根目录」坐标，2026-09-19 智能层）', () => {
  it('含【作品根目录】绝对路径 + 打开章节声明 + zj 引导句（base 不要自己编）', () => {
    const out = subtaskEnvBlock('/Users/x/织卷工作区/项目库/我的作品')
    expect(out).toContain('【作品根目录】/Users/x/织卷工作区/项目库/我的作品')
    expect(out).toContain('未打开')
    expect(out).toContain('zj_* 工具')
    expect(out).toContain('不要自己编')
  })

  it('与 runChat envBlock 的引导口径一致（zj 工具读、base 取自上下文）', () => {
    const out = subtaskEnvBlock('/tmp/项目')
    expect(out).toContain('base 永远是上下文给出的【作品根目录】')
    expect(out).not.toContain('zj_edit_doc') // 子任务是读类/核对类，无正文修改卡语境
  })
})
