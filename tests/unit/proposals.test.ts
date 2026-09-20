import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { applyAnchor, applyProposal, createProposals, createSliceProposals, invalidateChapter, listProposals, migrateChapter, rejectProposal, discardProposal, staleSliceSyncByChapter } from '../../src/main/proposals'
import type { ProposalItem } from '../../src/shared/types'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'zj-prop-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const item = (patch: Partial<ProposalItem>): ProposalItem => ({
  target: '人物/林晚.md',
  anchor: '## 现时状态',
  kind: 'upsert-section',
  before: '',
  after: '新状态',
  reason: '测试',
  ...patch
})

describe('applyAnchor（锚点写入核心算法）', () => {
  it('命中标题 → 整节替换：标题行保留、原内容去掉、后续小节不被波及', () => {
    const text = '# 人物档案\n\n## 基础设定\n\n基础内容\n\n## 现时状态\n\n旧状态\n\n## 成长轨迹\n\n轨迹内容'
    const r = applyAnchor(text, item({ anchor: '## 现时状态', after: '新状态' }))
    expect(r.ok).toBe(true)
    expect(r.out).toContain('## 现时状态')
    expect(r.out).toContain('新状态')
    expect(r.out).not.toContain('旧状态')
    expect(r.out).toContain('## 基础设定')
    expect(r.out).toContain('基础内容')
    expect(r.out).toContain('## 成长轨迹')
    expect(r.out).toContain('轨迹内容')
  })

  it('锚点写成不带井号的纯文本也能命中', () => {
    const r = applyAnchor('# 文件\n\n### 角色状态\n\n旧', item({ anchor: '角色状态', after: '新' }))
    expect(r.ok).toBe(true)
    expect(r.out).toContain('新')
    expect(r.out).not.toContain('旧')
  })

  it('锚点不存在 → 在文末追加新节（H2，与模块设计 §7 模板一致），原内容保留', () => {
    const text = '# 文件\n\n原有段'
    const r = applyAnchor(text, item({ anchor: '## 不存在的节', after: '新内容' }))
    expect(r.ok).toBe(true)
    expect(r.out).toContain('原有段')
    expect(r.out).toContain('## 不存在的节')
    expect(r.out).not.toContain('### 不存在的节')
    expect(r.out).toContain('新内容')
  })

  it('切片锚点不存在 → 追加 H2「## 切片：<名>」（回归：曾追加 H3 漂移）', () => {
    const text = '# 陈默\n\n## 基础档案\n\n- 姓名：陈默'
    const r = applyAnchor(text, item({ anchor: '切片：第一幕_夜', after: '- 本幕动向：守灯' }))
    expect(r.ok).toBe(true)
    expect(r.out).toContain('## 切片：第一幕_夜')
    expect(r.out).not.toContain('### 切片：第一幕_夜')
    expect(r.out).toContain('- 本幕动向：守灯')
  })

  it('空锚点 → 追加 H2「## 切片状态」小节', () => {
    const r = applyAnchor('旧文', item({ anchor: '', after: '状态片段' }))
    expect(r.ok).toBe(true)
    expect(r.out).toContain('## 切片状态')
    expect(r.out).not.toContain('### 切片状态')
    expect(r.out).toContain('状态片段')
  })

  it('kind=append → 直接贴到文末', () => {
    const r = applyAnchor('文', item({ kind: 'append', after: '追加' }))
    expect(r.out).toBe('文\n\n追加')
  })

  it('锚点精确化：前缀相似不误命中——「夜」不得替换「夜雨」整节（回归：曾 includes 误替换丢数据）', () => {
    const text = '# 陈默\n\n## 基础档案\n\n- 姓名：陈默\n\n## 切片：第一幕_夜雨\n\n- 雨夜：灯笼与雾\n\n## 成长轨迹\n\n轨迹'
    const r = applyAnchor(text, item({ anchor: '切片：第一幕_夜', after: '- 夜：守灯' }))
    expect(r.ok).toBe(true)
    // 「夜雨」整节原样保留
    expect(r.out).toContain('## 切片：第一幕_夜雨')
    expect(r.out).toContain('- 雨夜：灯笼与雾')
    expect(r.out).toContain('## 成长轨迹')
    // 夜 走文末追加 H2，不碰已有节（用「- 夜：守灯」出现位置在后证明非原地替换；前缀子串不可比）
    expect(r.out).toContain('## 切片：第一幕_夜\n\n- 夜：守灯')
    expect(r.out!.indexOf('- 夜：守灯')).toBeGreaterThan(r.out!.indexOf('- 雨夜：灯笼与雾'))
  })

  it('锚点带井号前缀/标题带尾随空格 → 归一化后仍命中替换', () => {
    const r = applyAnchor('## 现时状态 \n\n旧', item({ anchor: '## 现时状态', after: '新' }))
    expect(r.out).toContain('新')
    expect(r.out).not.toContain('旧')
  })

  it('全角空格锚点归一化后命中', () => {
    const r = applyAnchor('## 切片：A\u3000\n\n旧', item({ anchor: '切片：A', after: '新' }))
    expect(r.out).toContain('新')
    expect(r.out).not.toContain('旧')
  })
})

