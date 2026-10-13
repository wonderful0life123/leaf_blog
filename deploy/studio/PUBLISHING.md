# 文章预览与发布：服务器接入及验收

预览采用单篇 Markdown 渲染；确认发布后才运行完整 Astro 构建、选中文章的 Git 提交和博客源站的原子切换。需要更新后端并重启 Studio；草稿 SQLite 仍为 v2，不迁移正文、图片或 OAuth 数据。不要按纯前端升级处理。

## 行为与边界

1. 自动保存仍在私密草稿库。点击“检查并生成预览”只在数据目录内工作，不推送。
2. 每次检查绑定草稿 revision 和 Git 分支 HEAD。现有博客文章检查 source.baseHash；再次发布检查上一次文章 hash，防止覆盖外部修改。
3. 文章路径与分类分开。新路径使用小写英文、数字和短横线，支持多层目录。现有文章沿用路径。图片存到文章旁的 `assets/<文章文件名>/<sha256>.<扩展名>`，只复制当前正文引用的图片，不删除共享图片。
4. 本期支持普通 Markdown、代码、公式和 Markdown 图片。原始 HTML、MDX、加密文章阻止网页发布，需沿用本地方式。预览复用博客的 Markdown 插件、Expressive Code 和文章 CSS，展示单篇正文而非完整站点横幅、侧栏；图片直接使用已验证的原图，不运行全站图片优化。预览禁用脚本、导航和表单；动态 Mermaid、播放器等交互不在这个静态预览内运行。
5. 用户勾选公开提示并点击“确认发布”后，才运行 icons → Astro → Pagefind 完整构建，成功且再次核对草稿/分支后，向 leaf_blog 配置分支提交。只暂存选中文章和图片，普通 fast-forward push，不 force、不 reset 现有工作区、不修改 obsidian_note。
6. GitHub 提交后才切换源站产物。失败保留草稿；提交成功但切换失败会记录 commit，用户点“重试上线”时先核对远端，避免重复提交。旧产物保留。
7. 本期不监听任意本地 Git 推送。代码更新仍由服务器部署方同步双前端；旧 master timer 保持禁用。
8. 成功发布后，Studio 文章目录读取最新已发布任务的源文件快照，立即反映新文章；重启也会恢复同一快照。更新发布基准 SHA 时，部署方须同步既有博客只读来源目录到最新内容，避免列表回到旧版本。不要删除最新已发布任务的 work 目录。

## 先隔离验收，再启用生产发布

保留现有 OAuth/网络修复、服务环境、草稿、图片和 Nginx 既有代理。本次后端更新 publications/publication-git，并新增 publication-preview.mjs 和 preview-worker.mjs；本地 plugin 仅供开发。先审查差异，不用整仓库覆盖服务器本地修改。

- 固定到交接提交安装依赖，运行 `pnpm run studio:test`、`pnpm build`、`pnpm run studio:build`。构建过程内部直接调用已安装的 Node 构建入口，步骤等同 generate-icons → astro build → pagefind，避免运行时自动安装依赖。
- 用本机临时 bare Git remote、隔离数据目录、隔离公开目录演练新文章和图片、第二次发布、冲突及失败恢复。自动验收不得写入真实 GitHub 或生产草稿。
- 先设置 `WONDER_PUBLISH_ENABLED=0` 在服务器验证私密预览、登录与匿名 401。真实文章的首次公开由用户本人点击确认，不替用户发布测试文章。

## 发布仓库与权限

新增独立发布 checkout，例如 `/srv/wonder-publisher/leaf_blog`，origin 必须是 `wonderful0life123/leaf_blog`。配置分支沿用 `feat/wonder-studio-private-workspace`，不能改 master/main。

- checkout 固定到当前已审查、已同步部署的提交；安装锁定依赖。node_modules 必须完整且服务账号可读，pnpm-lock.yaml 必须与发布基准一致。
- 发布服务只 fetch、生成对象及推送；不会 checkout/reset 此目录。`WONDER_PUBLISH_CODE_REVISION` 为本次部署提交的完整 SHA。后续 HEAD 仅允许 `src/content/posts/` 改动；发现其他代码变更时暂停发布，先由部署方同步代码、双前端和该基准 SHA。
- 给服务账号配置仅限 leaf_blog 的仓库写权限，凭据保存于服务器私密文件，由 git credential helper 或 repo-local core.sshCommand 使用。不要把 token 放进 remote URL、进程参数、环境日志或聊天。保持 GitHub SSH 主机校验或 HTTPS 证书校验。
- GitHub OAuth App 仍只负责身份，不增加 repo scope，不复用登录 token 发布。如果现有凭据未授权该仓库，先准备所有配置与隔离验证，再由用户在 GitHub 授权最小范围权限。

