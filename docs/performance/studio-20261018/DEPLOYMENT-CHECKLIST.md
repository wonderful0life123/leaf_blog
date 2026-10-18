# 性能批次部署与生产测量清单

本地实现和回归已完成；代码提交为 `9162936`（Studio）与 `5a39060`（公开页面），后续文档提交一并交付。部署目标以最终推送交付消息中的完整 SHA 为准；没有远端核验成功记录时不要执行。不要部署旧基准 `8d106a3` 来代替本批修改。部署前确认最新生产文章提交仍保留。本地开发分支为 `feat/studio-reading-workbench`，生产文章分支最近报告为 `feat/studio-writing-experience`，两者不能混同。

## 一次部署所需范围

| 范围 | 本批影响 |
| --- | --- |
| Studio 前端 | 阅读/编辑渲染、分屏队列、共享页面组件；更新完整 `studio-dist` |
| Studio 后端 | 仅 `scripts/studio/article-status.mjs`、`scripts/studio/publications.mjs`；实例内缓存需要更新后的进程加载 |
| 公开 runtime | 壁纸、搜索、播放器及页面脚本；更新完整 runtime 构件，沿用现有内容快照/发布机制 |
| 私密渲染构件 | 在目标源码上编译一次；仅放私密发布环境 |
| 普通静态博客 | 本地已验证构建；生产目前为 runtime，如不更新备用静态产物，无需为上线重复构建它 |
| 数据库与配置 | 无 schema 变化，无依赖锁文件变化；无需迁移或重装已有匹配依赖 |

部署前读取实际状态，备份本次会替换的代码/构件与现行私密数据；复用已经核验有效的最新备份，避免无依据地反复制作完整副本。保留 OAuth、网络修复、环境文件、Nginx/CDN/TLS、草稿、图片、publications、目录状态及既有运行模式。不要启用旧部署 timer，不合并 master，不强推文章分支，不用测试数据覆盖生产。

## 避免重复构建

在独立工作区、确认正确 SHA 与依赖后，按现有部署脚本执行。对同一源码、配置及依赖组合，私密渲染器、图标、Studio、runtime **各生成一次**；构建记录、测试和切换使用这些同一批产物。

现有 `studio:test`、`studio:build`、`runtime:build` 都可能调用私密渲染构建。需要去重时，可按其 package.json 等价拆分：

1. `node scripts/studio/build-preview.mjs` 与 `node scripts/generate-icons.js` 各一次。
2. `node --test tests/studio/*.test.mjs`；不要再通过会重复编译的包装命令运行同一测试。
3. Studio：清除遗留 runtime 构建环境变量后，`WONDER_STUDIO_BUILD=1 ASTRO_TELEMETRY_DISABLED=1 node node_modules/astro/bin/astro.mjs build`。
4. runtime：使用 `scripts/runtime/build.mjs` 中相同的 Astro 环境，即 `WONDER_RUNTIME_BUILD=1 WONDER_RUNTIME_COMPILING=1 WONDER_STUDIO_BUILD=0 WONDER_STUDIO_LOCAL=0 ASTRO_TELEMETRY_DISABLED=1 node node_modules/astro/bin/astro.mjs build`，复用第 1 步前置构件。
5. 使用现有隔离 runtime smoke 一次，固定本地裸 Git 远端和临时数据；勿把生产目录设为演练目标。

上述前端构建应串行，避免共享 `.astro` 状态竞争。没有代码/配置变化或验证失败，不为同一个验收项目重新构建。记录构建与验收分别耗时，不能用本地约几秒的结果承诺服务器同样耗时。

按既有可回滚方式成套切换。后端及公开 runtime 的必要重启/重载集中执行一次；发布基准、发布仓库和实际运行构件应一致。更新基准需保留上线期间的新文章，不能把旧快照当成新内容。保持原发布开关意图；临时维护关闭后仅在成功验收时恢复。失败按本次备份回滚代码/构件，不能覆盖之后新增的用户数据。

## 足够且有针对性的验收

- 使用隔离数据做一轮浏览器检查：切换短文/长文/代码文章、复制、即时渲染/源码/分屏、保存刷新、恢复正文状态、目录待移动状态。
- 桌面及手机各一次：公开首页→文章→归档→Studio→公开页；音乐列表开关与切页后的控件；搜索下拉→完整搜索→文章，查询更换与清空无旧结果覆盖。
- 核对实际返回的 HTML 和新增 JS/CSS 内容或哈希；新播放器共享模块与搜索模块必须可访问。HTTP 200 本身不足以确认版本。
- 默认入口和当前 DNS 节点核对新版本；超时与旧缓存分开记录。没有证据时不要反复复测历史失效节点，也不要重跑多轮无差异大资源下载。
- 使用一次已认证的含图私密预览，在默认入口及当前 DNS 节点对同一 HTML/CSS/图片/任务路径匿名复测。应为 401、no-store、错误 JSON；禁止用带缓存破坏参数的 URL 替代原路径。尽量复用既有合规测试会话；若需用户操作，只请用户打开预览，不索取 Cookie。
- 不代替用户发布真实文章。隔离 smoke 通过和生产首篇文章验收分别报告。

## 上线前后测量：同设备、同内容、同网络

| 场景 | 最小记录 |
| --- | --- |
| Studio 列表/目录/打开草稿 | 首次和随后 5 次分别记录请求响应时间；区分浏览器端与服务器处理时间 |
| 编辑与阅读 | 同一长文/多代码块文章切换，分屏输入，持续滚动；记录 Long Task/交互观察，不能把 click→rAF 当作 INP |
| 访客首屏 | 桌面和手机各冷加载一次，暖导航一次；HTML/图片/JS 字节、请求数、TTFB；确认仅当前尺寸壁纸被选择 |
| 搜索 | 初始不请求搜索引擎；同一关键词的命中数及详情请求数；新发布后的索引更新沿用现有机制 |
| 预览和发布 | 分开记录 source/workspace/render/snapshot/feeds/search 与 GitHub 时间；生产发布由用户操作 |
| 代码部署 | 私密渲染、Studio、runtime、快照、切换、验收分别计时，同时记录 CPU steal、可用内存和磁盘 |

只比较同条件前后结果。不满足条件时报告绝对值与限制，不能套用本地百分比。若仍卡顿，下一轮以生产最慢的实际路径为目标，不再无差别增加缓存或扩大任务范围。
