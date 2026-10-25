# 验证记录

验证日期：2026-10-26（北京时间）。开发位置：Coder `dev-base-test` 的 `/home/coder/projects/cloudflare-doh-ecs`。

## 自动检查

`npm run check`：TypeScript 类型检查、Vitest 测试、Wrangler 部署预演。

当前版本已移除国内分流、KV 和定时规则更新。自动检查共 83 项，覆盖 TTL=0/5/upstream、A/AAAA/CNAME、多区段记录、SOA 负缓存、OPT 标志与 ECS 选项保留、DNSSEC RDATA 不变、代理出口来源优先级、IPv6、上游故障回退、不同来源不共用 DNS 应答。

## 本地 Workers 运行时 + 真实公共上游

下表的 ECS / TTL / 故障回退验证在上一提交已完成；本次简化后另行验证无 KV、无规则初始化的真实运行时查询。

使用 Wrangler 的 workerd 本地运行时（不是仅调用 TypeScript 函数），向公共 DoH 发出标准 DNS 报文：

| 场景 | 结果 |
|---|---|
| 主上游 Google，查询 example.com A | HTTP 200 / DNS NOERROR，TTL 5 |
| 主上游 Google，查询 example.com AAAA | HTTP 200 / DNS NOERROR，TTL 5 |
| 查询 Google 的 o-o.myaddr.l.google.com TXT | HTTP 200 / DNS NOERROR，TTL 5 |
| 本地模拟连接来源 8.8.4.123 | Google TXT 回显 ECS 8.8.4.0/24，DNS OPT 同样返回该网段 |
| 本地模拟连接来源 1.1.1.123 | Google TXT 回显 ECS 1.1.1.0/24，没有复用前一个网段 |
| 将主上游路径故意设为无效路径，并启用 DNS_TTL_MAX=0 | 自动使用备用 https://8.8.4.4/dns-query，A 记录 TTL 0 |
| 直接访问备用 Google DoH | TLS 验证成功，HTTP 200 / DNS NOERROR |

所有改写后的 HTTP 响应都有 `Cache-Control: no-store`。

本次简化没有变更 Google 主备、ECS 或 TTL 实现。新测试额外确认 www.qq.com、example.cn 和自有域名形式的查询全部进入 Google，无域名分类和存储资源依赖。

## 尚未验证的范围

- 没有发布到用户的 Cloudflare 账号；一键部署入口、Wrangler 配置和打包预演已准备。
- 来源地址通过本地 HTTP 请求头模拟，未使用用户实际的德国/香港代理节点。
- Google 回显证明 ECS 传递成功，不代表所有域名都采用 ECS，或必定返回某个国家的 IP。
- 未更改用户的 DNS 权威记录；短 TTL 不保证公共上游提前清除其缓存。
