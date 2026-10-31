#!/usr/bin/env node
/** 旧昵称种子提权部署已停用，避免重新安装不可信身份提权链。 */
console.error('旧自动站长提权脚本已停用。请先审阅 security-disable-nickname-bootstrap.sql，再仅按人工核验的 CloudBase UID 运行 security-grant-reviewed-admin-uid.sql。')
process.exitCode = 1
