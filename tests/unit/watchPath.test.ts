import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { watchRelPath } from '../../src/shared/watchPath'

// F-20261029-01 回归：macOS 递归 fs.watch 给相对 root 的 filename，
// 旧实现 relative(root, filename) 会把相对名当 cwd 相对 → ../../.. 串 → 编辑器不刷新。
describe('watchRelPath', () => {
  const root = '/Users/u/Documents/织卷工作区/项目库/项目A'

  it('相对 filename（macOS 递归监听）原样归一化为 root 相对', () => {
    expect(watchRelPath(root, '正文/第01章_灯下.md')).toBe('正文/第01章_灯下.md')
    expect(watchRelPath(root, './正文/第01章_灯下.md')).toBe('正文/第01章_灯下.md')
    expect(watchRelPath(root, '.zhijuan/版本/x.md')).toBe('.zhijuan/版本/x.md')
  })

  it('绝对 filename（部分平台/版本）→ 相对 root', () => {
    expect(watchRelPath(root, join(root, '正文/第01章_灯下.md'))).toBe('正文/第01章_灯下.md')
  })

  it('越界/空值丢弃', () => {
    expect(watchRelPath(root, '')).toBe('')
    expect(watchRelPath(root, '../别的项目/正文/x.md')).toBe('')
    expect(watchRelPath(root, '/tmp/outside.md')).toBe('')
  })

  it('原子写的临时文件名仍为项目内相对路径（不丢事件）', () => {
    expect(watchRelPath(root, '正文/.第01章_灯下.md.1234.0.tmp')).toBe('正文/.第01章_灯下.md.1234.0.tmp')
  })
})