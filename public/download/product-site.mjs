const $ = (selector, root = document) => root.querySelector(selector)
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)]

const embeddedBrowser = /MicroMessenger/i.test(navigator.userAgent) ? '微信' : /\bQQ\/|MQQBrowser/i.test(navigator.userAgent) ? 'QQ' : ''
if (embeddedBrowser) {
  const notice = $('#wxBar')
  $('#inAppBrowserTitle').textContent = `你正在${embeddedBrowser}内打开哦狐`
  $('#inAppBrowserHelp').textContent = '点右上角「···」，选择“在浏览器打开”。网页无法替你强制切换。'
  notice?.classList.add('show')
}
$('#wxClose')?.addEventListener('click', () => $('#wxBar')?.classList.remove('show'))
$('#wxOpenBrowser')?.addEventListener('click', async (event) => {
  const button = event.currentTarget
  const help = $('#inAppBrowserHelp')
  let copied = false
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(window.location.href)
      copied = true
    } else {
      const input = document.createElement('textarea')
      input.value = window.location.href
      input.style.position = 'fixed'
      input.style.opacity = '0'
      document.body.append(input)
      input.select()
      copied = document.execCommand('copy')
      input.remove()
    }
  } catch { copied = false }
  if (copied) {
    help.textContent = '链接已复制。点右上角「···」→“在浏览器打开”，再粘贴链接访问。'
    button.textContent = '已复制'
    window.setTimeout(() => { button.textContent = '复制链接' }, 2200)
  } else help.textContent = '复制未成功。点右上角「···」→“在浏览器打开”；也可长按地址栏复制链接。'
})

const navToggle = $('#menuToggle')
const navLinks = $('#navLinks')
function closeNavigation() {
  navToggle?.setAttribute('aria-expanded', 'false')
  navLinks?.classList.remove('is-open')
}
navToggle?.addEventListener('click', () => {
  const open = navToggle.getAttribute('aria-expanded') !== 'true'
  navToggle.setAttribute('aria-expanded', String(open))
  navLinks?.classList.toggle('is-open', open)
})
navLinks?.addEventListener('click', (event) => {
  if (event.target.closest('a')) {
    closeNavigation()
  }
})
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && navToggle?.getAttribute('aria-expanded') === 'true') {
    closeNavigation()
    navToggle.focus()
  }
})

const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
const hero = $('.hero')
const skipIntro = $('#skipIntro')
if (hero && skipIntro && !motionPreference.matches) {
  hero.classList.add('stage-entering')
  skipIntro.hidden = false
  const finishIntro = () => { hero.classList.remove('stage-entering'); skipIntro.hidden = true }
  skipIntro.addEventListener('click', finishIntro)
  window.setTimeout(finishIntro, 1800)
}
const progress = $('#readingProgress')
let progressFrame = 0
function updateReadingProgress() {
  progressFrame = 0
  const distance = document.documentElement.scrollHeight - window.innerHeight
  if (progress) progress.style.transform = `scaleX(${distance > 0 ? Math.min(1, Math.max(0, window.scrollY / distance)) : 0})`
}
window.addEventListener('scroll', () => { if (!progressFrame) progressFrame = requestAnimationFrame(updateReadingProgress) }, { passive: true })
window.addEventListener('resize', updateReadingProgress, { passive: true })
updateReadingProgress()
const stage = $('.hero-stage')
if (stage && window.matchMedia('(hover: hover) and (pointer: fine)').matches && !motionPreference.matches) {
  stage.addEventListener('pointermove', (event) => {
    const rect = stage.getBoundingClientRect()
    stage.style.setProperty('--stage-x', `${((event.clientX - rect.left) / rect.width - .5) * 8}px`)
    stage.style.setProperty('--stage-y', `${((event.clientY - rect.top) / rect.height - .5) * 8}px`)
  })
  stage.addEventListener('pointerleave', () => { stage.style.removeProperty('--stage-x'); stage.style.removeProperty('--stage-y') })
}

const revealNodes = $$('.reveal')
if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const revealObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return
      entry.target.classList.add('is-visible')
      observer.unobserve(entry.target)
    })
  }, { threshold: 0.12 })
  revealNodes.forEach((node) => revealObserver.observe(node))
} else revealNodes.forEach((node) => node.classList.add('is-visible'))

