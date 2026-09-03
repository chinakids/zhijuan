# dsh-runtime —— 织卷内置 agent 边车运行时

织卷的创作 agent 基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）的
SDK 边车：`@deepseek-ai/dsh` 以 `--profile sdk` 作为独立子进程由 Electron 主进程拉起，
`@deepseek-ai/dsh-sdk-client` 在主进程驱动它，织卷的写作工具以 cordis 插件形式挂载。

## 结构

- `node_modules/` —— 独立依赖树（有单独 lockfile，**不**进主库 node_modules；gitignore）
- `dshhome/` —— `$DSH_HOME`：sessions（会话历史）+ profiles/sdk（镜像 cordis 树）
- `dshhome/profiles/sdk/cordis.patch.yml` —— 静态基础层（默认 LLM 端点 + jsonrpc 边车 + zj-core 插件）
- `run/` ——（gitignore）运行时生成：按当前设置的 LLM 端点覆写 → `llm.override.patch.yml`、日志
- `plugins/` → 织卷正式写作工具（构建后用 `node_modules/zj-core/` 挂载，见下）

## 重建依赖树

```bash
cd dsh-runtime && bash install.sh
```

坑（已趟平，详见 commit 历史的 SPIKE-RESULT）：必须 `--legacy-peer-deps`；装完要循环补装同 scope
漏装依赖；darwin 要剔除 `node-addon-landlock-run-linux-*`；koffi/node-pty/protobufjs 的 native
install 脚本要先 `npm approve-scripts`。超时挂起时用 `env -i` 干净环境从 npmmirror 装。

## 织卷写作工具（zj-core）

源码：`src/plugins/zj-core.ts`（自包含、只用 node 内置模块，契约=官方 adding-a-tool 形状）。
构建：`node scripts/build-plugins.mjs` → 打成自包含 mjs 放进 `node_modules/zj-core/`（按包名挂载）。
工具：`zj_workspace`（作品结构）、`zj_list_docs`（列目录）、`zj_read_doc`（读文档，front matter 合规）、
`zj_search`（全文搜索）。全部只读；写入走应用侧提案制。

## 引擎须知

- 引擎是 developer preview，**版本锁在 package.json/package-lock.json**，别随手升。
- 所有创作数据仍在磁盘，引擎可随时拔（老引擎开关见设置 agentEngine）。
- SDK 无线级取消：「停止」是 UI 停止显示，边上继续把一轮跑完再入会话历史。
