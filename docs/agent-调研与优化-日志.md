# 织卷 · agent 功能调研与优化日志

> 本文件由「Agent 功能专项优化器」cron（job 021be06b0cfc 的错峰搭档）维护：
> 每轮先调研同类 agent 能力（来源可回溯），再结合织卷产品诉求收敛优化点，能落地就落地。
> 与本技能（zhijuan-app）「文字>大脑」同约：结论、取舍、来源都写在这，回执只给一句话。

---

## 2026-09-09 13:00 ｜ 调研主题：agent-native 长篇创作工具的「审读/Review 结果如何成为项目持久资产」

### 调研背景

主推进器刚完成 M6 闭环（导演板→分幕→采纳→切片同步→兑现检查→按检查重写段）与 agent-first P2「多视角审视」；agent 功能面最明显的空洞已不是「缺检查」，而是**检查结果一次即弃**：冷读/巡查/多视角的结论只活在抽屉 state 里，关掉即丢；改稿两周后想对照上次审读说了什么，只能重跑（几分钟 + token），且无法回答「上次的问题改了吗」。本轮围绕「同类工具如何处置 AI 审读产物」做真实调研。

### 来源清单（URL，均可回溯）

- **Novel（xieshu.me）— 本地优先 AI 长篇小说创作工具**：https://xieshu.me/ （首页）
- Novel · Narrative Trace：https://xieshu.me/features/narrative-trace
- Novel · Local-first projects：https://xieshu.me/features/local-first
- （抓取方式：本机 web_extract 把外网判为私有网络被拦，改用 `curl r.jina.ai/<url>` 取回 Markdown 原文；本机 CDP 也无头浏览器可作后备）

### 调研结论（要点）

1. **Novel 的产品分层**：「Agent 是创作大脑，Novel 是可靠边界，作者拥有最终决定」——App 只负责版本、引用、审批、发布与恢复，语义判断交给 Agent。与织卷「材料包 + 提案制 + 正文为源」同一哲学。
2. **AI Review 必须绑定它真正读过的版本**（Draft Revision 绑定）：正文变化后旧审读结论不能冒充新历史。织卷审计是「跑时快照」，本身读的是跑时全卷，这一点天然满足，但**结论没留下**——Novel 的做法是 Review/Digest/Chapter Trace 作为项目资产持久化、可回溯。
3. **候选召回与语义解析分开、导航不替代事实**：名称/Alias 只召回候选，Agent 沿稳定 ID 定位章节后仍读**精确原文**做判断。「导航记忆」不取代原文读取。对应织卷：切片设定是摘要层，判断仍应回正文（现有实现已是材料包喂原文）。
4. **作者批准后进入记忆**（AUTHOR GATE → Digest → Canon Ledger）：未经批准的内容不进长期记忆，避免「草稿泡污水」。织卷的提案制 = 同一模式的本地版，正确。
5. 未尽事项（未深挖，后续可查）：Novel 的具体 Review 产出格式（structured? freeform?）、Revision/Diff 的落盘形态（canon.jsonl + manuscript/ 目录）——对织卷「全部文档化/零结构化」的取舍有参考但不可照搬（织卷一期明确不引结构化存储）。

### 收敛出的优化点（本轮做）

**审读存档：全卷审计结论自动落盘 `大纲/审读_<名>.md`**（一致性巡查 / 冷读报告 / 多视角审视 各一个文件）。

- 为什么现在做：检查阵容已齐（S6/S7/P2），唯一缺的是「结论资产的沉淀」；这是调研里唯一既贴合织卷定位、又小步可验的缺口。改稿逐轮对比、跨会话回看、git 可回溯，正好补「把改稿压成十分钟」的最后一段。
- 怎么做（沿现有架构，无新层无新依赖）：
  - `src/main/agent/audit.ts` 新增纯函数 `auditToMarkdown` / `auditReportRel`（可单测）；`runAudit` 成功后 `writeDoc` 落盘（主进程直写，写作副产物——与章卡/导演板同约定；设定类改动仍走提案制不受影响）。
  - **覆盖式**（每类一个文件、最新一次为准）：避免每次重跑堆噪音文件；历史版本由 git 兜底（与章卡「可重导覆盖」同心智）。空结果也留档（「这一遍没有发现问题」= 跑过的证据）。
  - 失败不阻断：盘写异常只丢 savedReport，审计结果照常展示。
  - UI：AuditDrawer 结果行显示「✓ 已存档」（title 给路径）；大纲区侧栏新增「审读存档」分组（`大纲/审读_*.md`），点击即在编辑器回看；已回建计数排除审读文件。
  - 小取舍：本章小环（chapter/revision）本轮**不**落盘（每章高频重复跑，噪音大），留作下一步待观察。
