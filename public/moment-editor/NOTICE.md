# 朋友圈编辑器：字体与开源素材

本页面列出实际随包分发的素材；不要求用户购买字体。系统黑体与宋体由设备提供，没有重新分发系统字库。

## 新增中文字体
站酷快乐体、站酷小薇体、龙藏手书来自 https://github.com/google/fonts 。采用 SIL Open Font License 1.1，允许商业使用和嵌入。随包保留各字体目录的 OFL.txt（作者版权声明与完整许可证）；转换为 WOFF2 容器，保留全部字形。具体源文件地址、大小和 SHA-256 见 fonts/sources.json。

## 精选贴纸
12 款静态 SVG 来自 Google Noto Emoji 的 2D/svg 目录：https://github.com/googlefonts/noto-emoji/tree/main/2D/svg 。Copyright 2013 Google, Inc. All Rights Reserved. 原图形按 Apache-2.0 分发，保留 stickers/LICENSE 及 licenses/Apache-2.0.txt；没有使用该项目的 3D 动画资产。来源与哈希见 stickers/sources.json。

## 代码组件
Fabric.js：https://github.com/fabricjs/fabric.js （MIT），用于对象图层、涂鸦、贴纸、文字与导出。
react-easy-crop：https://github.com/ValentinH/react-easy-crop （MIT），用于裁剪交互。
fft.js：https://github.com/indutny/fft.js （MIT），用于真实二维频域处理。
小波、Sobel、中值、马赛克、调节管线由哦狐实现，没有从无许可的编辑器复制代码。

字体与贴纸均在本地选用，不依赖第三方 CDN；图片只有点击朋友圈发表后才进入现有上传流程。
