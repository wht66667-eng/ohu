/**
 * 遗留标记查询：老装机用户本地可能仍有「学号门禁已通过」标记。
 * 登录已改为手机号注册 / 密码登录（见 PhoneRegistrationGate），
 * 学号 + 教务密码改在「课表」页绑定同步；此处仅保留启动帧判断用的兼容查询。
 */
import { loadCampusAccount } from './campus-account'

const LS_UNLOCKED = 'campus.gate.unlocked.v1'

export function hasCampusGatePass(): boolean {
  if (localStorage.getItem(LS_UNLOCKED) !== '1') return false
  const a = loadCampusAccount()
  return !!(a.stuid && a.remember && a.jwPassword)
}
