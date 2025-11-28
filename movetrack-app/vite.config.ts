import { build, defineConfig, optimizeDeps } from 'vite'
import vue from '@vitejs/plugin-vue'
import { quasar, transformAssetUrls } from '@quasar/vite-plugin'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    vue({
      template: { transformAssetUrls }
    }),

    quasar({
      sassVariables: 'src/quasar-variables.sass'
    })
  ],

  //MARK: new code here
  optimizeDeps: { // 👈 optimizedeps
    esbuildOptions: {
      target: "ES2022", 
      // Node.js global to browser globalThis
      define: {
        global: 'globalThis'
      },
      supported: { 
        bigint: true 
      },
    }
  },

  define: {
    'import.meta.env.VITE_APP_DECRYPT_URL_KEY': JSON.stringify(process.env.VITE_APP_DECRYPT_URL_KEY),
  },

  build: {
    target: ["ES2022"], // 👈 build.target
  },

  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3050',
        changeOrigin: true,
      },
      '/users': {
        target: 'http://localhost:3050',
        changeOrigin: true,
      },
      '/locations': {
        target: 'http://localhost:3050',
        changeOrigin: true,
      },
      '/collections': {
        target: 'http://localhost:3050',
        changeOrigin: true,
      },
      '/containers': {
        target: 'http://localhost:3050',
        changeOrigin: true,
      },
      '/lists': {
        target: 'http://localhost:3050',
        changeOrigin: true,
      },
      '/file': {
        target: 'http://localhost:3050',
        changeOrigin: true,
      },
      '^/vision(?=/)': {
        target: 'http://localhost:3050',
        changeOrigin: true,
      },
      '/public': {
        target: 'http://localhost:3050',
        changeOrigin: true,
      },
      '/auth': {
        target: 'http://localhost:3050',
        changeOrigin: true,
      },
    }
  }
})
