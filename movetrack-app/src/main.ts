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

setCssVar('primary', '#274690');    // VeriMove Royal Blue
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
