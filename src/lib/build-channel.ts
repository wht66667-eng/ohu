/** Compile-time distribution channel switch. Regular APKs and H5 default to the OHU updater. */
export const IS_FDROID_BUILD = import.meta.env.VITE_FDROID_BUILD === '1'
