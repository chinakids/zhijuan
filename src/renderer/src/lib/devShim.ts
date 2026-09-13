// ===== 浏览器开发垫片：无 Electron 时（纯浏览器调试/无头截图）用内存 mock 顶替 window.zhijuan =====
import type { AgentEvent, AppSettings, ChapterEntry, OutlineCard, Proposal, ProposalItem, ProjectSummary, ProjectTemplate, SliceEntry, LibraryCategory, SearchHit, RecentLibraryDoc, FsEvent, ImportResult, MenuActionEvent, MenuActionId, MenuStateReport } from '../../../shared/types'
import type { EditItem } from '../../../shared/types'
import { isOutlineCardRel, outlineCardDoc, outlineIndexDoc, parseOutlineCard, syncChapterNameInDoc, syncChapterSliceInDoc } from '../../../shared/outline'
import { listChapterEntries } from '../../../shared/chapters'
import { listSliceEntries } from '../../../shared/slices'
import { resolveLibraryRoot } from '../../../shared/settingsLogic'
import { AGENT_PANEL_DEFAULT_WIDTH } from '../../../shared/uiPrefs'
import { sanitizeFile } from '../../../shared/paths'
import { nextProjectId } from '../../../shared/projects'
import { extractFrontMatter, setFrontMatterField } from '../../../shared/fmatter'
import { adoptActsChapter } from '../../../shared/actsAdopt'
import { countWords } from '../../../shared/count'
import { unlistedInBody, listedFrom, parseAliases, unusedAliasCheck, presenceCheck, chapterMissingFromRaw } from '../../../shared/presence'
import { actGapsCheck } from '../../../shared/actGaps'
import { findAnchorLine, normalizeAnchor } from '../../../shared/anchor'
import { auditDocMarkdown } from '../../../shared/auditDoc'
import { parseAnnotationCsv, segmentFromText, escapeCsvField } from '../../../shared/annotations'
import type { RecentEntry } from '../../../shared/projects'
import { toast } from '../store/toasts'

const now = Date.now()

// 无头冒烟：?zj-agent-delay=<ms> 拉长 agent 演示事件间隔（默认 60ms；冒烟用大值验证工具卡「进行中已 Ns」与完成耗时）
const DEMO_DELAY = (() => {
  const v = Number(new URLSearchParams(location.search).get('zj-agent-delay') ?? '')
  return Number.isFinite(v) && v > 0 ? v : 60
})()
const demoDelay = (ms?: number) => new Promise<void>((r) => setTimeout(r, ms ?? DEMO_DELAY))

// ---- 文件系统事件模拟（2026-09-10）：与主进程 watchProject→fs:event 链路同语义 ----
// 真机：store.writeDoc 写盘 → chokidar watcher 广播 {projectId, kind:'change', path:相对项目根}，
//       .zhijuan 等点路径被 DOT_DIR 过滤不广播。devShim 无真实磁盘与 watcher，改为写入口显式模拟：
//       任何项目内非点路径的「写盘」都广播给 onFsEvent 订阅者，让无头侧 extVersion 静默重载链路可被冒烟。
const fsListeners = new Set<(e: FsEvent) => void>()
function fsEmit(projectId: string, rel: string) {
  if (!rel || rel.startsWith('.')) return // 与真机 DOT_DIR 过滤一致（.zhijuan 内部变化不打扰界面）
  const evt: FsEvent = { projectId, kind: 'change', path: rel }
  for (const h of fsListeners) h(evt)
}

// 系统菜单动作订阅（与真机 preload onMenuAction 同语义：MenuBridge 挂上后由 __ZJ_MENU_EMIT 驱动）
const menuListeners = new Set<(evt: MenuActionEvent) => void>()
// 最近一次菜单启用态上报（无头断言用；真机由主进程消费）
let lastMenuState: MenuStateReport | null = null

