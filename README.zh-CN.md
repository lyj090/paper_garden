# paper_garden

*[English](README.md)*

[Quartz](https://quartz.jzhao.xyz/) v5 的 fork：从**私有笔记库**生成**公开发布站点**。

两个仓库，一条边界：

- **私有源**：笔记与发布配置所在（永不公开）；
- **本仓库**：站点本体——主题、插件、导出/审查脚本。

本仓库不含任何笔记。构建时只把已批准的笔记复制到临时目录，渲染、审查通过后才发布。

## 工作方式

1. **导出**：从源中仅复制已批准的笔记到全新暂存目录；剥离私有元数据、本地链接与个人章节；只保留被引用的图片。
2. **构建**：Quartz 渲染暂存目录。
3. **审查**：扫描成品站点（页面、索引、订阅、文件名、资源），发现异常即中止发布。

保守优先：任何未识别的内容都会阻断发布，等待复核。

## 插件

| 插件 | 作用 |
| --- | --- |
| `literature-index` | 首页与标签 / 筛选导航 |
| `reading-fit` | 图表、表格、列表、目录、提示块的阅读排版 |
| `privacy-filter` | 渲染时移除遗留私有章节与不安全链接 |

## 快速开始

需要 Node 22+。

```bash
npm ci
npx quartz plugin install

PRIVATE_SOURCE_PATH=/path/to/source \
PUBLISHING_CONFIG=/path/to/config \
  ./setup.sh
```

浏览器打开 <http://127.0.0.1:8080>。`setup.sh` 会导出已批准的子集、构建并本地预览；私有源从不作为 Quartz 的内容目录。

## 隐私

私有数据（路径、选集、词表、服务设置）保存在本仓库之外的忽略文件中。公开的只有主题、插件、脚本，以及由已批准笔记构建并通过审查的静态站点。

## 部署

见 [DEPLOY.md](DEPLOY.md)。

## 上游

Fork 自 [jackyzha0/quartz](https://github.com/jackyzha0/quartz)（分支 `v5`）。同步上游：

```bash
git fetch upstream
git rebase upstream/v5
```

MIT 许可，见 [LICENSE.txt](LICENSE.txt)。
