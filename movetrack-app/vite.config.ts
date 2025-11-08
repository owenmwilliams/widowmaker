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
})