## 原子上线目录

建议独立的 `/var/www/wonder-published`，只存公开产物：

```
/var/www/wonder-published/
  releases/<版本编号>/
  current -> releases/<版本编号>
```

部署方先备份当前 `/var/www/firefly`，把已上线普通 dist 放入 releases 初始版本，验证权限与完整性。再把 `/var/www/firefly` 配置为指向上述 current 的符号链接，或审查后将 Nginx 博客 root 指向 current；选择与现有配置兼容的方式，验证后才启用发布。应用不会替你迁移现有目录，也不会修改 Nginx。

`current` 必须是软链接，且目标在配置的 releases 内。同一文件系统中用 rename 切换软链接，原版本仍可用。新产物会保留旧版本 `_astro` 哈希资源，兼容持有旧 HTML 的浏览器。

studio-dist 仍在 `/opt/wonder-studio/studio-dist`，不得放入公开 releases。私密预览工作目录也不得由 Nginx 静态提供。CDN 对 HTML 需要及时回源/重新验证，四个 Studio 路径继续绕过缓存；源站切换本身不等于 CDN 已刷新，启用前必须检查公网实际文章和资源版本。

## 环境示例（无密钥）

追加到既有私密环境文件：

```ini
WONDER_PUBLISH_REPO_DIR=/srv/wonder-publisher/leaf_blog
WONDER_PUBLISH_BRANCH=feat/wonder-studio-private-workspace
WONDER_PUBLISH_CODE_REVISION=REPLACE_WITH_REVIEWED_DEPLOYMENT_COMMIT
WONDER_PUBLISH_RELEASE_DIR=/var/www/wonder-published/releases
WONDER_PUBLISH_LIVE_LINK=/var/www/wonder-published/current
WONDER_PUBLISH_ENABLED=0
```

先保持 0 验收。全部前提完成后设 1 并重启 Studio 才启用提交。应用只允许一个 Studio 实例执行发布，不使用进程集群或多副本。

保留 systemd 加固。按实际账号及目录添加最小 ReadWritePaths：草稿数据目录、独立发布 repo 的 Git 对象目录，以及 `/var/www/wonder-published`；不要授予整个 `/var/www`、`/root` 或 sudo 权限。Git 配置/凭据需可读；构建产物目录由服务账号写入、公开产物文件 0644/目录 0755 供 Nginx 读取。验证 PrivateTmp/ProtectHome 等原限制下的 git、Node、依赖和凭据访问，再启用。

## 验收必须覆盖

- 匿名不能访问发布设置、任务、预览 HTML、CSS、图片；跨站 POST 被拒绝。
- 私密预览不产生远端提交，生成的真实页面能显示 Markdown、代码、公式与本地图片；脚本与链接不可执行。
- 修改草稿/移入回收站使旧预览不可确认；远端文章冲突、分支新增提交也不可覆盖。
- 用户确认后只提交文章及其图片；其他私密草稿、来源笔记、数据库、配置、预览目录不进入 Git 或公开目录。
- 重复确认只产生一次提交和切换；断网、构建失败、push 失败和切换失败有明确状态。
- 上线失败重试、进程中断恢复不重复提交。出现 retry 时先处理该任务，不绕开状态开启下一次发布。
- 验证博客首页、旧文章、刚发布文章、图片以及 Studio/导航均正常；公网/CDN 必须核验真实内容，不只看 200。
- 再次编辑已发布草稿，沿用文章路径和 frontmatter 中未编辑字段，更新正文后能再次发布。

## 数据、回滚与后续维护

任务日志在 `WONDER_STUDIO_DATA_DIR/publications/<id>/job.json`，构建工作区和构建日志（含成功构建）也在私密目录。保留此目录与既有 SQLite 备份一起做受保护的文件备份，否则重启/恢复后无法准确识别已提交任务。它不在旧 SQLite 单文件备份内。当前不自动清理任务/版本，需监测磁盘；不得清理最新已发布、ready、publishing、retry 的任务工作区。日志可能包含正文，仅本机私密查看，不粘贴全文。

