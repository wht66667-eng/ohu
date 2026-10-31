/** The shell owns keyboard avoidance; child composers must not subtract it again. */
export function keyboardViewport(input: {
  layoutHeight: number
  baselineHeight: number
  visualHeight?: number
  visualOffsetTop?: number
  visualScale?: number
  nativeImeHeight?: number
  editing: boolean
}) {
  const layout = Math.max(1, input.layoutHeight)
  const zoomed = Math.abs((input.visualScale ?? 1) - 1) > 0.05
  const visual = zoomed ? layout : Math.min(layout, input.visualHeight ?? layout)
  const offset = zoomed ? 0 : Math.max(0, input.visualOffsetTop ?? 0)
  const resizedBySystem = Math.max(0, input.baselineHeight - layout)
  // adjustResize may already have removed some/all of the IME from innerHeight.
  const nativeOverlap = Math.max(0, (input.nativeImeHeight ?? 0) - resizedBySystem)
  const height = Math.max(1, Math.min(visual, layout - nativeOverlap))
  const keyboardOpen = input.editing && !zoomed &&
    Math.max(resizedBySystem, layout - visual - offset, input.nativeImeHeight ?? 0) > 150
  return { height, offsetTop: Math.min(offset, layout - height), keyboardOpen }
}

/** Android IMEs may report keyCode 229 while isComposing is already false. */
export function isImeComposing(event: { keyCode?: number; nativeEvent?: { isComposing?: boolean; keyCode?: number } }) {
  return !!event.nativeEvent?.isComposing || event.keyCode === 229 || event.nativeEvent?.keyCode === 229
}

/** Enter inserts a line break. Sending always has a visible button; desktop gets Ctrl/Cmd+Enter. */
export function submitMessageKey(event: { key: string; ctrlKey?: boolean; metaKey?: boolean; keyCode?: number; nativeEvent?: { isComposing?: boolean; keyCode?: number } }) {
  return event.key === 'Enter' && !!(event.ctrlKey || event.metaKey) && !isImeComposing(event)
}
