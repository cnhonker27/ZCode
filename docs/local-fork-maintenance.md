# 本地 Fork 维护笔记

> 记录从开源社区 fork 之后的本地环境、构建、隔离启动与日常更新流程。
> 仅维护于本人 fork（`fix/build-and-dev-isolation` 分支），不随 PR 提交上游。

## 仓库与远程布局

| 远程 | 地址 | 用途 |
| --- | --- | --- |
| `origin` | `https://github.com/zai-org/ZCode.git` | 社区上游，只读（fetch/pull 可用，push 会 403，误推无风险） |
| `fork` | `https://github.com/cnhonker27/ZCode.git` | 本人 fork，推送个人分支 |

长期分支：`fix/build-and-dev-isolation`（个人定制 + 通用修复）。

## 本地环境（Windows）

| 组件 | 版本 / 来源 | 说明 |
| --- | --- | --- |
| Node | 24.14.0（`mise.toml` 钉住） | nvm-windows 镜像索引异常装不上，手动从 npmmirror CDN 下载 `node-v24.14.0-win-x64.zip` 解压到 `D:\SoftWare\nvm\v24.14.0` 后 `nvm use 24.14.0` |
| pnpm | 10.33.2 | 与根 `package.json` 的 `packageManager` 一致；需在 Node 24.14.0 下重装（`npm i -g pnpm@10.33.2`），全局包跟着 Node 版本目录走 |
| registry | `registry.npmmirror.com` | 本机访问不了 `registry.npmjs.org`，安装依赖统一走镜像 |
| Electron 镜像 | `https://npmmirror.com/mirrors/electron/` | 与 `mise.toml` 的 `ELECTRON_MIRROR` 一致 |

安装依赖：

```bash
npm_config_registry=https://registry.npmmirror.com pnpm install
```

## 构建

- 完整构建：`pnpm build`（递归构建全部 workspace 包）
- 桌面开发启动：双击根目录 `dev-desktop-test.bat`，或 `pnpm dev:desktop:test`
- 验证：`pnpm typecheck`、`pnpm lint`（基线 62 条既有警告、0 错误）
- 开工前基线检查：`node scripts/check-workspace-freshness.mjs`

### 数据隔离

`pnpm dev:desktop:test` 的 test 模式自动隔离：agent 数据根与设置文件全部落在
`~/.zcode-dev-home`，已安装的 ZCode（`~/.zcode`）不受影响；Electron userData 本来就走独立的 `%APPDATA%/ZCode Dev`。

原理：`scripts/dev-desktop-env.mjs` 会把 `ZCODE_DATA_BASE_DIR` 与 `ZCODE_DESKTOP_HOME_DIR`
联动指向同一目录。注意 `ZCODE_DATA_BASE_DIR` 只隔离 agent 数据根；
settingService（`packages/services/src/setting/settingService.ts`）的路径规则是
`ZCODE_DESKTOP_HOME_DIR || HOME || USERPROFILE`，不读 `ZCODE_DATA_BASE_DIR`，
所以只设数据根时设置文件仍会写到真实 `~/.zcode`。

### 分支上的修复（尚未进上游）

1. `fix: pin web-share @zcode/shared alias to exact match and map subpath exports` —
   vite 字符串别名按前缀匹配，会把 `@zcode/shared/model-config` 这类子路径导入错误替换，
   导致 web-share 构建失败。
2. `fix: keep Gen UI vendor assets byte-identical on autocrlf checkouts` —
   Windows `core.autocrlf=true` 检出时破坏 Gen UI vendor 快照的 sha256 校验；
   已在 `.gitattributes` 按字节保存并重新检出。
3. `feat: isolate desktop dev data home and add Windows launcher` —
   dev 数据隔离联动 + `dev-desktop-test.bat` 启动器（个人定制）。

前两个是通用问题，建议 cherry-pick 后向上游提 PR；合并进上游后可丢弃本地提交，减少维护面。

## 日常更新社区代码

```bash
git switch main
git pull origin main
git switch fix/build-and-dev-isolation
git rebase main
git push --force-with-lease fork fix/build-and-dev-isolation
npm_config_registry=https://registry.npmmirror.com pnpm install   # lockfile 有变化时
pnpm build
```

- rebase 冲突高发点：`packages/web-share/vite.config.ts`、`.gitattributes`、
  `scripts/dev-desktop-env.mjs`。若上游已自行修复同类问题，采用上游版本并丢弃对应本地提交。
- 提交会触发 pre-push 钩子 `pnpm verify:pre-push`（lint + 架构检查 + 受影响单测），
  push 卡住时先在本地跑一遍确认。
