import { describe, expect, it, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { writeFileAtomic } from '../../src/main/fsutil'

let dirs: string[] = []
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'zj-fsutil-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
  dirs = []
})

describe('writeFileAtomic', () => {
  it('写新文件：内容完整落盘', () => {
    const d = tmp()
    const f = join(d, 'a.json')
    writeFileAtomic(f, 'hello')
    expect(readFileSync(f, 'utf-8')).toBe('hello')
  })

  it('覆盖已有文件：内容被替换且无临时文件残留', () => {
    const d = tmp()
    const f = join(d, 'a.json')
    writeFileSync(f, 'old', 'utf-8')
    writeFileAtomic(f, 'new\ncontent')
    expect(readFileSync(f, 'utf-8')).toBe('new\ncontent')
    expect(readdirSync(d).sort()).toEqual(['a.json']) // 无 .a.json.*.tmp 残留
  })

  it('同目录多次连续写：每次内容均为最终态（临时文件不串台）', () => {
    const d = tmp()
    const f = join(d, 'b.json')
    writeFileAtomic(f, '1')
    writeFileAtomic(f, '22')
    writeFileAtomic(f, '333')
    expect(readFileSync(f, 'utf-8')).toBe('333')
    expect(readdirSync(d).sort()).toEqual(['b.json'])
  })

  it('目标为已存在目录（rename 失败）：抛错且清理临时文件', () => {
    const d = tmp()
    const f = join(d, 'adir')
    mkdirSync(f)
    expect(() => writeFileAtomic(f, 'x')).toThrow()
    expect(readdirSync(f)).toEqual([]) // 无 tmp 残留进目录
  })

  it('目录不存在：抛错（与 writeFileSync 语义一致，调用方负责建目录）', () => {
    const d = tmp()
    expect(() => writeFileAtomic(join(d, 'no-such-dir', 'a.md'), 'x')).toThrow()
  })

  it('嵌套目录写入正常', () => {
    const d = tmp()
    const sub = join(d, 'x', 'y')
    mkdirSync(sub, { recursive: true })
    const f = join(sub, 'c.json')
    writeFileAtomic(f, 'nested')
    expect(readFileSync(f, 'utf-8')).toBe('nested')
    expect(statSync(f).size).toBe(6)
  })
})
