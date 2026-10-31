import { useId, useRef, type ReactNode } from 'react'
import styles from './ImageUploadField.module.css'

/**
 * 统一的选图控件。内部是一个原生 <input type="file">，用 opacity:0 透明铺满可点区域。
 *
 * 不写成「按钮 + JS 触发 input.click()」，有三个坑：
 *   1) WebView 要求唤起系统选择器必须在用户手势的同步调用栈里，
 *      中间插了 setState 或 useEffect 就静默失效，点了完全没反应；
 *   2) input 挂在「点遮罩关闭」的容器里时，转发过去的 click 照常冒泡，
 *      先把弹层关掉、input 跟着卸载，文件回传时 change 已无接收者；
 *   3) id 不能写死，一个页面可能同时挂多个实例，这里用 useId()。
 *
 * 也不能换成 hidden / display:none：那种元素不参与命中测试，只能靠 label 转发点击，
 * 部分 ROM 的 WebView 不认这种转发。opacity:0 照常参与命中测试，
 * 手指等于直接点在原生控件上。
 *
 * 与「发布闲置」里那个一直能正常上传的 input 是同一套机制。
 * Android 13+ 走系统选择器不需要申请存储权限。
 */
export function ImagePickButton({
  label,
  hint,
  multiple = false,
  disabled,
  capture,
  ariaLabel,
  onPick,
}: {
  /** 可点区域内显示的内容（图标或文字） */
  label: ReactNode
  hint?: string
  multiple?: boolean
  disabled?: boolean
  /** 'environment' 直接唤起后置摄像头 */
  capture?: 'environment' | 'user'
  ariaLabel?: string
  onPick: (files: File[]) => void
}) {
  const id = useId()
  const inputRef = useRef<HTMLInputElement | null>(null)

  return (
    <span className={styles.pickInline}>
      <label className={styles.pickLabel} htmlFor={id}>
        {label}
        {hint ? <em className={styles.hint}>{hint}</em> : null}
      </label>

      {/* 透明但保留在布局里，铺满可点区域：不靠 label 转发，也不靠 JS 触发 click */}
      <input
        id={id}
        ref={inputRef}
        className={styles.pickInput}
        type="file"
        accept="image/*"
        multiple={multiple}
        capture={capture}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(e) => {
          /* 同步拷一份：紧接着要清空 value，FileList 是活引用，会被一起清空 */
          const files = e.target.files ? Array.from(e.target.files) : []
          if (inputRef.current) inputRef.current.value = ''
          if (files.length) onPick(files)
        }}
      />
    </span>
  )
}
