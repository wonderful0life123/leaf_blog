# 目录对齐：本地实现与验证记录

日期：2026-10-17。对应计划：`2026-10-17-1158-feat-studio-directory-alignment-plan.md`。
状态：U1–U6 本地实现完成，供用户体验；未提交、未推送、未部署。保留开始工作时的既有修改。

## 已实现

- 树、底部移动面板和文章设置使用同一目录归属。中文目录与文件名可用，标题与文件名独立。
- 单篇发布带自己的正文和位置；批量目录应用只移动公开正文，不带未发布编辑或私人目录。
- 实际 Markdown 文件、博客分类与网址同步移动；历史地址直接 302/no-store 跳到当前地址，允许移回。
- 独立 articleId、schema v4 增加式迁移、持久化发布绑定与幂等恢复。保留草稿正文、标签、回收站和目录撤销。
- 解析 Markdown 引用位置改写链接，保留共享图片，保护嵌套代码中的示例；旧 Astro slug/index 规则及 RSS GUID 保持兼容。
- 公开更新仍走 runtime 快照，不进行日常全站编译。

## 验证结果

- Studio 全套：130/130 通过，`/tmp/wonder-directory-run/suite-final3.log`。
- 普通博客、Studio、runtime、私密渲染构件构建成功。最后一次提示文案修改后又完成 Studio 构建。
- 临时本地裸 Git 演练通过：新增、正文更新、中文目录移动、图片字节、旧址跳转、回移、并发冲突和重启重试。
- 实测确认至完成：本地首次发布 521ms、正文更新 498ms、目录应用 782ms；不是服务器/GitHub/CDN 耗时承诺。
- 浏览器：390×844 下逐级选择目录、确认移动、阅读区同步和撤销通过；恢复桌面尺寸后核对设置目录、独立中文文件名及生成预览（不到 1 秒）；批量检查列表只显示公开文章，正式发布禁用。
- 浏览器未操作正式发布；关闭弹窗后后台任务完成的父界面刷新由代码审查覆盖，未用生产账号验收。
- `git diff --check` 通过。全仓只读 Biome 检查未通过（216 errors/35 warnings/102 infos）；未证明全部属于本轮或既有问题，未执行覆盖全仓的自动格式化。

## 审查与处理

ce-code-review 完成，最终无 actionable findings：
`/tmp/compound-engineering-501/ce-code-review/20261017-130541-9baff7f5/review.json`。

按当前代码验证并在本地修复：旧源摘要冲突保护、未发布仓库文章导入、移动后元数据读取、目录待同步标记、历史路由、静态 RSS 身份、嵌套引用/代码保护，以及目录任务关闭/刷新交互。补充真实 v3 迁移与公开切换后本地确认失败的恢复测试。外部跨模型审查没有运行；使用本地审查流程。

## 当前体验环境

URL：`http://127.0.0.1:4321/studio/`。
隔离数据：`/tmp/wonder-directory-run/preview-data`。
只读内容快照仓库：`/tmp/wonder-directory-run/preview-repo`，不含生产远端。
本地插件启用 `WONDER_STUDIO_LOCAL=1`，并通过 `WONDER_STUDIO_DATA_DIR` 与 `WONDER_STUDIO_PREVIEW_REPO_DIR` 指向上述临时环境，发布开关关闭。

“中文目录体验 / 中文路径体验”为体验数据。可以移动、撤销、调整目录和生成预览；GitHub 和线上博客不会改变。临时 Git 提交仅用于隔离测试/内容快照，不是项目分支提交。

界面截图：`/tmp/wonder-directory-run/workbench-move.png`、`/tmp/wonder-directory-run/chinese-path-preview.png`。

下一步由用户确认本地效果，再单独决定推送和服务器部署；部署范围与 v4 恢复限制见 `scripts/studio/README.md`。

## 本地收尾补充

2026-10-17 后续收尾仅整理本轮涉及的 24 个前端/共享模块：格式、导入顺序、独立变量声明、明确的局部遍历变量及路由类型。控制字符校验正则保留，增加精确说明；未关闭全仓检查规则。

