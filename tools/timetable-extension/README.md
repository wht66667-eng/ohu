# 阳光课表同步扩展

学生只需：

1. **安装本扩展（一次）**
2. **登录学校 WebVPN**
3. **登录教务系统**

扩展会自动读取 Cookie（含 HttpOnly），推送到阳光校园 H5 课表页完成导入。  
**不必再手动 F12 复制 Cookie。**

## 安装（Chrome / Edge）

1. 打开 `chrome://extensions` 或 `edge://extensions`
2. 打开右上角「开发者模式」
3. 「加载已解压的扩展程序」
4. 选择本目录：`xm-main/tools/timetable-extension`

## 使用

1. 先打开课表页（如 `http://localhost:43123/schedule`）
2. 浏览器登录 WebVPN → 进入教务并登录
3. 进入学生主页后会自动同步；也可点扩展图标「立即同步课表」

## 说明

- 网页脚本读不到 HttpOnly 会话 Cookie，所以必须用扩展的 `chrome.cookies` API
- Cookie 只发给本机打开的课表页，扩展不上传第三方
- 手机微信内无法装扩展，请改用 H5 里的「截图 / Excel」导入
