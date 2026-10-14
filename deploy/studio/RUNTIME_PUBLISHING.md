# 日常文章快速发布：部署与回滚

本版本新增显式开启的 `runtime` 发布模式，默认仍为 `static`。无需迁移 SQLite。目标是日常文章不再执行 Astro/Vite 全站编译；主题代码部署仍须构建。不要仅替换前端后就开启开关。

## 行为及边界

- 保留原 Studio 预览、明确确认、GitHub 提交及推送、冲突保护、失败重试。推送成功才原子切换公开内容版本。
- Markdown 只在发布时渲染；未变化文章复用渲染结果。公开 Node 服务沿用现有主题模板，请求时组合页面；首页、归档、文章、全文 RSS、站点地图、搜索及图片共同读取同一版本。
- `published.json` 是内部快照，不通过 HTTP 提供。只包括已发布文章；Studio 草稿库、私密预览保持原鉴权和目录。
- 当前支持普通 Markdown、代码、数学公式、表格及 PNG/JPEG/GIF/WebP/AVIF 本地图片。图片保留原始字节，不进行 Astro 图片优化。已发布 MDX、加密文章及自动 OG 图片生成会明确阻止快速发布；这些需求继续使用 static 模式。草稿 MDX 不公开。
- 不承诺服务器毫秒级上线：GitHub 网络、服务器 CPU、页面负载及 CDN 仍影响端到端耗时。此实现每次重建全文搜索索引，适用于当前小规模博客，尚未做大规模文章/高并发负载测试。
- 本机正式流程实测：首次确认到完成 637ms，正文/元数据修改 621ms；包含本地裸 Git 推送，不包含 GitHub/CDN。全流程无 icons/site 编译，编译产物哈希不变。

## 部署前准备（一次）

1. 确认目标代码 SHA，核对远端最新正式文章没有遗漏。代码来源分支为 `perf/studio-daily-publishing`；文章发布目标仍应是明确授权的 `feat/` 分支。该分支必须包含目标代码 SHA，随后只能增加 `src/content/posts/` 内容改动。若目标 SHA 尚未进入文章分支，先完成经用户授权的快进/集成，不能改成旧基准或绕过保护。
2. 临时关闭发布，等活动任务结束，并处理所有 retry 任务。保留旧公开静态产物、Studio 前端、后端、环境配置和 Git 状态；生成最新私密数据一致备份。不要覆盖 `/root/Firefly`、OAuth 修复、数据库或图片。
3. 在独立、干净的目标 checkout 使用仓库指定的 pnpm 9.14.4 安装锁定依赖。逐项执行一次：

```sh
pnpm install --frozen-lockfile
pnpm studio:test
pnpm build
pnpm studio:build
pnpm runtime:build
pnpm runtime:test
```

`runtime:test` 使用临时 SQLite、真实本地 HTTP、临时裸 Git 远端；不推送 GitHub。它验证两次发布、冲突、失败恢复、全文 RSS、站点地图和图片。允许回环监听即可；不要与并行压测同时运行。无需重复多轮全量构建。

产物：`dist` 为静态回退版本；`studio-dist` 为私密 Studio 前端；`runtime-dist` 为公开服务代码；`.studio-preview` 为发布时使用的私密渲染构件。各自放在独立位置，禁止将 snapshot、publications 或 `.studio-preview` 暴露为 Nginx 静态目录。

## 内容目录及初始快照

示例路径，实际部署时先核实权限，不覆盖已有目录：

- 发布 checkout：`/srv/wonder-publisher/leaf_blog`，固定目标 SHA；包含依赖、`runtime-dist` 和 `.studio-preview`。
- 内容版本：`/var/lib/wonder-public/releases`。
- 活动版本软链接：`/var/lib/wonder-public/current`，与 releases 同级。
- 独立公开服务：`wonder-public.service`，仅监听 `127.0.0.1:4313`。

内容目录由 Studio 服务账号写入；公开服务用独立无 Git/OAuth 凭据的账号，只读这些目录和运行时代码。父目录可使用专用组限制访问，初始快照须授予该组读/目录遍历权限。公开服务不需要读取 Studio 数据目录。示例 unit 和环境文件见本目录 `wonder-public.service.example` 与 `wonder-runtime.env.example`。

在目标 checkout、以发布服务账号执行初始化（环境变量的 SHA 必须完整）：

```sh
WONDER_RUNTIME_CODE_REVISION=<TARGET_SHA> \
WONDER_RUNTIME_RELEASE_DIR=/var/lib/wonder-public/releases \
WONDER_RUNTIME_LIVE_LINK=/var/lib/wonder-public/current \
node scripts/runtime/initialize.mjs
```

父目录提前创建；命令拒绝替换已有 current。初始化不提交 Git、不发布草稿。检查当前快照、全文 RSS 和媒体只来自已发布内容，然后启动公开服务。初始化前后不要同时发布文章。