- 作用域内 Biome：0 errors、11 warnings、52 infos。剩余类型/风格建议未作为功能缺陷，未扩大为整体重构。
- 全仓 Biome：122 errors，全部位于本次清理未修改的文件中。与清理前对照，范围外错误数量同为 122，未声称全仓 lint 通过。
- 再次通过 130/130 测试、普通/Studio/runtime 构建及隔离 runtime 发布演练。
- 工作台浏览器重新加载正常。证据日志使用 `/tmp/wonder-directory-run/cleanup-*`、`lint-scoped2.json`、`lint-after-cleanup.json`。
- Code review: skipped (mechanical diff) — 本次收尾是格式和等价语法整理，无新功能；保留前一轮完整审查 receipt，不重复分派审查。
- 交接草案：`2026-10-17-directory-alignment-deployment-handoff.md`。目标 SHA 待真正推送后填写，当前仍未提交、推送或部署。

## 工作台滚动与全站字号补充（2026-10-17）

- 复现：移动面板打开时目录祖先 `inert`，滚轮后 scrollTop 仍为 0；改为仅禁用目录内操作，滚动容器保持可用，复测 scrollTop 到 864。移动对象不会因背景点击而改变。
- 复现：阅读区 `overscroll-behavior: contain` 导致正文顶部继续上滚时页面停在 497；恢复浏览器滚动接续后页面回到 0。正文底部复测也能继续下滚页面。
- 顶部显示设置新增 90/100/110/120% 全站字号，浏览器本地保存、刷新恢复、跨标签同步、恢复默认。保留原手机/桌面基础字号；编辑器独立字号作为基础再跟随全站比例。
- 实际浏览器：工作台正文 120% 为 18.24px；编辑器默认 18px 在 120% 下为 21.6px；公开文章在 120/90% 下为 19.2/14.4px。手机 390×844 的 120% 面板与页面无横向溢出，移动面板关闭正常。测试完成后恢复 100%。
- 针对性测试 23/23；Studio 构建、runtime 构建成功；`git diff --check` 通过。CSS 滚动回归以真实浏览器操作验证，未新增只检查 CSS 字符串的测试。
- 日志 `/tmp/wonder-scroll-font-tests.log`、`/tmp/wonder-scroll-font-studio-build.log`、`/tmp/wonder-scroll-font-runtime-build.log`。本轮仍未提交、推送或部署。


## 最终目录与正文联动验收（2026-10-17）

复用已构建 runtime/私密渲染构件；本轮仅扩展现有隔离 smoke 场景，未修改产品实现，也未重复全量编译。

- 35/35 个目录、路径、归档、发布针对性测试通过。
- 真实 HTTP + 临时本地裸 Git + 实际 runtime 演练通过，共 13 组综合检查。结果：`/var/folders/gn/7y4fsr5n6_x1874m_s0w2fw80000gn/T/wonder-runtime-publish-VE2TgZ/pipeline-results.json`；运行日志 `/tmp/wonder-directory-final-linkage.log`。
- 补齐“中文验收/嵌套目录/第一篇中文文章.md”，标题与文件名独立；整个父目录移动到“公开整理验收”后，Markdown 路径、快照分类和实际网址一致，原文件删除，旧址 302/no-store 跳转，图片字节一致。
- 移动与撤销仅影响工作台，Git 和公开快照不变；确认目录应用后才移动公开版本，私人同目录草稿及正文修改均未泄漏。私人编辑和草稿保留。
- 移动后的正文单独更新仍使用新目录；Git 变更仅包含当前文章和其自己的附件，不牵连其他文章。
- 首轮新增断言把正文更新误限定为仅一个 Markdown 文件；实际会把本篇附件复制到新目录，旧附件保留。核对真实 Git diff 后将断言限定为当前文章及其附件，并增加附件字节断言，复测通过。未因此修改产品代码。
- 此前已有的“单篇发布携带自己的待移动和正文”“批量目录调整不带私人正文”“移回无跳转循环”“失败保留旧版本与重试不重复提交”同轮通过。
- `git diff --check` 通过。本地项目分支未提交、未推送，未访问生产发布服务或修改线上数据。测试 Git 提交仅存在上述临时仓库内。