- 涉及模块：src/main/agent/audit.ts、src/preload/index.ts、src/renderer/.../AuditDrawer.tsx、Outline.tsx、lib/devShim.ts、tests/unit/audit-report.test.ts、scripts/audit-archive-ui-smoke.mjs。

### 验证结果（真实跑通）

- 三道门：`npm run typecheck` ✅ / `npm run build` ✅ / `npm test` **135 例全过**（130+5：auditReportRel 路径 1 例、auditToMarkdown 有/空条目 2 例、runAudit 落盘与盘写失败不阻断 2 例）。
- **无头 UI 冒烟（锁屏下，CDP 9224 + out/renderer）** `scripts/audit-archive-ui-smoke.mjs` **PASS**：正文页 Agent 面板点「一致性巡查」→ 抽屉显示「已存档」→ `listDocs('demo-aseya','大纲')` 实锤 `审读_一致性巡查.md` 存在且内容含报告头 → 大纲区出现「审读存档」分组 → 点击 → 编辑器渲染出报告内容。整链（审计→落盘→回看）在真实页面 DOM 上走通。
- 提交：**55eb47f**（feat(audit)）。

### 下一步（候选，未拍板）

1. **本章小环结果落盘**（`大纲/审读_本章_<章名>.md`，或仅分层修订落盘）——先看本轮使用体验再定。
2. **审计条目 →「交给 agent 改」**：suggest 目前只是文本（可复制/转提案），可加一条「按此建议让 agent 用 zj_edit_doc 改正文」的通道（兑现检查 missed/partial 已有「重写第 N 段」先例）。
3. **报告间对比**：两份存档 diff（改稿前后的审读结论），做「上次的问题这次还在不在」清单——需先有存档积累。
4. 回写 zhijuan-app 技能（本 job 边界只动织卷仓库，留给拥有技能写权限的会话/主推进器）。

## 2026-09-09 14:50 ｜ 落地：审计条目「让 agent 改」（候选 2）

- 上一节「下一步候选 2」已落地（提交 **63f4abb**）：审计抽屉每条目新增「让 agent 改」→ 条目（类型/严重度/位置/现象/建议/关联档案）打包成一条指令消息发给 agent 区，模型用 zj_read_doc 定位、zj_edit_doc 出修改卡（采纳才写入）。与「兑现检查 → 重写第 N 段」同一哲学：检查必有处置入口，审计结论从「库存」变成「可执行」。
- 未做结构化「条目→章节」映射：where 是模型的自由文本定位，转结构＝新增模型字段＝变数；模型自己读全卷定位更稳（agent-first 分工）。
- 验证：三道门 138 例全绿；无头 UI 冒烟 `scripts/audit-toagent-ui-smoke.mjs` PASS（真实点击链：抽屉→按钮→指令进对话→EditCard 到达）。
- 剩余候选：**报告间对比**（两份存档 diff，「上次的问题这次还在不在」）——待存档积累两版后做。

## 2026-09-09 16:00 ｜ 调研主题：确定性（规则/统计）审查 vs LLM 审查——业界如何分层 & 织卷缺的「机械层」

### 调研背景

织卷审计阵容（一致性巡查/冷读/多视角/本章小环/让 agent 改）全部是 **LLM 审查**：每次几分钟 + token，天然不适合高频重复。主推进器下一步候选是「报告间对比」，但它依赖存档积累；在本轮先补上 LLM 审查下面的「确定性审查层」——这类检查无需模型、秒级、可重复，是「常驻巡查」的低成本形态。围绕「同类工具把哪些检查做成了确定性计算」做真实调研。

### 来源清单（URL，均可回溯）

- **Novelcrafter · Discover all the features**：https://www.novelcrafter.com/features （其「Review」版块）
- **Novelcrafter · Codex / Help docs**：https://www.novelcrafter.com/help/docs/codex/series-codex 等（由 features 页 404 的 /codex 页指引）
- **Sudowrite · Plugins 市场**：https://www.sudowrite.com/plugins （Chapter Recap / Character Simulator / Dialogue Distinctifier 等）
- （抓取方式：本机 web_search 后端 searxng 本轮空返，改 `curl r.jina.ai/<url>` 取回 Markdown，与既往轮一致）

### 调研结论（要点）

