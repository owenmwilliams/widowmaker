import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import { Image as VanImage } from 'vant';
import 'vant/lib/index.css'
import enUS from 'vant/es/locale/lang/en-US'
import router from './router'
import { createPinia } from 'pinia'

import { Quasar, Loading, BottomSheet, Notify, Dialog, setCssVar } from 'quasar';

import MasonryWall from '@yeger/vue-masonry-wall'

import 'quasar/src/css/index.sass'
import '@quasar/extras/material-icons/material-icons.css'
import { defineCustomElements } from '@ionic/pwa-elements/loader';
defineCustomElements(window);

// Development-only: Session persistence helper for HMR
const isDevelopment = import.meta.env.MODE === 'development';
if (isDevelopment) {
  // On app startup, restore session from sessionStorage if localStorage is empty
  const sessionToken = localStorage.getItem('session_token');
  const userData = localStorage.getItem('user_data');
  const backupToken = sessionStorage.getItem('dev_session_backup');
  const backupUser = sessionStorage.getItem('dev_user_backup');

  if (!sessionToken && backupToken) {
    console.log('[Dev Session] Restoring session from backup after HMR reload');
    localStorage.setItem('session_token', backupToken);
    if (backupUser) {
      localStorage.setItem('user_data', backupUser);
    }
  } else if (sessionToken) {
    // Backup current session to sessionStorage for HMR resilience
    sessionStorage.setItem('dev_session_backup', sessionToken);
    if (userData) {
      sessionStorage.setItem('dev_user_backup', userData);
    }
  }

  // Watch for localStorage changes and backup to sessionStorage
  window.addEventListener('storage', (e) => {
    if (e.key === 'session_token' && e.newValue) {
      sessionStorage.setItem('dev_session_backup', e.newValue);
    } else if (e.key === 'user_data' && e.newValue) {
      sessionStorage.setItem('dev_user_backup', e.newValue);
    }
  });
}

const app = createApp(App);

const pinia = createPinia();

app.use(router);

// const app = createApp(App).use(Quasar,   
//     {
//         config: {
//         },
//         plugins: {
//             Loading
//         }
//     }
//     );

app.use(Quasar, {
    plugins: {
        Loading,
        BottomSheet,
        Notify,
        Dialog
    }, // import Quasar plugins and add here
});

Notify.setDefaults({
    position: 'bottom',
    timeout: 2500,
    textColor: 'white',
    classes: 'notify-high-z'
});

setCssVar('primary', '#274690');    // ReloPrep Royal Blue
setCssVar('secondary', '#1CA1C1');  // Proof Cyan
setCssVar('accent', '#1CA1C1');     // Proof Cyan
setCssVar('positive', '#2EBD85');   // On-Time Green
setCssVar('negative', '#D64545');   // Safety Red
setCssVar('info', '#1CA1C1');       // Proof Cyan
setCssVar('warning', '#C99A3E');    // Brass

app.use(MasonryWall)
app.use(VanImage);
app.use(pinia)
app.mount('#app');
