import { build } from 'vite'
await build({
  configFile: false,
  logLevel: 'error',
  build: {
    ssr: true,
    outDir: '.tmp-smoke',
    emptyOutDir: false,
    rollupOptions: { input: 'tools/story-smoke.ts', output: { entryFileNames: 'smoke.mjs', format: 'esm' } },
  },
})
console.log('bundled')
