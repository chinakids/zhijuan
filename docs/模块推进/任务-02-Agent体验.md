# 任务线 · Agent 体验（2026-09-17 主人拍板独立推进）

> 主人（2026-09-17，F-20260916-06）：整个 Agent 区域的功能体验很重要，**上下文管理**与 **Agent 体验**拆成两个任务分别推进。
> 本文档＝**Agent 体验**专项线的任务档案（现状 / 候选 / 验收口径 / 迭代记录）。实现主责＝体验层轮次（渲染层 AgentPanel 与相关 UI）；涉及上下文/引擎逻辑归上下文管理线。
> 关系：上下文管理线＝`任务-01-Agent上下文管理.md`；两线候选互不混排。

## 一、范围（本线管什么）

- Agent 面板（`features/agent/AgentPanel.tsx`）：消息流、流式渲染、工具调用链卡片、TodoCard、错误气泡、取消/重试、输入区（快捷指令 chips、@ 引用、/ 命令槽位、引用注入预算提示）、划词引用悬浮层联动；
- 审阅/检查入口布局：检查菜单（现仅一致性/冷读/多视角 3 项）、规则体检状态栏（F-20260916-05）、AuditDrawer 联动；
- 批注联动（划词工具条「批注」入口、amon 气泡/导航抽屉/侧标）、历史抽屉、EditCard（IDE 式对比/采纳）；
- Agent 面板布局与响应（宽度拖拽、窄窗折叠保护）、可访问性（键盘/焦点/ARIA）。

## 二、不做（边界）

- 上下文装配/预算/zj 工具描述 → 任务-01；
- 引擎（dsh runtime）与模型适配层；
- 审计规则本身的新增（智能层常规轮次）。

## 三、现状盘点（2026-09-17）

- 已落地：流式生成与取消（含 dsh ABORTED 语义）、工具链连续同工具合并一行×N（默认折叠+展开逐步序号/续读/offset）、折叠组头带组内状态（失败/取消优先）+合计耗时（fa5d5e2）、工具卡 summary 截断（max-w 45%+title）、快捷指令 chips（续写/润色/延伸/巡查/导演 可编辑插入）、划词引用浮层（唯一引用入口，引用选中按钮已删）、EditCard 采纳并写入、AuditDrawer（转提案/让 agent 改/与上次对比）、批注全闭环、TodoCard 完成态（去删除线，Claude Code 范式）、错误气泡一键重试、Agent 面板宽拖拽、输入框引用提示条（节选+「引用自 来源」行+取消×，来源随 doc 相对路径经 quoteSrcOf 生成——2026-09-23 收口）、检查菜单收窄（本地规则→状态栏体检）。
- 冒烟：tool-chain-ui-smoke / tool-detail-ui-smoke / agent-cancel-ui-smoke / health-bar-ui-smoke / audit-archive / audit-diff / anno-* / float-edge / float-kbd 等。

## 四、候选（按优先级，下一轮开工先读本节）

1. **链内失败步「处置引导」走查** ~~（智能层档案候选 2 移入本线）~~ **✅ 收口（2026-09-17 14:15 轮，提交 823a9d1，详见 04-体验层.md 迭代日志）**：调研结论=Claude Code / Codex 均无单步工具重试（工具错误回灌模型自理；CC 内置 malformed 自动重试次数；Codex backtrack=消息级恢复旧 prompt）→ 织卷落地=失败工具卡（链组头/展开步/单卡）「让 agent 处理」按钮（`zj-tool-fail-guide`，仅工具报错态、取消不提供）→ `failureFollowupPrompt` 预写指引填入输入框（可编辑不代发）；单测 3 例 + fail-guide-ui-smoke 8/8 + 回归双绿 + 845 例绿 + 截图 `fail-guide-1447.png`。
2. **解锁后真机核对**（锁屏顺延项汇集）：ⓐ 工具执行期取消路径优先级（点停止时 dsh 合成失败结果 vs 渲染层已取消兜底孰先孰后）；ⓑ 长工具（导演/检查类）取消耗时真机视图；ⓒ 展开态链内失败步呈现（含本轮新「让 agent 处理」按钮）；ⓓ TodoCard 完成态新外观、R7 跨线重名提示真机视图；ⓔ 检查菜单缩减后真机走查（3 项）。
3. ~~失败步「一键重试」~~ **✅ 搁置（2026-09-17 14:15 轮）**：按候选 1 调研结论吸收——业界无单步工具重试（模型编排下无法重放后续步序），「让 agent 处理」引导（候选 1 落地形态）即等价替代；不再排期。
4. **Agent 面板体验体检**（HIG 视角续）**✅ 收口（2026-09-17 17:15 轮，提交 7ca96e3，详见 04-体验层.md 迭代日志）**：走查=空态引导（实缺口：文案断链「添加到对话」vs 浮层按钮「对话」+ @//命令零可发现性 → 重做为 4 条图标指引卡）+ 消息流排版（92% 上限/长代码横向滚动/长消息整条+外层滚动=HIG 达标）+ 工具卡密度（truncate+title/失败徽标+耗时/icon-only 合规达标）；agent-empty-ui-smoke 10/10 + engine-gate 3/3 + 845 例绿 + 截图两档。
5. ~~链 [失败→成功] 恢复后组头终态语义（观察项）~~ **✅ 收口（2026-09-17 23:15 轮，提交 a612ef5，详见 04-体验层.md 迭代日志）**：定案=聚合组头状态=链尾结果（GitHub Actions continue-on-error 同语义）——尾步失败才标「失败」+「让 agent 处理」；曾失败但尾步成功=「已恢复」中性徽标（绿勾终态+失败摘要保留，详情展开可见失败步完整结果）；chain-recover-ui-smoke 10/10 + fail-guide/tool-chain/tool-cancel 回归全绿 + 852 例绿 + 截图两档。**坑**：组头=head 首卡，「failed」必须以 agg 终态为准（aggFailed!==undefined ? aggFailed : 自身），否则失败首卡顶掉聚合语义。