公开服务环境（独立文件，不复制 Studio 的秘密）：

```ini
WONDER_RUNTIME_CODE_REVISION=<TARGET_SHA>
WONDER_RUNTIME_RELEASE_DIR=/var/lib/wonder-public/releases
WONDER_RUNTIME_LIVE_LINK=/var/lib/wonder-public/current
WONDER_RUNTIME_PORT=4313
```

Studio 原有配置只追加/修改以下字段，保留其他配置及网络修复：

```ini
WONDER_PUBLISH_MODE=runtime
WONDER_PUBLISH_CODE_REVISION=<TARGET_SHA>
WONDER_PUBLISH_REPO_DIR=/srv/wonder-publisher/leaf_blog
WONDER_PUBLISH_RELEASE_DIR=/var/lib/wonder-public/releases
WONDER_PUBLISH_LIVE_LINK=/var/lib/wonder-public/current
WONDER_PUBLISH_BRANCH=feat/studio-writing-experience
WONDER_PUBLISH_ENABLED=0
```

发布分支填写实际经授权并含目标 SHA 的分支。代码版本、公开服务、渲染构件、发布仓库必须一致。不要在运行服务设置 `WONDER_RUNTIME_COMPILING`，它仅用于代码构建。

## Nginx / CDN 与首次切换

先通过本地端口验收首页、原文章、归档、RSS、搜索；保留 `/studio/`、Studio API/OAuth 和私密预览的现有 location 与鉴权。仅把公开网站兜底路由代理到 4313；Node adapter 同时提供其 `runtime-dist/client` 静态资源。传递原 Host 与正确的转发协议，开启该 adapter 所需的代理信任配置时只信任本机 Nginx。不要改 TLS/CDN 回源校验来完成本次功能切换。

切换前在 CDN 明确禁用以下路径的边缘缓存，并清除既有缓存：

- 公开 HTML：首页、分页、文章、归档、分类和其他页面；可用“除以下明确版本化资源外全部旁路”的规则。
- `/api/allPostMeta.json`、`/rss.xml`、`/sitemap-index.xml`、`/sitemap-0.xml`。
- `/runtime-release.json`、`/pagefind/pagefind.js`。

只有 `/_astro/` 哈希资源、`/runtime-search/<版本>/` 和 `/published-media/<版本>/` 可长期缓存。已有 Studio/私密预览旁路规则保留。服务返回 no-store 不是 CDN 实际遵守的证明；线上以相同 URL 的新文章内容/版本检查交付，不能只检查 HTTP 200。运行时模式关闭 Swup 的 HTML 缓存与预加载，浏览器搜索每次核对当前内容版本。

Nginx 配置检查通过后切换公开兜底路由并 reload；Studio 同步本轮后端模块及 `scripts/runtime`，通过现有启动方式重启一次读取模式配置。首次切换需要这些步骤，普通发文不重启任何服务。

确认旁路服务、公开页面及私密隔离正常后，将发布开关恢复为 1。用户重新生成预览再确认发布，旧模式的预览不能直接确认。首次真实发布核对：Git commit、文章及图片、首页/归档、RSS、站点地图、搜索，以及默认入口与之前异常 CDN 节点的相同路径内容。记录 source/snapshot/feeds/search 阶段，确认没有 site/icons 全站编译；不要让用户再次等待几十轮重复验收。

## 备份、保留与回滚

- 原 Studio 私密备份继续启用；另备份 `/var/lib/wonder-public`（包括软链接与版本目录）、公开服务代码和环境配置。原 Studio 备份不自动包含新目录。
- 旧媒体/搜索地址不可随意删除。当前快照可能复用旧版本图片；`manifest.json.mediaReleases` 标明引用版本。清理时至少保留当前、回滚、所有被引用媒体版本，并为已打开页面保留搜索版本。此版本不自动删除内容版本。
- 日常内容回退：关闭发布并等待无活动任务后，原子将 current 指向**同一代码 SHA**的旧内容版本。无需重启公开服务。此操作不会撤销 GitHub 提交，恢复发布前须核对分支与内容状态。
- 整套退回静态：关闭发布并处理任务，恢复原 Nginx 公开静态路由与旧静态产物；恢复 Studio 前端/后端及原 `WONDER_PUBLISH_*` 配置，重启 Studio；检查公开网站后停止公开 Node 服务。不要拿旧 SQLite 覆盖当前数据。若快速发布后已有新文章，旧静态产物不包含它们，应先从当前 Git 内容生成静态产物再切换，或明确告知内容回退。
- 以后更换代码 SHA：旧服务只读取匹配 SHA 的快照。使用新的版本目录/软链接准备新快照与旁路服务，再成套切换，不能直接用新 SHA 启动服务读取旧快照。

本地测试没有验证生产 GitHub 网络、CDN 或真实断电恢复。以上是一次架构切换交接；后续普通文章发布不应再执行整套部署验收。
