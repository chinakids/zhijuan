// ===== 织卷 · 上下文装配预算（单一权威源，2026-09-14 智能层）=====
// 原定义在 src/main/agent/context.ts 的 CAP 常量；shared 化原因：用量显示（AgentPanel）
// 必须与主进程装配口径同源，否则渲染层复制一份迟早失配（atRefs 先例）。
// 改预算：只改这里，context.ts 与 AgentPanel 自动跟随。
export const WCTX_CAPS = {
  /** 当前章正文（超长装结尾）。
   * 2026-09-17 智能层「装配块口径复核」：原 8000——对照真实项目正文长度（主人已完作品 19 章，
   * 字符中位 8548 / 平均 8590 / 最大 10941）会触发 13/19 章（68%）每轮裁剪（保尾+「前文已省略」），
   * 续写模型看不到章首（伏笔/铺垫常落开头）；模型侧 1M 上下文（ROADMAP），预算纪律=信号密度非窗口容量，
   * 正文为源 → 调至 12000 覆盖真实分布+长章余量；>12000 仍走既有「保尾+注明+可现读」兜底。 */
  chapter: 12000,
  /** 上一章尾部（承接） */
  prevTail: 3000,
  /** 单个涉及人物档案 */
  char: 4000,
  /** 最多附档案的人物数 */
  maxChars: 4,
  /** 当前切片设定（超长保头） */
  slice: 4000,
  /** 本章章卡 */
  card: 2000,
  /** 本章导演板 */
  director: 2500,
  /** 素材库索引路标 */
  material: 1200
} as const

/** skill 技能包预算（2026-09-21 智能层运行层；设计基线 docs/skill-运行层-产品规划-2026-09-21.md §5.1/§5.3）
 * 对齐业界渐进披露：描述常驻（清单）、正文按需（激活）；清单总预算=name-only 降级阈值。 */
export const SKILL_CAPS = {
  /** 清单行：单技能展示长度（描述+触发词合计）截断 */
  perLine: 120,
  /** 清单总预算：超=降级为仅技能名（name-only，对齐 Claude） */
  listing: 600,
  /** 单个技能正文激活注入预算（超=保头+注明 zj_read_doc 现读；对齐开放标准 <5000 tokens 推荐口径） */
  body: 3000
} as const

/** 写作上下文（buildWritingContext）装配预算总量上限（含人物 × maxChars） */
export const WCTX_MAX =
  WCTX_CAPS.chapter +
  WCTX_CAPS.prevTail +
  WCTX_CAPS.char * WCTX_CAPS.maxChars +
  WCTX_CAPS.slice +
  WCTX_CAPS.card +
  WCTX_CAPS.director +
  WCTX_CAPS.material
