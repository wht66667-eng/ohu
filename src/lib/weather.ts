/**
 * 江苏海洋大学·苍梧校区周边实况（Open-Meteo + 中国气象局 CMA GRAPES）
 * 无需 API Key；本地缓存 15 分钟。
 */
const LAT = 34.6
const LON = 119.178
const CACHE_KEY = 'weather.cache.v3'
const CACHE_MS = 15 * 60 * 1000

export type WeatherNow = {
  temp: number
  feelsLike: number
  humidity: number
  weatherCode: number
  /** 风力等级 0–12 */
  windLevel: number
  /** 风速 m/s */
  windMs: number
  precip: number
  label: string
  emoji: string
  high: number
  low: number
  updatedAt: string
  city: string
}

/** WMO Weather interpretation codes → 中文 */
const CODE_MAP: Record<number, { label: string; emoji: string }> = {
  0: { label: '晴', emoji: '☀️' },
  1: { label: '大部晴朗', emoji: '🌤' },
  2: { label: '多云', emoji: '⛅' },
  3: { label: '阴', emoji: '☁️' },
  45: { label: '雾', emoji: '🌫' },
  48: { label: '雾凇', emoji: '🌫' },
  51: { label: '毛毛雨', emoji: '🌦' },
  53: { label: '小雨', emoji: '🌦' },
  55: { label: '小雨', emoji: '🌧' },
  56: { label: '冻毛毛雨', emoji: '🌧' },
  57: { label: '冻雨', emoji: '🌧' },
  61: { label: '小雨', emoji: '🌧' },
  63: { label: '中雨', emoji: '🌧' },
  65: { label: '大雨', emoji: '⛈' },
  66: { label: '冻雨', emoji: '🌧' },
  67: { label: '强冻雨', emoji: '⛈' },
  71: { label: '小雪', emoji: '🌨' },
  73: { label: '中雪', emoji: '🌨' },
  75: { label: '大雪', emoji: '❄️' },
  77: { label: '雪粒', emoji: '🌨' },
  80: { label: '阵雨', emoji: '🌦' },
  81: { label: '阵雨', emoji: '🌧' },
  82: { label: '强阵雨', emoji: '⛈' },
  85: { label: '阵雪', emoji: '🌨' },
  86: { label: '强阵雪', emoji: '❄️' },
  95: { label: '雷阵雨', emoji: '⛈' },
  96: { label: '雷阵雨伴冰雹', emoji: '⛈' },
  99: { label: '强雷暴冰雹', emoji: '⛈' },
}

function mapCode(code: number) {
  if (CODE_MAP[code]) return CODE_MAP[code]
  // 相近码回退（如 52→51）
  const near = Object.keys(CODE_MAP)
    .map(Number)
    .sort((a, b) => Math.abs(a - code) - Math.abs(b - code))[0]
  return CODE_MAP[near] || { label: '天气', emoji: '🌤' }
}

/** 风速 m/s → 中国气象风力等级（蒲福氏近似） */
export function windToLevel(ms: number): number {
  const v = Math.max(0, ms)
  if (v < 0.3) return 0
  if (v < 1.6) return 1
  if (v < 3.4) return 2
  if (v < 5.5) return 3
  if (v < 8.0) return 4
  if (v < 10.8) return 5
  if (v < 13.9) return 6
  if (v < 17.2) return 7
  if (v < 20.8) return 8
  if (v < 24.5) return 9
  if (v < 28.5) return 10
  if (v < 32.7) return 11
  return 12
}

function readCache(): WeatherNow | null {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null') as
      | { at: number; data: WeatherNow }
      | null
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.data
  } catch {
    /* ignore */
  }
  return null
}

function writeCache(data: WeatherNow) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data }))
  } catch {
    /* ignore */
  }
}

async function fetchOnce(models?: string): Promise<WeatherNow> {
  const modelQ = models ? `&models=${models}` : ''
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}` +
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation` +
    `&daily=temperature_2m_max,temperature_2m_min&timezone=Asia%2FShanghai&forecast_days=1` +
    `&wind_speed_unit=ms${modelQ}`

  const res = await fetch(url)
  if (!res.ok) throw new Error('天气服务暂不可用')
  const j = await res.json()
  const code = Number(j.current?.weather_code ?? 0)
  const m = mapCode(code)
  const windMs = Number(j.current?.wind_speed_10m ?? 0)
  return {
    temp: Math.round(Number(j.current?.temperature_2m ?? 0)),
    feelsLike: Math.round(Number(j.current?.apparent_temperature ?? j.current?.temperature_2m ?? 0)),
    humidity: Math.round(Number(j.current?.relative_humidity_2m ?? 0)),
    weatherCode: code,
    windMs,
    windLevel: windToLevel(windMs),
    precip: Number(j.current?.precipitation ?? 0),
    label: m.label,
    emoji: m.emoji,
    high: Math.round(Number(j.daily?.temperature_2m_max?.[0] ?? 0)),
    low: Math.round(Number(j.daily?.temperature_2m_min?.[0] ?? 0)),
    updatedAt: new Date().toISOString(),
    city: '连云港·海大',
  }
}

export async function fetchCampusWeather(): Promise<WeatherNow> {
  const hit = readCache()
  if (hit) return hit

  // 优先中国气象局 GRAPES（对国内更贴），失败再回退全球最优
  let data: WeatherNow
  try {
    data = await fetchOnce('cma_grapes_global')
  } catch {
    data = await fetchOnce()
  }
  writeCache(data)
  return data
}
