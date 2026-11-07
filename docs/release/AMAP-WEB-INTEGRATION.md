# 高德校园地图接入配置

官网校园地图已支持高德地图 JavaScript API 2.0、校区切换、地图缩放、地点关键词搜索和楼宇／餐饮／运动分类查询。为避免公开页面写入高德安全密钥，地图只在配置浏览器 Web JS API Key 后启用；未配置时继续展示现有 OSM 校区几何图。

## 1. 申请并限制浏览器 Key

在高德开放平台创建 Web 端 JS API Key。将允许访问域名限制为实际发布域名（例如 `jouxyfwglzx.cn`、`www.jouxyfwglzx.cn`）以及本地预览域名。Key 仅用于前端加载地图，仍应启用高德控制台提供的域名白名单和配额告警。

把 Key 填入 `public/download/amap-config.js` 的 `webKey`。该 Key 会在浏览器中可见，不能把它当成服务端秘密；安全密钥 `securityJsCode` 绝不能写进这个文件或其他前端源码。

## 2. 配置安全密钥代理

高德要求 JS API 安全密钥走服务端代理。生产 Web 服务器必须将 `/_AMapService/` 代理到高德 Web 服务，并在服务端追加 `jscode`。本项目页面已在加载 JS API 前把代理地址配置为同源 `/_AMapService`。

Windows Caddy 站点配置可按高德官方代理文档加上以下路由（用 Caddy 服务进程环境变量保存 `AMAP_SECURITY_JS_CODE`；将其替换为本机的环境变量配置，不要提交真实值）：

```caddyfile
@amapStyles path /_AMapService/v4/map/styles*
handle @amapStyles {
    uri strip_prefix /_AMapService
    uri query +jscode {$AMAP_SECURITY_JS_CODE}
    reverse_proxy https://webapi.amap.com {
        header_up Host webapi.amap.com
    }
}

handle_path /_AMapService/* {
    uri query +jscode {$AMAP_SECURITY_JS_CODE}
    reverse_proxy https://restapi.amap.com {
        header_up Host restapi.amap.com
    }
}
```

先在 Caddy staging 配置验证代理，再安排线上变更；此文档本身不代表生产服务器已配置。生产尚未配置时，地图库可能显示但高德 POI 搜索会失败。按高德官方要求维护 JS API Key、安全密钥、来源域名与代理限额。

## 3. 本地预览与回退

本地源码默认 `webKey` 为空，因此 4173 预览和未配置环境仍显示本地公开几何，并在地图状态中说明高德尚未配置。填入 Key、设置允许来源后重建官网即可测试；切换校区会分别定位苍梧、宋跳和通灌。若 SDK 加载失败，页面自动回到 OSM 几何，不会出现空白地图。

地图校区中心点由公开 OSM 校区边界包围盒计算，并用高德 JS API 转换到 GCJ-02 后定位；它不是校方认证的教学楼坐标。地点搜索结果来自高德 POI 数据，地点完整度、营业状态和路线仍以地图服务及现场为准。

## 参考

- [高德地图 JS API 2.0 安全密钥与代理配置](https://lbs.amap.com/api/javascript-api-v2/guide/abc/jscode)
- [高德地图 JS API PlaceSearch](https://lbs.amap.com/api/maps-javascript-api/reference/search/placesearch)
