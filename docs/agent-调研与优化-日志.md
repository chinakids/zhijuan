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
