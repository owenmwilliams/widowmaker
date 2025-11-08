import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import { Image as VanImage } from 'vant';
import 'vant/lib/index.css'
import enUS from 'vant/es/locale/lang/en-US'
import router from './router'
import { createPinia } from 'pinia'

import { Quasar, Loading, BottomSheet, Notify, Dialog } from 'quasar';

import MasonryWall from '@yeger/vue-masonry-wall'

import 'quasar/src/css/index.sass'
import '@quasar/extras/material-icons/material-icons.css'
import { defineCustomElements } from '@ionic/pwa-elements/loader';
defineCustomElements(window);
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
    config: {
    },
    plugins: {
        Loading,
        BottomSheet,
        Notify,
        Dialog
    }, // import Quasar plugins and add here
});

app.use(MasonryWall)
app.use(VanImage);
app.use(pinia)
app.mount('#app');