const featureData = {
  schedule: { screen: 'schedule', image: 'assets/app-home.png', alt: '哦狐学生端首页真实截图，显示今日课程入口；当前没有完整课表页截图', caption: '首页真实截图 · 展示今日课程入口；完整课表页截图待补充', kicker: 'LEARN · PLAN · REVIEW', heading: '今天怎么安排，<br>打开就能看。', description: '课表、成绩、考试、待办和专注工具在学习中心各有入口。粘贴课程通知后，可以检查识别出的候选，再决定是否加入待办。', href: '/study', link: '了解学习功能' },
  services: { screen: 'services', image: 'assets/app-services.png', alt: '哦狐学生端服务页真实截图', caption: '学生端服务页 · 常用校园入口', kicker: 'CAMPUS · TOOLS · DAILY', heading: '常用校园服务，<br>收在一个入口。', description: '校园生活里的常用工具与服务集中展示，减少在多个页面之间来回寻找。具体服务以当前学校接入情况为准。', href: '/services', link: '浏览校园服务' },
  tasks: { screen: 'home', image: 'assets/app-home.png', alt: '哦狐首页中的今日任务区域真实截图', caption: '首页真实截图 · 今日任务入口', kicker: 'SMALL STEPS · CLEAR MIND', heading: '把要做的事记下来，<br>再专心完成一件。', description: '首页提供今日任务入口，学习中心还包含专注工具。通知识别能力会先展示候选，确认后再保存。', href: '/study', link: '打开学习中心' },
  meet: { screen: 'meet', image: 'assets/app-meet.png', alt: '哦狐碰个空校园活动匹配真实截图', caption: '碰个空 · 看共同空闲与活动', kicker: 'FIND A GAP · MAKE A PLAN', heading: '时间刚好合上，<br>就一起做点喜欢的事。', description: '碰个空围绕共同空闲与校园兴趣活动展开，帮助同学发起邀约、组队和安排线下活动。', href: '/meet?view=student', link: '了解碰个空' },
  community: { screen: 'profile', image: 'assets/app-profile.png', alt: '哦狐个人页与校园社交入口真实截图', caption: '个人页 · 校园社交入口', kicker: 'CAMPUS · FRIENDS · MOMENTS', heading: '认识身边同学，<br>分享校园日常。', description: '校园广场、好友与个人资料入口连接学习之外的校园生活。发布和互动请遵守社区规则。', href: '/plaza', link: '进入校园广场' },
  campus: { screen: 'map', image: 'assets/app-home.png', alt: '公开地图几何预览，不是哦狐 App 截图', caption: '公开地图几何 · OpenStreetMap；非官方导航', kicker: 'CAMPUS · MAP · EXPLORE', heading: '熟悉的校园，<br>换个方式看看。', description: '预览来自 OpenStreetMap 的公开地图几何。不同校区的数据完整度不同，地图不是官方导航，出行请以现场信息为准。', href: '#campus', link: '探索校园地图' },
}
const simulatorScreens = {
  home: { image: 'assets/app-home.png', alt: '哦狐学生端首页真实截图', caption: '学生端首页 · 真实界面' },
  schedule: { image: 'assets/app-home.png', alt: '首页截图中的今日课程入口；完整课表截图待补充', caption: '首页真实截图 · 今日课程入口；完整课表截图待补充' },
  services: { image: 'assets/app-services.png', alt: '哦狐学生端服务页真实截图', caption: '学生端服务页 · 真实界面' },
  map: { map: true, alt: '江苏海洋大学苍梧校区 OpenStreetMap 公开几何预览', caption: '公开地图几何 · OpenStreetMap · 非官方导航' },
  meet: { image: 'assets/app-meet.png', alt: '哦狐碰个空真实截图', caption: '碰个空 · 真实界面' },
  profile: { image: 'assets/app-profile.png', alt: '哦狐个人页真实截图', caption: '学生端个人页 · 真实界面' },
}
const featureTabs = $$('.feature-tab')
let featureIndex = Math.max(0, featureTabs.findIndex((tab) => tab.classList.contains('is-active')))
let explicitFeatureLockUntil = 0
let explicitFeatureSyncTimer = 0
function focusFeatureStory(index) {
  if (!window.matchMedia('(min-width: 721px)').matches) return
  explicitFeatureLockUntil = Date.now() + 1500
  featureTabs[index]?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' })
  window.clearTimeout(explicitFeatureSyncTimer)
  explicitFeatureSyncTimer = window.setTimeout(() => { explicitFeatureLockUntil = 0; setFeature(index) }, 1250)
}
const resumeStoryTracking = () => { explicitFeatureLockUntil = 0; window.clearTimeout(explicitFeatureSyncTimer) }
window.addEventListener('wheel', resumeStoryTracking, { passive: true })
window.addEventListener('touchstart', resumeStoryTracking, { passive: true })
function setSimulatorScreen(screen) {
  const item = simulatorScreens[screen]
  if (!item) return
  const image = $('#featureScreenshot')
  const map = $('#simulatorMap')
  const device = $('#showcaseDevice')
  const isMap = Boolean(item.map)
  if (image) { image.hidden = isMap; if (item.image) image.src = item.image; image.alt = item.alt }
  if (map) map.hidden = !isMap
  if (device) device.classList.toggle('is-map', isMap)
  $('#featureCaption').textContent = item.caption
  $$('[data-sim-screen]').forEach((button) => {
    const active = button.dataset.simScreen === screen
    button.classList.toggle('is-active', active)
    button.setAttribute('aria-pressed', String(active))
  })
  if (isMap) void drawSimulatorMap('cangwu')
}
function setFeature(index, { syncSimulator = true } = {}) {
  if (!featureTabs.length) return
  featureIndex = (index + featureTabs.length) % featureTabs.length
  const tab = featureTabs[featureIndex]
  const item = featureData[tab.dataset.feature]
  if (!item) return
  featureTabs.forEach((button, i) => {
    const active = i === featureIndex
    button.classList.toggle('is-active', active)
    button.setAttribute('aria-selected', String(active))
    button.tabIndex = active ? 0 : -1
  })
  const panel = $('#featurePanel')
  panel?.setAttribute('aria-labelledby', tab.id)
  $('#featureKicker').textContent = item.kicker
  $('#featureHeading').innerHTML = item.heading
  $('#featureDescription').textContent = item.description
  if (syncSimulator) setSimulatorScreen(item.screen || 'home')
  const link = $('.feature-panel-copy .text-link')
  if (link) { link.href = item.href; link.firstChild.textContent = `${item.link} ` }
}
featureTabs.forEach((tab, index) => {
  tab.addEventListener('click', () => {
    setFeature(index)
    focusFeatureStory(index)
  })
  tab.addEventListener('keydown', (event) => {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? featureTabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + featureTabs.length) % featureTabs.length
    setFeature(next)
    focusFeatureStory(next)
    featureTabs[next].focus()
  })
})
$('#featureNext')?.addEventListener('click', () => setFeature(featureIndex + 1))
$('#featurePrev')?.addEventListener('click', () => setFeature(featureIndex - 1))
const featureSwipe = $('#featurePanel')
let featureTouch = null
featureSwipe?.addEventListener('touchstart', (event) => {
  if (event.target.closest('button, a, input, select, textarea')) { featureTouch = null; return }
  const point = event.changedTouches[0]
  featureTouch = point ? { x: point.clientX, y: point.clientY } : null
}, { passive: true })
featureSwipe?.addEventListener('touchend', (event) => {
  if (!featureTouch || !event.changedTouches[0]) return
  const deltaX = event.changedTouches[0].clientX - featureTouch.x
  const deltaY = event.changedTouches[0].clientY - featureTouch.y
  if (Math.abs(deltaX) > 55 && Math.abs(deltaX) > Math.abs(deltaY) * 1.3) setFeature(featureIndex + (deltaX < 0 ? 1 : -1))
  featureTouch = null
}, { passive: true })
featureSwipe?.addEventListener('touchcancel', () => { featureTouch = null }, { passive: true })

