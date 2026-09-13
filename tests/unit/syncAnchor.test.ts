import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { normalizeSyncItems, ensureWorldSliceFile, guardPersonTargets, editDistance } from '../../src/main/agent/syncAnchor'
import { worldSliceFile } from '../../src/shared/paths'

const tmp = mkdtempSync(join(tmpdir(), 'zj-synca-'))
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

const item = (partial: Partial<Parameters<typeof normalizeSyncItems>[0][number]> = {}) => ({
  target: '人物/林晚.md',
  anchor: '',
  kind: 'upsert-section' as const,
  before: '',
  after: '- 本幕动向：……',
  reason: '测试',
  ...partial
})

describe('normalizeSyncItems（切片同步产物归一化）', () => {
  it('人物 anchor 为空 → 归一为「切片：<切片名>」', () => {
    const [r] = normalizeSyncItems([item()], '第一幕_夏夜')
    expect(r.anchor).toBe('切片：第一幕_夏夜')
    expect(r.target).toBe('人物/林晚.md')
  })

  it('人物 anchor 指向长期小节（基础档案/成长轨迹等）→ 归一，绝不覆盖基础设定', () => {
    for (const bad of ['基础档案', '基础设定', '成长轨迹（按时间切片）', '## 成长轨迹', '定位']) {
      const [r] = normalizeSyncItems([item({ anchor: bad })], '第二幕_台风夜')
      expect(r.anchor).toBe('切片：第二幕_台风夜')
    }
  })

  it('人物 anchor 已是「切片：xxx」→ 原样保留', () => {
    const [r] = normalizeSyncItems([item({ anchor: '切片：第二幕_台风夜' })], '第二幕_台风夜')
    expect(r.anchor).toBe('切片：第二幕_台风夜')
  })

  it('白名单制导（2026-09-13）：人物任意异形锚点（无前缀/带#号/后缀废话/超长自定义）一律归一到「切片：<切片名>」', () => {
    for (const bad of ['第一幕_夏夜', '## 切片：第一幕_夏夜', '切片：第一幕_夏夜（深夜续）', '切片：第一幕_夏夜——台风来袭的详细记录']) {
      const [r] = normalizeSyncItems([item({ anchor: bad })], '第一幕_夏夜')
      expect(r.anchor).toBe('切片：第一幕_夏夜')
    }
  })

  it('白名单制导：世界锚点写「总纲」等异形 → 同样归一为「切片：<切片名>」（不再混入异号标题）', () => {
    for (const bad of ['总纲', '## 第一幕_夏夜', '']) {
      const [r] = normalizeSyncItems([item({ target: '世界观/总纲.md', anchor: bad })], '第一幕_夏夜')
      expect(r.target).toBe('世界观/切片_第一幕_夏夜.md')
      expect(r.anchor).toBe('切片：第一幕_夏夜')
    }
  })

  it('世界观 target/总纲.md → 归一为 切片_<切片名>.md，anchor 同步归一', () => {
    const [r] = normalizeSyncItems([item({ target: '世界观/总纲.md', anchor: '' })], '第一幕_夏夜')
    expect(r.target).toBe('世界观/切片_第一幕_夏夜.md')
    expect(r.anchor).toBe('切片：第一幕_夏夜')
  })

  it('世界观 target 已是切片_ 文件 → 只归一 anchor', () => {
    const [r] = normalizeSyncItems([item({ target: '世界观/切片_第一幕_夏夜.md', anchor: '' })], '第一幕_夏夜')
    expect(r.target).toBe('世界观/切片_第一幕_夏夜.md')
    expect(r.anchor).toBe('切片：第一幕_夏夜')
  })

  it('无切片名 → 人物 anchor 兜底「切片状态」，世界观 target 不动', () => {
    const [r] = normalizeSyncItems([item({ target: '世界观/总纲.md' })], '')
    expect(r.anchor).toBe('切片状态')
    expect(r.target).toBe('世界观/总纲.md')
  })

  it('其他目录 target（大纲/等）→ 原样保留', () => {
    const [r] = normalizeSyncItems([item({ target: '大纲/第01章.md', anchor: '关键事件' })], '第一幕_夏夜')
    expect(r.target).toBe('大纲/第01章.md')
    expect(r.anchor).toBe('关键事件')
  })
})

