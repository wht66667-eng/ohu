# 启用学习通只读代理（CHAOXING_READ_ENABLED）

> 目标：让 CloudRun 服务 `jou-api` 的 `/api/integrations/capabilities` 返回
> `chaoxing.enabled=true`，从而启用现有 `/api/learning/chaoxing/query`。

## 1. 现状

服务详情（2026-11-07）：

```
ServiceName : jou-api
Region      : ap-shanghai
EnvId       : jou-d4gq7a3cqf51e6caa
Port        : 8090
EnvParams   : {
  "MOCK":"0",
  "MAX_UPSTREAM_CONCURRENCY":"4",
  "ALLOWED_ORIGINS":"https://jou-...tcloudbaseapp.com,https://jou-...ap-shanghai.app.tcloudbase.com",
  "PHYSICAL_READ_ENABLED":"1",
  "PHYSICAL_ALLOW_HTTP":"1"
}
```

缺少的只有：

```json
"CHAOXING_READ_ENABLED": "1"
```

代码侧已确认可用：

- `chaoxing_read.py` 已实现 `/fanyalogin` + AES-CBC；
- `requirements.txt` 已含 `pycryptodome==3.23.0`；
- `python -m unittest -v test_read_integrations` 7 项全绿；
- 本地 `CHAOXING_READ_ENABLED=1` 时 capabilities 返回 `enabled:true`。

## 2. 启用方式 A：控制台（推荐，风险最低）

1. CloudBase 控制台 → 云托管 → `jou-api` → 服务设置；
2. 环境变量增加：
   ```
   CHAOXING_READ_ENABLED=1
   ```
3. 保存并重启/重新部署；
4. 验证：
   ```
   curl https://jou-d4gq7a3cqf51e6caa-1394316826.ap-shanghai.app.tcloudbase.com/api/integrations/capabilities
   ```
   期望：
   ```json
   {"chaoxing":{"enabled":true,"readOnly":true},"ok":true,...}
   ```

## 3. 启用方式 B：源码重新部署

```bash
cd tools/jou-api

# 坑 1：本机代理会让 tcb 连不上 COS
# 坑 2：CLI 3.7.3 的灰度提问需要喂一个回车（默认 No，成功后自动切流量）
printf '\n' | env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy \
  -u ALL_PROXY -u all_proxy -u NODE_USE_ENV_PROXY NO_PROXY='*' no_proxy='*' \
  tcb cloudrun deploy --source . --service-name jou-api --port 8090 --force --wait
```

部署后：

```bash
tcb cloudrun detail --service-name jou-api
# 看 OnlineVersionInfos 是否出现新版本
curl .../api/health
curl .../api/integrations/capabilities
```

## 4. 验证

- capabilities `chaoxing.enabled === true`；
- App「学习通助手」不再显示“服务端同步代理当前未启用”；
- 用学习通账号点「只读同步并保存」，能拿到课程/作业；
- 失败时看 `/api/learning/chaoxing/query` 返回：
  - `INTEGRATION_DISABLED` → 环境变量未生效；
  - `CHAOXING_READ_FAILED` → 账号/二次验证/结构变化；
  - `1004` → 限流。

## 5. 回滚

删除 `CHAOXING_READ_ENABLED` 或设为 `0`，重启/重新部署即可；
不影响 `/api/timetable` 与体测接口。

## 6. 注意

- 该接口会让服务器在内存中短暂持有学习通密码，请求结束即销毁；
- 仅只读课程/作业，不做签到、提交、自动化；
- 生产变更前先确认课表接口健康。