$('#meetDemoForm')?.addEventListener('submit', (event) => {
  event.preventDefault()
  const form = event.currentTarget
  const values = new FormData(form)
  const result = $('#meetDemoResult')
  result.querySelector('h3').textContent = `${values.get('time')} · ${values.get('activity')}`
  result.querySelector('p').textContent = `计划 ${values.get('people')} 人参加，搭子偏好：${values.get('personality')}。`
  result.querySelector('small').textContent = '这是本地预览，尚未发起活动或匹配同学。'
  result.classList.add('is-ready')
})

$('#liveExperience')?.addEventListener('toggle', (event) => {
  const frame = $('#liveExperienceFrame')
  if (event.currentTarget.open && frame && !frame.hasAttribute('src')) frame.src = frame.dataset.src
})

$$('[data-sim-screen]').forEach((button) => button.addEventListener('click', () => {
  setSimulatorScreen(button.dataset.simScreen)
  const matching = featureTabs.findIndex((tab) => featureData[tab.dataset.feature]?.screen === button.dataset.simScreen)
  if (matching >= 0) {
    setFeature(matching, { syncSimulator: false })
    focusFeatureStory(matching)
  }
}))

if ('IntersectionObserver' in window && featureTabs.length) {
  let storyObserver
  const syncStoryObserver = () => {
    storyObserver?.disconnect()
    if (!window.matchMedia('(min-width: 721px)').matches) return
    storyObserver = new IntersectionObserver((entries) => {
      if (Date.now() < explicitFeatureLockUntil) return
      const candidates = entries.filter((entry) => entry.isIntersecting).sort((a, b) => {
        const center = window.innerHeight / 2
        return Math.abs(a.boundingClientRect.top + a.boundingClientRect.height / 2 - center) - Math.abs(b.boundingClientRect.top + b.boundingClientRect.height / 2 - center)
      })
      if (!candidates.length) return
      const index = featureTabs.indexOf(candidates[0].target)
      if (index >= 0) setFeature(index)
    }, { rootMargin: '-16% 0px -16% 0px', threshold: [0, .15, .4, .7] })
    featureTabs.forEach((tab) => storyObserver.observe(tab))
  }
  syncStoryObserver()
  window.matchMedia('(min-width: 721px)').addEventListener?.('change', syncStoryObserver)
}

