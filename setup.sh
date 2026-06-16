#!/usr/bin/env bash
# Quartz 数字花园一键部署脚本
# 用法: bash setup.sh
# 适用: Ubuntu/Debian, 需要 git, node >= 20

set -euo pipefail

REPO_URL="${1:-git@github.com:lyj090/paper_garden.git}"
OBSIDIAN_REPO="https://github.com/lyj090/Obsidian.git"
# 如果本地已有 Obsidian vault，设置此路径（例如: /home/robot/LYJ/Obsidian）
OBSIDIAN_LOCAL="${OBSIDIAN_LOCAL_PATH:-}"
NODE_MIN=20

echo "=== ============== ==="
echo "=== Quartz 数字花园 ==="
echo "===   一键部署脚本   ==="
echo "=== ============== ==="
echo ""

# ── 1. 检查 Node.js ──
echo "🔍 检查 Node.js 版本 ..."
if ! command -v node &>/dev/null; then
    echo "❌ Node.js 未安装。请先安装 Node.js >= ${NODE_MIN}"
    echo "   推荐: curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash"
    exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt "$NODE_MIN" ]; then
    echo "❌ Node.js 版本过低 (当前: $(node -v), 需要: >= ${NODE_MIN})"
    echo "   升级: nvm install 22 && nvm use 22"
    exit 1
fi
echo "   ✅ Node.js $(node -v)"

# ── 2. 检查 Git ──
echo "🔍 检查 Git ..."
if ! command -v git &>/dev/null; then
    echo "❌ Git 未安装。请先安装 Git"
    exit 1
fi
echo "   ✅ Git $(git --version | awk '{print $3}')"

# ── 3. 克隆数字花园仓库 ──
echo ""
echo "📦 克隆数字花园仓库 ..."
if [ -d "my-digital-garden" ]; then
    echo "   ⚠️  目录 my-digital-garden 已存在，更新中 ..."
    cd my-digital-garden
    git pull origin main
else
    git clone "$REPO_URL" my-digital-garden
    cd my-digital-garden
fi

# ── 4. 同步 Obsidian 内容 ──
echo ""
echo "📂 同步 Obsidian 笔记内容 ..."
rm -rf content
if [ -n "$OBSIDIAN_LOCAL" ] && [ -d "$OBSIDIAN_LOCAL" ]; then
    # 本地有 Obsidian vault → 符号链接（编辑即时生效）
    ln -s "$OBSIDIAN_LOCAL" content
    echo "   ✅ 符号链接到本地 vault: $OBSIDIAN_LOCAL"
else
    # 无本地 vault → git clone
    # CI 用 PAT 认证；本地用 SSH
    if [ -n "${OBSIDIAN_PAT:-}" ]; then
      git clone --depth 1 "https://x-access-token:${OBSIDIAN_PAT}@github.com/lyj090/Obsidian.git" content
    else
      git clone --depth 1 "$OBSIDIAN_REPO" content
    fi
    echo "   ✅ Git clone Obsidian 笔记"
fi

# ── 5. 安装依赖 ──
echo ""
echo "📥 安装 npm 依赖 ..."
npm ci
echo "   ✅ 依赖安装完成"

# ── 6. 本地预览 ──
echo ""
echo "🎉 部署完成！执行本地预览："
echo ""
echo "   cd my-digital-garden"
echo "   npx quartz build --serve"
echo ""
echo "   浏览器访问: http://localhost:8080"
echo ""
echo "📋 配置文件: quartz.config.yaml"
echo "📁 内容目录: content/ (Obsidian 笔记符号链接)"
echo ""
echo "要更新内容: cd my-digital-garden && cd content && git pull && cd .. && npx quartz build"
