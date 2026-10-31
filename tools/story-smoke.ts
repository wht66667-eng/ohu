import { calcDamage, catchRate, expAtLevel, gainExp, applyExp, type Fighter } from '../src/games/story/battle-engine'
import { rollWeather, worldSlice, seasonOf, dayOfSeason, weatherEffect } from '../src/games/story/world'
import { PEOPLE, peopleHere, scheduleOf, giftDelta, bondTier } from '../src/games/story/people'
import { festivalOf, upcoming, monthView } from '../src/games/story/calendar'
import { rollFish, mineFloor, STAMINA_COST, MAX_STAMINA } from '../src/games/story/gather'
import { emptySave, addItem, bump } from '../src/games/story/save'
import {
  ACHIEVEMENTS,
  achDone,
  buy,
  checkAchievements,
  refreshQuests,
  sell,
  SHOP,
  syncQuestProgress,
} from '../src/games/story/shop'
import { makeFox, wildAt } from '../src/games/story/foxes'

let fail = 0
function ok(name: string, cond: boolean, extra = '') {
  if (!cond) fail++
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`)
}

// D 章：伤害 / 克制 / 捕捉 / 成长
const a: Fighter = { id: 'a', name: 'A', type: 'water', level: 10, hp: 50, maxHp: 50, atk: 12, def: 8, rate: 100, status: 'none' }
const d: Fighter = { id: 'd', name: 'D', type: 'fire', level: 10, hp: 50, maxHp: 50, atk: 10, def: 8, rate: 100, status: 'none' }
const superHit = calcDamage({ attacker: a, defender: d, move: { id: 'm', name: '水花', type: 'water', power: 40 }, rand: 0.5 })
const plainHit = calcDamage({ attacker: { ...a, type: 'norm' }, defender: d, move: { id: 'm', name: '撞击', type: 'norm', power: 40 }, rand: 0.5 })
ok('水打火是克制', superHit.factor === 1.5)
ok('克制伤害高于普通', superHit.damage > plainHit.damage, `${superHit.damage} > ${plainHit.damage}`)
ok('伤害至少 1', superHit.damage >= 1)
ok('残血捕捉率更高', catchRate({ ...d, hp: 5 }, 'normal') > catchRate({ ...d, hp: 45 }, 'normal'))
ok('高级球优于普通球', catchRate(d, 'great') > catchRate(d, 'normal'))
ok('捕捉率封顶 0.95', catchRate({ ...d, hp: 1 }, 'season') <= 0.95)
ok('经验曲线立方', expAtLevel(10) === 1600 && expAtLevel(20) === 12800, `${expAtLevel(10)}/${expAtLevel(20)}`)
const grown = applyExp(a, gainExp(a, 60, 'wild') * 7)
ok('攒够经验能升级', grown.fox.level > 10, `Lv.${grown.fox.level}`)

// F 章：天气 / 时间
ok(
  '季节按 28 天切',
  seasonOf(1) === 'spring' && seasonOf(29) === 'summer' && seasonOf(60) === 'autumn' && seasonOf(85) === 'winter',
  `${seasonOf(1)}/${seasonOf(29)}/${seasonOf(60)}/${seasonOf(85)}`,
)
ok('一季内天数 1–28', dayOfSeason(1) === 1 && dayOfSeason(28) === 28 && dayOfSeason(29) === 1)
ok('每 7 天一场雨', rollWeather(7) === 'rain' && rollWeather(14) === 'rain')
ok('季节首尾晴天', rollWeather(1) === 'sunny' && rollWeather(28) === 'sunny')
ok('天气稳定可复现', rollWeather(11) === rollWeather(11))
ok('时段切片正确', worldSlice(6 * 60) === 'dawn' && worldSlice(15 * 60) === 'afternoon' && worldSlice(23 * 60) === 'late')
ok('暴雨不能钓鱼', weatherEffect('storm').canFish === false)
ok('雨天自动浇水', weatherEffect('rain').autoWater === true)
ok('雪天作物不长', weatherEffect('snow').cropGrow === false)

// A 章：居民
const ctx = { day: 12, weather: rollWeather(12) as never, festivalMap: null }
const onFarm = peopleHere('farm', 10 * 60, ctx)
ok('上午农田有人', onFarm.length > 0, onFarm.map((x) => x.person.name).join('/'))
ok('日程覆盖生效', scheduleOf(PEOPLE[0], { ...ctx, festivalMap: 'plaza' })[0].map === 'plaza')
ok('生日送礼 ×3', giftDelta(PEOPLE[0], 'cabbage', true) === giftDelta(PEOPLE[0], 'cabbage', false) * 3)
ok('讨厌礼物扣好感', giftDelta(PEOPLE[0], 'trash', false) < 0)
ok('好感分 5 级', bondTier(0).name === '陌生' && bondTier(85).name === '挚友')
ok('八位居民', PEOPLE.length === 8)

// B 章：日历
ok('春 13 日是播种节', festivalOf(13)?.id === 'sow')
ok('月历 28 格', monthView(12).length === 28)
ok('即将到来非空且有序', upcoming(5).length > 0 && upcoming(5)[0].inDays >= 0)

// C 章：钓鱼 / 矿洞
const f = rollFish(12, 18 * 60, 'sunny', 2, 3)
ok('黄昏能摇到鱼', !!f.fish, f.fish?.name)
ok('判定区间随鱼竿变大', rollFish(12, 18 * 60, 'sunny', 5, 5).window > rollFish(12, 18 * 60, 'sunny', 1, 1).window)
ok('风暴天摇不到鱼', rollFish(12, 18 * 60, 'storm', 1, 1).fish === null)
const fl = mineFloor(12, 12)
ok('矿洞有矿可采', fl.nodes.length > 0)
ok('第 10 层是 Boss 层', mineFloor(10, 1).boss === true)
ok('体力上限 100', MAX_STAMINA === 100 && STAMINA_COST.mine === 3)

// H/E 章：存档 / 商店 / 任务 / 成就
const save = emptySave()
ok('新档金币 200', save.gold === 200)
addItem(save, 'cabbage', 3)
ok('背包可加可查', save.bag.cabbage === 3)
bump(save, 'goldEarned', 1200)
const got = checkAchievements(save)
ok('赚够钱解锁成就', got.some((x) => x.id === 'a_gold1'), got.map((x) => x.name).join('/'))
ok('成就共 24 个', ACHIEVEMENTS.length === 24)
refreshQuests(save, 1)
ok('刷新出日常任务', save.quests.some((q) => q.kind === 'daily'))
const before = save.gold
const seedItem = SHOP.find((s) => s.id === 'seed_cabbage')!
buy(save, seedItem, 1)
ok('买种子扣钱加包', save.gold < before && (save.bag.seed_cabbage ?? 0) > 0)
const goldBefore = save.gold
sell(save, 'cabbage', 2)
ok('卖作物进钱', save.gold > goldBefore)
syncQuestProgress(save)
ok('任务进度可同步', save.quests.every((q) => q.now <= q.goal))
ok('图鉴成就可读', typeof achDone(save, ACHIEVEMENTS[0]) === 'boolean')
ok('野狐可按地图摇出', !!wildAt('dock', 'dusk', 'spring'))
ok('物种可实例化', makeFox('dewfox', 8)?.maxHp === 40 + (8 - 5) * 2 * 3)

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`)
