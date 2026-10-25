# Cloudflare DoH ECS · 短 TTL 版

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2FPhysica-sage%2Fcloudflare-doh-ecs)

基于 [Akiiia/cloudflare-doh-ecs](https://github.com/Akiiia/cloudflare-doh-ecs) 的个人 fork。此 Worker 专门接收 Mihomo **“漏网之鱼”所选代理出口**发来的 DNS 查询，统一转发 Google DoH，并提供动态 ECS 和可控 DNS TTL。国内 DNS 策略留在 Mihomo；Worker 对收到的所有域名使用同一对上游，包括用户自己的域名。

## 这个版本改了什么

- 默认把普通 DNS 记录的 TTL 限制在 **5 秒以内**；原本为 0、1、2 秒的记录不会被延长。
- `DNS_TTL_MAX=0` 返回零 TTL，适合希望 Mihomo 每次重新查询的场景；`upstream` 保留上游 TTL。
- 同时处理 A、AAAA、CNAME 链及 SOA 负缓存；保留 OPT、ECS、DNSSEC 签名数据。
- 默认从 Cloudflare 的 `CF-Connecting-IP` 读取当前连接来源，生成 IPv4 `/24`、IPv6 `/56` 的 ECS。
- 国外默认 **Google DoH → Google 8.8.4.4 DoH**，避免故障回退后悄悄换成不同 ECS 行为的提供商。这是同一服务商的两个接入地址，不是独立运营商容灾。
- Worker 已移除国内分流、域名分类规则、KV 及定时更新；部署只需要 Worker 和环境变量。
- Worker 不保存 DNS 应答缓存。HTTP 请求和响应使用 `no-store`。
- 已添加配置、TTL 报文、代理出口切换测试，以及 GitHub Actions 检查。

## 一键部署

1. 点击顶部 **Deploy to Cloudflare**，登录 Cloudflare，并按页面授权访问你的 GitHub。
2. 按页面创建部署仓库和 Worker。由于你已拥有这个 fork，Cloudflare 若提示仓库重名，给部署副本换一个名字即可。
3. 保持默认值即可开始。只需部署 Worker，无需 KV、数据库或定时任务，也不用下载规则。
4. 部署成功后，DoH 地址为：
   ```text
   https://<你的 Worker 域名>/doh
   ```
5. 在 Mihomo 中将这个地址指定为经“漏网之鱼”代理组访问的 DNS 上游。Worker 收到请求后直接查询上游，没有规则初始化步骤。

若想直接部署当前 fork、避免 Cloudflare 再创建仓库：Cloudflare 控制台 → Workers & Pages → 创建应用 → 导入 Git 仓库 → 选择本仓库，安装命令 `npm ci`，部署命令 `npm run deploy`，使用默认根目录。若界面需要构建命令，可填 `npm run typecheck`；Wrangler 会在部署时打包 TypeScript。

`/doh` 是协议接口，只支持标准 DoH GET / POST；直接在浏览器打开根路径或不带 DNS 报文打开 `/doh`，返回 404 / 400 是正常现象。可用下面的检测脚本检查真实 DNS 应答。

## Mihomo 配置

国内查询继续由 Mihomo 直接交给国内 DNS；其余查询（包括没有命中 `geosite:cn` 的自有域名）经选中的代理节点访问 Worker。Worker 不进行第二次国内外分类。完整示例见 [examples/mihomo-dns.yaml](examples/mihomo-dns.yaml)，替换 Worker 域名和代理组名称即可。

```yaml
dns:
  enable: true
  respect-rules: true
  default-nameserver:
    - 223.5.5.5
    - 119.29.29.29
  proxy-server-nameserver:
    - 223.5.5.5
    - 119.29.29.29
  nameserver:
    - "https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/doh#漏网之鱼"
  nameserver-policy:
    "geosite:cn":
      - "https://dns.alidns.com/dns-query#DIRECT"
      - "https://doh.pub/dns-query#DIRECT"
  direct-nameserver: []
```

- “漏网之鱼”必须选中实际代理节点。选择德国节点时，Worker 看到的连接来源通常就是该德国出口；切换香港节点后，下一次查询会注入香港出口的网段。端到端效果仍需用实际节点验证。
- Worker 的域名由 `default-nameserver` 引导解析；代理节点域名由 `proxy-server-nameserver` 独立解析，避免启动循环。
- `direct-nameserver: []` 让直连解析也遵循同一套策略，避免额外的直连解析器使用不同上游。
- 配置到 OpenWrt 或手机时无需再运行 MosDNS。请确认客户端没有覆盖 DNS 设置。
- 首次切换到这套 DoH 后清理一次旧 DNS 缓存或重启核心。后续本地 TTL 默认最多 5 秒；要避免切换节点时继续使用上一个地区的缓存，可设 `DNS_TTL_MAX=0`。
- `fake-ip-ttl` 不控制真实 DNS 缓存，本项目改的是 DNS 报文里的真实记录 TTL。

## 环境变量

在仓库的 `wrangler.jsonc` 修改后重新部署，可使后续构建保留设置。若临时在 Cloudflare 控制台修改变量，也要重新部署并留意下一次 Git 构建可能恢复仓库配置。

| 变量 | 默认值 | 说明 |
|---|---|---|
| `DOH_PATH` | `/doh` | DoH 路径 |
| `DNS_TTL_MAX` | `5` | `0..86400` 的整数秒；`0` 不缓存；`upstream` 不改写 |
| `TRUST_X_FORWARDED_FOR` | `false` | 默认取 CF 提供的连接来源；仅在有受信任前置代理时改为 `true`，此时优先取 XFF 中的第一个合法公网 IP |
| `GLOBAL_DOH_URL` | `https://dns.google/dns-query` | 国外主上游，支持 ECS |
| `GLOBAL_FALLBACK_DOH_URL` | `https://8.8.4.4/dns-query` | 国外备用 Google 接入地址 |

每个上游超时 3 秒。连接失败、HTTP 错误、无效 DNS 响应或 DNS SERVFAIL 时使用备用 Google 接入地址；合法 NXDOMAIN 正常返回。所有域名都使用同一对上游。

## 地区解析与刷新速度的边界

1. **目标权威 DNS 必须支持并采用 ECS。** ECS 提供调度依据，不能保证所有域名都返回所选节点国家的 IP；结果仍由域名运营方和地理数据库决定。
2. 当前配置使用 Workers 默认靠近请求入口执行的行为，没有启用 Smart Placement 或固定区域。Anycast 由网络路由选择入口，不保证任何时刻的绝对最低延迟。地区解析仍用连接来源网段生成 ECS，不把 Worker 机房位置当成节点位置。
3. **短 TTL 只减少客户端这层缓存。** Google 上游仍可能保留旧答案，Worker 不会强迫它们绕过缓存，也不是完整递归解析器。
4. `Cache-Control: no-store` 只管 HTTP，不能替代 DNS 报文 TTL。本版本两者都处理。
5. 若用其他 CDN、反向代理或 Worker 转发这条 DoH，连接来源可能变成中间服务器。优先直接绑定 Worker 自定义域名；确有受信任前置代理时再配置 XFF。
6. 不记录完整查询域名和客户端 IP。公开使用的服务可自行在 Cloudflare 配置限速；本项目没有附加认证要求。

## 从上一版更新

重新部署当前分支后，应用不再使用 `RULES_KV`、`DOMESTIC_DOH_URL`、`DOMESTIC_FALLBACK_DOH_URL` 或 Cron。若旧部署残留这些绑定或计划任务，可在 Cloudflare 控制台确认后手动移除；这个代码更新不会删除已有 KV 数据或账号资源。Google 主备地址和 DoH 路径保持不变。

## 本地开发与验证

需要 Node.js 22 或更高版本：

```sh
npm ci
npm run check
npm run dev
```

`npm run check` 包括 TypeScript 检查、测试和 Wrangler 部署预演，不会发布到 Cloudflare。

本地 Worker 或已部署服务可这样测试：

```sh
node scripts/check-doh.mjs http://127.0.0.1:8787/doh example.com A
node scripts/check-doh.mjs https://<你的 Worker 域名>/doh example.com AAAA
node scripts/check-doh.mjs https://<你的 Worker 域名>/doh o-o.myaddr.l.google.com TXT
```

脚本输出 DNS 状态码、各记录 TTL、A/AAAA/TXT/CNAME 等内容，以及响应中可能出现的 ECS；不把 HTTP 200 直接当作 DNS 成功。地区验证需让这些请求实际经过不同代理出口，再与已知分地区域名的预期结果对照。

## 项目来源与协议

原项目：[Akiiia/cloudflare-doh-ecs](https://github.com/Akiiia/cloudflare-doh-ecs)，MIT License，原版权声明保留。本 fork 已移除原项目的国内域名规则模块。

参考：[Workers 执行位置](https://developers.cloudflare.com/workers/configuration/placement/)、[Cloudflare 一键部署](https://developers.cloudflare.com/workers/platform/deploy-buttons/)、[Google ECS](https://developers.google.com/speed/public-dns/docs/ecs)、[RFC 2308 负缓存](https://www.rfc-editor.org/rfc/rfc2308)、[RFC 7871 ECS](https://www.rfc-editor.org/rfc/rfc7871)。
