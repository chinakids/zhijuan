// 织卷冒烟「模型类名单」单源（平台层 2026-09-16 04:30 轮）
// ---------------------------------------------------------------------------
// 背景：真模型驱动的冒烟依赖算力池 vLLM（127.0.0.1）忙闲，非织卷代码红/绿判据——门禁（--all）
//       若包含它们会因模型侧波动恒红（基线 2026-09-15 13:30 实锤：acts/engine-sync 全量 300s 被杀=误杀）。
// 处置=显式名单声明身份（Playwright @slow/tag 语义：测试自己声明而非路径猜测），smoke-ui.mjs 按名单
//       SKIP（--live/单独指名才跑）。对应 pytest --strict-markers 的登记制（未登记 mark 报错）——
//       但启发式无法 100% 判定，故审计脚本只提示不硬卡（最终判定仍需人工核对调用面）。
// 维护契约：
//   · 新增真模型驱动冒烟 → 必须把它加进 MODEL_SCRIPTS（否则 --all 会把它跑进门禁=恒红误杀）；
//   · 人工核对过「特征命中但确非模型类」的脚本 → 加进 REVIEWED_NON_MODEL（带理由），否则审计每轮误报；
//   · 改本文件后跑 `node scripts/smoke-model-audit.mjs`（健康基线）与 `--selfcheck`（判据自检）。
// 观察项 ㉔ 机械化：scripts/smoke-model-audit.mjs 静态扫 scripts/ 与名单求差，漏网自动现形。

// 模型类冒烟显式名单（2026-09-15 16:30 收口 12 个，判定依据逐条核对过调用面——共同特征=走真实边车/
// 真模型（runChat/runSync/runSubtask/runDirector/runActs/引擎聊天 或 zj-bridge 桥注入），与 8810 可选
// 环境无关——即使桥起着，--all 门禁也不应包含（依赖算力池忙闲，非代码判据）。
// 判据核对备注：sync-produce-loop-smoke 注释自证「无模型调用」故不在名单；context-cast/context-char-tail
// 无 LLM_KEY 字面量但注释明示「真模型 runChat 走查」（走默认 local 配置）；engine-sync 无字面量但基线
// 13:30 实锤真模型（runSync 出真实提案）。
export const MODEL_SCRIPTS = new Set([
  'acts-smoke.mjs',
  'agent-cancel-live-smoke.mjs',
  'agent-cancel-live-ui-smoke.mjs',
  'context-cast-smoke.mjs',
  'context-char-tail-smoke.mjs',
  'context-realmodel-smoke.mjs',
  'director-check-smoke.mjs',
  'director-smoke.mjs',
  'engine-smoke.mjs',
  'engine-sync-smoke.mjs',
  'subtasks-smoke.mjs',
  'zj-edit-smoke.mjs',
])

// 审计特征（smoke-model-audit.mjs 用；smoke-ui.mjs 不用特征只按名单）：
//   强特征=几乎必然真模型驱动（出现即可高置信提示）；
//   弱特征=常见于真模型脚本但也会出现在无模型的数据层/UI 冒烟（runSync/runChat 是页面/数据函数名，
//           未必走引擎；「真模型」可能是注释描述产物来源）——命中仅提示人工核对，不自动判定。
export const STRONG_MARKERS = ['LOCAL_LLM_KEY', '127.0.0.1', 'vLLM', 'zj-bridge', 'runDirector', 'runActs', 'runSubtask', 'dsh-runtime']
export const WEAK_MARKERS = ['runChat', 'runSync', '真模型', 'driveSession']

// 人工核对过=确非模型类（审计不再提示；理由=核对依据）。2026-09-16 04:30 第一轮审计逐条核对：
//   guard-issues-3entry-ui-smoke：无头 UI 冒烟（devShim），runSync 是页面调用（注释「恢复后 runSync → zj-guard 注入」）；
//   sync-anchor-smoke：数据层「无 GUI / 无模型」（锚点归一化纯文件逻辑）；
//   sync-guard-smoke：数据层「无 GUI / 无模型调用」（guard 纯函数防线）；
//   sync-produce-loop-smoke：「无 GUI / 无模型调用」（注释里「真模型」是描述 engine-sync 产物来源）；
//   project-ctx-smoke：「真读盘，不依赖模型」（runChat 只是注入块函数名）；
//   sync-log-ui-smoke：无头 UI 冒烟（devShim），agentSync 是页面 mock 调用（runSync 只出现在注释/口径说明，无引擎/边车/模型）。
export const REVIEWED_NON_MODEL = new Set([
  'guard-issues-3entry-ui-smoke.mjs',
  'sync-anchor-smoke.mjs',
  'sync-guard-smoke.mjs',
  'sync-produce-loop-smoke.mjs',
  'project-ctx-smoke.mjs',
  'sync-log-ui-smoke.mjs',
  // 2026-09-17 01:30 平台层轮核对：smoke-userdata-check.mjs 是数据层 userData 契约静态审计（CLI 元工具，
  // 无引擎/边车/模型调用）；强特征 zj-bridge 与弱特征「真模型」均来自其头注背景描述（mention zj-bridge.mjs
  // 白名单依据与「真模型冒烟假绿」动机说明），非实际调用——头注措辞若收缩弱特征可再评估。
  'smoke-userdata-check.mjs',
  // 2026-09-17 13:30 平台层轮核对：multiline-outline-director-smoke.mjs 是数据层冒烟（bundle 主进程
  // outline.ts/director.ts 真实现 + scripts/drive-mock-outline.mjs 驱动 mock，头注明示「驱动 mock（不依赖模型）」）；
  // 强特征 runDirector 命中的是 esbuild stdin 的 export 行（L29），非引擎/边车/模型调用——第九次全量审计实抓。
  'multiline-outline-director-smoke.mjs',
  // 2026-09-19 19:3x 平台层轮核对：bodylen-smoke.mjs 是数据层冒烟（bundle engine.ts 真代码路径，
  // 仅 stub 掉模型会话——头注 L1-3「driveSession 返回 '[]'=合法空」，/tmp/runtime-stub.mjs 无引擎/边车/模型调用）；
  // 弱特征 runSync/driveSession 命中的是 stdin export 行与 stub 导入行——P1 bodyLen 取证字段数据层验证（9f13550 配套）。
  'bodylen-smoke.mjs',
])

export const MODEL_SKIP_REASON = '模型类：真模型驱动（依赖 vLLM 算力池），--all 门禁不包含——--live 或单独跑'
