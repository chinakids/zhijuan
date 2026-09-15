import { describe, it, expect } from 'vitest'
import type { SyncIssue } from '../../src/shared/types'
import { personRelOf, isUnfiledIssue } from '../../src/renderer/src/features/sync/guardCreate'

const issue = (partial: Partial<SyncIssue>): SyncIssue => ({
  target: '人物/新角色1.md',
  action: 'dropped',
  reason: '尚未建档',
  ...partial
})

describe('guardCreate.isUnfiledIssue（toast 建档按钮的处置判据）', () => {
  it('未建档型 dropped 为 true', () => {
    expect(isUnfiledIssue(issue({ unfiled: true }))).toBe(true)
  })
  it('已纠正 / 非未建档 dropped 均为 false', () => {
    expect(isUnfiledIssue(issue({ action: 'corrected' }))).toBe(false)
    expect(isUnfiledIssue(issue({ unfiled: false }))).toBe(false)
    expect(isUnfiledIssue(issue({ unfiled: undefined }))).toBe(false)
  })
})

describe('guardCreate.personRelOf（守卫 target → 可写人物路径；toast 批量建档与四入口共用判据）', () => {
  it('人物 target 归一化为 人物/<名>.md（原样）', () => {
    expect(personRelOf('人物/沈藏.md')).toBe('人物/沈藏.md')
    expect(personRelOf('人物/新角色1.md')).toBe('人物/新角色1.md')
  })

  it('非人物 target 返回 null（建档动作只对人物目标生效）', () => {
    expect(personRelOf('世界观/总纲.md')).toBeNull()
    expect(personRelOf('正文/第01章_雾港.md')).toBeNull()
  })

  it('空名 / 仅路径前缀返回 null', () => {
    expect(personRelOf('人物/.md')).toBeNull()
    expect(personRelOf('人物/')).toBeNull()
    expect(personRelOf('人物/  .md')).toBeNull()
    expect(personRelOf('')).toBeNull()
  })

  it('无 .md 后缀补后缀；名称首尾空白被修剪', () => {
    expect(personRelOf('人物/张三')).toBe('人物/张三.md')
    expect(personRelOf('人物/  张三  .md')).toBe('人物/张三.md')
  })

  it('危险字符走 sanitizeFile 清洗（与清单/写盘同口径）', () => {
    expect(personRelOf('人物/张三:李.md')).toBe('人物/张三_李.md')
  })
})