const docs = new Map<string, string>()
// 导演任务取消标记（与真机 director.ts 的 directorCancels 同口径：token → cancelled）
const directorCancels = new Set<string>()
// 生成中停止标记（与真机 engine.ts 的 active Map + abortRequest 同口径：caller 停止后事件不再转发）
const cancelledAgentRids = new Set<string>()
// 被重发（writeDoc 触碰）过的演示停滞卡 key：docsOf 对它的「3天前」mtime 特判失效，恢复真机行为（mtime=写盘时刻）
const taskTouched = new Set<string>()
// 空类别（dev 内存无目录概念：新类别只登记名字，树/列表经 libraryTree 组装时按计数 0 展示）
const extraCats = new Set<string>()
// 老默认位（文档/织卷项目库）模拟：true＝存在且非空（本机实况，真机 libraryRoot 默认走它；2026-09-12）
const DEV_LEGACY_EXISTS = true
// 版本历史 mock：与主进程行为对齐（仅版本化 rel：正文/ 与 大纲/审读_*（与真机 isVersionedRel 同口径），内容变化才快照旧内容，新→旧，上限 50）
const histories = new Map<string, { name: string; content: string; mtimeMs: number }[]>()
const HISTORY_LIMIT_DEV = 50
function snapNameDev(ts: number): string {
  const d = new Date(ts)
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${p(d.getMilliseconds(), 3)}`
}
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
// dev 演示：批注定时优化（主人 2026-09-12）——第01章带两条批注（L10 雨句 / L12 沈藏台词），
// 行号按第01章内容真实定位；格式与主人批注任务脚本.py 一致：L<行>:<列>-L<行>:<列>,批注意图
docs.set(
  'demo-aseya/正文/第01章_雾港_批注.csv',
  ['L10:1-L10:34,这句太文艺了，改成冷静克制：直接写阿七攥着灯的手在抖。', 'L12:1-L12:60,沈藏语气再轻一点，去掉审问感：只把「你当真不记得了？」改成「你真的不记得了？」', ''].join('\n')
)
docs.set(
  'demo-aseya/正文/第02章_灯塔.md',
  ['---', '章号: 2', '题名: 灯塔', '切片: 第二幕_灯塔', '涉及人物: [阿七]', '---', '', '# 灯塔', '', '（本章待写）', ''].join('\n')
)
// dev 演示：第3章正文用了「沈爷」（沈藏档案登记的别名）但约定头只列了阿七 → 保存时触发「名单外出场」提示
docs.set(
  'demo-aseya/正文/第03章_码头.md',
  ['---', '章号: 3', '题名: 码头', '切片: 第三幕_码头', '涉及人物: [阿七]', '---', '', '# 码头', '', '阿七在码头等船。沈爷远远站着，帽檐压得很低，像是怕被认出来。', ''].join('\n')
)
// dev 演示：第4章约定头列了阿七/沈藏但正文（≥字数阈值）均未出现 → 保存时触发「列入未出场」提示
docs.set(
  'demo-aseya/正文/第04章_雾夜.md',
  [
    '---', '章号: 4', '题名: 雾夜', '切片: 第四幕_雾夜', '涉及人物: [阿七, 沈藏]', '---', '', '# 雾夜', '',
    '码头的雾比昨夜更浓。海风卷着咸腥味穿过候船厅，铁皮屋顶被雨点敲得闷响。值班室的灯亮着，昏黄的光从门缝漏出来，在地面上拉出一道细长的影子。远处渔船的马达声断断续续，像有人在咳嗽。',
    '',
    '潮水涨上了石阶，浪头一次次拍打栈桥的木桩，溅起的水花打湿了缆绳。有人把没抽完的烟头按灭在栏杆上，留下一小点焦痕。空气里混着柴油、鱼腥和潮湿木头的气味，整个码头像是睡着了，又像是屏住呼吸在等什么。',
    '',
    '候船厅的长椅上坐着个打盹的旅客，怀里抱着一只帆布包。广播响过两遍，没有船进港，也没有人起身。灯管发出细微的电流声，混着雨声，让夜显得更安静。值班员打了个哈欠，翻了一页报纸，又把目光投向玻璃窗外的雾。',
    '',
    '（本章只写码头空镜与旧事回响，主要人物尚未进场。）', ''
  ].join('\n')
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
  // 别名「沈老爹」全卷正文从未出现 → 供「档案」Tab（人物档案腐坏核查）演示命中；「沈爷」在第3章出现过（供 unlisted 演示）
  ['---', '姓名: 沈藏', '身份: 老渔民', '别名: [沈爷, 沈老爹]', '---', '', '## 基础档案', '', '- 外貌：络腮胡，常年穿墨绿雨衣', '- 性格：话少，爱打哑谜', ''].join('\n')
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
  ['# 素材库索引', '', '- 桥段 / 环境：雾海、旧灯塔、泛黄船票', '- 人物原型：冰山沉默系守灯人', ''].join('\n')
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
// dev 演示：补一张比正文更旧的导演板（docsOf 会把 _导演 文件的 mtime 模拟成一天前），
// 让「导演板偏旧 → 建议重导」的轻提示在演示页自然出现。
docs.set(
  'demo-aseya/大纲/第01章_雾港_导演.md',
  ['---', '章号: 1', '题名: 雾港', '切片: 第一幕_雾港之夜', '状态: 已生成', '---', '', '# 导演板 · 第1章 雾港', '', '> 对应正文：正文/第01章_雾港.md', '', '> （dev 示例）这张板子在正文初稿之前生成，正文后来又有改动，所以它比正文更旧。', '', '## 情绪弧分段', '', '1. **推进**：阿七借旧灯，确认失忆的裂缝开始松动', '', '## 人物行为轴', '', '- **阿七（试探）**：从什么也不记得，转为揪着船票不放', '', '## 写作红线（不许破）', '', '- 不要把沈藏写成全知的解谜工具', '', '## 钩子（要还的债 / 可新埋）', '', '- 灯是谁熄的（可新埋）', ''].join('\n')
)

// dev 演示：采集池里放一张「已完成」任务卡（front matter 与管道回填格式一致），
// 让「任务卡点击看结果」在演示页可点、可验。
docs.set(
  'demo-aseya/素材库/采集池/任务_演示图书馆.md',
  [
    '---',
    'status: done',
    '需求: 校园图书馆的感官细节，要写实的、贴近国内校园的描写素材',
    '关键词: [旧图书馆, 借书卡, 阅览室]',
    '类别: 环境',
    '来源:',
    '创建: 2026-09-03 00:45',
    '结果: 素材库/环境/采集_演示图书馆.md',
    '完成: 2026-09-03 12:25',
    '---',
    '',
    '# 采集任务：校园图书馆场景细节',
    '',
    '用于小说「放学后的图书馆」一段的质感支撑。优先找写实、贴国内校园的：借书卡怎么用、木质书架、靠窗旧阅览室、午后光线、灰尘里的味道。',
    ''
  ].join('\n')
)
// dev 演示：一张「停滞」任务卡（pending 但 mtime 已 3 天未动 → 列表/详情出停滞提示；需求文本用于演示提交查重）
docs.set(
  'demo-aseya/素材库/采集池/任务_演示停滞.md',
  [
    '---',
    'status: pending',
    '需求: 雨夜的码头描写，要能闻到咸腥味和柴油味',
    '关键词: [雨夜, 码头, 气味]',
    '类别: 环境',
    '来源:',
    '创建: 2026-09-07 10:00',
    '---',
    '',
    '# 采集任务：雨夜码头',
    '',
    '（dev 演示）这张卡管道一直没处理——用于看「停滞」提示；同名需求提交会触发查重警告。',
    ''
  ].join('\n')
)
// dev 演示：任务卡「结果」指向的素材卡（与管道回填的“整理后草稿”格式一致），
// 让详情里「点击结果预览素材」在演示页可点、可验。
docs.set(
  'demo-aseya/素材库/环境/采集_演示图书馆.md',
  [
    '---',
    '标签: [图书馆, 校园, 环境]',
    '来源: 知乎问答 #旧图书馆, 豆瓣 #大学图书馆',
    '---',
    '',
    '# 校园老图书馆（采集草稿）',
    '',
    '> 采集自公开网络，**草稿**，逐条过目后再决定是否升格。',
    '',
    '## 可复用的感官细节',
    '',
    '- **借书卡**：手写墨迹会洇开，卡片边缘被翻得发毛，铅笔写的还书日期常被橡皮蹭糊。',
    '- **木质书架**：老樟木味混着纸页的霉味；靠窗那排书架被晒得褪色，阳光斜进来时能看到灰尘在光柱里打转。',
    '- **旧阅览室**：靠窗的位子总是有人占，桌面有刻字，台灯是绿罩子的。',
    '',
    '## 来源与版权注意',
    '',
    '- 知乎：校园图书馆有哪些细节（问答，作写实参考，不直接引用原文）',
    '- 豆瓣：大学老图书馆回忆帖（同上）',
    ''
  ].join('\n')
)
// dev 演示：第二个类别的正式素材（非采集草稿），让类别树/搜索演示可区分多类别
docs.set(
  'demo-aseya/素材库/人物/旧茶楼账房.md',
  [
    '---',
    '来源: 自研',
    '---',
    '',
    '# 旧茶楼账房',
    '',
    '临街的账房先生姓周，算盘打得极快，记账用蝇头小楷。柜上常年搁一盏铜油灯，灯芯剪得短短的——他说省油，也省得看清来人。',
    '',
    '## 可复用的点',
    '',
    '- 算盘声、油灯、蝇头小楷，可做旧时代茶楼场景的细节锚',
    ''
  ].join('\n')
)

const settings: AppSettings = {
  workspace: '',
  libraryRoot: '',
  llm: { active: 'local', providers: {} },
  theme: 'paper',
  collectionEnabled: true,
  annotationsEnabled: false,
  agentPanelWidth: AGENT_PANEL_DEFAULT_WIDTH,
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
    stats: { chapters: 3, characters: 2, worldviewFiles: 2, materials: 1 },
    lastChapter: '第03章_码头'
  },
  {
    id: 'demo-yunshan',
    name: '云山驿事',
    description: '示例：驿道上的妖与账房先生',
    createdAt: now - 86400_000 * 40,
    updatedAt: now - 86400_000 * 2,
    stats: { chapters: 5, characters: 4, worldviewFiles: 3, materials: 2 },
    lastChapter: '第05章_山雨'
  },
  {
    id: 'demo-blank',
    name: '空白示例',
    description: '示例：尚未写正文的项目（空态演示）',
    createdAt: now - 86400_000,
    updatedAt: now - 3600_000,
    stats: { chapters: 0, characters: 0, worldviewFiles: 0, materials: 0 }
  }
]

// 最近打开（与真机 userData/zhijuan-recents.json 同语义，内存版）
const recents: RecentEntry[] = []

function docsOf(prefix: string): { file: string; name: string; mtime: number }[] {
  return [...docs.keys()]
    .filter((k) => k.startsWith(prefix + '/'))
    .map((k) => {
      const file = k.slice(prefix.length + 1)
      return { file, name: file.split('/').pop()!, mtime: devMtime(prefix, file) }
    })
}

/** mtime 模拟（真机=文件系统 mtime；dev 内存无盘，用稳定模拟以便演示/冒烟断言）：
 * 导演板一律模拟为一天前写的（比正文旧），方便看「导演板偏旧」轻提示；
 * 「任务_演示停滞」模拟为 3 天前（未处理），方便看采集任务「停滞」提示；
 * 该卡一旦被重发（writeDoc 触碰）就从特判名单移除 → mtime 恢复为现在（模拟真机写盘更新 mtime），
 * 否则无头冒烟里「重发后停滞徽标消失」永远验不过（静态模拟与真机行为不一致）。 */
function devMtime(prefix: string, file: string): number {
  const key = prefix + '/' + file
  return file.endsWith('_导演.md')
    ? now - 86400_000
    : file.includes('任务_演示停滞') && !taskTouched.has(key)
      ? now - 3 * 86400_000
      : now
}

/** 与真机 store 的索引重建同口径：以现存章卡文件为权威重建 大纲/索引.md（章卡生成/解析共用 shared/outline 纯函数） */
function devRefreshOutlineIndex(id: string): void {
  const cards: OutlineCard[] = []
  for (const key of [...docs.keys()]) {
    if (!key.startsWith(id + '/大纲/')) continue
    const rel = key.slice(id.length + 1) // '大纲/<章>.md'
    if (!isOutlineCardRel(rel)) continue
    const c = parseOutlineCard(docs.get(key) ?? '', rel)
    if (c) cards.push(c)
  }
  cards.sort((a, b) => (a.no ?? 1e9) - (b.no ?? 1e9))
  docs.set(id + '/大纲/索引.md', outlineIndexDoc(cards))
  fsEmit(id, '大纲/索引.md')
}

const mock = {
  // 平台（devShim 默认当作 mac，好让自定义标题栏在无头截图也能看到）
  platform: 'darwin',
  getSettings: async () => settings,
  setSettings: async (s: AppSettings) => Object.assign(settings, s),

  // 工作区（dev 模式：内存文档；真机走磁盘）
  workspaceStatus: async () => {
    const dir = settings.workspace || '~/Documents/织卷工作区'
    // 与真机 listWorkspaceDocs 同口径：docs 按名称 zh 排序（2026-09-13 口径审计）
    return {
      dir,
      inited: wsDocs.size > 0,
      docs: [...wsDocs.keys()]
        .map((file) => ({ file, name: file.replace(/\\.md$/, '') }))
        .sort((a, b) => a.name.localeCompare(b.name, 'zh'))
    }
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
  createProject: async (name: string, description: string, _template?: string): Promise<ProjectSummary> => {
    // 与真机 store.createProject 同口径：shared nextProjectId（sanitizeFile + 已占用加时间戳后缀；2026-09-12 对齐）
    const id = nextProjectId(name, (i) => projects.some((p) => p.id === i))
    const p: ProjectSummary = { id, name, description, createdAt: now, updatedAt: now, stats: { chapters: 0, characters: 0, worldviewFiles: 0, materials: 0 } }
    projects.unshift(p)
    return p
  },
  listTemplates: async (): Promise<ProjectTemplate[]> => [
    { id: '示例', name: '示例', builtin: true },
    // 非内建模板演示项：真机＝扫描 工作区/模板/项目模板/ 用户目录（templates.ts listTemplates：builtin 排前 + zh 排序）。
    // 目的＝让首页新建项目「初始内容」下拉可驱动「非内建模板显示名」分支（Home.tsx SelectItem 对非 builtin 直接显示 t.name）。
    // 模板应用语义（把模板文件复制进新项目）由真机 applyTemplate 负责；dev 无 fs，不模拟复制（合理简化差异，见平台层档案）。
    { id: '悬疑短篇', name: '悬疑短篇', builtin: false }
  ],
  importProject: async (dir: string): Promise<ImportResult> => {
    // 与真机 store.importProject 同口径：空白路径报错（真机先 trim 校验），id=resolve 后 basename（不做 sanitize）；
    // 模拟「目录内无 project.md」最简情形 name=id、description=''（真机此时也是这两值）；dev 无 fs 不复制内容。
    const trimmed = (dir ?? '').trim()
    if (!trimmed) return { ok: false, error: '目录路径为空' }
    const name = trimmed.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || trimmed
    const p: ProjectSummary = {
      id: name,
      name,
      description: '',
      createdAt: now,
      updatedAt: now,
      stats: { chapters: 0, characters: 0, worldviewFiles: 0, materials: 0 }
    }
    projects.unshift(p)
    return { ok: true, summary: p, copied: true }
  },
  importPicker: async (): Promise<string | null> => null,
  // 与真机 project:export 同口径语义：成功返回 { ok, dest }；dev 无 fs 不真复制，dest 为示意路径（UI 冒烟只断言 ok/dest 出现）
  exportProject: async (id: string) => ({ ok: true, dest: '/tmp/导出/' + id }),
  removeProject: async (id: string) => {
    const i = projects.findIndex((p) => p.id === id)
    if (i >= 0) projects.splice(i, 1)
    // 与真机 store.removeProject 同口径：返回 { ok }（2026-09-13 口径审计）
    return { ok: true }
  },
  revealProject: async () => {},
  openProject: async (id: string) => {
    // 与真机 project:open（recordOpen + watchProject）同语义：记录最近打开；返回 true（preload 类型 boolean）
    const i = recents.findIndex((r) => r.id === id)
    if (i >= 0) recents.splice(i, 1)
    recents.unshift({ id, openedAt: Date.now() })
    if (recents.length > 12) recents.length = 12
    return true
  },
  getRecentEntries: async (): Promise<RecentEntry[]> => recents.slice().sort((a, b) => b.openedAt - a.openedAt),
  readDoc: async (_id: string, rel: string) => docs.get(_id + '/' + rel) ?? null,
  writeDoc: async (_id: string, rel: string, content: string) => {
    const k = _id + '/' + rel
    const prev = docs.get(k)
    // 与真机 isVersionedRel 同口径：正文/ 与 大纲/审读_*（2026-09-12 对齐）
    if ((rel.startsWith('正文/') || rel.startsWith('大纲/审读_')) && prev !== undefined && prev !== content) {
      const arr = histories.get(k) ?? []
      // 与真机 writeSnapshot 同口径：版本文件名 = yyyyMMdd-HHmmss-SSS.md（带扩展名；真实 listSnapshots 按 .md 过滤）
      arr.unshift({ name: snapNameDev(Date.now() + arr.length) + '.md', content: prev, mtimeMs: Date.now() })
      if (arr.length > HISTORY_LIMIT_DEV) arr.length = HISTORY_LIMIT_DEV
      histories.set(k, arr)
    }
    if (rel.includes('任务_演示停滞') && prev !== undefined && prev !== content) taskTouched.add(k)
    docs.set(k, content)
    fsEmit(_id, rel)
    // 与真机 doc:write handler 同口径：返回 true（2026-09-13 口径审计）
    return true
  },
  deleteDoc: async (_id: string, rel: string) => {
    // 与真机 store.deleteDoc 同口径防御：只收 .md、拒绝空/绝对/带 .. 段的路径
    const bad = !rel || !rel.endsWith('.md') || rel.startsWith('/') || rel.split('/').some((s) => s === '..')
    if (bad) return { ok: false, error: '路径不合法' }
    const k = _id + '/' + rel
    if (!docs.delete(k)) return { ok: false, error: '文档不存在' }
    fsEmit(_id, rel)
    return { ok: true }
  },
  // 章节管理（§6.2）：与真机 store.renameChapter 同语义（改约定头题名 + 文件名 slug + 大纲副产物/历史同步；无头无磁盘/废纸篓，key 迁移即模拟）
  renameChapter: async (_id: string, rel: string, newTitle: string) => {
    if (!rel?.startsWith('正文/') || !rel.endsWith('.md') || rel.split('/').some((s) => s === '..')) return { ok: false, error: '路径不合法' }
    const k = _id + '/' + rel
    const cur = docs.get(k)
    if (cur === undefined) return { ok: false, error: '章节不存在' }
    const t = (newTitle ?? '').trim()
    if (!t) return { ok: false, error: '题名不能为空' }
    const oldTitle = String(extractFrontMatter(cur).fm?.['题名'] ?? '')
    const clean = sanitizeFile(t) // 与真机 shared/paths.sanitizeFile 同口径（2026-09-12 对齐）
    const oldName = rel.split('/').pop()!
    const idx = oldName.indexOf('_')
    const prefix = idx >= 0 ? oldName.slice(0, idx + 1) : ''
    const newName = prefix + clean + '.md'
    const newRel = '正文/' + newName
    const next = setFrontMatterField(cur, '题名', t)
    if (newRel === rel) {
      docs.set(k, next)
      // 与真机同口径：题名变了但文件名同形 → 大纲副产物内容同步 + 索引重建
      if (oldTitle && oldTitle !== t) {
        for (const key of [...docs.keys()]) {
          if (!key.startsWith(_id + '/大纲/')) continue
          const f = key.slice((_id + '/大纲/').length)
          const nm = f.replace(/\.md$/, '')
          if (nm === oldName.replace(/\.md$/, '') || nm.startsWith(oldName.replace(/\.md$/, '') + '_')) {
            const rawDoc = docs.get(key)
            if (rawDoc !== undefined) {
              const nextDoc = syncChapterNameInDoc(rawDoc, oldTitle, t, rel)
              if (nextDoc !== rawDoc) { docs.set(key, nextDoc); fsEmit(_id, '大纲/' + f) }
            }
          }
        }
        devRefreshOutlineIndex(_id)
      }
      fsEmit(_id, rel)
      return { ok: true, newRel: rel }
    }
    const nk = _id + '/' + newRel
    if (docs.has(nk)) return { ok: false, error: '目标文件名已存在' }
    const baseOld = oldName.replace(/\.md$/, '')
    const baseNew = newName.replace(/\.md$/, '')
    for (const key of [...docs.keys()]) {
      if (!key.startsWith(_id + '/大纲/')) continue
      const f = key.slice((_id + '/大纲/').length)
      const nm = f.replace(/\.md$/, '')
      if (nm === baseOld || nm.startsWith(baseOld + '_')) {
        const newF = f.replace(baseOld, baseNew)
        const moved = _id + '/大纲/' + newF
        if (!docs.has(moved)) {
          const rawDoc = docs.get(key)
          if (rawDoc !== undefined) {
            // 与真机同口径：内容随改名同步（fm 题名/H1/对应正文 → 新题名与新路径）
            const nextDoc = syncChapterNameInDoc(rawDoc, oldTitle, t, newRel)
            docs.set(moved, nextDoc !== rawDoc ? nextDoc : rawDoc)
            docs.delete(key)
          }
        }
        // 与真机 fs.watch(recursive) 同口径：每个被改动的文件各广播一次（rename=旧+新路径）
        fsEmit(_id, '大纲/' + f)
        fsEmit(_id, '大纲/' + newF)
      }
    }
    // 与真机同口径：章卡内容已同步 → 以章卡为权威重建索引（题名/对应路径更新）
    devRefreshOutlineIndex(_id)
    const hk = histories.get(k)
    if (hk) { histories.set(nk, hk); histories.delete(k) }
    // proposals.chapter 指针迁移（与真机 store.renameChapter → migrateChapter 同语义；无头假盘只同步内存数组）
    for (const p of mock.proposals) { if (p.chapter === rel) p.chapter = newRel }
    docs.set(nk, next)
    docs.delete(k)
    fsEmit(_id, rel)
    fsEmit(_id, newRel)
    return { ok: true, newRel }
  },
  // 章节「切片」改名（真机 store.editChapterSlice 同语义：正文约定头 + 大纲副产物 fm 切片字段 + slice-sync pending 置 stale；旧名世界文件/人物小节保留为历史）
  editChapterSlice: async (_id: string, rel: string, newSlice: string) => {
    if (!rel?.startsWith('正文/') || !rel.endsWith('.md') || rel.split('/').some((s) => s === '..')) return { ok: false, error: '路径不合法' }
    const k = _id + '/' + rel
    const cur = docs.get(k)
    if (cur === undefined) return { ok: false, error: '章节不存在' }
    const s = (newSlice ?? '').trim()
    if (!s) return { ok: false, error: '切片名不能为空' }
    const oldSlice = String(extractFrontMatter(cur).fm?.['切片'] ?? '')
    if (oldSlice === s) return { ok: true, oldSlice, newSlice: s, synced: 0, staled: 0 }
    docs.set(k, setFrontMatterField(cur, '切片', s))
    fsEmit(_id, rel)
    let synced = 0
    const base = rel.split('/').pop()!.replace(/\\.md$/, '')
    for (const key of [...docs.keys()]) {
      if (!key.startsWith(_id + '/大纲/')) continue
      const nm = key.slice((_id + '/大纲/').length).replace(/\\.md$/, '')
      if (nm === base || nm.startsWith(base + '_')) {
        const rawDoc = docs.get(key)
        if (rawDoc !== undefined) {
          const nextDoc = syncChapterSliceInDoc(rawDoc, s)
          if (nextDoc !== rawDoc) {
            docs.set(key, nextDoc)
            synced++
            fsEmit(_id, '大纲/' + nm + '.md')
          }
        }
      }
    }
    let staled = 0
    for (const p of mock.proposals) {
      if (p.chapter === rel && p.source === 'slice-sync' && p.status === 'pending') {
        p.status = 'stale'
        staled++
      }
    }
    return { ok: true, oldSlice, newSlice: s, synced, staled }
  },
  deleteChapter: async (_id: string, rel: string) => {
    const k = _id + '/' + rel
    if (!docs.has(k)) return { ok: false, error: '章节不存在' }
    const baseOld = (rel.split('/').pop() ?? '').replace(/\.md$/, '')
    let cleaned = 0
    for (const key of [...docs.keys()]) {
      if (!key.startsWith(_id + '/大纲/')) continue
      const f = key.slice((_id + '/大纲/').length)
      const nm = f.replace(/\.md$/, '')
      if (nm === baseOld || nm.startsWith(baseOld + '_')) {
        if (docs.delete(key)) cleaned++
        // 与真机 fs.watch(recursive) 同口径：被删文件各广播一次旧路径
        fsEmit(_id, '大纲/' + f)
      }
    }
    docs.delete(k)
    // 与真机 store.deleteChapter 同口径（2026-09-12）：历史入口随删除进废纸篓（无头=移除内存 key），
    // 指向本章的 pending 提案置 stale（invalidateChapter）
    histories.delete(k)
    for (const p of mock.proposals) {
      if (p.chapter === rel && p.status === 'pending') p.status = 'stale'
    }
    fsEmit(_id, rel)
    // 与真机同口径（2026-09-12）：章卡文件为权威重建 大纲/索引.md（剔除已删章条目并修正计数）
    devRefreshOutlineIndex(_id)
    return { ok: true, cleaned }
  },
  exportChapter: async () => ({ ok: true, path: '/tmp/导出章节.md' }),
  listHistory: async (_id: string, rel: string) =>
    (histories.get(_id + '/' + rel) ?? []).map((h) => ({
      name: h.name,
      mtimeMs: h.mtimeMs,
      // 与真机 listSnapshots 同口径：size = UTF-8 字节数（statSync size；HistoryDrawer 显示「字节」），不是字符数（2026-09-13 口径审计）
      size: new TextEncoder().encode(h.content).length
    })),
  readHistory: async (_id: string, rel: string, name: string) =>
    (histories.get(_id + '/' + rel) ?? []).find((h) => h.name === name)?.content ?? null,
  listDocs: async (id: string, relDir: string) =>
    // 与真机口径一致：只列 .md（csv 等批注文件不进列表）；name 去掉 .md 后缀；按 mtime 新→旧
    docsOf(id + '/' + relDir)
      .filter((d) => d.name.endsWith('.md'))
      .map((d) => ({ ...d, name: d.name.replace(/\.md$/, '') }))
      .sort((a, b) => b.mtime - a.mtime),
  // 素材库域：类别枚举（内存由 docs 推导；空类别靠 extraCats 登记）/ 新建类别 / 文件名+全文搜索
  listLibraryCategories: async (id: string): Promise<LibraryCategory[]> => {
    const counts = new Map<string, number>()
    for (const k of docs.keys()) {
      if (!k.startsWith(id + '/素材库/')) continue
      const rel = k.slice((id + '/素材库/').length)
      const seg = rel.split('/')
      if (seg.length < 2) continue
      const top = seg[0]
      if (top === '采集池' || top.startsWith('.')) continue
      counts.set(top, (counts.get(top) ?? 0) + 1)
    }
    for (const c of extraCats) {
      if (c.startsWith(id + '/')) {
        const name = c.slice(id.length + 1)
        if (!counts.has(name)) counts.set(name, 0)
      }
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  },
  createLibraryCategory: async (id: string, name: string) => {
    // 与真机 main/library.createLibraryCategory 同口径：trim + sanitizeFile（2026-09-12 对齐）
    const trimmed = (name ?? '').trim()
    if (!trimmed) return { ok: false, error: '名称不能为空' }
    const n = sanitizeFile(trimmed)
    const key = id + '/' + n
    const hasDocs = [...docs.keys()].some((k) => k.startsWith(id + '/素材库/' + n + '/'))
    if (hasDocs || extraCats.has(key)) return { ok: false, error: `类别「${n}」已存在` }
    extraCats.add(key)
    return { ok: true }
  },
  searchDocs: async (id: string, relDir: string, query: string, opts?: { excludePrefix?: string[]; limit?: number }): Promise<SearchHit[]> => {
    const q = (query ?? '').trim()
    if (!q) return []
    const terms = q.split(/\s+/).map((t) => t.toLowerCase()).filter(Boolean)
    const prefix = id + '/' + relDir + '/'
    const excl = opts?.excludePrefix ?? []
    const limit = opts?.limit ?? 50 // 与真机 main/library.searchDocs 同口径（默认 50）
    const out: SearchHit[] = []
    for (const [k, text] of docs) {
      if (out.length >= limit) break // 真机同语义：达到 limit 后不再扫描/产生更多
      if (!k.startsWith(prefix)) continue
      const relFromRoot = relDir + '/' + k.slice(prefix.length)
      if (excl.some((p) => relFromRoot.startsWith(p))) continue
      const fileRel = k.slice(prefix.length)
      const name = fileRel.split('/').pop()!.replace(/\.md$/, '')
      const lower = text.toLowerCase()
      if (terms.every((t) => name.toLowerCase().includes(t))) {
        // mtime 与 listDocs 同口径（docsOf 的导演板/停滞卡特判；2026-09-12 对齐）
        out.push({ file: relFromRoot, name, mtime: devMtime(id + '/' + relDir, fileRel), field: 'name', snippet: name })
      } else if (terms.every((t) => lower.includes(t))) {
        // 与真机 snippetOf 同口径：取各 term 在正文中最早出现的位置
        let idx = -1
        for (const t of terms) {
          const i = lower.indexOf(t)
          if (i >= 0 && (idx < 0 || i < idx)) idx = i
        }
        const start = text.lastIndexOf('\n', idx) + 1
        let end = text.indexOf('\n', idx)
        if (end < 0) end = text.length
        const line = text.slice(start, end).trim()
        out.push({ file: relFromRoot, name, mtime: devMtime(id + '/' + relDir, fileRel), field: 'content', snippet: line.length > 80 ? line.slice(0, 80) + '…' : line })
      }
    }
    return out
  },
  recentLibraryDocs: async (id: string, n = 5): Promise<RecentLibraryDoc[]> => {
    const out: RecentLibraryDoc[] = []
    for (const { file, mtime } of docsOf(id + '/素材库')) {
      const relFromRoot = '素材库/' + file
      if (relFromRoot.startsWith('素材库/采集池/')) continue
      out.push({ file: relFromRoot, name: file.split('/').pop()!.replace(/\.md$/, ''), mtime })
    }
    out.sort((a, b) => b.mtime - a.mtime || a.file.localeCompare(b.file, 'zh'))
    return out.slice(0, n)
  },
  listChapters: async (id: string): Promise<ChapterEntry[]> => {
    // 解析/排序口径在 shared/chapters（与真机 store.listChapters 同一实现，2026-09-12 根治分叉）；
    // 与真机 listDocs 同口径只收 .md（划词批注 csv 等不进章节列表，2026-09-12 补）
    const sources = docsOf(id + '/正文')
      .filter((d) => d.file.endsWith('.md'))
      .map(({ file, mtime }) => ({
        file,
        name: file.replace(/\.md$/, ''),
        text: docs.get(id + '/正文/' + file) ?? '',
        mtime
      }))
    return listChapterEntries(sources)
  },
  listSlices: async (id: string): Promise<SliceEntry[]> => {
    // 解析/排序口径在 shared/slices（与真机 main/slices.listSlices 同一实现，2026-09-12）；
    // updatedAt 与真机 statSync mtimeMs 同语义——docsOf 的 devMtime 稳定模拟（正文=现在/导演板=一天前等）
    return listSliceEntries(
      docsOf(id + '/正文').map(({ file, mtime }) => ({
        file,
        text: docs.get(id + '/正文/' + file) ?? '',
        updatedAt: mtime
      }))
    )
  },
  onFsEvent: (cb: (e: FsEvent) => void) => {
    fsListeners.add(cb)
    return () => {
      fsListeners.delete(cb)
    }
  },
  onMenuAction: (cb: (evt: MenuActionEvent) => void) => {
    menuListeners.add(cb)
    return () => {
      menuListeners.delete(cb)
    }
  },
  reportMenuState: (state: MenuStateReport) => {
    lastMenuState = state
  },
  // 与真机 getPaths 同口径（shared/settingsLogic.resolveLibraryRoot 决策链）：documents=生效库根（设置非空→老默认位→工作区/项目库）。
  // dev 无 fs：老默认位是否「存在且非空」用常量模拟——本机实况（~/Documents/织卷项目库 非空）为 true，真机默认走 legacy（2026-09-12 对齐）
  getPaths: async () => ({
    documents: resolveLibraryRoot({
      configured: settings.libraryRoot,
      legacyPath: '~/Documents/织卷项目库',
      workspaceDefault: '~/Documents/织卷工作区',
      legacyExists: DEV_LEGACY_EXISTS
    }),
    defaultLibrary: '' // 真机=process.env.HOME（ipc.ts）；已核实渲染层零消费（仅此定义处），renderer 无 node 环境取不到 HOME，保持 ''
  }),
  // 真机=系统目录选择器（settings:pickLibrary）；dev 模拟「选了新库」——写入 settings.libraryRoot 并返回，getPaths 决策链随动
  pickLibrary: async (): Promise<string | null> => {
    settings.libraryRoot = '/tmp/织卷-dev-项目库'
    return settings.libraryRoot
  },

  // dev 演示的人物索引：与主进程 readCharIndex 同口径（档案题名 + 登记别名）
  _charIndexOf: (id: string) => {
    const knownChars: string[] = []
    const aliasMap: Record<string, string[]> = {}
    for (const { file, name } of docsOf(id + '/人物')) {
      const n = name.replace(/\.md$/i, '').trim()
      if (n && !['总览', '索引'].includes(n)) {
        knownChars.push(n)
        const r = docs.get(id + '/人物/' + file) ?? ''
        const al = parseAliases(extractFrontMatter(r).fm)
        if (al.length) aliasMap[n] = al
      }
    }
    return { knownChars, aliasMap }
  },

  // 保存正文前置快检（dev：与主进程同口径——共享纯函数 + 内存文档，可无头演示「名单外出场」提示）
  checkChapterUnlisted: async (id: string, chapterRel: string) => {
    const raw = docs.get(id + '/' + chapterRel)
    if (raw === undefined) return { ok: false, error: '章节文档不存在' }
    const { fm, body } = extractFrontMatter(raw)
    const { knownChars, aliasMap } = mock._charIndexOf(id)
    return { ok: true, items: unlistedInBody({ body, listed: listedFrom(fm ?? {}), knownChars, aliasMap }) }
  },

  // 保存正文前置快检（missing 侧）：约定头列了但正文（达字数阈值）未出现 → 命中清单（与主进程同口径）
  checkChapterMissing: async (id: string, chapterRel: string) => {
    const raw = docs.get(id + '/' + chapterRel)
    if (raw === undefined) return { ok: false, error: '章节文档不存在' }
    const { aliasMap } = mock._charIndexOf(id)
    return { ok: true, items: chapterMissingFromRaw({ raw, aliasMap }) }
  },

  // 提案（S4）
  proposals: [] as Proposal[],
  listProposals: async () => mock.proposals.slice(),
  createProposals: async (_id: string, source: 'slice-sync' | 'agent-chat' | 'annotation-sync', chapter: string, sliceName: string, items: ProposalItem[], meta?: { annotations?: { file: string; rows: number[] }[]; note?: string }, metas?: { annotations?: { file: string; rows: number[] }[]; note?: string }[]) => {
    console.log('[sync] items', JSON.stringify(items))
    // 与真机 createProposals 同口径：同章旧 pending 一律置 stale（2026-09-12 补）
    for (const old of mock.proposals) {
      if (old.chapter === chapter && old.status === 'pending') old.status = 'stale'
    }
    const nowT = Date.now()
    const created = items.map((it, idx) => {
      const p: Proposal = {
        id: 'p' + nowT.toString(36) + idx,
        source,
        chapter,
        slice: sliceName,
        status: 'pending',
        createdAt: nowT,
        items: [it],
        meta: metas?.[idx] ?? meta
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
        fsEmit(_id, it.target)
      } catch (e) {
        errs.push(it?.target + ': ' + String((e as Error).message || e))
      }
    }
    p.status = 'accepted'
    devAnnoResolve(_id, p.meta?.annotations)
    return { ok: errs.length === 0, applied: p.items.filter((_, i) => !errs[i]).map((i) => i.target), errors: errs }
  },
  rejectProposal: async (_id: string, pid: string) => {
    const p = mock.proposals.find((x) => x.id === pid)
    if (p) {
      p.status = 'rejected'
      devAnnoResolve(_id, p.meta?.annotations)
    }
    return !!p
  },
  discardProposal: async (_id: string, pid: string) => {
    const i = mock.proposals.findIndex((x) => x.id === pid && x.status === 'stale')
    if (i < 0) return false
    mock.proposals.splice(i, 1)
    return true
  },

  // 批注定时优化（主人 2026-09-12）：扫描 *_批注.csv → 按 mock 改写表生成提案（真机由引擎改写）
  scanAnnotations: async (id: string) => {
    const csvRel = '正文/第01章_雾港_批注.csv'
    const csv = docs.get(id + '/' + csvRel)
    const md = docs.get(id + '/正文/第01章_雾港.md') ?? ''
    if (!csv) return { found: 0, generated: 0, skipped: 0, note: '没有新的待处理批注' }
    // 防重（真机口径：pending 未决期间记账，不重复生成；dev 用 pending 存在即停）
    if (mock.proposals.some((p) => p.source === 'annotation-sync' && p.status === 'pending')) {
      return { found: 0, generated: 0, skipped: 0, note: '已有待确认的批注提案，先处理再扫描' }
    }
    const MOCK_AFTER: Record<string, string> = {
      'L10:1-L10:34': '雨把港口淋成一片灰。阿七靠着候船厅的柱子，攥着灯的手在抖。',
      'L12:1-L12:60': '「你真的不记得了？」沈藏点了根烟，烟雾在灯罩边绕了一圈，「这盏灯，是你自己熄的。」',
      // 划词批注 loc 留空（before 兜底定位，见 Prose.tsx dispatchAnno）：按原文匹配
      '雨把港口淋成一片灰': '雨把港口淋成一片灰。阿七靠着候船厅的柱子，攥着灯的手在抖。'
    }
    const targets = parseAnnotationCsv(csv)
      .map((r, i) => {
        const byText = r.before && md.includes(r.before) ? r.before : segmentFromText(md, r.loc)
        return { row: i + 1, loc: r.loc, note: r.note, before: byText }
      })
      .filter((t): t is { row: number; loc: string; note: string; before: string } => Boolean(t.before != null))
    if (!targets.length) return { found: 0, generated: 0, skipped: 0, note: '没有新的待处理批注' }
    const items: ProposalItem[] = []
    const metas: { annotations: { file: string; rows: number[] }[]; note?: string }[] = []
    const refRows: number[] = []
    for (const t of targets) {
      const after = MOCK_AFTER[t.loc] ?? MOCK_AFTER[t.before]
      if (!after) continue
      items.push({ target: '正文/第01章_雾港.md', anchor: t.loc, kind: 'replace-text', before: t.before, after, reason: '批注：' + t.note })
      metas.push({ annotations: [{ file: csvRel, rows: [t.row] }] })
      refRows.push(t.row)
    }
    if (!items.length) return { found: targets.length, generated: 0, skipped: targets.length, note: '引擎未产出可用改写（批注未动，可稍后重试）' }
    await mock.createProposals(id, 'annotation-sync', '正文/第01章_雾港.md', '', items, undefined, metas)
    return { found: targets.length, generated: items.length, skipped: 0, note: `发现 ${targets.length} 条批注，生成 ${items.length} 条修改提案` }
  },

  // 划词添加批注（dev：追加内存 csv，与真机 addAnnotation 同构）
  annotationAdd: async (id: string, mdRel: string, entry: { loc: string; before: string; note: string }) => {
    const mdNorm = mdRel.endsWith('.md') ? mdRel : mdRel + '.md'
    const csvRel = mdNorm.replace(/\.md$/, '') + '_批注.csv'
    const key = id + '/' + csvRel
    const body = (docs.get(key) ?? '').replace(/\n$/, '')
    const line = `${escapeCsvField(entry.loc)},${escapeCsvField(entry.note)},${escapeCsvField(entry.before)}`
    docs.set(key, (body ? body + '\n' : '') + line + '\n')
    fsEmit(id, csvRel)
    return { csvRel, row: parseAnnotationCsv(docs.get(key) ?? '').length, ok: true }
  },

  // 读某章批注并定位文段（dev：与真机 listAnnotations 同构——before 优先、loc 切片兜底）
  annotationList: async (id: string, mdRel: string) => {
    const mdNorm = mdRel.endsWith('.md') ? mdRel : mdRel + '.md'
    const csvRel = mdNorm.replace(/\.md$/, '') + '_批注.csv'
    const md = docs.get(id + '/' + mdNorm) ?? ''
    const csv = docs.get(id + '/' + csvRel)
    if (csv == null) return []
    return parseAnnotationCsv(csv).map((r, i) => {
      let before = ''
      if (r.before && md.includes(r.before)) before = r.before
      else {
        const seg = segmentFromText(md, r.loc)
        if (seg != null) before = seg
      }
      return { row: i + 1, loc: r.loc, note: r.note, before }
    })
  },

  // 删除一条批注（dev：从内存 csv 删第 row 行，空文件删除；与真机 removeAnnotation 同构）
  annotationRemove: async (id: string, mdRel: string, row: number) => {
    const mdNorm = mdRel.endsWith('.md') ? mdRel : mdRel + '.md'
    const csvRel = mdNorm.replace(/\.md$/, '') + '_批注.csv'
    const key = id + '/' + csvRel
    const csv = docs.get(key)
    if (csv == null) return { ok: false, remaining: -1, note: '批注文件不存在' }
    let lines = csv.replace(/\n$/, '').split('\n')
    if (!(Number.isInteger(row) && row >= 1 && row <= lines.length)) return { ok: false, remaining: -1, note: '批注行号非法' }
    lines.splice(row - 1, 1)
    if (!lines.join('\n').trim()) docs.delete(key)
    else docs.set(key, lines.join('\n') + '\n')
    fsEmit(id, csvRel)
    let remaining = 0
    try {
      remaining = parseAnnotationCsv(docs.get(key) ?? '').filter((r) => r.loc || r.before).length
    } catch {
      remaining = 0
    }
    return { ok: true, remaining, note: '已删除批注' }
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
    fsEmit(_id, rel)
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
    const emit = (e: AgentEvent) => {
      // 停止后不再转发后续事件（与真机 runChat 的 `if (run.aborted) return` 拦截同口径；
      // 取消事件本身由 agentCancel 直接发，不走此门）
      if (cancelledAgentRids.has(rid)) return
      mock.agentListeners.forEach((h) => h(e))
    }
    await demoDelay()
    // 思考过程演示
    emit({ requestId: rid, type: 'think', text: '先看一下当前章节里需要改的位置，再决定怎么改…' })
    await new Promise((r) => setTimeout(r, 40))
    // 工具调用：带参数（读了哪个文档）
    emit({ requestId: rid, type: 'meta', tool: 'zj_read_doc', args: '正文/第01章_雾港.md' })
    await demoDelay()
    emit({ requestId: rid, type: 'meta-done', tool: 'zj_read_doc', message: '章节已读完' })
    // 工具失败演示：prompt 提到「失败/读不到/不存在」时演示一次失败工具卡（红色徽标）
    if (/失败|读不到|不存在/.test(input.prompt)) {
      await demoDelay()
      emit({ requestId: rid, type: 'meta', tool: 'zj_search', args: '幽灵船' })
      await demoDelay()
      emit({ requestId: rid, type: 'meta-done', tool: 'zj_search', message: '未找到匹配（ENOENT）', ok: false })
    }
    // 正文修改演示：prompt 提到「改」时给出 IDE 式修改方案
    if (/改|修|润|错别/.test(input.prompt)) {
      await demoDelay()
      emit({ requestId: rid, type: 'meta', tool: 'zj_edit_doc', args: '正文/第01章_雾港.md' })
      await demoDelay()
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
      await demoDelay()
      emit({ requestId: rid, type: 'meta-done', tool: 'zj_edit_doc', message: '已生成正文修改方案（1 处），采纳后写入' })
    }
    // 只有明确提到计划/提问词时才演示卡片（避免平时也冒一堆卡）
    const needDemo = /计划|todo|任务|问|确认/.test(input.prompt)
    if (needDemo) {
      await demoDelay()
      emit({ requestId: rid, type: 'meta', tool: 'todo_write' })
      await demoDelay()
      emit({
        requestId: rid,
        type: 'todo',
        items: [
          { content: '读取当前章节与人物设定', status: 'in_progress' },
          { content: '给出续写建议', status: 'pending' },
          { content: '等待确认后应用到正文', status: 'pending' }
        ]
      })
      await demoDelay()
      emit({ requestId: rid, type: 'meta', tool: 'ask_user_question' })
      await demoDelay()
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
              { label: '轻快一些', description: '给人物一个透气的瞬间' }
            ],
            multiSelect: false
          }
        ]
      })
      await demoDelay()
    }
    const demo =
      '（dev 模式模拟回复）\n\n刚把当前章节和人物相关设定读了一遍。结合现在的进度，建议先从灯入手：让主角在雨夜里再靠近一次那盏旧灯，把「灯语约定」的伏笔再点一下，然后留一个悬念给下一幕。\n\n要不要我直接按这个思路把这一段写出来？'
    // 流式压力演示：prompt 含「流式压力」时高频发射大量 think/delta 增量（3ms 间隔），
    // 验证渲染层帧级节流（streamBuffer）合并后内容完整无丢失（真实 reasoning 高频流模拟）
    if (/流式压力/.test(input.prompt)) {
      for (let i = 0; i < 60; i++) {
        emit({ requestId: rid, type: 'think', text: `思考片段${String(i).padStart(2, '0')}；` })
        await new Promise((r) => setTimeout(r, 3))
      }
      for (let i = 0; i < demo.length; i += 8) {
        emit({ requestId: rid, type: 'delta', text: demo.slice(i, i + 8) })
        await new Promise((r) => setTimeout(r, 3))
      }
      emit({ requestId: rid, type: 'final', text: demo })
      emit({ requestId: rid, type: 'done' })
      return { ok: true }
    }
    // 交错流演示：prompt 提到「交错」时在 delta 中途插一次工具调用（模拟真模型「文本→工具→文本」循环），
    // 且收尾不发 final（模拟流被截断/停止场景）——用于验证 delta 拼接不因尾部工具卡错位（前文丢失/摘要混入）
    const interleave = /交错/.test(input.prompt)
    for (let i = 0; i < demo.length; i += 8) {
      if (interleave && i === 96) {
        emit({ requestId: rid, type: 'meta', tool: 'zj_search', args: '灯语' })
        await demoDelay()
        emit({ requestId: rid, type: 'meta-done', tool: 'zj_search', message: '找到 3 处灯语（正文/第01章）' })
        await demoDelay()
      }
      emit({ requestId: rid, type: 'delta', text: demo.slice(i, i + 8) })
      await demoDelay() // 演示流速度随 ?zj-agent-delay=<ms> 可调（默认 60ms；停止冒烟用 200ms 拉长窗口）
    }
    if (interleave) {
      emit({ requestId: rid, type: 'done' })
    } else {
      emit({ requestId: rid, type: 'final', text: demo })
      emit({ requestId: rid, type: 'done' })
    }
    // 与真机 agent:send handler 同口径：返回 { ok: true }（2026-09-13 口径审计）
    return { ok: true }
  },
  agentCancel: async (requestId: string) => {
    // 停止模拟（与真机 agent:cancel → abortRequest 同口径）：标记后本请求后续事件不再转发，
    // 并补发 aborted 收尾（真机在模型跑完后发——展示性取消；devShim 立即发以便冒烟/交互即时反馈）
    cancelledAgentRids.add(String(requestId))
    mock.agentListeners.forEach((h) => h({ requestId: String(requestId), type: 'aborted' }))
    return true
  },
  agentDirectorCancel: async (token: string) => {
    directorCancels.add(token)
    return true
  },
  agentAnswer: async (_batch: string, answers: unknown[]) => {
    console.log('[devShim] agent answer', JSON.stringify(answers))
    return { ok: true }
  },
  agentAudit: async (projectId: string, kind: string) => {
    // 与主进程同语义：审计成功后把结论落盘 大纲/审读_<名>.md（供无头 UI 冒烟断言「已存档」与大纲区「审读存档」）
    const name = kind === 'consistency' ? '一致性巡查' : kind === 'perspectives' ? '多视角审视' : kind === 'presence' ? '人物在场核查' : kind === 'order' ? '切片时序核查' : kind === 'unused' ? '人物档案腐坏核查' : kind === 'actgaps' ? '正文缺段核查' : '冷读报告'
    const res =
      kind === 'presence'
        ? (() => {
            // 与主进程同语义：复用共享纯函数（演示项目第03章正文用「沈爷」=沈藏登记别名且约定头未列 → unlisted 别名命中带 refFile）
            const aliasMap: Record<string, string[]> = {}
            const names: string[] = []
            for (const { file, name } of docsOf(projectId + '/人物')) {
              const n = name.replace(/\.md$/i, '').trim()
              if (n && !['总览', '索引'].includes(n)) {
                names.push(n)
                const al = parseAliases(extractFrontMatter(docs.get(projectId + '/人物/' + file) ?? '').fm)
                if (al.length) aliasMap[n] = al
              }
            }
            const chapters = docsOf(projectId + '/正文')
              .map(({ file }) => ({ file: '正文/' + file, raw: docs.get(projectId + '/正文/' + file) ?? '' }))
              .filter((c) => c.raw.trim())
            return { ok: true as const, result: presenceCheck({ knownChars: names, chapters, aliasMap }) }
          })()
        : kind === 'order'
        ? {
            ok: true as const,
            result: {
              summary: '（演示）切片时序核查：共 4 章，2 条需复核（章号结构 / 切片顺序）。',
              items: [
                { severity: 'medium' as const, type: 'timeline', where: '灯塔夜访（正文/第02章_灯塔夜访.md）→ 无人码头（正文/第03章_无人码头.md）', what: '切片序号倒流：前序章的切片「第二幕_风起」（第 2）晚于本章的「第一幕_夜」（第 1），按章号顺序时间线向后跳了。', suggest: '若为有意的插叙/倒叙可忽略；否则检查这两章约定头「切片」是否写反，或章节顺序需要调整。' },
                { severity: 'low' as const, type: 'timeline', where: '全卷共 4 章，章号不连续：1→3。', what: '相邻章号之间存在空缺（可能还有未写的章节，或已删章节未重新编号）。', suggest: '草稿阶段常见，可忽略；若作品已成型，请在补齐或删除后统一重排章号。' }
              ]
            }
          }
        : kind === 'unused'
        ? (() => {
            // 与主进程同语义：复用共享纯函数 + devShim 内存文档真实计算（演示项目沈藏登记了未出现的「沈老爹」）
            const aliasMap: Record<string, string[]> = {}
            for (const { file, name } of docsOf(projectId + '/人物')) {
              const n = name.replace(/\.md$/i, '').trim()
              if (n && !['总览', '索引'].includes(n)) {
                const al = parseAliases(extractFrontMatter(docs.get(projectId + '/人物/' + file) ?? '').fm)
                if (al.length) aliasMap[n] = al
              }
            }
            const chapters = docsOf(projectId + '/正文')
              .map(({ file }) => ({ file: '正文/' + file, raw: docs.get(projectId + '/正文/' + file) ?? '' }))
              .filter((c) => c.raw.trim())
            return { ok: true as const, result: unusedAliasCheck({ aliasMap, chapters }) }
          })()
        : kind === 'actgaps'
        ? (() => {
            // 与主进程同语义：复用共享纯函数 + devShim 内存文档真实计算（演示项目正文无占位注释 → 零命中空态；命中路径由单测/数据层冒烟覆盖）
            const chapters = docsOf(projectId + '/正文')
              .map(({ file }) => ({ file: '正文/' + file, raw: docs.get(projectId + '/正文/' + file) ?? '' }))
              .filter((c) => c.raw.trim())
            return { ok: true as const, result: actGapsCheck({ chapters }) }
          })()
        : kind === 'consistency'
        ? {
            ok: true as const,
            result: {
              summary: '（演示）发现有 2 处设定需要再看一眼。',
              items: [
                { severity: 'high' as const, type: 'setting-conflict', where: '第2章 · 灯塔夜访（正文/第02章_灯塔夜访.md）', what: '“顾岸的旧车”前文是烟青色，这里写成了黑色', suggest: '统一为烟青色并顺手修正后文描写', target: '人物/顾岸.md' },
                { severity: 'low' as const, type: 'foreshadow', where: '第1章 · 雾港之夜', what: '墙角提到一封信，之后没有回收', suggest: '后续任一章节提一笔，或在文中删掉', target: '' },
                { severity: 'medium' as const, type: 'character-drift', where: '第3章', what: '沈确的称呼在“你”与“您”之间跳了两次', suggest: '保持对这个人物的固定称呼（建议互称）', target: '人物/沈确.md' }
              ]
            }
          }
        : kind === 'perspectives'
          ? {
              ok: true as const,
              result: {
                summary: '（演示）设定党最在意的一处：第 4 章里灯塔重新点灯，但世界观档写它二十年前就废弃了。',
                items: [
                  { severity: 'high' as const, type: 'setting', viewer: '设定党', where: '第4章 · 灯塔重明（正文/第04章_灯塔重明.md）', what: '灯塔被写“重新点灯”，但世界观切片从未提过它可以再用', suggest: '补一段设定或在正文里加入“重新启用”的交代', target: '世界观/切片_灯塔.md' },
                  { severity: 'medium' as const, type: 'character', viewer: '角色粉', where: '第2章 · 灯塔夜访', what: '顾岸明明怕水，这里却主动要在夜潮里走', suggest: '给一个由头（比如有人落水）或让他在岸上等', target: '人物/顾岸.md' },
                  { severity: 'low' as const, type: 'pacing', viewer: '节奏读者', where: '第3章', what: '开头用一整段慢慢描天气，主线三章没推进', suggest: '把天气细节并进动作里，主线事件提前半页' }
                ]
              }
            }
          : {
              ok: true as const,
              result: {
                summary: '（演示）开篇节奏可以再快一点。',
                items: [
                  { severity: 'high' as const, type: 'pacing', where: '第1章 · 雾港之夜', what: '进入第一个事件太慢，背景铺垫多', suggest: '让第一个事件提前一页，细节后置到冲突里补', target: '' },
                  { severity: 'medium' as const, type: 'structure', where: '全书', what: '第3章和第4章是同一天的两条线，读者易混', suggest: '在章节头标注同一天下的不同地点', target: '世界观/切片_灯塔.md' }
                ]
              }
            }
    // 人物在场核查 / 切片时序核查 / 档案腐坏核查：主进程同语义——本地规则结果，不落盘（高频重跑噪音大）
    if (kind === 'presence' || kind === 'order' || kind === 'unused') return res
    const rel = '大纲/审读_' + name + '.md'
    // 与真机 auditToMarkdown 同源模板（shared/auditDoc.ts）——dev 报告可被 parseAuditMarkdown 解析出条目
    const md = auditDocMarkdown(res.result, name)
    // 与真机 writeDoc 同口径：版本化 rel 且内容有变 → 旧版入史（「与上次对比」在 dev 模式两版可跑；2026-09-12 三期对齐）
    const key = projectId + '/' + rel
    const prevMd = docs.get(key)
    if (prevMd !== undefined && prevMd !== md) {
      const arr = histories.get(key) ?? []
      arr.unshift({ name: snapNameDev(Date.now() + arr.length) + '.md', content: prevMd, mtimeMs: Date.now() })
      if (arr.length > HISTORY_LIMIT_DEV) arr.length = HISTORY_LIMIT_DEV
      histories.set(key, arr)
    }
    docs.set(key, md)
    fsEmit(projectId, rel)
    return { ...res, savedReport: rel }
  },
  agentSync: async (id: string, rel: string) => {
    // 无头冒烟断言用：记录每次切片同步调用（仅 devShim 测试面，真机走 agentSync IPC）
    const w = window as unknown as { __ZJ_SYNCS?: string[] }
    ;(w.__ZJ_SYNCS ??= []).push(id + '|' + rel)
    return { ok: true, items: [] } as { ok: boolean; items: ProposalItem[] }
  },
  agentStatus: async () => ({ online: true, provider: '本机 vLLM', model: 'deepseek-v4-flash-vision-exp-uncensored', message: '' }),
  agentListCapabilities: async () => [
    { id: 'audit', title: '全卷检查', description: '（演示）一致性巡查 / 冷读报告：跨全卷对照设定找问题' },
    { id: 'perspectives', title: '多视角审视', description: '（演示）以角色粉 / 设定党 / 节奏读者三种立场各通读一遍，交叉找问题' },
    { id: 'chapter-check', title: '本章检查', description: '（演示）每章短巡查 / 分层修订：沿写作线的小环兜底' },
    { id: 'outline', title: '大纲回建', description: '（演示）把既有正文回建成章卡' },
    { id: 'director', title: '章节导演', description: '（演示）动笔前先出一张本章导演板' },
    { id: 'director-check', title: '导演兑现检查', description: '（演示）动笔后对照导演板核对本章承诺兑没兑现' },
    { id: 'triage', title: '素材升格', description: '（演示）素材按语境归类并判可否入档' },
    // 与真机 listCapabilities 全量 9 项同口径（2026-09-13 口径审计补两条：acts / annotation-sync）
    { id: 'acts', title: '分幕生成', description: '按导演板情绪弧分段逐段起草整章正文，拼成定稿草稿落 大纲/<章>_分幕.md' },
    { id: 'annotation-sync', title: '批注改写引擎', description: '按批注意图产出正文改写（定时/手动扫描批注时调用；配合设置页「批注定时优化」开关使用）' }
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
      docs.set(projectId + '/' + rel, outlineCardDoc(c, c.file))
      writes.push(rel)
      fsEmit(projectId, rel)
    }
    docs.set(projectId + '/大纲/索引.md', outlineIndexDoc(cards))
    fsEmit(projectId, '大纲/索引.md')
    return { ok: true, cards, written: writes }
  },
  // 章节导演（dev 模式：写 mock 的 大纲/<章>_导演.md 并返回导演板；与真机同口径支持取消）
  agentDirector: async (projectId: string, chapterRel: string, _requirement?: string, cancelToken?: string) => {
    const name = chapterRel.replace(/^正文\//, '').replace(/\.md$/, '')
    const rel = '大纲/' + name + '_导演.md'
    // 模拟真机延迟：给 UI 冒烟留出「点停止」窗口（此前 mock 瞬时返回，取消路径没法真实驱动）
    if (cancelToken) directorCancels.delete(cancelToken)
    await new Promise((r) => setTimeout(r, 700))
    if (cancelToken && directorCancels.has(cancelToken)) {
      return { ok: false, error: '已取消' }
    }
    const sheet = {
      premise: '把阿七从“被记忆咬住”推到“决定主动去查”，用一个旧钥匙串串起灯塔与候船厅两条线。',
      arcs: [
        { task: '推进', goal: '阿七在候船厅翻到一串旧钥匙，认出是灯塔的' },
        { task: '白热化', goal: '守塔人当面把灯再一次熄灭，阿七当夜抢船出海' },
        { task: '拉锯', goal: '在塔底与守塔人对峙，两个人都要对方先开口' },
        { task: '推进', goal: '阿七决定带着钥匙和疑问回来，但带走了一根灯芯' }
      ],
      climax: { at: 2, idea: '守塔人当着阿七的面吹灭唯一的光，整片海湾瞬间沉进黑里（可留下“灯为什么必须灭”的空间）' },
      axes: [
        { character: '阿七', line: '从被动被回忆咬住，转为主动抓住旧钥匙不放', level: '试探' },
        { character: '沈藏', line: '继续用淡漠当壳，但最后一次退让落在“要不要灭灯”上', level: '被压' }
      ],
      redlines: ['不要把守塔人写成单纯的恶人', '钥匙不能提前解释来历，先落一个钩子'],
      hooks: ['灯芯带回来要呼应', '旧钥匙的来历下一章揭' ]
    }
    docs.set(projectId + '/' + rel, '# 导演板 · ' + name + '（演示数据）\n\n## 本章戏剧任务\n' + sheet.premise + '\n')
    fsEmit(projectId, rel)
    return { ok: true, written: rel, sheet }
  },
  // 导演兑现检查（dev 模式：固定演示核对报告，对照上面的演示导演板）
  agentDirectorCheck: async (_projectId: string, chapterRel: string) => {
    const name = chapterRel.replace(/^正文\//, '').replace(/\.md$/, '')
    const rel = '大纲/' + name + '_导演.md'
    if (!docs.has(_projectId + '/' + rel)) {
      return { ok: false, error: '本章还没有导演板。先在「大纲区」点「导演本章」生成一张，再回来做兑现检查。' }
    }
    return {
      ok: true,
      result: {
        summary: '（演示）本章整体兑现得不错，但有两条要回头补：沈藏的行为轴有漂移，灯芯的钩子还没还。',
        arcs: [
          { ref: '推进：阿七在候船厅翻到一串旧钥匙，认出是灯塔的', status: 'done', note: '开篇即出现钥匙手记，对应上了' },
          { ref: '白热化：守塔人当面把灯再一次熄灭，阿七当夜抢船出海', status: 'partial', note: '灭灯有写到，但抢船出海被略过成了“次日清晨”' },
          { ref: '拉锯：在塔底与守塔人对峙，两个人都要对方先开口', status: 'done', note: '塔底对峙整段都在，嘴硬程度够' }
        ],
        axes: [
          { character: '阿七', ref: '从被动被回忆咬住，转为主动抓住旧钥匙不放', status: 'aligned', note: '摸到钥匙开始主动翻查，行为轴成立' },
          { character: '沈藏', ref: '继续用淡漠当壳，但最后一次退让落在要不要灭灯上', status: 'drifted', note: '沈藏这章说了很多心里话，壳快太多了' }
        ],
        redlines: [
          { ref: '不要把守塔人写成单纯的恶人', status: 'kept', note: '灭灯保留了“规矩”的动机，没脸谱化' }
        ],
        hooks: [
          { ref: '灯芯带回来要呼应', status: 'open', note: '灯芯提了但没让它在结尾起作用' },
          { ref: '旧钥匙的来历下一章揭', status: 'new', note: '钥匙来历被新埋进守塔人的半句话里' }
        ]
      }
    }
  },
  // 分幕生成（dev 模式：有导演板就写一份演示分幕草稿；opts.only 只重写指定段、其余段保留——与主进程同语义的简化实现）
  agentActs: async (projectId: string, chapterRel: string, _opts?: { only?: number[]; onlyFailed?: boolean }) => {
    const name = chapterRel.replace(/^正文\//, '').replace(/\.md$/, '')
    const boardRel = '大纲/' + name + '_导演.md'
    if (!docs.has(projectId + '/' + boardRel)) {
      return { ok: false, error: '本章还没有导演板。先在「大纲区」点「导演本章」生成一张，再回来分幕生成。' }
    }
    const rel = '大纲/' + name + '_分幕.md'
    const only = (_opts?.only ?? []).filter((n) => Number.isFinite(n) && n >= 1)
    if (only.length) {
      const cur = docs.get(projectId + '/' + rel)
      if (cur == null) return { ok: false, error: '本章还没有分幕草稿：先点「分幕生成」写出一版，再来只重写指定段。' }
      const fmPart = cur.match(/^---\n[\s\S]*?\n---\s*(\n|$)/)?.[0] ?? ''
      const body = cur.slice(fmPart.length)
      const segRe = /## 第 (\d+) 段\n\n([\s\S]*?)(?=\n\n## 第 \d+ 段|$)/g
      let replaced = 0
      const out = body.replace(segRe, (m, num, text) => {
        const n = Number(num)
        if (only.includes(n)) {
          replaced++
          return `## 第 ${n} 段\n\n${text.trim()}\n\n【演示：第 ${n} 段已重写】`
        }
        return m
      })
      if (!replaced) return { ok: false, error: '草稿里没有要求重写的段落（第 ' + only.join('、') + ' 段）。' }
      docs.set(projectId + '/' + rel, fmPart + out)
      fsEmit(projectId, rel)
      return { ok: true, written: rel, acts: replaced, words: 100 }
    }
    const body = [
      '## 第 1 段',
      '',
      '『演示分幕草稿』第一段：候船厅的灯慢慢暗下来时，阿七在墙角的杂物筐里摸到一串锈钥匙，每一把都缠着蜡线——最旧的那把，齿形正好对着灯塔锁孔。',
      '',
      '## 第 2 段',
      '',
      '他还没把钥匙掂热，守塔人就从身后的阴影里伸出手，把柜台上那盏唯一的油灯吹熄了。整个海湾沉进一片静里，只剩码头下的浪还在一下一下推着船帮。',
      ''
    ].join('\n')
    docs.set(
      projectId + '/' + rel,
      '---\n状态: 分幕草稿\n题名: ' + name + '\n---\n\n# ' + name + '（分幕草稿）\n\n> 由「分幕生成」按导演板情绪弧分段逐段写出（演示数据）。确认后把下面的正文部分搬进正文文件即可。\n\n' + body
    )
    fsEmit(projectId, rel)
    return { ok: true, written: rel, acts: 2, words: 128 }
  },
  // 采纳分幕草稿为本章正文（dev 模式：复用 shared/actsAdopt 纯函数，与真机 handler 同口径——剥段标记/缺段警示、保留本章题名、countWords 计数）
  adoptActs: async (projectId: string, chapterRel: string, draftRel: string) => {
    const cur = docs.get(projectId + '/' + chapterRel)
    if (cur == null) return { ok: false, error: '章节正文已不存在' }
    const draft = docs.get(projectId + '/' + draftRel)
    if (draft == null) return { ok: false, error: '分幕草稿已不存在' }
    const name = chapterRel.replace(/^正文\//, '').replace(/\.md$/, '')
    const r = adoptActsChapter(cur, draft, name)
    if ('error' in r) return { ok: false, error: r.error }
    docs.set(projectId + '/' + chapterRel, r.next)
    fsEmit(projectId, chapterRel)
    return { ok: true, words: countWords(r.body) }
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

/** dev：接受/拒绝批注提案后删除对应 csv 行（与真机 resolveAnnotationRows 同语义）；空文件删除 */
function devAnnoResolve(id: string, refs?: { file: string; rows: number[] }[]): void {
  for (const ref of refs ?? []) {
    const key = id + '/' + ref.file
    const raw = docs.get(key)
    if (raw == null) continue
    const lines = raw.replace(/\n$/, '').split('\n')
    for (const r of [...ref.rows].sort((a, b) => b - a)) {
      if (r >= 1 && r <= lines.length) lines.splice(r - 1, 1)
    }
    const out = lines.join('\n').trim()
    if (!out) docs.delete(key)
    else docs.set(key, out + '\n')
    fsEmit(id, ref.file)
  }
}

/** devShim 用的锚点写入（与 main 侧同规则：shared/anchor 精确匹配；标题下节体替换；无标题则追加 H2） */
function applyAnchor(text: string, it: ProposalItem): string {
  if (it.kind === 'append') return text + '\n\n' + it.after
  if (it.kind === 'replace-text') {
    if (!it.before || !text.includes(it.before)) throw new Error('原文段已变（可能被手动编辑），请人工确认')
    return text.replace(it.before, it.after)
  }
  const anchor = normalizeAnchor(it.anchor || '')
  const lines = text.split('\n')
  if (!anchor) return text.trimEnd() + '\n\n## 切片状态\n\n' + it.after + '\n'
  const hit = findAnchorLine(lines, anchor)
  if (!hit) return text.trimEnd() + '\n\n## ' + anchor + '\n\n' + it.after + '\n'
  let end = lines.length
  for (let i = hit.line + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+/)
    if (m && m[1].length <= hit.level) {
      end = i
      break
    }
  }
  const head = lines[hit.line]
  return [...lines.slice(0, hit.line), head, '', ...it.after.split('\n'), '', ...lines.slice(end)].join('\n')
}

/** 无头冒烟：`?zj-fail=<api>[,<api>…]`（首次调用 reject 一次，重试恢复）与
 *  `?zj-fail-x=<api>[,<api>…]`（每次都 reject，验证错误态本身；Workspace 计数调用会先吞掉一次，
 *  持续失败可保证页面层错误卡必然出现）。仅 devShim 存在；真机错误态是同一套 React 组件。 */
function buildFailProbe(base: typeof window.zhijuan): typeof window.zhijuan {
  const parse = (key: string) =>
    new Set(
      (new URLSearchParams(location.search).get(key) ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    )
  const once = parse('zj-fail')
  const always = parse('zj-fail-x')
  if (!once.size && !always.size) return base
  const src = base as unknown as Record<string, (...a: unknown[]) => unknown>
  const probe = { ...(base as unknown as Record<string, unknown>) }
  for (const name of new Set([...once, ...always])) {
    if (typeof src[name] !== 'function') continue
    probe[name] = async (...args: unknown[]) => {
      if (always.has(name)) throw new Error('模拟失败：' + name)
      if (once.has(name)) {
        once.delete(name)
        throw new Error('模拟瞬态失败：' + name)
      }
      return (src[name] as (...a: unknown[]) => unknown)(...args)
    }
  }
  return probe as unknown as typeof window.zhijuan
}

/** 无头冒烟：`?zj-empty=<场景>[,<场景>…]` 使对应 mock 接口返回空（验证空态版式）。
 *  场景：projects / chapters / timeline / docs:<relDir>（如 docs:人物）。仅 devShim 存在；
 *  真机空态是同一套 React 组件。可与 zj-fail 叠加（先 empty 后 fail 包装）。 */
function buildEmptyProbe(base: typeof window.zhijuan): typeof window.zhijuan {
  const raw = (new URLSearchParams(location.search).get('zj-empty') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (!raw.length) return base
  const emptyDocs = new Set<string>()
  let emptyProjects = false
  let emptyChapters = false
  let emptySlices = false
  let emptyLibrary = false
  for (const item of raw) {
    if (item === 'projects') emptyProjects = true
    else if (item === 'chapters') emptyChapters = true
    else if (item === 'timeline' || item === 'slices') emptySlices = true
    else if (item === 'library') emptyLibrary = true
    else if (item.startsWith('docs:')) emptyDocs.add(item.slice('docs:'.length))
  }
  const probe = { ...(base as unknown as Record<string, unknown>) }
  if (emptyProjects) probe.listProjects = async () => []
  if (emptyChapters) probe.listChapters = async () => []
  if (emptySlices) probe.listSlices = async () => []
  if (emptyLibrary) {
    // 素材库树 = 类别 + 文件推导；两者都清才能真正空树
    probe.listLibraryCategories = async () => []
    const orig = base.listDocs
    probe.listDocs = async (id: string, relDir: string) => (relDir === '素材库' ? [] : orig(id, relDir))
  }
  if (emptyDocs.size) {
    const orig = base.listDocs
    probe.listDocs = async (id: string, relDir: string) => (emptyDocs.has(relDir) ? [] : orig(id, relDir))
  }
  return probe as unknown as typeof window.zhijuan
}

export function ensureDevShim() {
  if (window.zhijuan) return
  ;(window as unknown as { __ZJ_TEST: boolean }).__ZJ_TEST = true
  window.zhijuan = buildEmptyProbe(buildFailProbe(mock as unknown as typeof window.zhijuan))
  // 无头冒烟用：暴露全局 Toast API（与 __ZJ_EDITORS 同级的测试面，仅 devShim 存在）
  ;(window as unknown as { __ZJ_TOAST: typeof toast }).__ZJ_TOAST = toast
  // 无头冒烟用：模拟主进程菜单动作（真机走 ipcMain send('menu:action') → preload onMenuAction）
  const emitMenu = (id: MenuActionId) => {
    for (const h of menuListeners) h({ id })
  }
  ;(window as unknown as { __ZJ_MENU_EMIT: (id: MenuActionId) => void }).__ZJ_MENU_EMIT = emitMenu
  ;(window as unknown as { __ZJ_MENU_STATE: () => MenuStateReport | null }).__ZJ_MENU_STATE = () => lastMenuState
}
