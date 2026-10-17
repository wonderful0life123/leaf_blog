---
title: 服务器加载codex
category: writing
tags: []
description: ''
published: 2026-10-14T00:00:00.000Z
draft: false
articleId: 'legacy:writing/server-codex-setup.md'
slug: writing/server-codex-setup
---
**找到了，Codex 还在。当前的问题是终端没有加载它所在的 nvm 环境。**

你安装的 Codex 在：
```text
/root/.nvm/versions/node/v22.22.2/bin/codex
```

但之前输出的 `PATH` 没有这个目录，当前 Node 则是 `/usr/bin/node`。这解释了为什么“安装过，却提示找不到命令”。**目前这些现象不构成被入侵的证据。**

先在服务器执行，恢复当前终端环境：

```bash
export NVM_DIR="$HOME/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  . "$NVM_DIR/nvm.sh"
  nvm use v22.22.2
fi
command -v codex
codex --version
```

如果恢复成功，再检查为什么登录时没有自动加载。执行下面的只读检查，把输出一起贴来：

```bash
printf '当前 shell：'
ps -p $$ -o args=
grep -nE 'nvm|NVM_DIR|bashrc|PATH=' \
  /root/.bashrc /root/.profile /root/.bash_profile /root/.bash_login \
  2>/dev/null
```

**刚刚是否重新连过 SSH、开了新终端，或者执行过切换 Node 版本的命令？** 这些都可能让当前终端使用的环境发生变化；具体原因还要看启动配置。



```
nano .codex/config.toml
```


```
nano .codex/auth.json
```



控制台抓包：
```
sudo tcpdump -nn -i any 'tcp dst port 22557 and (tcp[tcpflags] & tcp-syn != 0)' -c 5
```

本地尝试：
```
ssh -p 22557 root@223.254.147.118
```
