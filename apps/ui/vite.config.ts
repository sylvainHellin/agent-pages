import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin, type ProxyOptions } from 'vite'

// The API refuses mutations whose Origin is not its Host or X-Forwarded-Host (as behind tailscale serve):
// say which host the page came from, so POST / PATCH from the dev server pass.
const toTest: ProxyOptions = {
  target: 'http://127.0.0.1:8329',
  configure: (proxy) => proxy.on('proxyReq', (req) => req.setHeader('X-Forwarded-Host', '127.0.0.1:8328')),
}

// The server answers /app/<file> with the same files as /<file> (the phone's Web Clip path); do the same in dev,
// so public files such as reader.css resolve at /app/ too.
const appAlias: Plugin = {
  name: 'app-alias',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url && /^\/app\/./.test(req.url)) req.url = req.url.slice(4)
      next()
    })
  },
}

// One build for /tutor/ and /tutor/app/: every URL is relative to the page.
// Dev server: 127.0.0.1:8328, API and lessons from the test server on 8329.
export default defineConfig({
  base: './',
  plugins: [appAlias, react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  build: { chunkSizeWarningLimit: 800 },
  server: {
    host: '127.0.0.1',
    port: 8328,
    strictPort: true,
    proxy: { '/api': toTest, '/lessons': toTest },
  },
})
