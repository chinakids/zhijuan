import { describe, expect, it } from 'vitest'
import { applyAnchor } from '../../src/main/proposals'
import { precheckApply } from '../../src/shared/proposalPrecheck'
import type { ProposalItem } from '../../src/shared/types'

const item = (patch: Partial<ProposalItem>): ProposalItem => ({
  target: '人物/林晚.md',
  anchor: '## 现时状态',
  kind: 'upsert-section',
  before: '',
  after: '新状态',
  reason: '测试',
  ...patch
})

describe('precheckApply（全部接受前置预检，2026-09-21 候选 3）', () => {
  it('append：恒 ok', () => {
    expect(precheckApply('旧文', item({ kind: 'append', after: '追加' }))).toEqual({ ok: true })
  })

  it('replace-text 缺 before：fail（与 applyAnchor 同 msg）', () => {
    const it = item({ kind: 'replace-text', before: '', after: '新' })
    const pre = precheckApply('原文', it)
    const applied = applyAnchor('原文', it)
    expect(pre).toEqual({ ok: false, msg: 'replace-text 缺少 before 文段' })
    expect(applied).toEqual({ ok: false, msg: 'replace-text 缺少 before 文段' })
  })

  it('replace-text before 漂移：fail；原文在：ok', () => {
    const it = item({ kind: 'replace-text', before: '原文段', after: '改写' })
    expect(precheckApply('原文已变', it)).toEqual({ ok: false, msg: '原文段已变（可能被手动编辑），请人工确认' })
    expect(precheckApply('前文 原文段 后文', it)).toEqual({ ok: true })
  })

  it('upsert-section 无锚点：恒 ok', () => {
    expect(precheckApply('文', item({ anchor: '', after: '状态片段' }))).toEqual({ ok: true })
  })

  it('有基线（字符串）但小节已不存在：fail（节被删/改名）', () => {
    const it = item({ anchor: '切片：第一幕_夜', after: '新', beforeExact: '- 旧内容' })
    expect(precheckApply('## 别的节\n\n内容', it)).toEqual({ ok: false, msg: '目标小节已不存在（可能被改名或删除），请先核对' })
  })

  it('生成时无节（beforeExact=null）而现在无该节：ok（追加）', () => {
    expect(precheckApply('# 文件\n\n## 别的节\n\n内容', item({ beforeExact: null }))).toEqual({ ok: true })
  })

  it('旧档/agent-chat 转提案（beforeExact=undefined）无该节：ok（追加）', () => {
    expect(precheckApply('# 文件\n\n## 别的节\n\n内容', item({}))).toEqual({ ok: true })
  })

  it('生成时无节（beforeExact=null）而现在有同名节：fail（作者新建，防覆盖）', () => {
    const it = item({ after: '新内容', beforeExact: null })
    expect(precheckApply('# 文件\n\n## 现时状态\n\n作者写的', it)).toEqual({ ok: false, msg: '该小节生成时不存在、现已存在（可能为作者新建），为避免覆盖请先核对' })
  })

  it('有基线且内容一致：ok；内容被改：fail（与 applyAnchor 同 msg）', () => {
    const doc = '# 文件\n\n## 现时状态\n\n- 动向：守灯\n\n## 下一节\n\n内容'
    const it = item({ beforeExact: '- 动向：守灯', after: '- 动向：离港' })
    expect(precheckApply(doc, it)).toEqual({ ok: true })
    const changed = '# 文件\n\n## 现时状态\n\n- 动向：守灯\n- 作者后写：补充\n\n## 下一节\n\n内容'
    const pre = precheckApply(changed, it)
    const applied = applyAnchor(changed, it)
    expect(pre).toEqual({ ok: false, msg: '该小节内容在本提案生成后已被修改（可能手动编辑或被其他提案更新），为避免覆盖请先核对' })
    expect(applied).toEqual({ ok: false, msg: '该小节内容在本提案生成后已被修改（可能手动编辑或被其他提案更新），为避免覆盖请先核对' })
  })

  it('判据与 applyAnchor 等价：预检 ok ⇔ 应用 ok（随机多 case 一致性）', () => {
    const cases: [string, ProposalItem][] = [
      ['# 文件\n\n## 现时状态\n\n旧\n', item({})],
      ['# 文件\n\n## 现时状态\n\n旧\n', item({ beforeExact: '旧' })],
      ['# 文件\n\n## 现时状态\n\n新\n', item({ beforeExact: '旧' })],
      ['# 文件\n\n## 现时状态\n\n新\n', item({ beforeExact: null })],
      ['文', item({ kind: 'append', after: '追加' })],
      ['文', item({ kind: 'replace-text', before: '文', after: '改' })],
      ['文', item({ kind: 'replace-text', before: '不存在', after: '改' })]
    ]
    for (const [text, it] of cases) {
      const pre = precheckApply(text, it)
      const applied = applyAnchor(text, it)
      expect(pre.ok).toBe(applied.ok)
      if (!pre.ok) expect((applied as { msg?: string }).msg).toBe(pre.msg)
    }
  })
})