describe('createProposals', () => {
  it('slice 字段必随提案落库并可回读（防回归：早期产物 slice 被丢成空串）', () => {
    const [p] = createProposals(root, 'p', 'slice-sync', '第1章', '第一幕_夏夜', [item({})])
    expect(p.slice).toBe('第一幕_夏夜')
    const back = listProposals(root, 'p')[0]
    expect(back.slice).toBe('第一幕_夏夜')
    expect(back.chapter).toBe('第1章')
    expect(back.status).toBe('pending')
    // 不同章的切片互不串
    createProposals(root, 'p', 'slice-sync', '第2章', '第二幕_台风夜', [item({})])
    const all = listProposals(root, 'p')
    expect(all.find((x) => x.chapter === '第2章')?.slice).toBe('第二幕_台风夜')
    expect(all.find((x) => x.chapter === '第1章')?.slice).toBe('第一幕_夏夜')
  })

  it('同章旧的 pending 置 stale；每 item 一条提案；不同章互不影响', () => {
    const p1 = createProposals(root, 'p', 'slice-sync', '第1章', '切片A', [item({ after: '一' }), item({ after: '二' })])
    expect(p1).toHaveLength(2)

    const p2 = createProposals(root, 'p', 'slice-sync', '第1章', '切片A', [item({ after: '三' })])
    expect(p2).toHaveLength(1)

    let all = listProposals(root, 'p')
    expect(all).toHaveLength(3)
    expect(all.find((x) => x.id === p1[0].id)?.status).toBe('stale')
    expect(all.find((x) => x.id === p2[0].id)?.status).toBe('pending')

    // 为第 2 章建提案，第 1 章的 pending 保持不动
    createProposals(root, 'p', 'slice-sync', '第2章', '切片B', [item({ after: '四' })])
    all = listProposals(root, 'p')
    expect(all.find((x) => x.id === p2[0].id)?.status).toBe('pending')
  })
})

describe('migrateChapter（章节重命名后 chapter 引用迁移）', () => {
  it('命中旧路径的提案全量迁移，item 审计内容不动；其它章不受影响', () => {
    const [a] = createProposals(root, 'p', 'slice-sync', '正文/第01章_雾港.md', '切片A', [item({ after: '一' })])
    createProposals(root, 'p', 'slice-sync', '正文/第02章_灯塔.md', '切片B', [item({ after: '二' })])

    const n = migrateChapter(root, 'p', '正文/第01章_雾港.md', '正文/第01章_灯下雾.md')
    expect(n).toBe(1)
    const all = listProposals(root, 'p')
    expect(all.find((x) => x.id === a.id)?.chapter).toBe('正文/第01章_灯下雾.md')
    expect(all.find((x) => x.id === a.id)?.items[0].after).toBe('一') // 审计内容不动
    expect(all.find((x) => x.chapter === '正文/第02章_灯塔.md')).toBeDefined()
  })

  it('迁移后同章再同步：旧 pending 能按新路径正确置 stale（stale 判定键修复）', () => {
    const [old] = createProposals(root, 'p', 'slice-sync', '正文/第01章_雾港.md', '切片A', [item({ after: '旧' })])
    migrateChapter(root, 'p', '正文/第01章_雾港.md', '正文/第01章_灯下雾.md')
    const [nw] = createProposals(root, 'p', 'slice-sync', '正文/第01章_灯下雾.md', '切片A', [item({ after: '新' })])
    expect(listProposals(root, 'p').find((x) => x.id === old.id)?.status).toBe('stale')
    expect(listProposals(root, 'p').find((x) => x.id === nw.id)?.status).toBe('pending')
  })

  it('防御：无提案目录返回 0；新旧同路径/空路径返回 0', () => {
    expect(migrateChapter(root, 'p', 'a', 'b')).toBe(0)
    expect(migrateChapter(root, 'p', '正文/第01章_雾港.md', '正文/第01章_雾港.md')).toBe(0)
    expect(migrateChapter(root, 'p', '', 'b')).toBe(0)
  })
})

