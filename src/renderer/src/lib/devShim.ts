// ===== 浏览器开发垫片：无 Electron 时（纯浏览器调试/无头截图）用内存 mock 顶替 window.zhijuan =====
import type { AppSettings, ChapterEntry, Proposal, ProposalItem, ProjectSummary } from '../../../shared/types'

const now = Date.now()

const docs = new Map<string, string>()
const seeded = { id: 'demo-aseya', name: '余烬的灯', description: '示例：失忆的守灯人找回自己' }

docs.set(
  'demo-aseya/正文/第01章_雾港.md',
  [
    '---',
    '章号: 1',
    '题名: 雾港',
    '切片: 第一幕_雾港之夜',
    '涉及人物: [阿七, 沈藏]',
    '---',
    '',
    '# 雾港',
    '',
    '雨把港口淋成一片灰。阿七靠着候船厅的柱子，指节发白地攥着那盏旧灯。',
    '',
    '「你当真不记得了？」沈藏点了根烟，烟雾在灯罩边绕了一圈，「这盏灯，是你自己熄的。」',
    '',
    '阿七低头看手里那张泛黄的船票 —— 上面写着她的名字，日期是十年前。',
    ''
  ].join('\n')
)
docs.set(
  'demo-aseya/正文/第02章_灯塔.md',
  ['---', '章号: 2', '题名: 灯塔', '切片: 第二幕_灯塔', '涉及人物: [阿七]', '---', '', '# 灯塔', '', '（本章待写）', ''].join('\n')
)
docs.set(
  'demo-aseya/人物/阿七.md',
  [
    '---',
    '姓名: 阿七',
    '身份: 灯塔守',
    '---',
    '',
    '## 基础档案',
    '',
    '- 外貌：黑发及腰，左耳戴一枚贝壳耳坠',
    '- 性格：安静、固执、怕水又偏偏守着海',
    '',
    '## 切片状态',
    '',
    '### 第一幕_雾港之夜',
    '- 见到十年前自己的船票，失忆症的裂缝开始松动',
    ''
  ].join('\n')
)
docs.set(
  'demo-aseya/人物/沈藏.md',
  ['---', '姓名: 沈藏', '身份: 老渔民', '---', '', '## 基础档案', '', '- 外貌：络腮胡，常年穿墨绿雨衣', '- 性格：话少，爱打哑谜', ''].join('\n')
)
docs.set(
  'demo-aseya/世界观/总纲.md',
  ['# 世界观总纲', '', '## 舞台', '', '- 地点：北方雾港「岑港」，一年里有两百天在下雨', '', '## 规则', '', '- 世界存在「记忆雾」：雾会吞掉人的记忆，灯塔的光能驱散它', ''].join('\n')
)
docs.set(
  'demo-aseya/世界观/第一幕_雾港之夜.md',
  ['# 切片：第一幕_雾港之夜', '', '- 雨夜，雾气偏浓，近海能见度不足百米', '- 候船厅还亮着几盏黄灯', ''].join('\n')
)
docs.set(
  'demo-aseya/素材库/索引.md',
  ['# 素材库索引', '', '- 桥段 / 环境：雾海、旧灯塔、泛黄船票', '- 人物原型 / 角色原型：冰山沉默系守灯人', ''].join('\n')
)
docs.set(
  'demo-aseya/素材库/桥段/追忆型开头.md',
  ['---', '标签: [桥段, 开头, 失忆]', '---', '', '# 追忆型开头', '', '以一件旧物切入，牵出角色“忘了的事”，用于开篇营造悬念。', ''].join('\n')
)

const settings: AppSettings = { libraryRoot: '', llm: { baseUrl: 'http://127.0.0.1:8888', model: 'deepseek-v4-flash-0731', apiKey: '' }, theme: 'paper', collectionEnabled: true }

const projects: ProjectSummary[] = [
  {
    id: seeded.id,
    name: seeded.name,
    description: seeded.description,
    createdAt: now - 86400_000 * 6,
    updatedAt: now - 3600_000,
    stats: { chapters: 2, characters: 2, worldviewFiles: 2, materials: 1 },
    lastChapter: '第02章_灯塔'
  },
  {
    id: 'demo-yunshan',
    name: '云山驿事',
    description: '示例：驿道上的妖与账房先生',
    createdAt: now - 86400_000 * 40,
    updatedAt: now - 86400_000 * 2,
    stats: { chapters: 5, characters: 4, worldviewFiles: 3, materials: 2 },
    lastChapter: '第05章_山雨'
  }
]

function docsOf(prefix: string): { file: string; name: string; mtime: number }[] {
  return [...docs.keys()]
    .filter((k) => k.startsWith(prefix + '/'))
    .map((k) => ({ file: k.slice(prefix.length + 1), name: k.split('/').pop()!, mtime: now }))
}

