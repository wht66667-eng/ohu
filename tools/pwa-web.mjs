/** Student website metadata only; native APK/IPA resources do not use this install path. */
export function studentWebAppMetadata(html) {
  if (html.includes('name="ohu-web-app"')) return html
  if (!html.includes('</head>')) throw Error('Website is missing its head element')
  return html.replace('</head>', `  <meta name="ohu-web-app" content="student">
  <link rel="manifest" href="/manifest.webmanifest">
  <link rel="apple-touch-icon" href="/download/student-icon.png">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-title" content="哦狐">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">
</head>`)
}
