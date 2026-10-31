/** NON-PRODUCTION fail-closed fallback: never import the real notification plugin from a review entry. */
const blocked = async () => { throw new Error('本地 UI 预览禁止未模拟的通知或权限桥接') }
export const LocalNotifications = new Proxy({}, { get: () => blocked })
