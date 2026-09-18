# 任务线 · Agent 上下文管理（2026-09-17 主人拍板独立推进）

> 主人（2026-09-17，F-20260916-06）：整个 Agent 区域的功能体验很重要，**上下文管理**与 **Agent 体验**拆成两个任务分别推进。
> 本文档＝**上下文管理**专项线的任务档案（现状 / 候选 / 验收口径 / 迭代记录）。实现主责＝智能层轮次（主进程 main/agent/* 与 zj 工具层）；涉及纯 UI 呈现部分归 Agent 体验线。
> 关系：Agent 体验线＝`任务-02-Agent体验.md`；两线候选互不混排。

## 一、范围（本线管什么）

- 创作上下文装配：`src/main/agent/context.ts`（buildWritingContext / buildProjectContext），块清单、预算硬控、截断策略、剥离注释口径；
- 预算常量：`src/shared/contextCaps.ts`（WCTX_CAPS / WCTX_MAX：正文 12000（2026-09-17 复核调：原 8000，真实章长中位 8548 触发 68% 章裁剪）/ 前情 3000 / 人物 4000×4 / 切片 4000 / 章卡 2000 / 导演板 2500 / 素材 1200；WCTX_MAX=40700）；
- zj 工具层描述与可发现性（zj_list_docs / zj_read_doc / zj_search / zj_workspace / zj_edit_doc）；
- 长文记忆策略：前情承接（上一章尾部→同线前驱）、衰减/摘要化（M1.3 精神）、embedding 增强召回（预留）；
- 多线叙事下的装配语义（线内前驱 / 人物分线 / 切片分线，2026-09-16/17 已落地 49558e4、41c2105）。

## 二、不做（边界）

- Agent 面板 UI/交互（消息流、工具卡、输入区、取消/重试入口）→ 任务-02；
- 引擎层（dsh runtime / providers）本身；
- 审计/检查规则新增（归智能层常规轮次）。

## 三、现状盘点（2026-09-17）

- 装配块：当前章（超长保尾+注明）/ 上一同线章尾部（缺段提示）/ 涉及人物档案（最多 4 人；分线装配 2026-09-17）/ 当前切片世界观（超长保头）/ 本章章卡 / 导演板 / 素材库索引；未开章另装配 项目总纲+世界观总纲；
- 预算：WCTX_CAPS 硬控 + 块级注明（「被截了、可用 zj_read_doc 现读」）；
- 注释：注入前剥离 `<!-- … -->`（shared/comments.ts），注释不占预算；
- 可发现性：`scripts/context-outline-probe.mjs` 实证未开章模型经 zj_workspace→zj_list_docs→zj_read_doc 可达大纲；结论＝暂不加路标（2026-09-17 09:00 智能层轮）；
- **工具描述（2026-09-18 03:00 轮收口）**：`zj-core.ts` 描述与实现一致性审计修正 2 处——zj_read_doc 引导「超长按返回提示 offset 续读、勿 maxChars 一次大读（白耗 token 拖慢响应）」、zj_search 如实说明「子串匹配/按目录顺序取前 N 文件/至多 3 行/无相关性排序」；描述守卫单测 zjToolDesc.test.ts + 真模型探针 zj-tooldesc-live.mjs（实证大读行为消除）；**改 src 描述后必须重跑 scripts/build-plugins.mjs（dsh 侧加载构建产物）**；
- 冒烟/单测：multiline-context-smoke 14/14 等（装配域冒烟见 scripts/context-*）。

## 四、候选（按优先级，下一轮开工先读本节）

> 2026-09-17 15:00 智能层轮更新：候选 1（装配块口径复核）**收口**——正文预算 8000→12000（真实项目数据：都市短篇合集 19 章 6851–10941 字符/中位 8548/平均 8590，原预算触发 13/19 章（68%）每轮裁剪保尾；模型侧 1M 上下文（ROADMAP），预算纪律=信号密度非窗口容量；人物档 27 份 739–3833 字符无一超 4000=人物预算合理不动；>12000 仍走既有「保尾+注明+可现读」兜底）。提交见智能层档案 15:00 轮。
>
> 2026-09-17 21:00 智能层轮更新：候选 3（embedding 增强召回成本与必要性评估）**收口**——实证：关键词同义/变体 6/10 全漏（新探针 `scripts/context-semantic-probe.mjs`）；nomic-embed-text 5/10 不可用（中文弱、分数密集）；**bge-m3 10/10**（本机 ollama 1.2GB 已装、查询 94ms、批量 13ms/段、零新依赖）；结论=**可行性成立、定位作者侧搜索、排期低优先**（触发条件=素材量 ≥50 篇或主人反馈搜不到 P1 升格；agent 侧经探针实证不需要向量检索）。明细见智能层档案 21:00 轮。
>
> 2026-09-18 06:00 智能层轮更新：多线装配真模型验证面补全**收口**——`scripts/multiline-context-live.mjs` 入仓（数据层 9 断言+真模型 3 问 5 断言，首跑 OK：模型答线内前驱事实、不把他线前驱/他线人物状态归当前线、零工具）；多线装配自此有行为层回归网（改多线装配/换模型后复跑）。详见本文件迭代记录。

1. ~~**预算改动后长效探针复测**~~（✅ 2026-09-17 18:00 收口：两探针全过零漂移）——装配预算改动（chapter 8000→12000、WCTX_MAX 36700→40700）后按 00:00 轮先例跑 context-full-live + mixform-toagent-live（覆盖面最广），确认注入链零漂移（预算改动守卫复测）；顺带观察正文装配块窗口变大后模型是否仍零现读。
2. **zj 工具描述补「大纲」示例**（预防性）——仅当真机/换模型出现「未开章问大纲答不出」且探针复跑失败时实现。
3. ~~**embedding 增强召回**~~（✅ 2026-09-17 21:00 评估收口：可行性成立/触发制低优先）——实施前先出成本与必要性评估（已完成）：本地 bge-m3（本机 ollama 1.2GB、10/10、94ms、零新依赖）为选定方案；**触发条件=织卷素材库真实量 ≥50 篇 或 主人反馈「同义词搜不到」（P1 升格）**；实现定位=作者侧 searchDocs 混合检索（词面+语义 Top-N）、素材卡级整篇嵌入（不分块）；**不做** agent 侧 RAG（09:00/12:00 探针已证 LLM 链通）与远端 API/vLLM 宿主挂载（零网络依赖与算力池边界）。
4. **前文衰减摘要**（候选保留，评估已判非必需）——若换模型/大项目后 context-fading-probe 出现「不搜/编造」，按 Novelcrafter 摘要链+takeLast 范式（storySoFar 摘要链）引入「每 N 章自动产摘要」；当前不立项。

## 五、迭代记录

### 2026-09-18 06:00–06:4x（多线装配真模型验证面补全：`scripts/multiline-context-live.mjs` 入仓，首跑 OK）

- 背景：多线装配（41c2105）只有数据层冒烟（multiline-context-smoke 14/14），**无行为层验证**——「上一章必须取同线前驱，否则跨时域误承接」=设计文档 §3 B 形态明示头号风险（D-V2-5 修订验收口径=多线交错中篇自洽）；换模型/改装配后是唯一静默回归面。
- 落地（**纯验证资产，零 src 改动**）：`scripts/multiline-context-live.mjs`——双线交错临时项目（主线 01/03/05 + 过去线 02/04 显式「时间线: 过去」、林晚两线状态不同、第05章切片刻意不建世界观→顺带验回退链线内）；三独家事实 X（主线第03章尾部红灯笼=线内前驱应有）/Y（过去线第04章尾部木匣子=不得含）/Z（人物档过去线切片子弹壳=不得含）；数据层 9 断言 + 真模型三问 5 断言（Q1 答 X 且不把 Y 当本线上一章/Q2 不把 Y 归当前线/Q3 不把 Z 归当前线）+ **零工具判定**（证明信息来自装配）。
- 实证：**MULTILINE-CTX LIVE OK** 首跑通过——Q1 答「第03章_灯下……红灯笼在檐下挂了一整夜」；Q2 准确复述「略去了其他时间线的切片小节『旧巷』」（=装配注明被模型利用）；Q3 只答主线状态不把子弹壳归当前线；调用工具=[]。
- 交接：加入观察项验证资产清单（**改多线装配/换模型后复跑**）；只验证「不误承接」负向面，「模型主动跨线查询正确归因」正向面待时间线页（体验层）就绪后补场景；候选顺位不变。

### 2026-09-18 09:00–09:5x（素材注入链路审计收口：素材库/索引.md 无任何程序维护端实锤→模型侧素材块改素材文件动态路标；提交 d4dd488，详见智能层档案 09:00 轮）

- 背景：线 A 范围「装配」面里素材注入（主人主线②首项）从未行为层验证；审计发现静态 `素材库/索引.md` 唯一写入点=骨架模板（store.ts DEFAULT_FILES.libIndex 说明文字），采集回填/App 新建素材均不更新它，且现实项目核证三态（织卷smoke 缺失/agent冒烟 陈旧描述不存在素材/模板占位非空被注入）→ 素材注入=失效甚至误导。定位=「大纲/索引.md 供人看、装配用章卡文件」同构：索引是作者侧目录文档（模块设计 §9 不变），模型侧路标必须以素材文件为权威运行时生成。
- 落地：`src/shared/materialCard.ts`（新单源：isMaterialCard/materialTags/materialPreview/materialContextPreview，LibraryBrowser 原私有三函数与 context/store 三口同源）；`context.ts` 素材块= listDocs('素材库') 过滤 isMaterialCard → 路标（类别/素材名/标签/增量预览，预算仍 1200、超限注明 zj_search dir=素材库——不套 capHead 的单文件现读提示）；`store.ts` stats.materials 同口径（不再把索引.md 计为素材，首页素材数修正）；三探针适配素材文件化。
- 实证：三道门全绿（863 例 86 文件）；context-budget-smoke 全过；**context-full-live FULLCTX LIVE OK**（真模型题 8 从路标答出真实素材「潮汐笔记/雾中航标」、零工具）；context-tools-live OK（素材核心意象移文件中段保探针纯度）；library-cat-ui-smoke 全 PASS（渲染层抽取零回归）。
- 交接：素材注入修复闭环；观察项——素材「使用侧」（路标→现读→用于创作）专门探针未单列；改素材卡判据/预览/标签先跑 materialCard.test + library-cat-ui-smoke + context-budget-smoke。

### 2026-09-18 12:00–12:4x（素材「使用侧」行为链探针收口：路标→现读→用于创作实证闭环；并修复素材路标路径缺「素材库/」前缀；提交 35a58d0，详见智能层档案 12:00 轮）

- 背景：09:00 轮交接观察项「使用侧未单列」——路标可见（fullctx 题8）与现读可达（tools-live）已证，但作者真实场景「用素材改这段」时模型三连（看到路标→读素材→用于正文出 zj_edit_doc）从未行为验证；线 A 「装配面」最后一块验证缺口。
- 调研：Novelcrafter《Prompt Functions》官方参考（CDP 实抓）——Codex 条目进创作上下文=「显式取用 codex.get + 全局标记 codex.global + 提及检索 codex.mentions」三机制；织卷同构=@引用注入+装配素材路标+zj_search 现读；本轮验证面=行为链完整性。
- 落地（新 `scripts/material-use-live.mjs` ≈170 行 + context.ts 一行修正 + context.test.ts 2 处断言）：临时项目贴真实采集卡形态（文件名=采集_<名>.md/H1=内容题名/tags front matter）；素材①核心意象（金色光晕/旧绸缎/航标灯）在文件中段、首段中性引子（路标零泄底保真）；素材②同话题干扰项（蓝丝线/白伞/便利店）；反例=采集池任务卡/索引.md/隐藏文件。数据层 7 断言 + 真模型行为 5 断言 + 软观察（排除说明）。**实证驱动修复**：首跑模型照抄路标路径 `环境/采集_雾港.md`（库内相对）调 zj_read_doc 失败并自纠——根因=素材路标呈现口径（zj_workspace/zj_list_docs 本为根相对，仅素材路标是库内相对）；修正=路标行补「素材库/」前缀（项目根相对、可照抄）；描述无需改（zj_read_doc 描述已含「相对作品根目录…素材库/…」示例）。
- 实证：探针 4 跑（二/三跑为「排除说明」判据措辞敏感假阴→软观察化）；**第四跑 MATERIAL-USE LIVE OK**（数据 7/7+行为 5/5）；修复后**模型零失败调用**（首调即 `素材库/环境/采集_雾港.md`）；工具链 zj_read_doc 正文→素材①→素材②→zj_edit_doc（1 处修改卡）；素材①意象全部织入改写、素材②零混入；模型主动提示「浪声很大」与「海上没有一丝风」违和并给微调（超预期协作）。三道门全绿（869 例 87 文件）。
- 交接：09:00 轮观察项①**关闭**；material-use-live 入固定后置验证资产清单（**改素材路标/预览口径/素材卡判据/换模型后复跑**）；「读了干扰素材并明确排除」为理想行为（软观察，不设硬判据——措辞多变）；候选顺位不变。

### 2026-09-18 03:00–03:2x（zj 工具描述-实现一致性审计收口：描述引导 offset 续读 + zj_search 诚实化）

- 背景：00:00 轮观察项①「模型倾向 maxChars=80000 大读非 offset 续读」+ 09:00 轮观察项②「zj 工具描述示例」——zj 工具描述面此前从未系统审计；线 A 范围明文含「zj 工具层描述与可发现性」。
- 调研：**Anthropic《Writing effective tools for agents》**（anthropic.com/engineering/writing-tools-for-agents，2025-09-11，CDP 9224 全文 23KB 实抓）——「Prompt-engineering your tool descriptions… can collectively **steer agents toward effective tool-calling behaviors**」（小改即可显著改善）；「**encourage agents to pursue more token-efficient strategies**, like making many small and targeted searches instead of a single, broad search」（截断/描述引导省 token=业界明示范式）；「avoid ambiguity by clearly describing… expected inputs and outputs」。
- 落地：`src/plugins/zj-core.ts` 2 处描述修正（zj_read_doc：删「读文件末尾可传 offset=全文长度-目标长度」诱导句，改「按返回提示 offset 续读，勿为一次读全调大 maxChars——整篇塞进上下文白耗 token 且拖慢响应」；maxChars 参数补「仅确需整篇时才调大」；zj_search：补「子串匹配、按目录顺序取前 N 文件、每文件至多 3 行、无相关性排序」）；`tests/unit/zjToolDesc.test.ts` 守卫 2 例；`scripts/build-plugins.mjs` 重跑（关键：dsh 侧加载构建产物，只改 src 不重建=描述不生效）；新长效探针 `scripts/zj-tooldesc-live.mjs`。
- 实证：真 vLLM 中立提示词（不暗示可调大 maxChars）——模型轨迹=zj_read_doc 默认参数 + zj_search「金色」定向 → 尾部事实全命中零编造；**「大读 maxChars>7000」=false，与 00:00 轮「maxChars=80000 一次读全」对比大读行为消除**。三道门全绿（855 例 84 文件）。
- 交接：观察项封闭；改描述/换模型后复跑 zj-tooldesc-live；描述修正仅影响 dsh 侧插件产物（主进程无描述副本）。候选顺位不变（1 真机核对锁屏顺延 → 2 zj 工具描述补大纲示例预防性 → 3 embedding 触发制 → 4 前文衰减摘要不立项）。


### 2026-09-18 00:00–00:3x（观察项「director-check 正文窗口独立口径」落定：头部窗口改引 contextCaps 权威源）

- 背景：2026-09-17 15:00/18:00 两轮登记「director-check clip(8000,1500) 未随正文预算对齐」——正文预算 8000→12000 后唯一未对齐的正文读入面（续写装配 context.ts 与兑现检查 director-check.ts 同读一份正文，后者却只看首+尾 9500 窗口）。
- 调研（三源，URL 见智能层档案 00:00 轮）：Medium《Chapter Design》EIEPR 五拍中 **Pivot 转折点居场景/章中段**（"everything before it is preparation and everything after it is consequence"，Prolong 亦集中于 Pivot）；tmpublisher「**If that peak occurs in the middle of the chapter**」（编辑语境：章节张力峰可在中段，且影响改稿决策）；littleseabear 每章=mini episode、climax 位置因章而异。→ 兑现检查=对照导演板（含波峰定位）的**全覆盖核对**，首+尾窗口对中段波峰/钩子=核对盲区，可能误判 missed/open 误导改稿。
- 落地：`director-check.ts` 正文头部窗口 `clip(body, 8000, 1500)` → `clip(body, WCTX_CAPS.chapter, 1500)`（单一权威源，改预算自动跟随；尾 1500=检查器专用尾部窗口保留，注释说明）；单测 +1（10336 字符正文含旧窗口盲区中段句 → 材料全量不裁，防再次硬编码漂移）。三道门全绿（853 例 83 文件）；构造独立性经 /tmp 脚本实证（旧漏/新全量）。
- 交接：**正文读入预算在续写装配与兑现检查两处同源（WCTX_CAPS.chapter）**；该观察项关闭。导演板窗口 2000+1000 与审计 reduced 装配口径保留（设计使然）。

### 2026-09-17 21:00–21:5x（候选 3「embedding 增强召回」评估收口：可行性成立/触发制低优先；探针入仓）

- 执行：评估轮（不实现）——本机事实核查（ollama nomic 已有但原生 ctx 2048/768 维；bge-m3 官方页 567M/1.2GB/8K/100+ 语言；vLLM 宿主无 embedding 模型实锤 `/v1/models`+`/v1/embeddings` 404；远端 API 违反 App 零网络依赖）+ 业界（Qdrant hybrid-search 文章：词义 dense 胜/精确术语 sparse 胜/hybrid 双成本；BEIR：BM25 鲁棒基线、rerank 平均最佳但计算成本高）+ **零代码实证**（新探针 `scripts/context-semantic-probe.mjs`：合成 20 篇意象标题素材+10 查询，基线=复刻 searchDocs）。
- 实证结果：关键词 4/10（**同义/变体 6/10 全 MISS**——「遗物→祖父的怀表」类漏检真实）；nomic-embed-text 5/10 且乱序（top 高频无关项=中文不可用级）；**bge-m3 10/10**（`ollama pull bge-m3` 1.2GB 约 15min 拉取成功；3 query 94ms、100 段 1335ms≈13ms/段；1024 维 float32 千段≈4MB）。
- 结论：embedding 增强召回=**作者侧素材搜索的可行解（bge-m3），但当前排期低优先**（织卷素材真实量个位数、主人实际素材=17 个主题分类 CSV 库名即主题词、标签/分类体系已覆盖主场景）；触发制=素材 ≥50 篇或主人反馈搜不到（P1 升格）。agent 侧不需要（2026-09-17 09:00/12:00 探针已证 LLM 工具链通）。
- 交接：探针入仓可复用（实现/换模型后复跑对照）；bge-m3 本机就绪。候选顺位：2（zj 工具描述补大纲示例，预防性）→ 4（前文衰减摘要，候选保留）→ 触发制 3（embedding 实现）。

### 2026-09-17 18:00–18:1x（候选 1「预算改动后长效探针复测」收口：两探针全过零漂移）

- 执行：预算改动（chapter 8000→12000、WCTX_MAX 36700→40700）后按 00:00 轮先例串行跑 `context-full-live` + `mixform-toagent-live`（python3 runner 1200s 超时/条，日志 /tmp/zj-probe-runner.log）：**context-full-live PASS（26s）**——数据层八块齐备+真模型一轮 runChat 零工具读盘答出全部独家事实（正文窗口变大后模型仍零现读）；**mixform-toagent-live PASS 6/6（285s）**——场景 B「无意乱换应统一」正文出统一修改卡 3 处、focus 预算下无驱动超时错误、final 收尾，场景 A 同轮 6 判据全过 → **注入链零漂移实证**。
- 调研背景：prompt/上下文模板改动=「不可见爆炸半径」（futureagi.com/blog/prompt-regression-testing-2026/、kunalganglani.com/blog/prompt-injection-regression-testing-ci、github.com/BertBR/gauntlet、tkgo1599-max/prompt-regression-gate 四源，详细见智能层档案 18:00 轮）→ 预算/装配改动后复测=业界基线，**已固化为固定后置动作**（观察项）。
- 交接：无源码改动（仅档案落档）。观察项沿用：① 结论单模型单样本（vLLM deepseek-v4-flash），换模型后应再复跑两探针；② 预算/装配块改动后复跑两探针=固定后置动作。候选顺位：2（zj 工具描述补大纲示例，预防性）→ 3（embedding 评估）→ 4（前文衰减摘要，评估已判非必需）。

### 2026-09-17 15:00–15:4x（候选 1「装配块口径复核」收口：正文预算 8000→12000；提交见智能层档案）

- 调研（真实上网，来源记档）：① **Reedsy《How Long Should a Chapter Be?》（2026 更新版，blog.reedsy.com/how-long-should-a-chapter-be/，CDP 9224 实抓全文 10KB）**——成人小说章节通例 2,000–4,000 words、全书平均 2,000–5,000 words，但「因类型/作者风格/故事需要变化」（fantasy 更长、thriller 更短；Vonnegut/Dan Brown 短、Tolkien 长）——章节长度=作者风格变量，工具预算应贴合使用者的实际分布而非行业平均；② 既有资产复核（Novelcrafter prompt-functions 文档 /tmp 已有原文）：`chapter.fullText`/`scene.fullText`=当前章/场景全量注入是业界能力基线（作者可控），与织卷「当前章为创作半径核心」同向；③ **真实项目数据**（主人已完都市短篇合集 19 章正文，仅统计长度未取内容）：去约定头后字符 6851–10941（中位 8548/平均 8590/最大 10941）；字数（countWords 口径）6004–9295（中位 7128）；人物设定 27 份 739–3833 字符（无一超 4000）；世界观文件 1 份 5206（切片预算参考缺失，见观察项）。
- 产品规划：为什么现在做——原正文预算 8000：真实章长中位 8548 → **68%（13/19）章每轮对话触发「正文已超 8000 预算：装配结尾、前文 N 字符已省略」**——续写模型看不到章首（伏笔/铺垫常落开头），且每轮引入裁剪噪音；预设 8000 非依据数据而是早期定值（docs/模型适配-2026-09.md 无依据说明）。模型侧 1M 上下文（ROADMAP），预算纪律的真实作用=信号密度（别把无关设定塞进来）而非窗口容量——正文是创作核心信号（「正文为源」），应优先保证全量。怎么做——只调 `shared/contextCaps.ts` 的 chapter 8000→12000（单一权威源，context.ts/AgentPanel 自动跟随）；>12000 仍走既有「保尾+注明省略+zj_read_doc 现读」兜底（超长不失控）。**不动**：prevTail 3000（12:00 轮已证 50 章+ 检索增强链通）、人物 4000（真实档 max 3833 无一超）、切片/章卡/导演板/素材预算、截断策略语义（正文保尾/其余保头）、结构、引擎协议、director-check clip(8000,1500)（导演兑现检查专用「头+尾窗口」口径，语义不同，登记观察项）。验收口径：三道门 + contextCaps/context 单测锚点同步 + usage-line UI 冒烟（用量行随 WCTX_MAX 自动显示 4.1 万）+ 截图。
- 技术落地（7 文件）：`shared/contextCaps.ts`（chapter 12000+注记数据依据）· `tests/unit/contextCaps.test.ts`（锚点 12000/WCTX_MAX=40700）· `tests/unit/context.test.ts`（预算断言弃字面量改 `WCTX_CAPS.chapter` 动态，防再漂移）· `context.ts` 头注释同步 · `docs/模型适配接入层与创作上下文-2026-09.md`/`docs/ROADMAP.md`（权威源口径 12000、用量行 4.1 万）· `scripts/usage-line-ui-smoke.mjs` 注释同步。
- 测试验收：三道门全绿（typecheck / build / **845 例 83 文件**，无新增用例——断言动态化不改用例数）；无头 UI 冒烟 usage-line-ui-smoke **全过**（用量行实测「对话 0 字 · 装配 ≤4.1 万字」→ 输入 12 字随增长 → 无「/6万」分母）；回归 context-budget-smoke 全过（章卡/导演板/总纲预算零回归）。截图 `~/Pictures/zhijuan/contextcap-usage-1532.png`（demo-aseya 选章后 AgentPanel 左下用量行）。**坑实记**：/tmp 无 ws 模块/node 内置 WebSocket 用 onmessage 属性式+直接 send('Runtime.evaluate') 返回 m.result 才跑通（事件式 addEventListener 版本静默挂起）；Bing/MasterClass 均被反爬，章节长度方法论改采 Reedsy（CDP 直抓成功）。
- 交接：候选 1 收口——正文预算对齐真实使用分布（12000 覆盖 100% 现存样本+余量），人物预算经数据证实合理。观察项：① **director-check clip(8000,1500) 独立口径**未对齐（导演兑现检查=头 8000+尾 1500 窗口，非续写语义，若验收发现问题再对齐）；② 切片 4000 无真实数据（世界观总纲单样本 5206 略超，主人未用织卷切片结构），待真实项目数据出现再复核；③ 预算数据源=主人「都市短篇合集」（非织卷内项目），织卷真实使用数据出现后应再核；④ 后续改预算只改 contextCaps.ts（测试/文档已动态化或锚点化）。

### 2026-09-17 12:00–12:3x（候选 1 评估收口；提交 5ac8c49，详见智能层档案 12:00 轮）

- 调研（Novelcrafter 官方，CDP 9224 实抓）：`storySoFar`=「summaries up to the current position」（摘要链非全文）；`takeLast(chapter.summary(storySoFar),3)`=只取最近 3 章摘要——业界前文衰减范式；「Summarize Scene」AI 生成摘要；FAQ 自认摘要会过时/需手动更新。
- 评估探针 `scripts/context-fading-probe.mjs`（60 章临时项目，独家事实只在第 08 章正文；第 60 章正文含「老槐树」线索引子）：数据层 FADING DATA OK；真模型（vLLM deepseek-v4-flash）两问全中零编造，轨迹=zj_workspace→zj_search「红丝带」→zj_read_doc 第08章→zj_search×2，用时 156.8s、zj 工具 6 次（8min 预算内）。
- 结论：50 章+ 场景「线索驱动承接」检索增强链通，**前文衰减摘要当前非必需**（摘要资产有漂移/生成成本，zj_search 以正文为准；无线索全景=审计域冷读职责）。
- 三道门全绿（842 例 83 文件）；观察项：结论基于单模型单样本，换模型/大项目先复跑探针。
