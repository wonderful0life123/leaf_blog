# 给服务器 Agent：部署 Wonder 私有写作空间

## 交付边界

这次增加 GitHub 身份登录、私有草稿/图片服务与备份。未实现 GitHub 文章提交、构建预览或发布。原博客仍由 Nginx 静态服务提供，写作后台是独立 Node 进程；不要使用 `astro dev` 上线，不要覆盖现有博客 Nginx 配置或其他应用的路径。

依据用户提供的服务器审计：博客源码在 `/root/Firefly`，公开目录 `/var/www/firefly`，另有 `/root/obsidian_note`。旧自动部署会 `git reset --hard`，因此后台代码和数据需要独立目录。

本地验证使用模拟 GitHub 响应覆盖授权、拒绝非主人、CSRF、PKCE、state 防重放、会话过期/注销、重启持久化、草稿图片和版本冲突。真实 OAuth 回跳和此服务器上的 systemd/Nginx 尚需按下面步骤验收。

## 1. 准备独立目录与账号

建议布局：

```text
/opt/wonder-studio/                 # 本次代码版本，含 node_modules 和 studio-dist
/srv/wonder-sources/leaf_blog/      # 博客内容的只读工作副本
/srv/wonder-sources/obsidian_note/  # 笔记的只读工作副本
/var/lib/wonder-studio/            # 私密数据；唯一需要写入的目录
/etc/wonder-studio.env             # OAuth 配置，root:root 0600
```

先核实 Node 路径及版本（22.13+，推荐使用已受支持的 Node 22 更新版本）、端口 4312 空闲、现有 HTTPS server、磁盘余量和现有服务。模板中的 `/usr/bin/node` 应改成核实后的系统 Node 路径，不要依赖交互式 shell 的 nvm。

创建专用无登录账号 `wonder-studio`。部署代码用独立 checkout 或审查后的源码包；不要修改 `/root/Firefly` 分支或重置服务器未提交文件。构建可由部署账号进行，运行时由 `wonder-studio` 读取代码和内容，只有数据目录可写。

将两个仓库的读取副本放到 `/srv/wonder-sources` 并给服务账号读取权限；不要为读取 `/root` 而关闭 `ProtectHome` 或扩大 root 目录权限。可用独立 clone，也可从现有 checkout 复制干净内容。配置里的文章根目录必须指向 `src/content/posts`。当前不做笔记自动拉取或全库自动发布，来源更新由部署方显式执行。

## 2. 用户创建 GitHub OAuth App（密钥不进入聊天）

由用户在 GitHub Settings → Developer settings → OAuth Apps → New OAuth App 中创建：

- Application name：`wonder 写作空间`
- Homepage URL：`https://wonder-ai.info/studio/`
- Authorization callback URL：`https://wonder-ai.info/studio-auth/callback/`

入口：<https://github.com/settings/applications/new>

将 Client ID 和生成的 Client Secret 直接填写到服务器的 `/etc/wonder-studio.env`。复制本目录 `server.env.example` 作模板，替换占位符。不要通过聊天、截图、Git 提交、命令参数或命令回显传递密钥。

允许账号编号已通过 GitHub 公开 API 核实：`wonderful0life123` → `222740128`。权限检查使用稳定的数字 ID，而非可改名的用户名。此 OAuth 应用只用于身份确认，授权请求不申请 repo/email scopes；不要复用曾被授予仓库权限的其他 OAuth App。将来发布使用单独、明确授权的仓库访问方案。

如果正式域名改变，必须同时更新 Origin 和 GitHub callback URL。配置不完整会拒绝启动；不要设置 `WONDER_STUDIO_DEV_HTTP` 或本机免登录开关。

## 3. 构建与启动

在独立代码目录安装仓库锁定的依赖（使用项目指定的 pnpm），执行：

```sh
pnpm install --frozen-lockfile
npm run studio:test
npm run studio:build
```

这会生成 `studio-dist`，不覆盖普通博客的 `dist`。写作 HTML 不内嵌笔记或草稿；运行时登录后从 API 读取内容。Node 仅提供 `/studio/`、`/studio-static/`、`/studio-auth/` 和 `/studio-api/` 这些明确路由。

**不要将 studio-dist 整个同步到 /var/www/firefly**；其中其他公开博客页面是构建框架的附带产物，后台仅使用写作外壳和 `studio-static` 资源。原博客继续按原部署流程运行。

安装 `wonder-studio.service`、`wonder-studio-backup.service`、`wonder-studio-backup.timer` 到 systemd 单元目录，核实用户名、路径、环境文件权限后 daemon-reload，启动写作服务并查看日志。写作进程只监听 `127.0.0.1:4312`。

注意：服务账号必须有两个来源根目录的读取权限。缺少目录时仍可新建草稿，但目录不会出现在笔记库。

## 4. 接入 Nginx

先备份现有 Nginx 站点配置，将 `nginx.conf` 里的 location 块加入 **现有 wonder-ai.info 的 HTTPS server**，不要另建冲突的同域 server。

保留 `/` 的静态服务及 `/v1/`、`/responses`、`/byok/` 等所有既有代理。确认 Host 转发为 `wonder-ai.info`，不要将 `proxy_pass` 添加尾路径而剥掉前缀。运行 `nginx -t` 成功后再 reload。

