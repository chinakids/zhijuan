#!/bin/bash
# 重建 dsh-runtime 依赖树（幂等）。已趟平的坑见下方注释；卡死时先怀疑环境：
#   env -i HOME=… PATH=… 干净环境装（本机交互 shell 会注入坏环境挂 50 分钟无输出）。
set -e
cd "$(dirname "$0")"

# 1) legacy-peer-deps：这套包是 peer 依赖灾难构型，裸装会死循环几十分钟
if [ ! -f .npmrc ]; then echo 'legacy-peer-deps=true' > .npmrc; fi

# 2) 装主依赖（干净环境）
env -i HOME="$HOME" PATH="/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin" npm i --no-audit --no-fund --legacy-peer-deps --fetch-retries=2 --loglevel=http

# 3) native 脚本默认不跑，先 approve
npm approve-scripts koffi node-pty protobufjs 2>/dev/null || true

# 4) 补装漏掉的依赖，重复到收敛（并剔除 darwin 装不上的 linux 包）
#    2026-10-27：判据从「只扫 @deepseek-ai 子包」扩为「扫全部包的 dependencies/peerDependencies」——
#    legacy-peer-deps 会让 npm 完全忽略 peerDependencies（npm 官方 config 文档原文），
#    非 @deepseek-ai scope 的缺失依赖原来扫不到；optional 依赖不算缺失（本就按平台可选）。
for round in 1 2 3; do
  PKGS=$(python3 - <<'PY'
import json, os, sys
root = 'node_modules'
platform = sys.platform  # darwin / linux / win32
# 平台专属包：本平台不是目标时视为「不缺」（例：darwin 上缺 *-linux 包属正常）
skip_marks = { 'darwin': ('linux',), 'linux': ('darwin', 'win32'), 'win32': ('linux', 'darwin') }.get(platform, ())
have = lambda name: os.path.isdir(os.path.join(root, *name.split('/')))
def pkgs():
    for entry in os.listdir(root):
        if entry.startswith('.'):
            continue
        base = os.path.join(root, entry)
        if entry.startswith('@'):
            for sub in getattr(os, 'listdir')(base) if os.path.isdir(base) else []:
                yield os.path.join(base, sub, 'package.json')
        else:
            yield os.path.join(base, 'package.json')
togo = {}
# sidecar 不走客户端 UI / MCP 可选 peer（实测引擎启动无需它们）；仍按需可手工装。
IGNORE_PEERS = {
    'react', 'react-dom', '@types/react', 'zustand', '@tanstack/react-virtual',
    'use-sync-external-store', '@cfworker/json-schema', 'bufferutil', 'utf-8-validate',
}
for p in pkgs():
    if not os.path.isfile(p):
        continue
    try:
        pkg = json.load(open(p))
    except Exception:
        continue
    for field in ('dependencies', 'peerDependencies'):
        for name, ver in (pkg.get(field) or {}).items():
            if have(name):
                continue
            if field == 'peerDependencies' and name in IGNORE_PEERS:
                continue
            if any(m in name for m in skip_marks):
                continue
            togo.setdefault(name, ver)
print(' '.join(f'{k}@{v}' for k, v in togo.items() if 'node-addon-landlock-run-linux' not in k))
PY
  )
  if [ -z "$PKGS" ]; then echo "依赖收敛（第 $round 轮）"; break; fi
  echo "第 $round 轮补装: $PKGS"
  npm i --no-audit --no-fund --legacy-peer-deps --fetch-retries=2 $PKGS
  [ $round -eq 3 ] && echo 'WARN: 3 轮仍未收敛，手工排查' && exit 1
done

# 5) 重建织卷写作域插件（esbuild 打成 mjs 按包名放进 node_modules）
cd .. && node scripts/build-plugins.mjs

# 6) 引擎启动补丁：给 dsh-app-boot 注入 hmr.registerConfig 守卫（NO_ADAPTER 根因，幂等）。
#    必须紧跟 build-plugins、在 boot-check 之前：npm i 会覆盖 dsh-app-boot 的 lib/index.js，
#    少跑这步 boot-check 必红（实测 TypeError: hmr.registerConfig is not a function）。
node scripts/patch-dsh-hmr.mjs

# 7) 织卷自维护补丁：dsh SDK 公开协议无中断口（HarnessClient 注释明言无 wire-level cancel），
#    给 vendored jsonrpc-server 加 session/cancel 转发（幂等；重装依赖后自动恢复，勿删）
cd dsh-runtime && node scripts/patch-server-cancel.mjs && cd ..

# 8) 织卷自维护补丁：session/prompt 加 per-session maxTokens 透传（子任务输出预算按 kind 分层，
#    幂等；重装依赖后自动恢复，勿删）
cd dsh-runtime && node scripts/patch-server-maxtokens.mjs && cd ..

# 9) 织卷自维护补丁：session/prompt 加 per-session reasoningEffort 透传（子任务思考档位按 kind 分层，
#    revision→low；幂等；重装依赖后自动恢复，勿删）
cd dsh-runtime && node scripts/patch-server-reasoning.mjs && cd ..

# 10) 启动自检：装完必须能真的起得来（2026-10-27 起）——10-21 的教训是依赖树装坏照样能打包出 dmg，
#    产物里的引擎却崩在注册 LLM 适配器之前。这里跑一条无模型的自检（超时即视为适配器 OK），
#    失败就让 install 整体失败，别把坏引擎打进发布物。cwd 此时＝仓库根（步骤 5~9 已回到根）。
node scripts/dsh-boot-check.mjs --timeout 30

echo 'dsh-runtime 就绪'