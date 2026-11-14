export const WESTERN_ZODIAC = [
  { number: 1, id: "aries", name: "白羊座", english: "Aries" },
  { number: 2, id: "taurus", name: "金牛座", english: "Taurus" },
  { number: 3, id: "gemini", name: "双子座", english: "Gemini" },
  { number: 4, id: "cancer", name: "巨蟹座", english: "Cancer" },
  { number: 5, id: "leo", name: "狮子座", english: "Leo" },
  { number: 6, id: "virgo", name: "处女座", english: "Virgo" },
  { number: 7, id: "libra", name: "天秤座", english: "Libra" },
  { number: 8, id: "scorpio", name: "天蝎座", english: "Scorpio" },
  { number: 9, id: "sagittarius", name: "射手座", english: "Sagittarius" },
  { number: 10, id: "capricorn", name: "摩羯座", english: "Capricorn" },
  { number: 11, id: "aquarius", name: "水瓶座", english: "Aquarius" },
  { number: 12, id: "pisces", name: "双鱼座", english: "Pisces" },
] as const

export const CHINESE_ZODIAC = [
  { number: 1, id: "rat", name: "鼠", english: "Rat" },
  { number: 2, id: "ox", name: "牛", english: "Ox" },
  { number: 3, id: "tiger", name: "虎", english: "Tiger" },
  { number: 4, id: "rabbit", name: "兔", english: "Rabbit" },
  { number: 5, id: "dragon", name: "龙", english: "Dragon" },
  { number: 6, id: "snake", name: "蛇", english: "Snake" },
  { number: 7, id: "horse", name: "马", english: "Horse" },
  { number: 8, id: "goat", name: "羊", english: "Goat" },
  { number: 9, id: "monkey", name: "猴", english: "Monkey" },
  { number: 10, id: "rooster", name: "鸡", english: "Rooster" },
  { number: 11, id: "dog", name: "狗", english: "Dog" },
  { number: 12, id: "pig", name: "猪", english: "Pig" },
] as const

export type FortuneSeries = 'western-zodiac' | 'chinese-zodiac' | 'tarot'

export function fortuneArtwork(series: FortuneSeries, id: string): string {
  return `${import.meta.env.BASE_URL}assets/today-fortune/${series === 'tarot' ? 'tarot/v3' : series}/${id}.webp`
}

const PROMPTS = [
  '先完成一件十分钟内能收尾的小事。', '给日程留一点弹性，临时变化也能从容应对。',
  '主动问候一位朋友，简单的交流也会带来好心情。', '遇到难题时先写下已知条件，再决定下一步。',
  '休息不是偷懒，短暂放松后再回来继续。', '把想法说清楚，比猜测对方的意思更轻松。',
  '今天可以尝试一个熟悉任务的新方法。', '做决定前核对信息，给自己一点思考时间。',
  '肯定已经完成的部分，再安排剩下的事。', '遇到分歧时，先确认双方真正想解决的问题。',
  '去户外走一小段，让注意力换个节奏。', '给重要任务设一个温和的开始时间，先动起来。',
] as const

export function dailyFortunePrompt(index: number, date = new Date()) {
  const year = date.getFullYear()
  const day = (Date.UTC(year, date.getMonth(), date.getDate()) - Date.UTC(year, 0, 0)) / 86_400_000
  return PROMPTS[(index * 5 + day) % PROMPTS.length]
}
