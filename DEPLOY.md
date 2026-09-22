# 本站部署说明（paper_garden）

> 本文件描述**这个 fork 的实际部署方式**，与上游 Quartz 文档无关。
> 站点：https://lyj090.github.io/paper_garden

## 内容从哪来

本仓库**不含笔记**。`content/` 已被 `.gitignore` 忽略，构建前才准备好：

| 场景 | `content/` 的来源 |
| --- | --- |
| CI（`.github/workflows/deploy.yml`） | `rm -rf content` → `git clone --depth 1 https://x-access-token:${{ secrets.OBSIDIAN_PAT }}@github.com/lyj090/Obsidian.git content` |
| 本地 | 符号链接到 vault：`ln -s "/path/to/Obsidian Vault" content`，或自行 clone |

因此**线上内容恒等于 `lyj090/Obsidian` 的 `main`**。

## 什么时候会重新构建

`deploy.yml` 只有两个触发器：

```yaml
on:
  push:
    branches: [main]     # 1) 改本仓库（主题/配置）
  workflow_dispatch:     # 2) 跨仓库触发 + 手动
```

### 关键：本仓库**不监听** vault 的 push

笔记在 **另一个仓库** `lyj090/Obsidian`（私有）。往那里 push **不会**触发本仓库构建，
因为 `git clone` 只是构建时的输入，不是事件源。

补上这条链路的是 **vault 里的** `.github/workflows/trigger-digital-garden.yml`
（Obsidian → paper_garden 跨仓库 `workflow_dispatch`）。

```
Obsidian push ──→ trigger-digital-garden.yml ──(repository dispatch, PAT)──→
                                                    deploy.yml ──→ GitHub Pages
```

改笔记后站点没更新，**先看 vault 那条 workflow 是不是红的**，而不是查本仓库。

## 定时构建已移除（2026-09-22）

原先有一条 `cron: "37 2 * * *"` 作兜底，已删除，因为它并没有在工作：

- **实际早已失效**：最后一次 `schedule` 触发停在 2026-08-24，此后一个月零次
  （GitHub 会在仓库连续 60 天无活动后自动禁用 scheduled workflow）。
- **且从不准时**：实测执行时间从 `06:47 UTC` 漂到 `03:31 UTC`。
  Actions 的 cron 只是 best-effort。
- **留着有害**：制造"有兜底"的错觉——而真正的故障（下游 PAT 失效）
  正好被这种错觉掩盖了三个月。

## 需要维护的 Secrets

| Secret | 位置 | 用途 | 失效症状 |
| --- | --- | --- | --- |
| `OBSIDIAN_PAT` | 本仓库 | CI 克隆私有 vault | 构建报 404 / clone 失败 |
| `DIGITAL_GARDEN_PAT` | **Obsidian 仓库** | vault 触发本仓库 dispatch | vault workflow 标红 `401 Bad credentials` |

两者都会过期。PAT 要求：classic token 勾 `repo`，或 fine-grained
选对应仓库 + `Actions: Read and write`。

> 排查提示：若在 UI 上"更新了 secret"却仍报错，用 API 确认 `updated_at` 是否真的刷新：
> `curl -H "Authorization: Bearer $TOK" https://api.github.com/repos/lyj090/Obsidian/actions/secrets/DIGITAL_GARDEN_PAT`

## 本地搭建与新机器

```bash
git clone https://github.com/lyj090/paper_garden.git my-digital-garden
cd my-digital-garden
# content/ 已被 .gitignore 忽略，不会随仓库分发，需自备：
#   本地有 vault → 符号链接
ln -s "/path/to/Obsidian Vault" content
#   否则 → 浅克隆
# git clone --depth 1 https://github.com/lyj090/Obsidian.git content
npm ci
npx quartz build --serve      # → http://localhost:8080
```

> CI 里 `content/` **不是**符号链接：构建前会 `rm -rf content` 再 `git clone`。

### Remote 结构

```
origin    →  git@github.com:lyj090/paper_garden.git    (fork)
upstream  →  https://github.com/jackyzha0/quartz.git   (上游)
```

## CI 配置要点

| 项 | 值 | 原因 |
| --- | --- | --- |
| 克隆深度 | `--depth 1` | 减少 90%+ 数据。`--filter=blob:none --sparse` 与 GitHub 不兼容（exit 128），已回退 |
| 插件缓存 | `actions/cache@v5` | 跳过 46 个插件安装 |
| npm 缓存 | `setup-node` | 跳过 `npm ci` |
| Node | 22 + `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24` | 消除 actions@v4 的 Node 20 弃用警告 |

构建耗时：缓存命中 ~30s，无缓存 ~1.5min。

## 排错

| 问题 | 原因 | 解决 |
| --- | --- | --- |
| **Push 了但站点不更新** | vault 的 trigger workflow 失败（常见：PAT 过期） | 看 vault 那条 workflow 是否标红，不要查本仓库 |
| trigger 报 `401 Bad credentials` | `DIGITAL_GARDEN_PAT` 过期或权限不足 | 重建 PAT 并更新 secret（用 API 确认 `updated_at` 刷新） |
| trigger "no job were run" | `if: secrets.X != ''` 空 secret 永远为 false | 移除该 `if`，改在 script 内校验 |
| 构建报 404 / clone 失败 | `OBSIDIAN_PAT` 失效 | 重建 PAT |
| Secrets 显示成功但不生效 | 误编辑了别的 secret / 未点 Update | 查 API 的 `updated_at` |
| 首页显示 RSS XML | 缺少 `index.md` | 创建首页 |
| citations 插件报错 | 无 bibliography URL | 禁用插件 |
| OG Image emoji 报错 | codepoint 不在字体映射中 | 禁用插件 |
| Pages deploy 404 | 新 fork 的 Pages 默认关闭 | API 创建 + 切 workflow 模式 |

## 一次性历史：Fork 改造（2026-06-16）

原先通过 `git clone` + `orphan branch` 创建，GitHub 不识别为 fork。
改为正式 fork 后可自动追踪与上游差异、PR 可双向提交。

```bash
gh repo fork jackyzha0/quartz --fork-name paper_garden --default-branch-only
git push origin main
gh repo edit lyj090/paper_garden --default-branch main
gh api --method POST /repos/lyj090/paper_garden/pages \
  -f "build_type=legacy" -f "source[branch]=main" -f "source[path]=/"
gh api --method PUT /repos/lyj090/paper_garden/pages -f "build_type=workflow"
```

**Fork 的两个坑**：secrets 不继承（两个 PAT 都要手动重加）；Pages 默认关闭需手动开启。
