import path from 'path'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import pkg from './package.json'

/**
 * Vite plugin that redirects module imports to their .demo counterparts.
 * Works with relative imports by hooking into resolveId after Vite resolves
 * the relative path to an absolute path.
 */
function demoAlias(mappings: Record<string, string>): Plugin {
  return {
    name: 'demo-alias',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
      if (!resolved) return null
      const replacement = mappings[resolved.id]
      return replacement ?? null
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const port = Number(env.VITE_PORT || 5173)
  const libDir = path.resolve(__dirname, 'src/lib')

  return {
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    build: {
      chunkSizeWarningLimit: 3000,
      rollupOptions: {
        onwarn(warning, defaultHandler) {
          // Suppress font resolution warnings (tex-gyre-pagella legacy formats)
          if (warning.message?.includes("didn't resolve at build time")) return
          // Suppress dynamic/static import mixing warnings
          if (warning.code === 'MIXED_DYNAMIC_STATIC') return
          defaultHandler(warning)
        },
      },
    },
    plugins: [
      ...(mode === 'demo' ? [demoAlias({
        [path.join(libDir, 'fetcher.ts')]: path.join(libDir, 'fetcher.demo.ts'),
        [path.join(libDir, 'search.ts')]: path.join(libDir, 'search.demo.ts'),
        [path.join(libDir, 'auth-shell.tsx')]: path.join(libDir, 'auth-shell.demo.tsx'),
      })] : []),
      react(),
      VitePWA({
        // 'prompt' (not 'autoUpdate'): under autoUpdate the generated
        // register code silently calls window.location.reload() as soon as
        // a new worker activates, so a deploy yanked the page out from under
        // whoever was reading. It also never calls onNeedRefresh, which made
        // the update toast in src/main.tsx dead code. 'prompt' leaves the new
        // worker waiting until the user taps that toast.
        registerType: 'prompt',
        includeAssets: ['icons/favicon-black.png', 'icons/favicon-white.png', 'apple-touch-icon-180x180.png'],
        manifest: {
          // Explicit app id pins the install identity. Without it browsers
          // derive it from start_url, so changing start_url later would look
          // like a different app to an already-installed client.
          id: '/all',
          name: 'Oksskolten',
          short_name: 'Oksskolten',
          description: 'Personal RSS Reader',
          lang: 'en',
          theme_color: '#ffffff',
          background_color: '#4D6782',
          display: 'standalone',
          prefer_related_applications: false,
          // Listing our own manifest lets navigator.getInstalledRelatedApps()
          // report this PWA as installed. Android Chrome stops firing
          // beforeinstallprompt after install, and a browser tab still reports
          // display-mode: browser, so this is the only way the Settings > About
          // section can tell "already installed" from "not installable".
          related_applications: [
            { platform: 'webapp', url: '/manifest.webmanifest' },
          ],
          scope: '/',
          start_url: '/all',
          icons: [
            {
              src: 'pwa-64x64.png',
              sizes: '64x64',
              type: 'image/png',
            },
            {
              src: 'pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
            },
            {
              src: 'pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
            },
            {
              src: 'maskable-icon-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
            {
              src: 'icons/favicon-black.png',
              sizes: '64x64',
              type: 'image/png',
            },
          ],
        },
        workbox: {
          maximumFileSizeToCacheInBytes: mode === 'demo' ? 5 * 1024 * 1024 : 2 * 1024 * 1024,
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
          navigateFallback: 'index.html',
          navigateFallbackDenylist: [/^\/api\//],
          runtimeCaching: [
            {
              urlPattern: /google\.com\/s2\/favicons/,
              handler: 'CacheFirst',
              options: {
                cacheName: 'favicons',
                expiration: { maxEntries: 200, maxAgeSeconds: 2592000 },
              },
            },
            {
              urlPattern: /\/api\/articles\/by-url/,
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'article-detail',
                expiration: { maxEntries: 200, maxAgeSeconds: 604800 },
              },
            },
            {
              urlPattern: ({ url }) =>
                url.pathname.startsWith('/api/')
                && url.pathname !== '/api/health'
                && url.pathname !== '/api/me'
                && url.pathname !== '/api/login'
                && url.pathname !== '/api/logout'
                && !url.pathname.startsWith('/api/auth/')
                && !url.pathname.startsWith('/api/oauth/'),
              handler: 'NetworkFirst',
              options: {
                cacheName: 'api',
                expiration: { maxEntries: 100, maxAgeSeconds: 86400 },
                networkTimeoutSeconds: 5,
              },
            },
            {
              urlPattern: /\.(png|jpg|jpeg|webp|gif)$/,
              handler: 'CacheFirst',
              options: {
                cacheName: 'images',
                expiration: { maxEntries: 100, maxAgeSeconds: 2592000 },
              },
            },
          ],
        },
      }),
    ],
    server: {
      host: '0.0.0.0',
      port,
      // Vite blocks non-localhost Host headers by default; staging on a
      // tailnet hostname needs it explicitly allow-listed (comma-separated).
      allowedHosts: env.VITE_ALLOWED_HOSTS
        ? env.VITE_ALLOWED_HOSTS.split(',').map(h => h.trim()).filter(Boolean)
        : undefined,
      watch: env.CHOKIDAR_USEPOLLING === 'true'
        ? { usePolling: true, interval: 300 }
        : undefined,
      proxy: {
        '/api': env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:3000',
      },
    },
  }
})