describe('applyProposal', () => {
  it('整流程：after 写进目标文件、旧状态被替换、提案置 accepted、返回 applied', () => {
    mkdirSync(join(root, 'p', '人物'), { recursive: true })
    writeFileSync(join(root, 'p', '人物/林晚.md'), '# 人物\n\n## 现时状态\n\n旧状态')
    const [p] = createProposals(root, 'p', 'agent-chat', '第1章', 's', [item({ after: '新状态' })])

    const r = applyProposal(root, 'p', p.id)
    expect(r.ok).toBe(true)
    expect(r.applied).toContain('人物/林晚.md')
    const file = readFileSync(join(root, 'p', '人物/林晚.md'), 'utf-8')
    expect(file).toContain('新状态')
    expect(file).not.toContain('旧状态')
    expect(listProposals(root, 'p')[0].status).toBe('accepted')
  })

  it('target 文件不存在 → 按协议补建目录与文件', () => {
    const [p] = createProposals(root, 'p', 'agent-chat', '第1章', 's', [
      item({ target: '人物/新人.md', anchor: '', after: '内容' })
    ])
    const r = applyProposal(root, 'p', p.id)
    expect(r.ok).toBe(true)
    expect(existsSync(join(root, 'p', '人物/新人.md'))).toBe(true)
  })

  it('系统/IO 失败（ENOTDIR 类）→ 保持 pending 可重试；修复后重试成功 accepted（2026-09-16 候选1 语义）', () => {
    // 把 人物 建为普通文件，让其下任何路径都写不进（ENOTDIR：系统错误带 code → ioFail）
    mkdirSync(join(root, 'p'), { recursive: true })
    writeFileSync(join(root, 'p', '人物'), '我是文件不是目录')
    const [p] = createProposals(root, 'p', 'agent-chat', '第1章', 's', [item({})])
    const r = applyProposal(root, 'p', p.id)
    expect(r.ok).toBe(false)
    expect(r.errors.length).toBeGreaterThan(0)
    expect(r.retryable).toBe(true)
    // 关键：IO/瞬态失败**不改状态**，卡仍在 pending 组、接受按钮可用，作者就地重试
    expect(listProposals(root, 'p')[0].status).toBe('pending')
    // 修复：还原 人物/ 目录与目标文件后，重试同一载荷成功（无需重新扫描/重新生成）
    rmSync(join(root, 'p', '人物'), { force: true })
    mkdirSync(join(root, 'p', '人物'), { recursive: true })
    writeFileSync(join(root, 'p', '人物/林晚.md'), '# 人物\n\n## 现时状态\n\n旧')
    const r2 = applyProposal(root, 'p', p.id)
    expect(r2.ok).toBe(true)
    expect(readFileSync(join(root, 'p', '人物/林晚.md'), 'utf-8')).toContain('新状态')
    expect(listProposals(root, 'p')[0].status).toBe('accepted')
  })

  it('已应用的提案再次 apply → ok:false', () => {
    mkdirSync(join(root, 'p', '人物'), { recursive: true })
    writeFileSync(join(root, 'p', '人物/林晚.md'), '# 人物\n\n## 现时状态\n\n旧')
    const [p] = createProposals(root, 'p', 'agent-chat', '第1章', 's', [item({})])
    expect(applyProposal(root, 'p', p.id).ok).toBe(true)
    const second = applyProposal(root, 'p', p.id)
    expect(second.ok).toBe(false)
    expect(second.errors.join()).toContain('accepted')
  })

  it('replace-text 缺 before → 拒绝且不写盘（提示缺文段）', () => {
    mkdirSync(join(root, 'p', '正文'), { recursive: true })
    writeFileSync(join(root, 'p', '正文/第01章_雾港.md'), '# 第1章\n\n你当真不记得了？')
    const [p] = createProposals(root, 'p', 'annotation-sync', '正文/第01章_雾港.md', '第一幕_夜', [
      item({ target: '正文/第01章_雾港.md', kind: 'replace-text', anchor: '', before: '', after: '你忘了？' })
    ])
    const r = applyProposal(root, 'p', p.id)
    expect(r.ok).toBe(false)
    expect(r.errors.join()).toContain('replace-text 缺少 before 文段')
    expect(readFileSync(join(root, 'p', '正文/第01章_雾港.md'), 'utf-8')).toBe('# 第1章\n\n你当真不记得了？')
    expect(listProposals(root, 'p')[0].status).toBe('rejected')
  })

  it('replace-text before 精确匹配 → 按 before→after 替换并置 accepted', () => {
    mkdirSync(join(root, 'p', '正文'), { recursive: true })
    writeFileSync(join(root, 'p', '正文/第01章_雾港.md'), '# 第1章\n\n你当真不记得了？')
    const [p] = createProposals(root, 'p', 'annotation-sync', '正文/第01章_雾港.md', '第一幕_夜', [
      item({ target: '正文/第01章_雾港.md', kind: 'replace-text', anchor: '', before: '你当真不记得了？', after: '你忘了？' })
    ])
    const r = applyProposal(root, 'p', p.id)
    expect(r.ok).toBe(true)
    expect(r.applied).toContain('正文/第01章_雾港.md')
    const file = readFileSync(join(root, 'p', '正文/第01章_雾港.md'), 'utf-8')
    expect(file).toContain('你忘了？')
    expect(file).not.toContain('你当真不记得了？')
    expect(listProposals(root, 'p')[0].status).toBe('accepted')
  })

  it('replace-text before 漂移（作者已手动改原文）→ 拒绝、提示请人工确认、正文未被改写', () => {
    mkdirSync(join(root, 'p', '正文'), { recursive: true })
    // 提案生成后原文被手动改动（before 漂移）：文件里是「你真不记得了？」，提案 before 是「你当真不记得了？」
    writeFileSync(join(root, 'p', '正文/第01章_雾港.md'), '# 第1章\n\n你真不记得了？')
    const [p] = createProposals(root, 'p', 'annotation-sync', '正文/第01章_雾港.md', '第一幕_夜', [
      item({ target: '正文/第01章_雾港.md', kind: 'replace-text', anchor: '', before: '你当真不记得了？', after: '你忘了？' })
    ])
    const r = applyProposal(root, 'p', p.id)
    expect(r.ok).toBe(false)
    expect(r.errors.join()).toContain('请人工确认')
    expect(readFileSync(join(root, 'p', '正文/第01章_雾港.md'), 'utf-8')).toBe('# 第1章\n\n你真不记得了？')
    expect(listProposals(root, 'p')[0].status).toBe('rejected')
  })

  it('提案不存在 → ok:false', () => {
    expect(applyProposal(root, 'p', 'nope').ok).toBe(false)
  })

  it('坏档被跳过，不影响良档', () => {
    const d = join(root, 'p', '.zhijuan', 'proposals')
    mkdirSync(d, { recursive: true })
    writeFileSync(join(d, 'bad.json'), '这不是 json')
    createProposals(root, 'p', 'agent-chat', '第1章', 's', [item({})])
    expect(listProposals(root, 'p')).toHaveLength(1)
  })
})