const mock = {
  getSettings: async () => settings,
  setSettings: async (s: AppSettings) => Object.assign(settings, s),
  listProjects: async (): Promise<ProjectSummary[]> => projects.slice(),
  createProject: async (name: string, description: string): Promise<ProjectSummary> => {
    const p: ProjectSummary = { id: 'demo-' + name.slice(0, 4), name, description, createdAt: now, updatedAt: now, stats: { chapters: 0, characters: 0, worldviewFiles: 0, materials: 0 } }
    projects.unshift(p)
    return p
  },
  importProject: async () => ({ ok: true }),
  removeProject: async (id: string) => {
    const i = projects.findIndex((p) => p.id === id)
    if (i >= 0) projects.splice(i, 1)
  },
  revealProject: async () => {},
  openProject: async (id: string) => projects.find((p) => p.id === id) ?? null,
  readDoc: async (_id: string, rel: string) => docs.get(_id + '/' + rel) ?? null,
  writeDoc: async (_id: string, rel: string, content: string) => {
    docs.set(_id + '/' + rel, content)
  },
  listDocs: async (id: string, relDir: string) => docsOf(id + '/' + relDir),
  listChapters: async (id: string): Promise<ChapterEntry[]> => {
    const out: ChapterEntry[] = []
    for (const { file } of docsOf(id + '/正文')) {
      const text = docs.get(id + '/正文/' + file) ?? ''
      const m = text.match(/章号:\s*(\d+)/)
      const t = text.match(/题名:\s*(.+)/)
      const s = text.match(/切片:\s*(.+)/)
      out.push({
        file: '正文/' + file,
        name: file.replace(/\.md$/, ''),
        fm: { 章号: m ? Number(m[1]) : undefined, 题名: t?.[1]?.trim(), 切片: s?.[1]?.trim() },
        wordCount: text.replace(/^---\n[\s\S]*?\n---\n/, '').replace(/\s/g, '').length,
        mtime: now,
        hasPendingProposal: false
      })
    }
    return out.sort((a, b) => (a.fm?.['章号'] ?? 1e9) - (b.fm?.['章号'] ?? 1e9))
  },
  onFsEvent: () => () => {},
  getPaths: async () => ({ documents: '', libraryRoot: '' }),

  // 提案（S4）
  proposals: [] as Proposal[],
  listProposals: async () => mock.proposals.slice(),
  createProposals: async (_id: string, source: 'slice-sync' | 'agent-chat', chapter: string, sliceName: string, items: ProposalItem[]) => {
    console.log('[sync] items', JSON.stringify(items))
    const nowT = Date.now()
    const created = items.map((it, idx) => {
      const p: Proposal = {
        id: 'p' + nowT.toString(36) + idx,
        source,
        chapter,
        slice: sliceName,
        status: 'pending',
        createdAt: nowT,
        items: [it]
      }
      mock.proposals.push(p)
      return p
    })
    return created
  },
  applyProposal: async (_id: string, pid: string) => {
    const p = mock.proposals.find((x) => x.id === pid)
    if (!p || p.status !== 'pending') return { ok: false, applied: [], errors: ['未找到待处理的提案'] }
    const errs: string[] = []
    for (const it of p.items) {
      const key = _id + '/' + it.target
      const cur = docs.get(key) ?? ''
      try {
        if (!it || typeof it.after !== 'string') throw new Error('提案格式不完整: ' + JSON.stringify(it).slice(0, 120))
        docs.set(key, applyAnchor(cur, it))
      } catch (e) {
        errs.push(it?.target + ': ' + String((e as Error).message || e))
      }
    }
    p.status = 'accepted'
    return { ok: errs.length === 0, applied: p.items.filter((_, i) => !errs[i]).map((i) => i.target), errors: errs }
  },
  rejectProposal: async (_id: string, pid: string) => {
    const p = mock.proposals.find((x) => x.id === pid)
    if (p) p.status = 'rejected'
    return true
  }
}

/** devShim 用的锚点写入（与 main 侧同规则：标题下节体替换；无标题则追加） */
function applyAnchor(text: string, it: ProposalItem): string {
  const lines = text.split('\n')
  const hit = lines.findIndex((l) => /^#{1,4}\s/.test(l) && l.replace(/^#+\s*/, '').replace(/^#/, '').trim() === it.anchor)
  if (it.kind === 'append') return text + '\n\n' + it.after
  if (hit >= 0) {
    const level = (lines[hit].match(/^#+/) || [''])[0].length
    let end = lines.length
    for (let i = hit + 1; i < lines.length; i++) {
      const m = lines[i].match(/^#+/)
      if (m && m[0].length <= level) {
        end = i
        break
      }
    }
    const head = lines[hit]
    return [...lines.slice(0, hit), head, '', ...it.after.split('\n'), '', ...lines.slice(end)].join('\n')
  }
  return text.trimEnd() + '\n\n### ' + it.anchor + '\n\n' + it.after + '\n'
}

export function ensureDevShim() {
  if (window.zhijuan) return
  ;(window as unknown as { __ZJ_TEST: boolean }).__ZJ_TEST = true
  window.zhijuan = mock as unknown as typeof window.zhijuan
}