回退前先关闭发布入口并等待活动任务结束、备份完整私密数据。前后端可成套回到旧版，SQLite v2 不变；公开网站通过把 current 原子切回记录的 previous 版本回滚。**GitHub 提交不会随软链接回滚撤销**；不要 force push。若需要撤销文章，审查后以新的内容提交恢复。发生远端再次变化、无法自动重试的任务时，部署方核对 commit/分支与当前软链接后处理，不能直接删除记录伪装完成。

报告需区分：代码已部署、预览可用、发布权限已启用、用户真实发布验收是否完成。不得因隔离测试通过就宣称线上真实 GitHub 提交已经验收。


## 预览耗时诊断与复用

预览只渲染当前文章，不调用 Astro/Vite 全站编译；发布继续需要用户确认。共享配置在 `src/markdown.config.ts`；受信任的服务端渲染模块和文章样式通过 `pnpm run studio:preview:build` 预先编译成 `.studio-preview/`。`studio:build`、`studio:test` 和本地 `studio` 已包含这一步。运行时复用隔离 Worker，30 秒超时退出，不静默回退到全站预览。点击发布窗口外部不再关闭窗口，关闭按钮、返回写作和 Escape 仍可退出。生成过程中可退出再打开查看同一任务，短暂轮询断网会自动重试，不触发新构建。

任务 API 和私密 `job.json` 新增 `phase`、`timings`、`elapsedMs` 和 `reused`；旧任务没有耗时记录时不推测用时。各阶段为：

- `source`：核对源提交（开启发布时包含 Git fetch）。
- `workspace`：展开源文件和连接已安装依赖。
- `content`：校验正文、元数据和图片。
- `render`：仅渲染当前 Markdown、复制其图片和预编译主题资源；新任务 `previewOnly=true`。
- `icons`、`site`、`search`（仅确认发布后）：图标、Astro 页面和图片、Pagefind 搜索索引。
- `build` 是上述三个构建阶段的合计，不能与它们重复相加。
- `reuse`：文章版本、摘要/日期等生成内容、图片内容、源提交和代码基准都匹配时，复制已成功渲染的单篇预览产物。仍会重新核对源提交，确认发布时继续做版本冲突检查；失败任务不复用。

本机隔离实测（2026-10-13，小文章，包含代码、公式、表格、提示块和图片）：首次约 1.24 秒，修改正文约 0.40 秒，相同请求约 0.45 秒。该数据不是服务器性能承诺；服务器应按相同三场景重新测量。`node --test tests/studio/publication-preview.test.mjs` 验证真实 Git 工作区准备与渲染，任一预览超过 10 秒或触发全站构建都会失败。
服务器部署验证应保留发布关闭状态，先在同一服务账号及权限限制下运行 `node tests/studio/publication-build.smoke.mjs`。该命令仅使用临时草稿库、临时本地裸 Git 仓库和临时上线目录，不提交 GitHub、不切换公网博客。原五分钟等待上限保留，新增阶段输出和复用断言；失败保留临时诊断目录供核查，成功自动清理。

若仍慢，报告任务各阶段秒数及 Astro 日志中构建、页面生成、图片处理各自的用时，并检查当时 CPU、内存/交换分区、磁盘 I/O，以及服务账号对 Astro 图片缓存目录的读写权限。不要仅扩大超时或启用发布来通过验收。日志可能包含文章内容与内部路径，应在服务器查看，仅返回脱敏阶段摘要；不得把整个 publications 目录放入公开站点。

部署必须包含：

- 双前端与后端 `publications.mjs`、`publication-git.mjs`、`publication-preview.mjs`、`preview-worker.mjs`。
- 在独立发布 checkout（`WONDER_PUBLISH_REPO_DIR`）用同一提交及锁定依赖生成 `.studio-preview/renderer.mjs` 和 `assets/`，服务账号可读。只更新 Studio 前端不够；遗漏时会明确提示预览组件未部署。
- `.studio-preview/` 是私密运行时构件，不能放进普通 `dist`、`studio-dist` 或公开 Nginx 目录。每个任务把预览输出放在 `work/preview`，仍通过现有鉴权预览接口返回。`work/dist` 仅在用户确认后产生，禁止将 `work/preview` 当作发布产物。
- 本次无 SQLite 迁移，新任务 buildVersion=3；旧版完整预览继续可读。回滚前保持发布关闭，备份当前任务；旧代码不认识新版单篇预览，不能用旧后端确认这些任务，必须重新检查生成旧版完整构建，或恢复本版后端。不能只回滚 publication-preview 单个模块。

部署时保留已有 OAuth/网络修复及环境配置，等待活动任务结束后再重启 Studio 加载后端改动。真实 GitHub 发布仍待单独验收。
