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

# 4) 补装漏掉的同 scope 依赖，重复到收敛（并剔除 darwin 装不上的 linux 包）
for round in 1 2 3; do
  PKGS=$(python3 - <<'PY'
import json, os
root='node_modules/@deepseek-ai'
togo={}
for sub in os.listdir(root):
    p=os.path.join(root,sub,'package.json')
    if not os.path.isfile(p): continue
    try: pkg=json.load(open(p))
    except: continue
    for f in ['dependencies','peerDependencies','optionalDependencies']:
        for k,v in (pkg.get(f) or {}).items():
            key=k.split('/')[1] if k.startswith('@deepseek-ai/') else None
            if key and not os.path.isdir(os.path.join(root,key)): togo[k]=v
print(' '.join(f'{k}@{v}' for k,v in togo.items() if 'node-addon-landlock-run-linux' not in k))
PY
  )
  if [ -z "$PKGS" ]; then echo "依赖收敛（第 $round 轮）"; break; fi
  echo "第 $round 轮补装: $PKGS"
  npm i --no-audit --no-fund --legacy-peer-deps --fetch-retries=2 $PKGS
  [ $round -eq 3 ] && echo 'WARN: 3 轮仍未收敛，手工排查' && exit 1
done

# 5) 重建织卷写作域插件（esbuild 打成 mjs 按包名放进 node_modules）
cd .. && node scripts/build-plugins.mjs

# 6) 织卷自维护补丁：dsh SDK 公开协议无中断口（HarnessClient 注释明言无 wire-level cancel），
#    给 vendored jsonrpc-server 加 session/cancel 转发（幂等；重装依赖后自动恢复，勿删）
cd dsh-runtime && node scripts/patch-server-cancel.mjs && cd ..

# 7) 织卷自维护补丁：session/prompt 加 per-session maxTokens 透传（子任务输出预算按 kind 分层，
#    幂等；重装依赖后自动恢复，勿删）
cd dsh-runtime && node scripts/patch-server-maxtokens.mjs && cd ..

echo 'dsh-runtime 就绪'