describe('rejectProposal', () => {
  it('pending 可拒；已拒的不可再拒', () => {
    const [p] = createProposals(root, 'p', 'agent-chat', '第1章', 's', [item({})])
    expect(rejectProposal(root, 'p', p.id)).toBe(true)
    expect(listProposals(root, 'p')[0].status).toBe('rejected')
    expect(rejectProposal(root, 'p', p.id)).toBe(false)
  })
})

describe('invalidateChapter（章节删除后提案失效）', () => {
  const write = (name: string, p: Partial<{ id: string; chapter: string; status: string }>) => {
    const d = join(root, 'p', '.zhijuan', 'proposals')
    mkdirSync(d, { recursive: true })
    writeFileSync(
      join(d, name),
      JSON.stringify({ id: name, source: 'sync', chapter: '正文/第01章_雾港.md', slice: 's', status: 'pending', createdAt: 1, items: [item({})], ...p })
    )
  }
  it('仅该章的 pending 置 stale；其他章与已非 pending 的不动', () => {
    write('a.json', { id: 'a' })
    write('b.json', { id: 'b', chapter: '正文/第02章_听潮.md' })
    write('c.json', { id: 'c', status: 'stale' })
    write('d.json', { id: 'd', status: 'rejected' })
    expect(invalidateChapter(root, 'p', '正文/第01章_雾港.md')).toBe(1)
    const byId = Object.fromEntries(listProposals(root, 'p').map((x) => [x.id, x]))
    expect(byId.a.status).toBe('stale')
    expect(byId.b.status).toBe('pending')
    expect(byId.c.status).toBe('stale')
    expect(byId.d.status).toBe('rejected')
  })
  it('无匹配 → 0 且不动任何档；空 rel 直接 0', () => {
    write('a.json', { id: 'a' })
    expect(invalidateChapter(root, 'p', '正文/第99章_不存在.md')).toBe(0)
    expect(invalidateChapter(root, 'p', '')).toBe(0)
    expect(listProposals(root, 'p')[0].status).toBe('pending')
  })
})

