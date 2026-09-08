# 织卷 · AI 辅助小说创作工作台

把「世界观 + 人物设定 + 章节情绪曲线/人物曲线」结构化，作为输入交给本地 LLM <!-- ann:msswpmxo -->生成<!-- /ann:msswpmxo -->章节<!-- ann:mssxa14k -->正文<!-- /ann:mssxa14k -->的 Electron 桌面应用。

## 快速开始

```bash
npm install
npm run dev       # 启动开发模式（热更新）
npm run build    # 编译产物到 out/
```

## 目录结构

```
src/
  main/          # Electron 主<!-- ann:mssxgq8e -->进程<!-- /ann:mssxgq8e -->：窗口、本地存储、生成引擎（IPC）
    store.ts     #   <!-- ann:msswqrlh --><!-- ann:mssx8ad9 --><!-- ann:mssxgxph -->项目<!-- /ann:mssxgxph --><!-- /ann:mssx8ad9 --><!-- /ann:msswqrlh -->库读写（文档/织卷项目库，每个项目一个 JSON）
    generator.ts #   生成引擎：曲线采样 → 拼 prompt → 调 OpenAI 兼容 API
    index.ts     #   应用入口
  preload/       # contextBridge 桥（window.zhijuan.*）
  shared/        # 共享数据模型（types）
  renderer/      # React 界面（世界观 / 人物 / 章节 三视图）
    src/components/
      WorldviewView.tsx    # 世界观编辑
      <!-- ann:msswqjtn -->CharactersView.tsx<!-- /ann:msswqjtn -->   # 人物档案（自由字段）
      ChaptersView.tsx     # 章节工作台（要素 + 曲线 + 生成）
      CurveEditor.tsx      # SVG 双曲线编辑器（可拖拽）
```

## 数据模型（src/shared/types.ts）

- `Project`：一个小说作品（世界观 + 人物 + 章节）
- `Worldview`：舞台、时代、主题、规则、背景
- `Character`：人物档案（自由字段，可填九项身体档案）
- `Chapter`：章节（要素 / 梗概 / 曲线集合 / 情节点 / 正文）
- `SeriesCurve`：情绪曲线或人物曲线（一条线上的控制点序列）
- `PlotBeat`：情节点（标注在曲线进度位置上的关键事件）

## 生成管线

编辑每条曲线 → 保存后由 `generator.ts` 把曲线按 0-100 进度分段采样成「强度走向」描述、情节点标注在对应位置，连同世界观、人物档案、本章要素一起拼进 prompt，发给局域网 **OpenAI 兼容**端点（默认 `127.0.0.1:8888`，`deepseek-v4-flash-vision-exp-uncensored`；2026-09 vLLM 重启换名，旧 id 0731 已 404/空返）。

**曲线如何真正影响生成**：曲线不是装饰——它被离散化成每一段落的强度值和趋势方向（骤升/缓升/平缓/猛跌），AI 被要求按这些走势推进剧情。

## 数据存放

所有项目保存在 `~/<!-- ann:mssx81xw -->Documents<!-- /ann:mssx81xw -->/织卷项目库/<项目id>/project.json`，一个项目一个目录，纯 JSON，可直接进 git。

## 已知限制

- LLM 配置（baseUrl / model / apiKey）目前写死在 `ChaptersView.tsx` 的 `doGenerate` 里，后续应抽到设置页。
