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
