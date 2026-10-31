import { isFoxFreeVariant, useUiVariant } from '../../lib/ui-variant'

/** Lightweight vector brand details; meaningful labels belong to the parent control. */
export function FoxPaw({ size = 24 }: { size?: number }) {
  if (isFoxFreeVariant(useUiVariant())) return null
  return <svg width={size} height={size} viewBox="0 0 32 32" fill="currentColor" aria-hidden="true" focusable="false"><ellipse cx="16" cy="22" rx="9" ry="7" /><ellipse cx="6" cy="12" rx="3.5" ry="5" transform="rotate(-25 6 12)" /><ellipse cx="13" cy="7" rx="3.5" ry="5" /><ellipse cx="21" cy="7" rx="3.5" ry="5" /><ellipse cx="27" cy="13" rx="3.5" ry="5" transform="rotate(25 27 13)" /></svg>
}
export function FoxBrand({ size = 32 }: { size?: number }) {
  if (isFoxFreeVariant(useUiVariant())) return null
  return <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true" focusable="false"><path d="M5 6 21 15 43 4 44 29 31 43 15 41 3 28Z" fill="var(--green)" /><path d="m5 6 16 9L3 28Z" fill="var(--green-deep)" /><path d="M13 31c3-11 12-17 23-15l-3 11 5 4-12 7Z" fill="var(--card)" /></svg>
}