## 五、迭代记录

（每轮落档：日期时间 / 四阶段 / 提交号 / 验证；格式沿用模块推进档案。）

- **2026-09-23 08:15–08:5x**：模块档案候选 1（划词引用反馈面）收口，提交 ac5f2ff——引用记录来源 QuoteRef{text,src}：Prose 划词/右键「添加到对话」detail 带 quoteSrc（DocEditor 由 rel 经 quoteSrcOf 生成「类别·名称」；zj:quote-text 兼容旧 string 通道）+ store 未分桶引用并入首项目桶（修人物/素材页划词后回正文引用丢失）+ AgentPanel 提示条来源行「引用自 类别·名称」+发送文案以 quote.src 为准（修切章/跨文档划词来源标错，探针实锤两场景）；quoteSrcOf 单测 6、agentStore +2、quote-src-ui-smoke 13/13、回归 float-kbd 23/23/context-menu-ui/anno-pop/error-retry-bucket/agent-project-bucket/agent-empty 全绿、1155 例三道门绿 + 截图 quote-tip-0845.png。详见 04-体验层.md 迭代日志。
- **2026-09-23 05:15–05:4x**：模块档案候选 1（错误重试跨项目语义）收口，提交 c3fb655——重试/排队续发按「原消息归属项目」发送（store `messageProject(id)` 归属查询 + `send` opts.project hint，桶读写统一按 hint）；顺带实修 doSend 生成中 Enter 静默丢弃（F-20260917-12 只修 send 内层，用户路径从未生效）；agentStore 单测 +3 / error-retry-bucket-ui-smoke 19/19 / error-notice·agent-project-bucket·agent-empty 回归全绿 / 1140 例三道门绿 + 截图 2 张。详见 04-体验层.md 迭代日志。
- **2026-09-22 20:15–20:5x**：模块档案候选 3（AgentPanel 对话跨项目保留）收口，提交 78edf4f——按项目分桶（VS Code Copilot per-workspace session 基线）：store byProject/setProject/按 id 路由；useSender asstId 固化+bucketOfSend；agentStore 单测 7 例 + agent-project-bucket-ui-smoke 14/14。详见 04-体验层.md 迭代日志。
- **2026-09-17 23:15–23:4x**：候选 5（链 [失败→成功] 恢复后组头终态语义）收口，提交 a612ef5——调研（GitHub Actions continue-on-error 官方语义=step 失败允许 job 通过时 run 摘要显示成功；HIG Progress indicators=状态指示瞬态/当前态）+ 落地（summarizeGroup 终态字段 endedFailed/recovered；组头 failed 以 agg 终态为准；「已恢复」中性徽标 zj-chain-recovered 仅尾步失败才红+「让 agent 处理」；失败摘要保留中性色；devShim「链恢复」种子）+ 验证（toolChain 单测 23 例 / chain-recover-ui-smoke 10/10 / 回归 fail-guide 9/9·tool-chain 15/15·tool-cancel 15/15 / 852 例绿）+ 截图 chain-recover-2337a/b.png。
- **2026-09-17 17:15–17:5x**：候选 4（Agent 面板体验体检）收口，提交 7ca96e3——走查=空态引导（实缺口）：文案断链（划词浮层按钮「对话」vs 空态「添加到对话」，Prose L1253 实证）+ @ 引用//命令零可发现性 → 空态重做为 4 条图标指引卡（11px 同级权重+truncate）+ agent-empty-ui-smoke 10/10 + engine-gate 断言同步 3/3 + 845 例绿 + 截图 agent-empty(-dark)-1734.png；消息流排版与工具卡密度走查**达标不改**（证据见 04-体验层.md 迭代日志）；候选 5 观察项（链恢复终态）转入 04-体验层.md「五」候选 2。
- **2026-09-17 14:15–14:5x**：候选 1（链内失败步处置引导）收口，提交 823a9d1——调研（Codex backtrack 源码 / Claude Code issues 一手）+ 落地（失败卡「让 agent 处理」按钮→预写指引入输入框不代发）+ 验证（failureFollowupPrompt 3 例单测 / fail-guide-ui-smoke 8/8 / tool-chain 15/15 / tool-cancel 15/15 / 845 例绿）+ 截图 fail-guide-1447.png；候选 3 按结论搁置；**观察项**：链 [失败→成功] 恢复后组头「失败」徽标缺终态语境（留候选 5 观察）。