1. **Novelcrafter 把「Review」做成了确定性统计审查**：Appearance Heatmap（人物/元素在场景中的出现热力图，「发现隐藏联系」）、Characters per Scene（发现拥挤场景与缺席角色）、Word Statistics——全是可计算的量化指标，**不消耗 LLM**，与它的 Codex（设定库）分层：Codex 管「是什么」，Review 管「出现频率/分布是否健康」。LLM 审查（它的 chat/scene 评审）是另一层。
2. **Sudowrite 插件生态与织卷已实现功能几乎一一对位**：Chapter Recap（分析一章记录重要进展 ≈ 织卷章卡回建）、Character Simulator（从角色获取反馈 ≈ 多视角/角色视角）、Dialogue Distinctifier（对话区分度检查）——**业界该有的 LLM 功能织卷都有了**，缺口不在功能而在「低成本确定性检查层」。
3. **确定性审查的最大价值是「沿写作线高频兜底」**：LLM 巡查几分钟一次、贵，作者不会每章跑；而「涉及人物约定头 vs 正文实际出现」这类检查是**机器可判定的**（子串匹配 + 已知名单），真·秒级、零成本、无模型变数，正合适做成默认常驻的一环。它守护的正是 V2 核心「正文为源、设定为流」的**锚点一致性**——约定头「涉及人物」是切片同步、正文章卡、agent 上下文半径的数据源，清单漂移会污染下游。

### 收敛出的优化点（本轮做）

**人物在场核查（人物 Presence Check）**：逐章对照约定头「涉及人物」与正文实际署名出现，输出两类问题——清单列了但正文未出现（missing，medium）、正文出现但清单没列（unlisted，low）。审计抽屉新增「在场」Tab（与巡查/冷读/视角并排），纯本地规则、零模型、不落盘（高频重跑噪音大，与本章小环同策略）。

- 为什么现在做：业界把「可计算的检查」从 LLM 里分离出来（Review=统计层）；织卷缺这一层，且它守护 V2 数据锚点（涉及人物清单），是与「切片同步」互补的校验面；小步（一个纯函数 + 一个 Tab）、一行可验、单测可覆盖。
- 怎么做（沿现有架构，无新依赖）：
  - `src/shared/presence.ts` 纯函数 `presenceCheck`（输入 全部章节 + 人物档案题名 → AuditResult，与审计抽屉同构；`listedFrom` 兼容字符串/数组两种约定头写法）；单字名、别名、指代不参与机械匹配（机械层承认局限，summary 里注明口径）。
  - `src/main/agent/audit.ts`：`runPresence(projectId)`（listDocs 人物/正文 + readDoc → 纯函数；过滤总览/索引、子目录取末段）；`runAudit('presence')` 特判，不走写作引擎、不落盘。
  - UI：AuditDrawer 加「在场」Tab（标题/状态行区分「本地规则核查·秒级」）；AgentPanel 头部新增按钮（UserCheck 图标）；devShim mock 对齐主进程语义（presence 不落盘）。
- 涉及模块：src/shared/presence.ts、src/shared/types.ts、src/main/agent/audit.ts、AuditDrawer.tsx、AgentPanel.tsx、lib/devShim.ts、tests/unit/presence.test.ts、scripts/presence-ui-smoke.mjs。
- 小取舍：条目不做「转提案」（问题在正文/约定头本体，不在设定文件）；保留「让 agent 改」（模型可用 zj_edit_doc 改约定头或补写正文——与审读条目同哲学）。

### 验证结果（真实跑通）

- 三道门：`npm run typecheck` ✅ / `npm run build` ✅ / `npm test` **146 例全过**（138+8：listedFrom 1、presenceCheck 6、runPresence 1）。
- **无头 UI 冒烟**（锁屏下，CDP 9224 + out/renderer）`scripts/presence-ui-smoke.mjs` **PASS**：正文页 Agent 面板出现「人物在场核查」按钮 → 点击 → 抽屉标题「人物在场核查」+ 状态行「本地规则核查：共列 1 条」+ 演示条目（含「让 agent 改」）渲染。
- **真数据层冒烟**：esbuild bundle audit.ts（alias electron=scripts/electron-stub.mjs）→ node 直跑 `runPresence('织卷smoke')`（真实项目库）→ `ok:true`，2 章全部与约定头「涉及人物」一致（真库 front matter 解析链路验证）。
- 提交：**<提交号占位>**（feat(check)）。

### 下一步（候选，未拍板）

1. **unlisted 联动「切片同步前置校验」**：保存正文时若有「人物出现但未列清单」，可在切片同步前提示补列（避免同步上下文缺人）——但涉及保存热路径，先看使用体验。
2. **报告间对比**（调研日志候选 3，主推进器候选）：存档是覆盖式、只有最新一版，需先解决「历史版本留存」（如存档也写 git 或改带日期文件名）再谈 diff。
3. **角色视角的确定性核查扩展**：称谓一致性（同一人物在正文中的称呼变体统计）、时间切片顺序核查（章号 vs 切片时间）——同属机械层，逐个加。
4. 回写 zhijuan-app 技能（本 job 边界只动织卷仓库，留给拥有技能写权限的会话/主推进器）。

---
