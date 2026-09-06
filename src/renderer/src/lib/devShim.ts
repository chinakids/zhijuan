// ===== 浏览器开发垫片：无 Electron 时（纯浏览器调试/无头截图）用内存 mock 顶替 window.zhijuan =====
import type { AgentEvent, AppSettings, ChapterEntry, Proposal, ProposalItem, ProjectSummary, SliceEntry } from '../../../shared/types'
import type { EditItem } from '../../../shared/types'
import { countWords } from '../../../shared/count'

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
docs.set(
  'demo-aseya/大纲/第01章_雾港.md',
  [
    '---',
    '章号: 1',
    '题名: 雾港',
    '切片: 第一幕_雾港之夜',
    '状态: 已回建',
    '---',
    '',
    '# 章卡 第1章 雾港',
    '',
    '> 对应正文：正文/第01章_雾港.md',
    '',
    '## 一句话定位',
    '',
    '用一盏旧灯和一张泛黄船票，把失忆的主角和「忘了的事」焊进主线。',
    '',
    '## 关键事件',
    '',
    '- 阿七提着旧灯出现在暴雨中的候船厅',
    '- 沈藏点破：这盏灯是阿七自己熄灭的',
    '- 一张十年前写着阿七名字的船票出现',
    '',
    '## 人物进展',
    '',
    '阿七从“什么也不记得”进入“裂缝松动”的状态。',
    '',
    '## 钩子 / 要还的债',
    '',
    '- 船票是谁留的',
    '- 灯为什么要被熄灭',
    ''
  ].join('\n')
)
docs.set(
  'demo-aseya/大纲/索引.md',
  ['---', '状态: 已回建', '---', '', '# 大纲区 · 章卡索引', '', '共 1 章已回建章卡。', '', '## 第1章 · 雾港', '', '> 定位：用一盏旧灯和一张泛黄船票，把失忆的主角和「忘了的事」焊进主线。', '', '- 关键事件：阿七提旧灯出现；沈藏点破灯是阿七自己熄的；十年前船票出现', ''].join('\n')
)

const settings: AppSettings = {
  workspace: '',
  libraryRoot: '',
  llm: { active: 'local', providers: {} },
  theme: 'paper',
  collectionEnabled: true,
  agentTools: { todo: true, askUser: true }
}