const campusMeta = {
  cangwu: { file: '/maps/jou-cangwu.geojson', name: '江苏海洋大学 · 苍梧校区', amapTitle: '苍梧校区', center: [119.21556605, 34.6082728], amapUrl: 'https://ditu.amap.com/place/B0FFKO0RCB' },
  songtiao: { file: '/maps/jou-songtiao.geojson', name: '江苏海洋大学 · 宋跳校区', amapTitle: '宋跳校区', center: [119.20295475, 34.6479758] },
  tongguan: { file: '/maps/jou-tongguan.geojson', name: '江苏海洋大学 · 通灌校区', amapTitle: '通灌校区', center: [119.1851096, 34.5879356] },
}
function amapCampusSearchUrl(title) {
  const query = new URLSearchParams({ keyword: `江苏海洋大学 ${title}`, city: '连云港', view: 'map', src: 'ohu-campus', callnative: '0' })
  return `https://uri.amap.com/search?${query.toString()}`
}
const svgNS = 'http://www.w3.org/2000/svg'
const mapWorld = $('#mapWorld')
const mapSvg = $('#campusMap')
const amapCanvas = $('#amapCanvas')
const mapViewport = $('#mapViewport')
const amapConfig = window.OHU_AMAP_CONFIG || {}
let mapZoom = 1
let mapPan = { x: 0, y: 0 }
let mapCategory = 'all'
let mapBaseStatus = ''
let amapMap = null
let amapPlaceSearch = null
let amapSdkPromise = null
let amapActive = false
let activeCampusMeta = null
let amapSearchTimer = 0

