<div align="center">

# 织卷 · ZHĪJUǍN

### 让设定跟着正文一起生长的 AI 创作工作台

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS-black.svg)]()
[![Electron](https://img.shields.io/badge/Electron-31-47848F.svg)]()
[![React](https://img.shields.io/badge/React-18-61DAFB.svg)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6.svg)]()
[![Tests](https://img.shields.io/badge/unit%20tests-1159-brightgreen.svg)]()
[![UI smokes](https://img.shields.io/badge/UI%20smokes-100%2B-orange.svg)]()
[![Local-first](https://img.shields.io/badge/local--first-Markdown%20plaintext-9cf.svg)]()

*正文是唯一的源头，设定是随之涌动的流。*

</div>

---

## 织卷是什么

织卷是一款 **纯本地优先** 的 AI 辅助小说创作工作台，为写长篇的作者而设计：人物、世界观、素材在长文后期最容易「啃书」失忆，织卷把「关键要素的设定与召回」与「让 AI 生成的故事不再平淡」做成两条引擎，并让 **人与 agent 的每一步协作都有确认护栏**。

织卷不在你和一个聪明的模型之间塞进黑盒——它把你和它的每一次协同都变成**可追溯、可回滚、可迁移**的资产：

- 正文是唯一源头，设定随写作自动演进（**正文为源、设定为流**）；
- agent 对设定的任何修改都走**提案制**，你确认才写入；
- agent 对正文的任何改动都出**修改卡**，采纳才落笔；
- 数据全部明文 Markdown，可入 git，作品永不锁死在工具里。

无账号、无云同步、无遥测；模型可接本地 vLLM 或任意 OpenAI 兼容端点，也可切换云端厂商。

## 截图

| 项目库 | 正文创作（含 Agent 协作区） |
|---|---|
| ![home](docs/screenshots/home.png) | ![novel](docs/screenshots/novel.png) |

| 大纲区（章卡 / 导演板） | 素材库 |
|---|---|
| ![outline](docs/screenshots/outline.png) | ![library](docs/screenshots/library.png) |

| 人物设定 | ⌘K 全局命令面板 |
|---|---|
| ![characters](docs/screenshots/characters.png) | ![command-palette](docs/screenshots/command-palette.png) |

## 核心优势

### 时间切片设定推进 —— 写 50 章不失忆
一章一切片：正文约定头（front matter）声明 `切片` 与 `涉及人物`，保存即触发切片同步，自动把本章事件与状态演进到对应的人物与世界观文档。先设定后成文（导演板 / 素材库供料）与先文沉淀设定（保存自动出提案）走同一条提案链，双向闭环。支持**多时间线叙事**：章节声明所属线、人物与世界状态按线分叉、「到本章为止」按线内序推理，插叙 / 双线并行不再把设定搅乱。

### 提案制 —— 人对 agent 的护栏
agent 对设定的任何修改都是提案：before 锚点定位 + 过期标记，接受才写入；提案库 `.zhijuan/proposals/` 明文可审计；**切片同步空写有磁盘真身校验与两步确认**，版本恢复有拦截防线——数据安全优先级第一。

### 装配式上下文 —— 只给模型它该知道的
主进程按「当前章 + 同线前章尾 + 涉及人物 + 当下切片 + 章卡 + 导演板 + 素材索引」装配上下文，预算硬控、超限保尾保头并注明可 `zj_read_doc` 现读；长文不用「整包硬塞」，信号不被噪音淹没。

### 创作检查阵容 —— 秒级常驻体检 + 全卷巡读
- 机械层（零 token、秒级、状态栏常驻）：人物在场核查、称谓一致性、切片时序、档案腐坏、正文缺段、保存前置名单快检；
- 模型层（全卷生成型）：一致性巡查、冷读报告、多视角审视，结论落档 `大纲/审读_*.md`；
- 章节导演：动笔前导出导演板——情绪弧分段、每段戏剧任务、波峰定位、人物行为轴、写作红线与钩子。

### 批注闭环
划词批注（意图 + 定位 + 原文），批注扫描自动生成修改提案；侧标 / 气泡 / 导航抽屉全键盘可达，接受后自动清行。

### 写作体验
Milkdown/ProseMirror 编辑器按 Apple 排版规范；⌘K 全局命令面板；暖纸 / 深色两档主题；窄窗口章节列自动折叠；本地版本历史（`.zhijuan/history/`）；正文中文引号自动成对；编辑器状态条实时字数。

## 技术说明

### 架构四层红线

| 层 | 职责 | 约束 |
|---|---|---|
| `src/shared` | 纯约定：类型 / front matter / 路径 / provider 适配表 | 无 fs、无 IO，可单测 |
| `src/main` | 域逻辑与文件操作（含 `agent/` 引擎驱动、审计、大纲、档案、写盘审计） | 数据操作只在此层 |
| `src/preload` | 薄桥 | 只转发 IPC |
| `src/renderer` | 页面与交互（editor / agent / outlines / proposals / annotations…） | 不碰文件系统 |

另有 `src/plugins/`（写作引擎域插件）与 `dsh-runtime/`（vendored 引擎）。

### 写作引擎（DeepSeek Harness 边车）
dsh 作为独立子进程由 Electron 主进程拉起，织卷自身只做宿主；织卷域能力以 cordis 插件（`src/plugins/zj-core.ts`）注入（读章节 / 列设定 / 全文搜 / 生成提案 / 改正文）。`EnginePort` 适配层保证换 agent 框架 = 换一个实现，不动调用方。

### 模型接入
本地 vLLM 默认，另支持 DeepSeek / 智谱 / OpenAI / Claude / Gemini 各家远程 API；设置页选服务商 + 填 key 即切，写作引擎按新厂商热重启。

### 质量体系
- **vitest 单元测试 1159 例**，覆盖 shared 纯函数、主进程域逻辑、渲染层 store；
- **100+ 无头 UI 冒烟脚本**（`scripts/*-ui-smoke.mjs`，本地 Chrome CDP 9224 + devShim），覆盖编辑器、Agent、审计、批注、命令面板、窄窗、主题、多时间线等关键路径；
- 三道门常绿：`npm run typecheck && npm run build && npm test`。

### 技术栈
Electron · electron-vite · React 18 · TypeScript · Tailwind v4 · shadcn/ui · Milkdown (ProseMirror) · zustand · vitest · DeepSeek Harness（vendored）

## 快速开始

```bash
# 依赖（npm 镜像见 .npmrc，可按需覆盖）
npm install

# vendored 写作引擎（约 300MB，包含运行时与本地模型支持）
bash dsh-runtime/install.sh

# 开发（Electron + Vite HMR）
npm run dev

# 生产构建 / 预览
npm run build
npm run start

# 测试与检查
npm run typecheck
npm test                 # vitest 单元测试（1159 用例）
node scripts/serve-renderer.mjs &   # 无头渲染服务
node scripts/xxx-ui-smoke.mjs       # 无头 UI 冒烟（需本机 Chrome CDP 9224）
```

- **macOS 打包**：`electron-builder` 已配置（`electron-builder.yml`），`release/` 产出 app/dmg（含引擎运行时）。
- **Windows**：兼容清单已走查，打包按需启用。

## 目录结构

```
src/            四层源码（shared / main / preload / renderer）
src/plugins/    写作引擎域插件（zj-core）
dsh-runtime/    vendored 写作引擎（install.sh 安装，不入库）
docs/           公开设计文档 + docs/screenshots/
scripts/        冒烟脚本与工具（serve-renderer、各 UI smoke）
tests/          单元测试（vitest）
legacy-v1/      V1 原型归档（仅参考）
```

## 主要文档

- [架构设计-V2](docs/架构设计-V2.md)
- [模块设计-V2](docs/模块设计-V2.md)
- [快捷键](docs/快捷键.md)
- [正文写入与切片同步-口径](docs/正文写入与切片同步-口径.md)
- [按钮与状态显示-规范](docs/按钮与状态显示-规范.md)
- [系统菜单-设计口径](docs/系统菜单-设计口径.md)
- [动效分层](docs/动效分层.md)

## License

[MIT](LICENSE) © kk