// 工作区落档文档（dev 示范；真机由主进程写盘）
const WRK_DOCS: Record<string, string> = {
  '使用说明.md': '# 织卷 · 使用说明（dev 示例）\n\n写长篇的创作工作台：正文是源，设定跟着走。',
  '约定与结构.md': '# 织卷 · 目录与约定（dev 示例）\n\n正文为源，设定为流；提案制改造设定。'
}
const wsDocs = new Map<string, string>()

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
  // 平台（devShim 默认当作 mac，好让自定义标题栏在无头截图也能看到）
  platform: 'darwin',
  getSettings: async () => settings,
  setSettings: async (s: AppSettings) => Object.assign(settings, s),

  // 工作区（dev 模式：内存文档；真机走磁盘）
  workspaceStatus: async () => {
    const dir = settings.workspace || '~/Documents/织卷工作区'
    return { dir, inited: wsDocs.size > 0, docs: [...wsDocs.keys()].map((file) => ({ file, name: file.replace(/\.md$/, '') })) }
  },
  workspaceInit: async () => {
    const created: string[] = []
    for (const [file, txt] of Object.entries(WRK_DOCS)) {
      if (!wsDocs.has(file)) { wsDocs.set(file, txt); created.push(file) }
    }
    return { ok: true, created, docs: Object.keys(WRK_DOCS) }
  },
  workspaceRead: async (file: string) => wsDocs.get(file) ?? null,
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
        wordCount: countWords(text),
        mtime: now,
        hasPendingProposal: false
      })
    }
    return out.sort((a, b) => (a.fm?.['章号'] ?? 1e9) - (b.fm?.['章号'] ?? 1e9))
  },
  listSlices: async (id: string): Promise<SliceEntry[]> => {
    const out: SliceEntry[] = []
    for (const { file } of docsOf(id + '/正文')) {
      const text = docs.get(id + '/正文/' + file) ?? ''
      const m = text.match(/^---\n([\s\S]*?)\n---/)
      if (!m) continue
      const fm = m[1]
      const name = (fm.match(/^切片:\s*(.+)$/m) ?? [])[1]?.trim() ?? ''
      if (!name) continue
      const chars = ((fm.match(/^涉及人物:\s*\[(.*)\]$/m) ?? [])[1] ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      out.push({ name, chapter: file.replace(/\.md$/, ''), chars, updatedAt: 0 })
    }
    return out
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
  },

  // 采纳 agent 的正文修改（dev：改内存文档）
  applyDocEdit: async (_id: string, rel: string, edits: EditItem[]) => {
    const key = _id + '/' + rel
    const cur = docs.get(key)
    if (cur === undefined) return { ok: false, errors: ['文档已不存在'] }
    let next = cur
    const errors: string[] = []
    for (const ed of edits) {
      const i = next.indexOf(ed.find)
      if (i < 0) { errors.push(`未找到原文「${ed.find.slice(0, 24)}…」`); continue }
      if (next.indexOf(ed.find, i + 1) >= 0) { errors.push(`「${ed.find.slice(0, 24)}…」在文档中不只一处，未应用`); continue }
      next = next.slice(0, i) + ed.replace + next.slice(i + ed.find.length)
    }
    if (errors.length) return { ok: false, errors }
    docs.set(key, next)
    return { ok: true }
  },

  // agent（无 Electron：本地模拟流式，驱动 hook 链路可跑）
  agentListeners: new Set<(e: AgentEvent) => void>(),
  onAgentEvent: (cb: (e: AgentEvent) => void) => {
    mock.agentListeners.add(cb)
    return () => {
      mock.agentListeners.delete(cb)
    }
  },
  agentSend: async (input: { requestId: string; prompt: string }) => {
    const rid = input.requestId
    const emit = (e: AgentEvent) => mock.agentListeners.forEach((h) => h(e))
    await new Promise((r) => setTimeout(r, 60))
    // 思考过程演示
    emit({ requestId: rid, type: 'think', text: '先看一下当前章节里需要改的位置，再决定怎么改…' })
    await new Promise((r) => setTimeout(r, 40))
    // 工具调用：带参数（读了哪个文档）
    emit({ requestId: rid, type: 'meta', tool: 'zj_read_doc', args: '正文/第01章_雾港.md' })
    await new Promise((r) => setTimeout(r, 60))
    emit({ requestId: rid, type: 'meta-done', tool: 'zj_read_doc', message: '章节已读完' })
    // 正文修改演示：prompt 提到「改」时给出 IDE 式修改方案
    if (/改|修|润|错别/.test(input.prompt)) {
      await new Promise((r) => setTimeout(r, 60))
      emit({
        requestId: rid,
        type: 'edit',
        file: '正文/第01章_雾港.md',
        edits: [
          {
            id: 'e1',
            find: '阿七靠着候船厅的柱子，指节发白地攥着那盏旧灯。',
            replace: '阿七靠着候船厅的柱子，指节发白地攥着那盏旧灯，灯罩里的火苗被雨打灭过一回。',
            reason: '给旧灯一个具象细节，呼应后文“灯语约定”',
            before: 'L8 │ 阿七靠着候船厅的柱子，指节发白地攥着那盏旧灯。',
            after: 'L8 │ 阿七靠着候船厅的柱子，指节发白地攥着那盏旧灯，灯罩里的火苗被雨打灭过一回。'
          }
        ]
      })
      await new Promise((r) => setTimeout(r, 60))
      emit({ requestId: rid, type: 'meta-done', tool: 'zj_edit_doc', message: '已生成正文修改方案（1 处），采纳后写入' })
    }
    // 只有明确提到计划/提问词时才演示卡片（避免平时也冒一堆卡）
    const needDemo = /计划|todo|任务|问|确认/.test(input.prompt)
    if (needDemo) {
      await new Promise((r) => setTimeout(r, 60))
      emit({ requestId: rid, type: 'meta', tool: 'todo_write' })
      await new Promise((r) => setTimeout(r, 60))
      emit({
        requestId: rid,
        type: 'todo',
        items: [
          { content: '读取当前章节与人物设定', status: 'in_progress' },
          { content: '给出续写建议', status: 'pending' },
          { content: '等待确认后应用到正文', status: 'pending' }
        ]
      })
      await new Promise((r) => setTimeout(r, 60))
      emit({ requestId: rid, type: 'meta', tool: 'ask_user_question' })
      await new Promise((r) => setTimeout(r, 60))
      emit({
        requestId: rid,
        type: 'ask',
        batch: 'dev-demo-1',
        questions: [
          {
            id: 'q_style',
            header: '风格选择',
            question: '这段续写打算用什么语气？',
            options: [
              { label: '保持现状', description: '延续全章的沉郁氛围' },
              { label: '轻快一些', description: '给角色一个透气的瞬间' }
            ],
            multiSelect: false
          }
        ]
      })
      await new Promise((r) => setTimeout(r, 60))
    }
    const demo =
      '（dev 模式模拟回复）\n\n刚把当前章节和人物相关设定读了一遍。结合现在的进度，建议先从灯入手：让主角在雨夜里再靠近一次那盏旧灯，把「灯语约定」的伏笔再点一下，然后留一个悬念给下一幕。\n\n要不要我直接按这个思路把这一段写出来？'
    for (let i = 0; i < demo.length; i += 8) {
      emit({ requestId: rid, type: 'delta', text: demo.slice(i, i + 8) })
      await new Promise((r) => setTimeout(r, 10))
    }
    emit({ requestId: rid, type: 'final', text: demo })
    emit({ requestId: rid, type: 'done' })
  },
  agentCancel: async () => true,
  agentAnswer: async (_batch: string, answers: unknown[]) => {
    console.log('[devShim] agent answer', JSON.stringify(answers))
    return { ok: true }
  },
  agentAudit: async (_projectId: string, kind: string) =>
    kind === 'consistency'
      ? {
          ok: true,
          result: {
            summary: '（演示）发现有 2 处设定需要再看一眼。',
            items: [
              { severity: 'high', type: 'setting-conflict', where: '第2章 · 灯塔夜访（正文/第02章_灯塔夜访.md）', what: '“顾岸的旧车”前文是烟青色，这里写成了黑色', suggest: '统一为烟青色并顺手修正后文描写', target: '人物/顾岸.md' },
              { severity: 'low', type: 'foreshadow', where: '第1章 · 雾港之夜', what: '墙角提到一封信，之后没有回收', suggest: '后续任一章节提一笔，或在文中删掉', target: '' },
              { severity: 'medium', type: 'character-drift', where: '第3章', what: '沈确的称呼在“你”与“您”之间跳了两次', suggest: '保持对这个人物的固定称呼（建议互称）', target: '人物/沈确.md' }
            ]
          }
        }
      : kind === 'perspectives'
        ? {
            ok: true,
            result: {
              summary: '（演示）设定党最在意的一处：第 4 章里灯塔重新点灯，但世界观档写它二十年前就废弃了。',
              items: [
                { severity: 'high', type: 'setting', viewer: '设定党', where: '第4章 · 灯塔重明（正文/第04章_灯塔重明.md）', what: '灯塔被写“重新点灯”，但世界观切片从未提过它可以再用', suggest: '补一段设定或在正文里加入“重新启用”的交代', target: '世界观/切片_灯塔.md' },
                { severity: 'medium', type: 'character', viewer: '角色粉', where: '第2章 · 灯塔夜访', what: '顾岸明明怕水，这里却主动要在夜潮里走', suggest: '给一个由头（比如有人落水）或让他在岸上等', target: '人物/顾岸.md' },
                { severity: 'low', type: 'pacing', viewer: '节奏读者', where: '第3章', what: '开头用一整段慢慢描天气，主线三章没推进', suggest: '把天气细节并进动作里，主线事件提前半页' }
              ]
            }
          }
        : {
            ok: true,
            result: {
              summary: '（演示）开篇节奏可以再快一点。',
              items: [
                { severity: 'high', type: 'pacing', where: '第1章 · 雾港之夜', what: '进入第一个事件太慢，背景铺垫多', suggest: '让第一个事件提前一页，细节后置到冲突里补', target: '' },
                { severity: 'medium', type: 'structure', where: '全书', what: '第3章和第4章是同一天的两条线，读者易混', suggest: '在章节头标注同一天下的不同地点', target: '世界观/切片_灯塔.md' }
              ]
            }
          },
  agentSync: async () => ({ ok: true, items: [] } as { ok: boolean; items: ProposalItem[] }),
  agentStatus: async () => ({ online: true, provider: '本机 vLLM', model: 'deepseek-v4-flash-0731' }),
  agentListCapabilities: async () => [
    { id: 'audit', title: '全卷检查', description: '（演示）一致性巡查 / 冷读报告：跨全卷对照设定找问题' },
    { id: 'perspectives', title: '多视角审视', description: '（演示）以角色粉 / 设定党 / 节奏读者三种立场各通读一遍，交叉找问题' },
    { id: 'chapter-check', title: '本章检查', description: '（演示）每章短巡查 / 分层修订：沿写作线的小环兜底' },
    { id: 'outline', title: '大纲回建', description: '（演示）把既有正文回建成章卡' },
    { id: 'triage', title: '素材升格', description: '（演示）素材按语境归类并判可否入档' }
  ],
  agentSetCapability: async () => true,

  // 本章级小环（每章短巡查 / 分层修订）— dev 模式给固定演示数据
  agentChapterCheck: async (_projectId: string, _chapterRel: string, kind: string) =>
    kind === 'chapter'
      ? {
          ok: true,
          result: {
            summary: '（演示）本章有两处值得现在就处理。',
            items: [
              { severity: 'medium', type: 'character-drift', where: '阿七对沈藏的称呼突然从“您”变“你”', what: '两人是第一次见面，称谓跳变显突兀', suggest: '统一为“您”，直到关系拉近那幕再改口', target: '人物/沈藏.md' },
              { severity: 'low', type: 'timeline', where: '船票日期 “十年前”', what: '与世界观里记忆雾吞人记忆的时间设定没有对齐', suggest: '对一下世界观里的时间线，必要时改票面日期', target: '世界观/总纲.md' }
            ]
          }
        }
      : {
          ok: true,
          result: {
            summary: '（演示）本章最值得先改的是：把开头的说明性白线压掉。',
            items: [
              { severity: 'high', layer: 'story', type: 'structure', where: '本章定位', what: '这章同时做了「相遇」和「信息揭示」，两个目标挤在一场戏里', suggest: '把“灯是阿七自己熄的”这个揭示挪到下一章，本章只留相遇', target: '' },
              { severity: 'medium', layer: 'scene', type: 'pacing', where: '候船厅相遇', what: '沈藏点烟后立刻给答案，场景张力被提前放掉', suggest: '让沈藏先说半句就停，把答案放到阿七追问之后', target: '' },
              { severity: 'low', layer: 'prose', type: 'prose', where: '“雨把港口淋成一片灰”', what: '开场白线带说明腔', suggest: '改成从阿七的手指、灯笼光写起，让雨退到背景', target: '' }
            ]
          }
        },
  // 大纲回建（dev 模式：写 mock 的 大纲/ 文件并返回卡片）
  agentOutlineRebuild: async (projectId: string) => {
    const cards = [
      {
        file: '正文/第01章_雾港.md',
        no: 1,
        title: '雾港',
        slice: '第一幕_雾港之夜',
        oneLine: '用一盏旧灯和一张泛黄船票，把失忆的主角和「忘了的事」焊进主线。',
        beats: ['阿七提旧灯出现在暴雨中的候船厅', '沈藏点破：这盏灯是阿七自己熄灭的', '一张十年前写着阿七名字的船票出现'],
        charProgress: '阿七从“什么也不记得”进入“裂缝松动”的状态。',
        hooks: ['船票是谁留的', '灯为什么要被熄灭'],
        wordCount: 86
      },
      {
        file: '正文/第02章_灯塔.md',
        no: 2,
        title: '灯塔',
        slice: '第二幕_灯塔',
        oneLine: '（演示）阿七顺着船票线索走向灯塔，第一次正面接触记忆雾。',
        beats: ['阿七带着船票走向海边灯塔', '在灯塔脚下遇到守塔人', '掌心贝壳耳坠有了微微的知觉'],
        charProgress: '从被动追查转为主动出发。',
        hooks: ['守塔人似乎认识阿七'],
        wordCount: 5
      }
    ]
    const writes: string[] = []
    for (const c of cards) {
      const rel = '大纲/' + c.file.replace(/^正文\//, '')
      docs.set(projectId + '/' + rel, '# 章卡 ' + (c.no ? `第${c.no}章 ` : '') + c.title + '\n\n> 定位：' + c.oneLine + '\n\n- 关键事件：' + c.beats.join('；') + '\n- 人物进展：' + c.charProgress + '\n- 钩子：' + c.hooks.join('；') + '\n')
      writes.push(rel)
    }
    docs.set(projectId + '/大纲/索引.md', '# 大纲区 · 章卡索引\n\n共 ' + cards.length + ' 章已回建章卡。\n')
    return { ok: true, cards, written: writes }
  },
  // 素材→设定升格（dev 模式：固定演示判定）
  agentTriage: async () => ({
    ok: true,
    result: {
      summary: '（演示）素材库里有一条值得直接升格进设定档案。',
      items: [
        { file: '素材库/桥段/追忆型开头.md', name: '追忆型开头', verdict: 'promote', category: '桥段', what: '以旧物切入牵出“忘了的事”，用于开篇营造悬念', suggestion: '把“以旧物定主线”的句式写成创作规范补进世界观总纲', target: '世界观/总纲.md' },
        { file: '素材库/环境/雾海.md', name: '雾海', verdict: 'reference', category: '环境', what: '雾海细节（能见度、气味）的描写素材', suggestion: '保持素材，写作时作为描写参考引入', target: '' }
      ]
    }
  })
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
