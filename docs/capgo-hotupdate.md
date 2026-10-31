# 哦狐手机界面更新

当前使用腾讯云静态托管和 CapacitorUpdater 插件手动切包。`capacitor.config.ts` 的 `autoUpdate` 为 `false`，不使用 Capgo 云端 production 自动更新。

请按 [三端发布与更新](release-and-update.md) 操作。旧文档中的 `1.2.7`、Capgo 云上传和“五端同步”不再适用于当前项目。

学生端读取 `/ota/user/manifest.json`，管理端读取 `/ota/admin/manifest.json`；旧学生客户端的 `/ota/manifest.json` 入口仍保留。两端可以分别发布，也可一起准备。

修改插件、权限或其他原生能力需要新版 APK；界面修改可使用 OTA，并标明最低原生构建号。安装包版本和界面版本分别显示，同号修复递增 Web 构建号。切包后的可用页面挂载才会确认就绪，不能把下载完成当成启动成功。
