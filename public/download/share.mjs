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

export function initPromotionSharing() {
  const shareModal = document.getElementById('shareModal');
  const downloadModal = document.getElementById('downloadModal');
  const posterImage = document.getElementById('sharePoster');
  const posterStatus = document.getElementById('posterStatus');
  const saveButton = document.getElementById('savePoster');
  const shareButton = document.getElementById('sendPoster');
  const copyButton = document.getElementById('copyLink');
  const context = promotionShareContext(location.href);
  const publicLink = document.getElementById('sharePublicLink');
  publicLink.href = context.url;
  publicLink.textContent = '打开公开宣传页 ↗';
  document.getElementById('sharePreviewNote').hidden = !context.preview;
  let activeModal = null, returnFocus = null, previousOverflow = '', inertState = [];
  let posterBlob = null, posterObjectUrl = '', renderId = 0, saving = false;
  let themeIndex = 0;
  const focusable = node => [...node.querySelectorAll('a[href],button:not([disabled]),[tabindex="0"]')]
    .filter(item => !item.hidden && item.getClientRects().length);
  function closeModal(restoreFocus = true) {
    if (!activeModal) return;
    activeModal.classList.remove('open');
    activeModal.setAttribute('aria-hidden', 'true');
    for (const [node, old] of inertState) node.inert = old;
    inertState = [];
    document.body.style.overflow = previousOverflow;
    activeModal = null;
    if (restoreFocus && returnFocus?.isConnected) returnFocus.focus();
  }
  function openModal(modal, trigger) {
    closeModal(false);
    returnFocus = trigger || document.activeElement;
    previousOverflow = document.body.style.overflow;
    activeModal = modal;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    for (const child of document.body.children) {
      if (child !== modal && child.tagName !== 'SCRIPT' && child.tagName !== 'STYLE') {
        inertState.push([child, child.inert]); child.inert = true;
      }
    }
    document.body.style.overflow = 'hidden';
    (focusable(modal)[0] || modal).focus();
  }
  for (const modal of [shareModal, downloadModal]) {
    modal.addEventListener('click', event => { if (event.target === modal) closeModal(); });
    modal.querySelectorAll('[data-close-modal]').forEach(button => button.addEventListener('click', () => closeModal()));
  }
  document.addEventListener('keydown', event => {
    if (!activeModal) return;
    if (event.key === 'Escape') { event.preventDefault(); closeModal(); }
    if (event.key === 'Tab') {
      const items = focusable(activeModal), first = items[0], last = items.at(-1);
      if (!items.length) { event.preventDefault(); activeModal.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !activeModal.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !activeModal.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    }
  });
  async function updatePoster() {
    const request = ++renderId;
    posterBlob = null; saveButton.disabled = true; shareButton.disabled = true;
    posterImage.hidden = true;
    posterStatus.textContent = '正在生成阿狐分享卡…';
    document.getElementById('sharePosterFrame').setAttribute('aria-busy', 'true');
    try {
      const blob = await renderSharePoster(themeIndex);
      if (request !== renderId) return;
      if (posterObjectUrl) URL.revokeObjectURL(posterObjectUrl);
      posterBlob = blob; posterObjectUrl = URL.createObjectURL(blob);
      posterImage.src = posterObjectUrl;
      posterImage.hidden = false;
      saveButton.disabled = false; shareButton.disabled = false;
      posterStatus.textContent = '分享卡已生成，保存图片后可发给同学。';
    } catch (error) {
      if (request === renderId) posterStatus.textContent = error.message || '分享卡生成失败，请重新选择配色，或复制链接。';
    } finally {
      if (request === renderId) document.getElementById('sharePosterFrame').setAttribute('aria-busy', 'false');
    }
  }
  document.getElementById('shareFab').addEventListener('click', event => {
    openModal(shareModal, event.currentTarget);
    if (!posterBlob) void updatePoster();
  });
  document.querySelectorAll('[data-share-theme]').forEach(button => button.addEventListener('click', () => {
    const next = Number(button.dataset.shareTheme);
    if (themeIndex === next && posterBlob) return;
    themeIndex = next;
    document.querySelectorAll('[data-share-theme]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    void updatePoster();
  }));
  saveButton.addEventListener('click', async () => {
    if (!posterBlob || saving) return;
    saving = true; saveButton.disabled = true;
    try {
      const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      const file = new File([posterBlob], `哦狐-校园搭子-${POSTER_THEMES[themeIndex].name}.png`, { type: 'image/png' });
      if (isMobile && navigator.share && navigator.canShare?.({ files: [file] })) {
        posterStatus.textContent = '请在系统面板中选择“存储图像”或保存到相册。';
        try { await navigator.share({ files: [file], title: '哦狐分享卡' }); }
        catch (error) {
          posterStatus.textContent = error?.name === 'AbortError' ? '已取消；也可以长按上方图片保存。' : '无法打开系统保存面板，请长按上方图片保存到相册。';
        }
      } else if (isMobile) {
        posterStatus.textContent = '请长按上方分享卡，选择“保存图片”或“存储到照片”。';
      } else {
        const link = document.createElement('a');
        link.href = posterObjectUrl; link.download = file.name;
        document.body.appendChild(link); link.click(); link.remove();
        posterStatus.textContent = '已请求下载，请在浏览器下载列表查看。';
      }
    } finally { saving = false; saveButton.disabled = !posterBlob; }
  });
  shareButton.addEventListener('click', async () => {
    if (!posterBlob || saving) return;
    const file = new File([posterBlob], '哦狐校园搭子.png', { type: 'image/png' });
    if (!navigator.canShare?.({ files: [file] }) || !navigator.share) {
      posterStatus.textContent = '当前浏览器不支持直接分享图片，请保存分享卡后发送给同学。'; return;
    }
    saving = true; shareButton.disabled = true;
    try { await navigator.share({ files: [file], title: '哦狐 · 你的校园生活搭子' }); }
    catch (error) { if (error.name !== 'AbortError') posterStatus.textContent = '没有完成分享，可以保存分享卡后发送。'; }
    finally { saving = false; shareButton.disabled = !posterBlob; }
  });
  copyButton.addEventListener('click', async () => {
    if (copyButton.disabled) return;
    copyButton.disabled = true;
    let copied = false;
    try { await navigator.clipboard.writeText(context.url); copied = true; }
    catch {
      const input = document.createElement('textarea');
      input.value = context.url; input.readOnly = true;
      input.style.cssText = 'position:fixed;left:0;top:0;opacity:0;';
      shareModal.querySelector('.share-controls').appendChild(input); input.select();
      try { copied = document.execCommand('copy'); } catch { /* Browser may forbid clipboard access. */ }
      input.remove(); copyButton.focus();
    }
    posterStatus.textContent = copied ? '已复制公开宣传页链接，可以发给同学。' : '复制失败，请长按下方公开链接，复制链接地址。';
    copyButton.disabled = false;
  });
  document.querySelectorAll('[data-platform]').forEach(button => button.addEventListener('click', () => {
    if (button.dataset.platform === 'android') { location.assign('/download/student.html'); return; }
    if (button.dataset.platform === 'ios') openModal(downloadModal, button);
  }));
  window.addEventListener('pagehide', () => { if (posterObjectUrl) URL.revokeObjectURL(posterObjectUrl); });
}

if (typeof document !== 'undefined') initPromotionSharing();
