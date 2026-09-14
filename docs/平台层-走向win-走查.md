# 织卷 · 走向 Windows 兼容走查（2026-09-14 平台层轮）

> 背景：发布冲刺-2026-09-15.md「Windows 兼容清单｜平台层」——**Windows 包主人 2026-09-12 拍板推迟**（本机 wine / GitHub Actions 路径另议），但**清单照常走查**。
> 范围：窗口外壳 / 菜单快捷键 / 路径处理 / 引擎宿主 / shell 语义。策略：**mac 优先不动平台行为**；只修「跨平台一致性缺口」；win 专属打磨登记观察。
> 依据文件（Electron v31.7.7 官方源码+文档，经 api.github.com contents 抓取，与仓库 node_modules/electron 31.7.7 同版本）：
> `docs/api/structures/base-window-options.md`（titleBarStyle）、`docs/api/accelerator.md`（修饰键）、`docs/api/menu-item.md`（role 清单）、`docs/api/shell.md`、`shell/browser/browser_win.cc` / `browser_mac.mm` / `browser_linux.cc`（showAboutPanel 三平台实装）。

## 一、已兼容（无需动）

| 面 | 现状 | 依据 |
|---|---|---|
| 窗口标题栏 | `index.ts:19` titleBarStyle 仅 darwin 注入；win 走 `default` 原生标题栏；渲染层 `WindowChrome` 按 `window.zhijuan.platform !== 'darwin'` 隐藏（preload 暴露 platform，devShim 硬编码 darwin=演示口径）——**win 不会双标题栏** | base-window-options.md 86-89：`hiddenInset` 为 `_macOS_` 专属；`default`=macOS/Windows 标准标题栏 |
| 应用退出语义 | `index.ts:77-79` window-all-closed 非 darwin 即 quit | 平台标准 |
| 废纸篓/文件管理器 | `shell.trashItem`（store.deleteDoc/removeProject）、`shell.showItemInFolder`（reveal/说明文档）、`shell.openExternal`（外链） | shell.md 无平台标注=跨平台 |
| 「关于织卷…」 | `app.showAboutPanel` 在 win 有实现（browser_win.cc：从 exe FileVersionInfo 构建关于框），不会死按钮 | browser_win.cc `Browser::ShowAboutPanel` |
| 路径根 | settings：`app.getPath('documents'/'userData')` + `join`，纯跨平台 API | Node/Electron 标准 |
| 打包配置 | electron-builder.yml win nsis+portable 已配；extraResources dsh-runtime 作用于全部平台（runtime.ts `app.isPackaged→resourcesPath` 分支平台无关） | 配置审查 |

## 二、本轮已修（跨平台一致性缺口，非 win 专属打磨）

**根因**：主进程枚举/监听「相对项目根路径」时用了原生 `path.join`/`path.relative`——mac 上产出 `/`（与渲染层与 devShim 全部约定一致），**Windows 上产出 `\`**，而渲染层 5+ 处消费约定 `/`（`'目录/' + d.file`）、`useFsChanged` 前缀匹配 `/`；这是「真机 vs devShim 双实现口径」工程红线的实锤缺口（devShim 全用 `/`），不等 win 上线就会暴露。

修复（提交见档案迭代日志）：
1. 新 `src/shared/relpath.ts`：`posixRel(prefix, name)`＝`path.posix.join`（任何平台恒 `/`；shared 纯约定无 fs，单测锁定）。
2. `store.ts listDocs`（walk 递归 + rel 计算）→ posixRel；
3. `library.ts searchDocs`、`recentLibraryDocs`（同上）；
4. `store.ts watchProject`：`relative(...)` 结果 `.split(sep).join('/')`（FsEvent.path 随渲染层 `/` 契约）。

**不动**：`abs/readDoc/writeDoc/deleteDoc` 内部 `join`（输入 rel 用 `/` 后 join 天然正确）、`join(projectDir,...)` 全部 fs 路径、devShim、渲染层、菜单（见下）。

## 三、已核差异 → 登记观察（win 启用前处理；不在本轮动）

| # | 面 | 差异 | 建议（win 启用时） |
|---|---|---|---|
| W-1 | 菜单 accelerator | `menu.ts` 硬编码 `Cmd+Q/W/M/H`、`Shift+Cmd+Z/G`、`Ctrl+Cmd+F`——官方（accelerator.md 31-33）「On Linux and Windows, the Command key does not have any effect so use CommandOrControl」→ 这些键在 win 不触发 | **已解决（2026-09-14 16:30 平台层轮）**：buildMenuTemplate 平台分派，win 走 winTemplate——role 项不写 accelerator（Electron 按平台给默认：close=CmdOrCtrl+W、redo win=Ctrl+Y、togglefullscreen win=F11、quit win 无），自定义项 CmdOrCtrl 化；口径 docs/系统菜单-设计口径.md §win |
| W-2 | 菜单结构 | `services/hide/hideOthers/unhide/front/zoom` 为 **macOS-only role**（menu-item.md 97-119）；顶栏「织卷」应用菜单在 win 显示为普通窗口菜单 | **已解决（同轮）**：winTemplate 不含 mac-only role、无「织卷」顶级；设置→文件菜单、关于→帮助菜单（平台惯例） |
| W-3 | 引擎宿主探测 | `runtime.ts nodeBin()`：`which`（win 无）/`/usr/local`、`/opt/homebrew`、`~/.nvm`（unix 路径）→ win 必然全部失败回落 `process.execPath`+`ELECTRON_RUN_AS_NODE=1`（功能可用但不复用系统 node） | **已解决（同轮）**：win32 分支=`where node` → nvm（%APPDATA%\nvm\versions\node\<v>\node.exe，winNodeBinCandidateList 纯函数+单测 4 例）→ Program Files 两位 → Electron 兜底；mac 探测零变化 |
| W-4 | 字体 | `tokens.css --font-sans` 无 Microsoft YaHei 显式候选（`-apple-system`/`sans-serif` 兜底会落微软雅黑，可接受）；`--font-serif` 已有 `SimSun`（注释明示 win 用 SimSun） | 观察；win 真机过目后再定（体验层域） |
| W-5 | dot 目录 | `.zhijuan` 在 win 无隐藏属性（win 不认 dot 前缀），资源管理器可见 | 观察；win 启用时可加 hidden 属性（不阻塞） |
| W-6 | 数据显示 | 路径类 UI 展示（库根/导出路径）可能显示 `C:\...` 反斜杠——用户可读性 | win 启用时 UI 层 `displayPath` 统一正斜杠（登记，不涉及 mac） |
| W-7 | win 菜单真机验收 | winTemplate 已落地（2026-09-14 16:30）但 win 未打包——真机展开/快捷键实测只能在 win 包上做 | win 包立项时按 docs/系统菜单-设计口径.md §win 验收（结构/role 默认快捷键/CmdOrCtrl 自定义项） |

## 四、边界声明

- 本轮**不**打包 win（nsis/portable 配置已备，主人已拍板延后；打包=主会话发布冲刺域）。
- 本轮**不**做 win 平台分支代码（除 W-3 登记），所有修复在 mac 上行为零变化，win 专属行为留 win 立项轮处理。
- 验证结论见档案迭代日志（三道门 + 单测 + 数据层冒烟 + 回归）。
