# 把截至 v3 的累计修改推到自己的远程分支（暂不开 PR）

v3 是完整累计源码，不是只含两个 UI 修复的补丁。基线仍是
`YomotsuHisami/eagler-touhou` 的 `frontend-redesign`，提交
`6e266f0c78ca8f2d465c478733133fba835fca5b`。

本流程只在你手动执行最后的 `git push` 时上传代码；不会自动创建 PR。
不要把 ZIP 直接上传 GitHub，不要在解压目录重新 `git init`，不要覆盖旧工作目录或使用 `--force`。

## 1. 先测试这份 v3

将 ZIP 解压到 `~/Projects/`，得到 `eagler-touhou-frontend-complete-v3`。不要覆盖旧的 complete 或原 Git 克隆。

```bash
cd "$HOME/Projects/eagler-touhou-frontend-complete-v3" &&
node scripts/setup-local-assets.mjs --from="$HOME/Projects/eagler-touhou-frontend-complete" &&
npm ci --ignore-scripts &&
npm run preview:offline
```

旧 complete 目录不存在时，把 `--from` 改成原克隆 `~/Projects/eagler-touhou-frontend`。
浏览器打开 `http://127.0.0.1:8137/`。停止用 Ctrl+C。无需清理浏览器存档/缓存数据库。
保留同一地址和端口，避免误把新 Origin 当成原来的存档空间。

## 2. 在原 Git 克隆旁开一个新的提交目录

以下命令以 Bash 为例。先检查旧目录，无论旧目录是否有未提交改动，都不要重置它。

```bash
cd "$HOME/Projects/eagler-touhou-frontend" &&
git status --short --branch &&
git worktree add -b feat/frontend-redesign-review \
  "$HOME/Projects/eagler-touhou-publish" \
  6e266f0c78ca8f2d465c478733133fba835fca5b
```

这是原仓库的独立 worktree，保留同一 Git 历史，不需要重新下载全部仓库。
如果分支/目标目录已存在，或基线提交不在本地，停止并保留报错，不删除现有目录，不盲目 fetch 所有分支。
之前已经建立的 `eagler-touhou-pr` 或旧修复分支也不会被覆盖。

## 3. 只应用 v3 的完整源码变更清单

```bash
cd "$HOME/Projects/eagler-touhou-frontend-complete-v3" &&
node scripts/apply-review-to-worktree.mjs \
  --target="$HOME/Projects/eagler-touhou-publish" --dry-run &&
node scripts/apply-review-to-worktree.mjs \
  --target="$HOME/Projects/eagler-touhou-publish" --apply
```

工具逐一核对目标 HEAD、干净状态、基线文件和包内文件的 SHA-256。不匹配则在写入前停止。
它只复制清单内的源码/文档/测试，不复制 node_modules、字体、游戏数据、存档、私有立绘或 `.cache`。
本包包含此前交付的所有改动；你另外在本地手动做的改动不会自动并入，应当单独比较、审查，不要覆盖。

## 4. 测试、审查并提交

```bash
cd "$HOME/Projects/eagler-touhou-publish" &&
npm ci --ignore-scripts &&
npm run test:frontend &&
git diff --check &&
git status --short &&
git diff --stat
```

需要完整查看时运行 `git diff`。在这个初始干净的新 worktree 中确认改动后：

```bash
git add . &&
git diff --cached --check &&
git diff --cached --stat
```

再用 `git diff --cached --name-only` 核对没有私人素材、游戏文件、存档、密码和缓存。
`git add .` 不会强行加入 Git 忽略的文件；不要加 `-f`。

```bash
git commit -m "feat(frontend): refine directory, portraits, save dialog and header layering"
```

若提示缺少作者信息，用你自己的署名与邮箱设置当前仓库的 `git config user.name` 和 `git config user.email`；可以使用 GitHub 账号设置中显示的 noreply 邮箱。

## 5. 推到自己的 fork，不创建 PR

先在 GitHub 确认有你自己的 fork。复制你 fork 页面 Code 按钮里的 HTTPS 或 SSH 地址，**不要直接复制朋友仓库的地址**。
下面只新增远端，不修改 origin，也不覆盖已存在的 myfork。输入的是普通仓库地址，不包含密码或 token。

```bash
read -r -p "粘贴你自己 fork 的仓库地址（HTTPS 或 SSH）：" FORK_URL
git remote add myfork "$FORK_URL"
git remote -v
```

若 `myfork` 已存在，直接查看 `git remote get-url myfork`，确认是自己的 fork；不确认之前不要推送。
确认后：

```bash
git push -u myfork feat/frontend-redesign-review
```

HTTPS 使用 GitHub 支持的凭据管理器/浏览器认证或访问令牌，不使用 GitHub 登录密码。
已有 SSH 配置可直接使用 SSH 地址。不要把令牌写进命令、remote URL 或发给别人。
出现权限不足或非快进错误时保留报错，不使用强制推送。

成功后核对：

```bash
git status --short --branch
git log -1 --oneline
git ls-remote myfork refs/heads/feat/frontend-redesign-review
```

本地 `git rev-parse HEAD` 和 `git ls-remote` 返回的提交应一致。
现在只保存到了你的远程分支，并没有创建 PR，也没有合并到朋友仓库。

## 6. 后续开发与提 PR

后续直接在 `~/Projects/eagler-touhou-publish` 编辑/运行，不再在多个 ZIP 解压目录之间来回改。
这个目录沿用 `npm run preview:offline` / `npm run preview:local`，需要的本地封面可以用 `setup-local-assets.mjs --from=旧目录` 复用。
DAIRI 原图继续保存在被忽略的 `private-assets/dairi/`，不提交。

后续保存改动：测试、审查，然后 `git add .` → `git commit` → `git push`。
等准备好再从该分支打开 PR。接收这些累计修复时通常选择朋友仓库的 `frontend-redesign` 作为 base；
若要把整个 redesign 合入 main，先与朋友确认比较范围。可使用 `docs/FRONTEND-PR-BODY.md`。

全库 `npm run check` 仍有记录在案的 TH10 基线配置失败；本轮相关测试通过不能写成所有 CI/所有游戏通过。

## 官方参考

- https://git-scm.com/docs/git-worktree
- https://docs.github.com/en/get-started/using-git/pushing-commits-to-a-remote-repository
- https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-authentication-to-github