草稿、会话、回跳接口均禁止缓存；OAuth 回跳路径不记录查询字符串。若另有 CDN/缓存层，必须为这四个路径绕过缓存。TLS 在现有 Nginx 终止，服务使用配置的 HTTPS Origin 生成 Secure Cookie。

## 5. 上线验收（必须真实完成后才算上线）

1. 未登录访问 `/studio/` 看到 GitHub 登录入口，页面源码不包含笔记内容。
2. 未登录请求 `/studio-api/drafts/`、`/studio-api/catalog/` 和已知图片 URL 返回 401。
3. 用户用自己的 GitHub 账号完成真实授权，回到写作页；其他 GitHub 账号无法进入。
4. 新建测试草稿、修改标题/正文/分类/标签，上传一张图片；等“已保存到服务器”后刷新。
5. 在另一设备登录，打开同一草稿验证文字和图片；两个页面同时改动应出现冲突提示，不得静默覆盖。
6. 保存后重启 **wonder-studio 服务**，验证草稿、图片、登录会话仍存在。
7. 退出登录后，原 Cookie 再访问草稿接口必须返回 401。
8. 确认博客首页、文章页以及同服务器其他应用路径正常。
9. 启动并 enable 备份 timer，手动运行一次备份 service，确认产物和权限，并在临时目录做恢复验证。

回报用户时只提供状态、公开网址和必要日志摘要，不粘贴环境文件、OAuth code、Cookie 或 token。

## 6. 草稿迁移、备份与恢复

服务器默认为空草稿库；本机草稿不会自动上传。若用户要迁移，用本机 `npm run studio:backup` 生成一致性快照，通过用户信任的传输方式交给服务器。**仅在目标草稿库为空、服务停止时**复制为 `/var/lib/wonder-studio/studio.sqlite` 并设 owner/mode。已有服务器草稿时不能直接覆盖，需另做按 ID 合并迁移。

`studio.sqlite` 包含正文与图片；`auth.sqlite` 仅含会话哈希和短期登录 state，不保存 GitHub access token。会话最长 7 天，退出登录立即撤销当前会话。

每日 03:15 的备份 timer 使用 SQLite `VACUUM INTO` 生成正文和图片的一致性快照，写入 `backups/`；应用在当天首次修改已有草稿前也会按需备份。备份不包括会话数据库，恢复后重新登录即可。当前不自动清理备份，需检查磁盘容量；将备份同步到用户选择的独立安全备份位置并配置保留策略后，才具备机器丢失情况下的恢复能力。

恢复：停止服务 → 把整个旧数据目录移动到安全位置留存 → 创建新的私密数据目录 → 将选定备份复制成 `studio.sqlite` → 设置服务账号权限 → 启动。不要混入旧 WAL/SHM 文件，不要在运行中替换数据库。

## 7. 回退

先保留数据和备份。停止后台服务/备份 timer，撤销本次新增的四组 Nginx 路径并验证、reload；原静态博客不依赖这个服务。代码升级应先备份再替换独立 checkout。不要删除草稿库或改写博客 master。

## 参考

- GitHub 官方 OAuth 流程（state、PKCE、回调及每次登录重新核实身份）：<https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps>
- GitHub OAuth App 创建：<https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app>
## 8. 登录回跳 `loginError=unavailable` 的排查

此错误发生在服务端交换 OAuth token 或读取 GitHub 用户信息时。不能仅凭该错误认定是网络、密钥或账号权限问题。

更新 `scripts/studio/auth.mjs` 并重启 `wonder-studio.service` 后，让用户从 `/studio/` 发起一次新的登录。旧授权回调不可重放。只提取诊断日志：

```sh
journalctl -u wonder-studio.service --since '10 minutes ago' --no-pager | grep -F '[studio] OAuth upstream failure'
```

日志仅包含阶段、HTTP 状态和白名单错误标签，不包含令牌、授权码、state、Cookie、Client Secret、请求或响应正文。

| 日志字段 | 下一步 |
| --- | --- |
| `stage=token_exchange`, `reason=incorrect_client_credentials` | 在服务器本机核对 Client ID 和 Secret 是否属于同一个 OAuth App；修改环境文件后重启服务，不输出其值。 |
| `reason=redirect_uri_mismatch` | 核对 GitHub 应用回调地址与 `https://wonder-ai.info/studio-auth/callback/` 完全一致。 |
| `reason=bad_verification_code` | 重新从登录入口授权，排查重复回调及 PKCE 配置；不重放旧 code。 |
| `reason=network_error` | 根据 `networkCode` 检查 DNS、TLS、出站连接及超时；在相同 Node 版本和服务运行环境中核验，curl 成功不能替代 Node fetch 验证。不要关闭 TLS 校验。 |
| `stage=user_profile`, `reason=http_error` | 按 HTTP 状态检查 GitHub 用户接口访问，401 为 token 被拒绝，403/429 需检查限流等上游限制。 |
| `reason=invalid_json/missing_access_token/invalid_profile` | 检查上游是否被代理替换或返回异常；只报告脱敏状态，不输出完整响应。 |

仅此后台诊断变更无需重新构建前端或部署博客静态产物。保留 OAuth 环境文件、数据库及备份，实际登录成功后再宣布故障已解决。
