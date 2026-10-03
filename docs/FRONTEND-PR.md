# 把本次修改提交为 PR

**当前 v3 的需求是先推送、之后再提 PR。请优先按 [REMOTE-PUSH.md](REMOTE-PUSH.md) 操作。**
以下保留 base/head 解释和旧命名示例；已按 REMOTE-PUSH 建立 publish 工作树后，不需要重复创建另一份工作树。

## 先明确 base 与 head

本次代码基于朋友仓库 `YomotsuHisami/eagler-touhou` 的 `frontend-redesign`：
`6e266f0c78ca8f2d465c478733133fba835fca5b`。

提交“这次前端修复”时，通常应该让 PR：

- base repository：`YomotsuHisami/eagler-touhou`
- base branch：`frontend-redesign`
- head repository：你自己的 fork
- compare branch：下面创建的 `feat/site-directory-portraits`

如果你朋友要的是“把整个 redesign 合入 main”，先和他确认，那是不同的比较范围。
不要直接把 main 当成本次小修复的 base，否则会把原有整批 redesign 改动也带进去。

## 1. 用原来的 Git 克隆建立独立工作树

先保留原来的目录。以下命令不会切换或丢弃原目录的未提交修改：

```bash
cd "$HOME/Projects/eagler-touhou-frontend"
git status --short --branch
git worktree add -b feat/site-directory-portraits   "$HOME/Projects/eagler-touhou-pr"   6e266f0c78ca8f2d465c478733133fba835fca5b
```

目标目录/分支已经存在时，不要删除，不要用 reset/clean。改用新的目录和分支名。
找不到基线提交时先停止；不要盲目全量 fetch 或把源文件覆盖到别的提交。

## 2. 核对并应用这包文件

```bash
cd "$HOME/Projects/eagler-touhou-frontend-complete-v3"
node scripts/apply-review-to-worktree.mjs   --target="$HOME/Projects/eagler-touhou-pr" --dry-run
node scripts/apply-review-to-worktree.mjs   --target="$HOME/Projects/eagler-touhou-pr" --apply
```

这个工具检查目标 HEAD、干净状态、原文件 SHA-256、包内修改文件 SHA-256。
任何不匹配都停止；只复制清单中的源码变更，不复制字体、游戏/用户数据、缓存或立绘，不提交、不推送。
应用后若你继续修改源码包，清单校验会拒绝，应该手动 diff/审查你的后续修改，不要绕过保护。

## 3. 在 PR 工作树里检查和提交

```bash
cd "$HOME/Projects/eagler-touhou-pr"
npm ci --ignore-scripts
npm run test:frontend
git diff --check
git status --short
git diff --stat
```

原 Git 基线已有字体，所以工作树无需从源码包重新复制字体。没有 node_modules 则正常 npm ci。

确认改动后：

```bash
git add .
git diff --cached --stat
git diff --cached --name-only
```

这是一份新建、初始干净的工作树；依然应核对没有 `private-assets`、游戏文件、存档、密码或本地缓存。
`git add .` 尊重 `.gitignore`，不要加 `-f`。随后提交：

```bash
git commit -m "feat(frontend): add site directory and shared local character portraits"
```

提示缺少身份时，用自己的 Git 姓名和邮箱配置 `git config user.name` / `git config user.email`，可使用 GitHub 提供的 noreply 邮箱。

## 4. 推送到你自己的 fork

在 GitHub 打开朋友的仓库，点击 Fork；已经有自己的 fork 则用现有的。
不要把 `YomotsuHisami` 自动当成你自己的用户名；先确认你登录的账号。

下面按 Bash 执行：

```bash
read -rp "你的 GitHub 用户名：" GH_USER
git remote add myfork "https://github.com/$GH_USER/eagler-touhou.git"
git push -u myfork feat/site-directory-portraits
```

`myfork` 已存在时先 `git remote -v` 检查，不要盲目覆盖。
HTTPS 认证使用 GitHub 支持的认证方式（浏览器/凭据管理器或 token），不是账号登录密码。
也可按你已有的 SSH 配置改用 SSH remote；不要把 token 写到 remote URL 或发给别人。

## 5. 在网页创建 PR

打开你 fork 的推送分支 → Compare & pull request → compare across forks。
确认第一节的 base/head 四个字段。选择 Draft pull request 更适合当前仍为示例大厅、尚未真实联机验收的状态。
描述可使用 [FRONTEND-PR-BODY.md](FRONTEND-PR-BODY.md)。
不要写“全库 CI / 全部游戏实机通过”：本次只通过了相关回归；全量 check 的 TH10 配置失败在未修改的基线也能复现。

官方说明：
https://docs.github.com/articles/creating-a-pull-request-from-a-fork
https://docs.github.com/articles/creating-a-pull-request