function loadAmapSdk() {
  if (window.AMap) return Promise.resolve(window.AMap)
  if (!amapConfig.webKey) return Promise.resolve(null)
  if (amapSdkPromise) return amapSdkPromise
  window._AMapSecurityConfig = { serviceHost: `${window.location.origin}/_AMapService` }
  amapSdkPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(amapConfig.webKey)}&plugin=AMap.PlaceSearch`
    script.async = true
    script.onload = () => window.AMap ? resolve(window.AMap) : reject(new Error('AMap SDK 未初始化'))
    script.onerror = () => reject(new Error('AMap SDK 加载失败'))
    document.head.append(script)
  }).catch((error) => { amapSdkPromise = null; throw error })
  return amapSdkPromise
}

function convertWgs84ToAmap(AMap, point) {
  return new Promise((resolve) => {
    AMap.convertFrom(point, 'gps', (status, result) => {
      const converted = result?.locations?.[0]
      if (status === 'complete' && result?.info === 'ok' && converted) resolve([converted.lng, converted.lat])
      else resolve(point)
    })
  })
}

function searchAmapPlaces() {
  if (!amapActive || !amapMap || !amapPlaceSearch || !activeCampusMeta) return
  window.clearTimeout(amapSearchTimer)
  amapSearchTimer = window.setTimeout(() => {
    const query = ($('#mapSearch')?.value || '').trim()
    const filter = mapCategory
    const categories = { building: '科教文化服务|高等院校', food: '餐饮服务', sports: '体育休闲服务' }
    const keywords = { building: '教学楼', food: '餐饮', sports: '运动场', all: activeCampusMeta.amapTitle }
    amapMap.clearMap()
    if (!query && filter === 'all') {
      amapMap.add(new window.AMap.Marker({ position: activeCampusMeta.amapCenter, title: activeCampusMeta.name }))
      $('#mapStatus').textContent = '高德地图已接入 · 输入地点名称或选择分类查看周边地点'
      return
    }
    amapPlaceSearch.setType(categories[filter] || '')
    $('#mapStatus').textContent = '正在搜索高德地图地点…'
    amapPlaceSearch.searchInBounds(query || keywords[filter] || '校园', amapMap.getBounds(), (status, result) => {
      if (status !== 'complete') {
        $('#mapStatus').textContent = '高德地点搜索暂不可用；可直接在高德地图中查看当前校区。'
        return
      }
      const count = result?.poiList?.pois?.length || 0
      $('#mapStatus').textContent = count ? `高德地图找到 ${count} 个相关地点` : '当前范围没有找到相关地点，可缩小关键词或拖动地图后重试'
    })
  }, 260)
}

async function showAmapCampus(key, meta) {
  if (!amapConfig.webKey || !amapCanvas || !mapSvg || !mapViewport) return false
  try {
    const AMap = await loadAmapSdk()
    if (!AMap) return false
    const center = await convertWgs84ToAmap(AMap, meta.center)
    if (!amapMap) {
      amapCanvas.hidden = false
      mapSvg.hidden = true
      amapMap = new AMap.Map(amapCanvas, { center, zoom: 16, viewMode: '2D', resizeEnable: true, mapStyle: 'amap://styles/normal' })
      await Promise.race([
        new Promise((resolve) => amapMap.on('complete', resolve)),
        new Promise((_, reject) => window.setTimeout(() => reject(new Error('AMap map load timeout')), 10000)),
      ])
      amapPlaceSearch = new AMap.PlaceSearch({ map: amapMap, city: '连云港', citylimit: true, pageSize: 20, pageIndex: 1, extensions: 'base', autoFitView: false, showCover: false })
    } else {
      amapCanvas.hidden = false
      mapSvg.hidden = true
      amapMap.clearMap()
      amapMap.setCenter(center)
      amapMap.setZoom(16)
      amapMap.resize()
    }
    meta.amapCenter = center
    activeCampusMeta = meta
    amapActive = true
    mapViewport.classList.add('amap-ready')
    $('#mapProviderLabel').textContent = '高德地图底图 · 搜索与地点分类由高德提供'
    $('#mapAttribution').innerHTML = '地图底图与地点搜索：<a href="https://lbs.amap.com/" target="_blank" rel="noopener noreferrer">高德地图开放平台</a> · 校区中心点依据公开地图范围换算'
    $('#mapLocationTag').textContent = '高德地图 · 校区中心'
    $('#mapSvgTitle').textContent = `${meta.name}高德地图`
    $('#mapSvgDesc').textContent = '高德地图底图，支持拖动、缩放、地点搜索与分类查询。'
    $('#mapStatus').textContent = '高德地图已接入 · 输入地点名称或选择分类查看周边地点'
    return true
  } catch (error) {
    console.warn('AMap unavailable; using the local public map preview.', error)
    amapActive = false
    mapViewport.classList.remove('amap-ready')
    amapCanvas.hidden = true
    mapSvg.hidden = false
    $('#mapProviderLabel').textContent = '本地公开地图示意 · 高德地图接入配置尚未完成'
    $('#mapAttribution').innerHTML = '地图示意数据：<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a> · ODbL 1.0'
    return false
  }
}
function applyMapFilters() {
  if (!mapWorld) return
  const query = ($('#mapSearch')?.value || '').trim().toLocaleLowerCase('zh-CN')
  const matches = (name, kind) => {
    if (query && !name.toLocaleLowerCase('zh-CN').includes(query)) return false
    if (mapCategory === 'building') return kind === 'building'
    if (mapCategory === 'food') return /餐|食堂|饮品|咖啡|小吃|超市|便利|美食/.test(name)
    if (mapCategory === 'sports') return kind === 'sport' || /运动|体育|球场|操场|田径/.test(name)
    return true
  }
  const named = [...mapWorld.querySelectorAll('[data-map-name]')]
  let resultCount = 0
  const shown = new Set()
  named.forEach((node) => {
    const name = node.dataset.mapName || ''
    const kind = node.dataset.mapKind || ''
    const visible = !name || matches(name, kind)
    node.style.display = visible ? '' : 'none'
    if (name && visible) shown.add(name)
  })
  resultCount = shown.size
  if (query || mapCategory !== 'all') {
    $('#mapStatus').textContent = resultCount ? `找到 ${resultCount} 个地点名称 · 可继续拖动地图` : '没有匹配的地点名称；仍可拖动浏览地图'
  } else $('#mapStatus').textContent = mapBaseStatus
}
function applyMapTransform() {
  mapWorld?.setAttribute('transform', `translate(${mapPan.x} ${mapPan.y}) translate(400 260) scale(${mapZoom}) translate(-400 -260)`)
}
function coordinatePoints(geometry, out = []) {
  if (!geometry) return out
  const visit = (node) => {
    if (Array.isArray(node) && typeof node[0] === 'number') out.push(node)
    else if (Array.isArray(node)) node.forEach(visit)
  }
  visit(geometry.coordinates)
  return out
}
function mapPath(coords, project, close = false) {
  const points = coords.map(project)
  if (!points.length) return ''
  return `M${points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join('L')}${close ? 'Z' : ''}`
}
function renderGeometry(geometry, project, kind, name) {
  const nodes = []
  const addPath = (coords, close) => {
    const d = mapPath(coords, project, close)
    if (kind === 'road') {
      const casing = document.createElementNS(svgNS, 'path')
      casing.setAttribute('d', d)
      casing.setAttribute('class', 'map-road-casing')
      nodes.push(casing)
    }
    const path = document.createElementNS(svgNS, 'path')
    path.setAttribute('d', d)
    path.setAttribute('class', `map-feature map-${kind}`)
    path.dataset.mapKind = kind
    if (name) path.dataset.mapName = name
    if (name) path.setAttribute('aria-label', name)
    nodes.push(path)
  }
  const draw = (g) => {
    if (!g) return
    if (g.type === 'Point') {
      const [x, y] = project(g.coordinates)
      const circle = document.createElementNS(svgNS, 'circle')
      circle.setAttribute('cx', x); circle.setAttribute('cy', y); circle.setAttribute('r', kind === 'poi' ? '4.2' : '2.5')
      circle.setAttribute('class', `map-feature map-${kind}`); circle.dataset.mapKind = kind
      if (name) circle.dataset.mapName = name
      nodes.push(circle)
      if (name) {
        const label = document.createElementNS(svgNS, 'text')
        label.setAttribute('x', x + 7); label.setAttribute('y', y - 6); label.setAttribute('class', 'map-label'); label.dataset.mapName = name; label.dataset.mapKind = kind; label.textContent = name
        nodes.push(label)
      }
    } else if (g.type === 'LineString') addPath(g.coordinates, false)
    else if (g.type === 'MultiLineString') g.coordinates.forEach((line) => addPath(line, false))
    else if (g.type === 'Polygon') g.coordinates.forEach((ring, i) => addPath(ring, i === 0))
    else if (g.type === 'MultiPolygon') g.coordinates.forEach((poly) => poly.forEach((ring, i) => addPath(ring, i === 0)))
    else if (g.type === 'GeometryCollection') g.geometries.forEach(draw)
  }
  draw(geometry)
  return nodes
}
async function loadCampus(key) {
  const meta = campusMeta[key]
  if (!meta || !mapWorld) return
  $('#mapCampusName').textContent = meta.name
  const amapLink = $('#mapAmapReference')
  if (amapLink) {
    amapLink.href = meta.amapUrl || amapCampusSearchUrl(meta.amapTitle)
    amapLink.textContent = `在高德地图查看${meta.amapTitle} ↗`
    amapLink.setAttribute('aria-label', `在新窗口打开高德地图，查看江苏海洋大学${meta.amapTitle}`)
  }
  $('#mapStatus').textContent = amapConfig.webKey ? '正在载入高德地图…' : '高德地图尚未配置 Web JS API Key，正在显示本地公开地图示意…'
  $('#mapLocationTag').textContent = '公开地图示意'
  amapActive = false
  mapViewport?.classList.remove('amap-ready')
  if (amapCanvas) amapCanvas.hidden = true
  if (mapSvg) mapSvg.hidden = false
  mapWorld.replaceChildren()
  mapPan = { x: 0, y: 0 }; mapZoom = 1; applyMapTransform()
  try {
    const response = await fetch(meta.file, { cache: 'force-cache' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json()
    const features = Array.isArray(data.features) ? data.features : []
    if (await showAmapCampus(key, meta)) return
    const points = features.flatMap((feature) => coordinatePoints(feature.geometry))
    if (!points.length) throw new Error('没有可显示的几何数据')
    const bounds = data.bbox?.length === 4 ? [[data.bbox[0], data.bbox[1]], [data.bbox[2], data.bbox[3]]] : points
    const latMid = (bounds[0][1] + bounds[1][1]) / 2
    const projectRaw = ([lon, lat]) => [lon * Math.cos(latMid * Math.PI / 180), lat]
    const projected = bounds.map(projectRaw)
    const minX = Math.min(...projected.map((point) => point[0])); const maxX = Math.max(...projected.map((point) => point[0]))
    const minY = Math.min(...projected.map((point) => point[1])); const maxY = Math.max(...projected.map((point) => point[1]))
    const padding = 42; const sx = (800 - padding * 2) / (maxX - minX || 1); const sy = (520 - padding * 2) / (maxY - minY || 1); const scale = Math.min(sx, sy)
    const offsetX = (800 - (maxX - minX) * scale) / 2; const offsetY = (520 - (maxY - minY) * scale) / 2
    const project = (point) => { const [x, y] = projectRaw(point); return [offsetX + (x - minX) * scale, 520 - offsetY - (y - minY) * scale] }
    const order = { green: 0, water: 1, campus: 2, road: 3, building: 4, sport: 5, poi: 6 }
    features.sort((a, b) => (order[a.properties?.kind] ?? 3) - (order[b.properties?.kind] ?? 3)).forEach((feature) => {
      const kind = String(feature.properties?.kind || 'other').replace(/[^a-z-]/gi, '')
      const name = String(feature.properties?.name || '').trim()
      renderGeometry(feature.geometry, project, kind, name).forEach((node) => mapWorld.append(node))
    })
    const counts = data.metadata?.feature_counts || {}
    mapBaseStatus = `${amapConfig.webKey ? '高德地图暂不可用，显示本地地图示意 · ' : '高德地图待配置 · '}${features.length} 项公开地图几何 · 数据更新于 ${data.metadata?.retrieved_at || '日期未提供'}`
    $('#mapStatus').textContent = mapBaseStatus
    $('#mapProviderLabel').textContent = '本地公开地图示意 · 高德地图接入配置尚未完成'
    $('#mapAttribution').innerHTML = '地图示意数据：<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a> · ODbL 1.0'
    $('#mapLocationTag').textContent = `${counts.building || 0} 个建筑轮廓 · 非官方导航`
    applyMapFilters()
    $('#mapSvgTitle').textContent = `${meta.name}公开地图`
    $('#mapSvgDesc').textContent = '依据 OpenStreetMap 公开几何绘制，不保证完整或实时准确。'
  } catch {
    $('#mapStatus').textContent = '地图数据暂时无法载入，请稍后重试。'
  }
}
async function drawSimulatorMap(key) {
  const world = $('#simulatorMapWorld')
  const meta = campusMeta[key]
  if (!world || !meta) return
  world.replaceChildren()
  try {
    const response = await fetch(meta.file, { cache: 'force-cache' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json()
    const features = Array.isArray(data.features) ? [...data.features] : []
    const points = features.flatMap((feature) => coordinatePoints(feature.geometry))
    if (!points.length) throw new Error('没有可显示的几何数据')
    const bounds = data.bbox?.length === 4 ? [[data.bbox[0], data.bbox[1]], [data.bbox[2], data.bbox[3]]] : points
    const latMid = (bounds[0][1] + bounds[1][1]) / 2
    const projectRaw = ([lon, lat]) => [lon * Math.cos(latMid * Math.PI / 180), lat]
    const projected = bounds.map(projectRaw)
    const minX = Math.min(...projected.map((point) => point[0])); const maxX = Math.max(...projected.map((point) => point[0]))
    const minY = Math.min(...projected.map((point) => point[1])); const maxY = Math.max(...projected.map((point) => point[1]))
    const padding = 38; const scale = Math.min((800 - padding * 2) / (maxX - minX || 1), (520 - padding * 2) / (maxY - minY || 1))
    const offsetX = (800 - (maxX - minX) * scale) / 2; const offsetY = (520 - (maxY - minY) * scale) / 2
    const project = (point) => { const [x, y] = projectRaw(point); return [offsetX + (x - minX) * scale, 520 - offsetY - (y - minY) * scale] }
    const order = { green: 0, water: 1, campus: 2, road: 3, building: 4, sport: 5, poi: 6 }
    features.sort((a, b) => (order[a.properties?.kind] ?? 3) - (order[b.properties?.kind] ?? 3)).forEach((feature) => {
      const kind = String(feature.properties?.kind || 'other').replace(/[^a-z-]/gi, '')
      const name = String(feature.properties?.name || '').trim()
      renderGeometry(feature.geometry, project, kind, name).forEach((node) => world.append(node))
    })
    $('#simulatorMapTitle').textContent = `${meta.name} OpenStreetMap 公开地图几何预览`
  } catch {
    world.replaceChildren()
    $('#simulatorMapTitle').textContent = '公开地图暂时无法载入'
  }
}
const campusTabs = $$('[data-campus]')
function selectCampus(button) {
  campusTabs.forEach((tab) => { const active = tab === button; tab.classList.toggle('is-active', active); tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1 })
  void loadCampus(button.dataset.campus)
}
campusTabs.forEach((button, index) => {
  button.tabIndex = button.getAttribute('aria-selected') === 'true' ? 0 : -1
  button.addEventListener('click', () => selectCampus(button))
  button.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? campusTabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + campusTabs.length) % campusTabs.length
    selectCampus(campusTabs[next]); campusTabs[next].focus()
  })
})
$('#mapSearch')?.addEventListener('input', () => amapActive ? searchAmapPlaces() : applyMapFilters())
$('#mapSearchClear')?.addEventListener('click', () => { const input = $('#mapSearch'); if (input) { input.value = ''; input.focus(); amapActive ? searchAmapPlaces() : applyMapFilters() } })
$$('[data-map-filter]').forEach((button) => button.addEventListener('click', () => {
  mapCategory = button.dataset.mapFilter || 'all'
  $$('[data-map-filter]').forEach((item) => { const active = item === button; item.classList.toggle('is-active', active); item.setAttribute('aria-pressed', String(active)) })
  amapActive ? searchAmapPlaces() : applyMapFilters()
}))
$('#mapZoomIn')?.addEventListener('click', () => { if (amapActive && amapMap) amapMap.setZoom(Math.min(19, amapMap.getZoom() + 1)); else { mapZoom = Math.min(4, mapZoom * 1.25); applyMapTransform() } })
$('#mapZoomOut')?.addEventListener('click', () => { if (amapActive && amapMap) amapMap.setZoom(Math.max(12, amapMap.getZoom() - 1)); else { mapZoom = Math.max(0.75, mapZoom / 1.25); applyMapTransform() } })
$('#mapReset')?.addEventListener('click', () => { if (amapActive && amapMap && activeCampusMeta) { amapMap.setCenter(activeCampusMeta.amapCenter); amapMap.setZoom(16); searchAmapPlaces() } else { mapZoom = 1; mapPan = { x: 0, y: 0 }; applyMapTransform() } })
let drag = null
mapSvg?.addEventListener('pointerdown', (event) => { drag = { x: event.clientX, y: event.clientY, panX: mapPan.x, panY: mapPan.y }; mapSvg.setPointerCapture?.(event.pointerId) })
mapSvg?.addEventListener('pointermove', (event) => { if (!drag) return; const rect = mapSvg.getBoundingClientRect(); mapPan = { x: drag.panX + (event.clientX - drag.x) * 800 / rect.width, y: drag.panY + (event.clientY - drag.y) * 520 / rect.height }; applyMapTransform() })
mapSvg?.addEventListener('pointerup', () => { drag = null })
mapSvg?.addEventListener('pointercancel', () => { drag = null })
mapSvg?.addEventListener('wheel', (event) => { event.preventDefault(); mapZoom = Math.max(0.75, Math.min(4, mapZoom * (event.deltaY < 0 ? 1.12 : 0.89))); applyMapTransform() }, { passive: false })
void loadCampus('cangwu')

const moods = {
  happy: { image: 'assets/fox-happy.png', alt: '开心的阿狐', caption: '开心一点，今天也有小进步。' },
  hello: { image: 'assets/fox-hello.png', alt: '打招呼的阿狐', caption: '和阿狐打个招呼，继续你的校园日常。' },
  miss: { image: 'assets/fox-miss.png', alt: '想念朋友的阿狐', caption: '给想念的人发一句消息吧。' },
  wow: { image: 'assets/fox-wow.png', alt: '惊喜的阿狐', caption: '今天也许会遇到一点小惊喜。' },
}
$$('[data-mood]').forEach((button) => button.addEventListener('click', () => {
  const mood = moods[button.dataset.mood]
  if (!mood) return
  $$('[data-mood]').forEach((tab) => { const active = tab === button; tab.classList.toggle('is-active', active); tab.setAttribute('aria-pressed', String(active)) })
  $('#moodFox').src = mood.image; $('#moodFox').alt = mood.alt; $('#moodCaption').textContent = mood.caption
}))

async function loadReleaseSummary() {
  try {
    const response = await fetch('/update.json', { cache: 'no-store' })
    if (!response.ok) throw new Error('release metadata unavailable')
    const release = await response.json()
    const version = release.latestVersion || release.version || release.appVersion
    const build = release.latestBuild || release.build || release.buildNumber
    const notes = release.notes || release.releaseNotes
    const size = release.assets?.androidArm64?.size || release.flavors?.user?.androidArm64?.size
    if (version) {
      const sizeText = Number.isFinite(size) && size > 0 ? ` · ${(size / 1024 / 1024).toFixed(1)} MB` : ''
      $('#releaseMeta').replaceChildren(Object.assign(document.createElement('span'), { className: 'release-dot' }), document.createTextNode(`当前版本 ${version}${build ? ` · 构建 ${build}` : ''}${sizeText}`))
      $('#updateVersion').textContent = `哦狐 ${version}`
      if (build) $('#updateBuild').textContent = `BUILD ${build}`
      const heroVersion = $('#heroVersion')
      if (heroVersion) heroVersion.textContent = `版本 ${version}${build ? ` · ${build}` : ''}`
      const announceVersion = $('#announceVersion')
      if (announceVersion) announceVersion.textContent = String(version)
      const announcement = $('#releaseAnnouncement')
      if (announcement) {
        announcement.dataset.build = String(build || 0)
        let dismissedBuild = 0
        try { dismissedBuild = Number(JSON.parse(localStorage.getItem('ohu.site.announce.v1') || 'null')?.build || 0) } catch { dismissedBuild = 0 }
        if (Number(build || 0) > 0 && dismissedBuild >= Number(build)) announcement.hidden = true
      }
      if (notes) $('#updateNotes').textContent = Array.isArray(notes) ? notes.join('；') : notes
    }
  } catch {
    $('#releaseMeta').textContent = '版本信息暂时无法读取，请以应用内更新页为准。'
    const announcement = $('#releaseAnnouncement')
    if (announcement) announcement.hidden = true
  }
}
void loadReleaseSummary()

const announceClose = $('#announceClose')
announceClose?.addEventListener('click', () => {
  const announcement = $('#releaseAnnouncement')
  if (!announcement) return
  try {
    localStorage.setItem('ohu.site.announce.v1', JSON.stringify({ build: Number(announcement.dataset.build || 0), at: Date.now() }))
  } catch { /* private browsing */ }
  announcement.hidden = true
})

const screenshot = $('#featureScreenshot')
const lightbox = $('#screenshotLightbox')
const lightboxImage = $('#lightboxImage')
function closeLightbox() { lightbox?.close?.() }
screenshot?.addEventListener('click', () => {
  if (!lightbox || !lightboxImage) return
  lightboxImage.src = screenshot.currentSrc || screenshot.src
  lightboxImage.alt = screenshot.alt
  if (lightbox.showModal) lightbox.showModal()
})
 screenshot?.setAttribute('tabindex', '0')
 screenshot?.setAttribute('role', 'button')
 screenshot?.setAttribute('aria-label', '放大查看哦狐产品截图')
 screenshot?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); screenshot.click() }
 })
$('#lightboxClose')?.addEventListener('click', closeLightbox)
lightbox?.addEventListener('click', (event) => { if (event.target === lightbox) closeLightbox() })

