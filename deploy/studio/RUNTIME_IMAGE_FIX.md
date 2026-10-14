# 中文目录图片修复交接（2026-10-15）

适用于已经完成 `24890bec284771d2bab8fdf03d4180120f5ae0e4` 准备、尚未切换公网的部署。

## 原因与验证

Markdown 将 `img.src` 中的中文转为百分号编码；旧渲染器仅按原始 URL 查表，导致 HTML 仍使用相对地址。修复在已验证的资源映射内比较一次解码后的 URL，优先精确匹配，不新增磁盘路径解析。已覆盖中文、预编码、混合编码、空格、emoji、百分号、方括号；代码示例与外部图片不改写。

- `node scripts/studio/build-preview.mjs`：成功。
- `node --test tests/studio/*.test.mjs`：96/96 通过。
- `node tests/studio/runtime-publish.smoke.mjs`：通过。额外请求既有 `/posts/ai-infra/cuda/global-indexing/` 的三张真实图片，发布前/后均 200，逐字节一致；全文 RSS 使用对应版本化图片 URL。

## 本次增量部署

1. 发布继续关闭，公网继续静态博客。核对代码分支最新 SHA，将授权文章分支普通快进到修复提交；不强推，不覆盖更新的文章。
2. 更新发布 checkout 及 Studio 使用的 `scripts/studio/publication-renderer.ts`，执行一次 `node scripts/studio/build-preview.mjs`，同步 `.studio-preview` 到发布实际使用位置。不要只更新源码而继续用旧编译文件。
3. 本次仅渲染器逻辑、测试和文档改变，依赖锁文件、三套前端源码及公开运行时服务代码均未改变。与 24890be 对比确认后，可复用已验收的 dist、studio-dist、runtime-dist；无需重复依赖安装、三次前端构建。公开页面服务同样读取新生成的内容快照。
4. **必须重新生成初始内容快照**：旧快照已存有错误 HTML，仅替换 renderer 不会自动修复它。保留旧目录，在新的 releases/current 路径下用 `runtime:initialize` 从修复提交生成快照；命令拒绝覆盖已有 current。以现有服务账号执行并保留公开服务只读权限。
5. 将 Studio 的 `WONDER_PUBLISH_CODE_REVISION`、公开服务的 `WONDER_RUNTIME_CODE_REVISION` 同步到修复 SHA，两个服务的 releases/current 配置指向同一新版本目录。按现有方式重启读取环境；公开仍只监听回环端口。不要更改 OAuth、数据库、私密任务目录或 TLS。
6. 在本地端口请求原 CUDA 文章，取**实际 HTML 中**的三张图片 URL，确认均为 `/published-media/...`、返回 image 类型和正确字节；检查全文 RSS 同步。再执行一次隔离 `runtime:test` 即可，无需重复多轮历史验收。

CDN 旁路/清缓存是独立阻断项，本补丁不代表 CDN 已修复。保持发布关闭及静态公网，直到 QEdge 规则生效并完成实际交付验证，再按主部署文档切换公开入口、恢复发布，由用户进行首次真实发布。