describe('ensureWorldSliceFile（世界切片文件确保存在）', () => {
  it('不存在 → 创建模板并返回相对路径；已存在 → 不改动', () => {
    const rel = ensureWorldSliceFile(tmp, '第一幕_夏夜')!
    expect(rel).toBe('世界观/切片_第一幕_夏夜.md')
    const abs = join(tmp, rel)
    expect(existsSync(abs)).toBe(true)
    expect(readFileSync(abs, 'utf-8')).toContain('切片：第一幕_夏夜')
    // 再调一次：内容保持（不重复覆盖）
    ensureWorldSliceFile(tmp, '第一幕_夏夜')
    expect(readFileSync(abs, 'utf-8')).toContain('切片：第一幕_夏夜')
  })

  it('切片名为空 → 返回 null 且不建文件', () => {
    expect(ensureWorldSliceFile(tmp, '')).toBe(null)
    expect(existsSync(join(tmp, '世界观'))).toBe(false)
  })
})

describe('worldSliceFile（命名约定）', () => {
  it('统一为 世界观/切片_<切片名>.md', () => {
    expect(worldSliceFile('第一幕_夏夜')).toBe('世界观/切片_第一幕_夏夜.md')
  })
})

describe('guardPersonTargets（候选 2e：target 存在性防线）', () => {
  const opts = { knownFiles: ['林晓', '陈默', '陆知微'], chapterCast: ['林晓', '陈默'] }
  const item = (target: string) => ({
    target,
    anchor: '切片：第一幕_夏夜',
    kind: 'upsert-section' as const,
    before: '',
    after: '- 新状态',
    reason: 'r'
  })

  it('精确命中现有档案 → 保留且无 issue', () => {
    const r = guardPersonTargets([item('人物/林晓.md')], opts)
    expect(r.items).toHaveLength(1)
    expect(r.issues).toHaveLength(0)
  })

  it('target 无 .md 后缀（模型手抖）且精确命中 → 保留', () => {
    const r = guardPersonTargets([item('人物/陈默')], opts)
    expect(r.items).toHaveLength(1)
    expect(r.issues).toHaveLength(0)
  })

  it('非人物 target（世界观/大纲）→ 一律不动', () => {
    const r = guardPersonTargets([item('世界观/切片_第一幕_夏夜.md'), item('大纲/第01章.md')], opts)
    expect(r.items).toHaveLength(2)
    expect(r.issues).toHaveLength(0)
    expect(r.items[0].target).toBe('世界观/切片_第一幕_夏夜.md')
  })

  it('编造 target 但存在唯一近名（编辑距离 1）→ 自动纠正并记 corrected', () => {
    const r = guardPersonTargets([item('人物/林晚.md')], opts)
    expect(r.items).toHaveLength(1)
    expect(r.items[0].target).toBe('人物/林晓.md')
    expect(r.issues).toHaveLength(1)
    expect(r.issues[0].action).toBe('corrected')
  })

  it('编造 target 且无近名 → 丢弃并记 dropped', () => {
    const r = guardPersonTargets([item('人物/沈藏.md')], opts)
    expect(r.items).toHaveLength(0)
    expect(r.issues).toHaveLength(1)
    expect(r.issues[0].action).toBe('dropped')
    expect(r.issues[0].reason).toContain('不存在')
  })

  it('多候选同距离（林如 vs 林晓/林晚 各距1）→ 不纠正，丢弃', () => {
    const r = guardPersonTargets([item('人物/林如.md')], { knownFiles: ['林晓', '林晚'], chapterCast: [] })
    expect(r.items).toHaveLength(0)
    expect(r.issues[0].action).toBe('dropped')
  })

  it('本章涉及人物但未建档 → 丢弃并明示「未建档」（不替作者建档）', () => {
    const r = guardPersonTargets([item('人物/林晚.md')], { knownFiles: ['林晓', '陈默'], chapterCast: ['林晓', '陈默', '林晚'] })
    expect(r.items).toHaveLength(0)
    expect(r.issues[0].action).toBe('dropped')
    expect(r.issues[0].reason).toContain('尚未建档')
  })

  it('名字前后空格/全角空格 → 规范化后命中现有档案', () => {
    const r = guardPersonTargets([item('人物/林晓 .md'), item('人物/陈默\u3000.md')], opts)
    expect(r.items).toHaveLength(2)
    expect(r.items[0].target).toBe('人物/林晓.md')
    expect(r.items[1].target).toBe('人物/陈默.md')
  })

  it('已知档案为空 → 人物 target 全丢（安全方向：不越权建档）', () => {
    const r = guardPersonTargets([item('人物/林晓.md')], { knownFiles: [], chapterCast: [] })
    expect(r.items).toHaveLength(0)
    expect(r.issues[0].action).toBe('dropped')
  })

  it('editDistance：相同=0、单字符替换=1、插入=1', () => {
    expect(editDistance('林晓', '林晓')).toBe(0)
    expect(editDistance('林晓', '林晚')).toBe(1)
    expect(editDistance('晓', '林晓')).toBe(1)
    expect(editDistance('', '林')).toBe(1)
  })
})
