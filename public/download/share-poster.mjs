// This is the existing public hosting site, verified before creating the QR assets.
// Keep assets/share-qr.{png,svg} in sync with this URL; the regression test decodes it.
export const PUBLIC_SHARE_URL = 'https://jou-d4gq7a3cqf51e6caa-1394316826.tcloudbaseapp.com/download/index.html';
export const POSTER_THEMES = [
  { name: '森林绿', paper: '#f6f8ed', pale: '#e2edcf', ink: '#174d39', accent: '#ff9657', fox: 'fox-happy.png' },
  { name: '橘子汽水', paper: '#fff6eb', pale: '#ffe3c1', ink: '#80442a', accent: '#ea7937', fox: 'fox-wow.png' },
  { name: '晴空蓝', paper: '#f0f8fc', pale: '#dcecf7', ink: '#245870', accent: '#ff9b56', fox: 'fox-hello.png' },
];

export function isPublicHttpsUrl(raw) {
  try {
    const value = new URL(raw);
    const host = value.hostname.toLowerCase().replace(/\.$/, '');
    if (value.protocol !== 'https:' || value.username || value.password || !host.includes('.') || host.includes(':')) return false;
    if (/(?:^|\.)(localhost|local|lan|home|internal|test|invalid|example)$/.test(host)) return false;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
      const [a, b] = host.split('.').map(Number);
      if (a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254
        || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0)
        || a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19)) return false;
    }
    return true;
  } catch { return false; }
}

export function promotionShareContext(currentUrl) {
  const live = isPublicHttpsUrl(currentUrl);
  // Never copy localhost, a native WebView URL, arbitrary query values or auth tokens.
  return {
    url: PUBLIC_SHARE_URL,
    preview: !live || new URL(currentUrl).origin !== new URL(PUBLIC_SHARE_URL).origin,
  };
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('分享图片未能加载，请检查网络后重试。'));
    image.src = new URL(src, import.meta.url).href;
  });
}

function roundedRect(context, x, y, width, height, radius, fill) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
  context.fillStyle = fill;
  context.fill();
}

function drawContained(context, image, x, y, width, height) {
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const w = image.naturalWidth * scale, h = image.naturalHeight * scale;
  context.drawImage(image, x + (width - w) / 2, y + (height - h) / 2, w, h);
}

// UI and the saved PNG share exactly the same image; no screenshot service is used.
export async function renderSharePoster(themeIndex) {
  const theme = POSTER_THEMES[themeIndex] || POSTER_THEMES[0];
  const [fox, code] = await Promise.all([
    loadImage(`assets/${theme.fox}`), loadImage('assets/share-qr.png'),
  ]);
  const canvas = document.createElement('canvas');
  canvas.width = 720; canvas.height = 1080;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前浏览器暂不支持生成分享卡，请复制链接。');
  context.fillStyle = theme.paper; context.fillRect(0, 0, 720, 1080);
  context.fillStyle = theme.pale;
  context.beginPath(); context.arc(680, 80, 190, 0, Math.PI * 2); context.fill();
  context.beginPath(); context.arc(50, 1060, 170, 0, Math.PI * 2); context.fill();
  const text = (value, size, x, y, color = theme.ink, weight = 800) => {
    context.fillStyle = color;
    context.font = `${weight} ${size}px -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft Yahei", sans-serif`;
    context.fillText(value, x, y);
  };
  text('OHU · CAMPUS LIFE', 20, 52, 58);
  text('校园生活，有哦狐。', 48, 52, 132);
  text('把有空，变成一起。', 27, 54, 184, theme.ink, 500);
  drawContained(context, fox, 190, 205, 340, 300);
  roundedRect(context, 62, 510, 596, 62, 31, theme.pale);
  context.textAlign = 'center';
  text('课表 · 地图 · 找搭子 · 校园服务', 24, 360, 550);
  roundedRect(context, 160, 596, 400, 400, 24, '#ffffff');
  // QR image is 360px, including a four-module white quiet zone. Draw at native size.
  context.imageSmoothingEnabled = false;
  context.drawImage(code, 180, 616, 360, 360);
  context.imageSmoothingEnabled = true;
  text('微信扫码，认识哦狐', 29, 360, 1042);
  context.textAlign = 'start';
  return new Promise((resolve, reject) => canvas.toBlob(
    blob => blob ? resolve(blob) : reject(new Error('分享卡生成失败，请重试或复制链接。')), 'image/png',
  ));
}

