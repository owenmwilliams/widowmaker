import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import { Image as VanImage } from 'vant';
import 'vant/lib/index.css'
import enUS from 'vant/es/locale/lang/en-US'
import router from './router'
import { createAuth0 } from '@auth0/auth0-vue'
import { createPinia } from 'pinia'

import { Quasar, Loading, BottomSheet, Notify, Dialog } from 'quasar';

import MasonryWall from '@yeger/vue-masonry-wall'



import 'quasar/src/css/index.sass'
import '@quasar/extras/material-icons/material-icons.css'
// import resetStore from './stores/reset-store'
import { defineCustomElements } from '@ionic/pwa-elements/loader';
defineCustomElements(window);
const app = createApp(App);

const auth_domain = import.meta.env.MODE == 'development' ? 'take-stock-demo.us.auth0.com' : 'take-stock.us.auth0.com';
const auth_client = import.meta.env.MODE == 'development' ? '230ix4qcpkz5AWFIoevU14nwyMhI6Sdl' : 'PoM7n3F6Nlp2k9AaFyA2wz0OIPKMaPmh';
const auth_audience = import.meta.env.MODE == 'development' ? 'https://take-stock.app/api-endpoint' : 'https://api-endpoint.take-stock.app';

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

// TEMPORARY: Only initialize Auth0 in production - REMOVE BEFORE PRODUCTION!
if (import.meta.env.MODE !== 'development') {
    app.use(
        createAuth0({
            domain: auth_domain,
            client_id: auth_client,
            redirect_uri: window.location.origin,
            audience: auth_audience
        })
    )
}

app.use(pinia)
app.mount('#app');