describe('discardProposal（清除过期提案）', () => {
  it('仅 stale 可清除：文件删除、列表移除；pending/accepted/rejected 拒绝', () => {
    const [a] = createProposals(root, 'p', 'slice-sync', '第1章', 's', [item({ after: 'a' })])
    const [b] = createProposals(root, 'p', 'slice-sync', '第1章', 's', [item({ after: 'b' })])
    // a 是上一批的 pending，被 b 的同章再保存置 stale
    expect(listProposals(root, 'p').find((x) => x.id === a.id)?.status).toBe('stale')
    expect(discardProposal(root, 'p', a.id)).toBe(true)
    expect(listProposals(root, 'p').find((x) => x.id === a.id)).toBeUndefined()
    // pending 不可清
    expect(discardProposal(root, 'p', b.id)).toBe(false)
    expect(listProposals(root, 'p').find((x) => x.id === b.id)).toBeDefined()
    // accepted 不可清；不存在 id 返回 false
    expect(rejectProposal(root, 'p', b.id)).toBe(true)
    expect(discardProposal(root, 'p', b.id)).toBe(false)
    expect(discardProposal(root, 'p', 'nope')).toBe(false)
  })
})

describe('staleSliceSyncByChapter（切片名修改时过期旧切片提案）', () => {
  const writeP = (name: string, p: Record<string, unknown>) => {
    const d = join(root, 'p', '.zhijuan', 'proposals')
    mkdirSync(d, { recursive: true })
    writeFileSync(
      join(d, name),
      JSON.stringify({ id: name.replace(/\.json$/, ''), source: 'slice-sync', chapter: '正文/第01章_雾港.md', slice: '第一幕', status: 'pending', createdAt: 1, items: [item({})], ...p })
    )
  }
  it('仅该章 slice-sync 的 pending 置 stale；annotation-sync/其他章/非 pending 保留', () => {
    writeP('a.json', {})
    writeP('b.json', { source: 'annotation-sync', items: [item({ target: '正文/第01章_雾港.md' })] })
    writeP('c.json', { chapter: '正文/第02章_听潮.md' })
    writeP('d.json', { status: 'rejected' })
    expect(staleSliceSyncByChapter(root, 'p', '正文/第01章_雾港.md')).toBe(1)
    const byId = Object.fromEntries(listProposals(root, 'p').map((x) => [x.id, x]))
    expect(byId.a.status).toBe('stale')
    expect(byId.b.status).toBe('pending')
    expect(byId.c.status).toBe('pending')
    expect(byId.d.status).toBe('rejected')
  })
  it('无匹配 → 0；无 proposals 目录 → 0', () => {
    writeP('a.json', {})
    expect(staleSliceSyncByChapter(root, 'p', '正文/第99章_不存在.md')).toBe(0)
    rmSync(join(root, 'p', '.zhijuan', 'proposals'), { recursive: true, force: true })
    expect(staleSliceSyncByChapter(root, 'p', '正文/第01章_雾港.md')).toBe(0)
  })
})

describe('createSliceProposals（未处置语义精化：正文保存不是失效信号）', () => {
  it('同章不同款 pending 在再次同步后保持 pending，新不同款照建', () => {
    const [pA] = createProposals(root, 'p', 'slice-sync', '正文/第01章_雾港.md', '雾港夜', [item({ after: '旧动向A' })])
    const r = createSliceProposals(root, 'p', '正文/第01章_雾港.md', '雾港夜', [item({ after: '新动向B' })])
    expect(r.created.length).toBe(1)
    expect(r.kept).toBe(0)
    expect(listProposals(root, 'p').find((x) => x.id === pA.id)?.status).toBe('pending')
    expect(listProposals(root, 'p').filter((x) => x.status === 'pending').length).toBe(2)
  })
  it('同款被「已拒绝历史」先行抑制时，同章旧 pending 不被作废（漏保护修复）', () => {
    // 构造：先造一条 rejected 同款历史（显式裁决），再造同款 pending（作者未处置的旧卡）
    const [pr] = createProposals(root, 'p', 'slice-sync', '正文/第02章_灯塔.md', '雾港夜', [item({ after: '动向X' })])
    expect(rejectProposal(root, 'p', pr.id)).toBe(true)
    const [p2] = createProposals(root, 'p', 'slice-sync', '正文/第02章_灯塔.md', '雾港夜', [item({ after: '动向X' })])
    const r = createSliceProposals(root, 'p', '正文/第02章_灯塔.md', '雾港夜', [item({ after: '动向X' })])
    expect(r.suppressed).toBe(1)
    expect(r.created.length).toBe(0)
    expect(listProposals(root, 'p').find((x) => x.id === p2.id)?.status).toBe('pending')
  })
})
