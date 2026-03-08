<script setup lang="ts">
  // This starter template is using Vue 3 <script setup> SFCs
  // Check out https://vuejs.org/api/sfc-script-setup.html#script-setup
  import { ref, watch } from 'vue';
  import useEventBus from './composables/useEventBus';
  import ItemDetailsModal from './components/inventory/ItemDetailsModal.vue';
  import { useQuasar } from 'quasar';

  // https://stackoverflow.com/questions/63471824/vue-js-3-event-bus/64019074#64019074
  
  const active = ref('location');
  const isLoading = ref(false);
  
  const { bus } = useEventBus();
  watch(() => bus.value.get('navigation'), (val) => {
    const [navigationBus] = val ?? []
    active.value = navigationBus    
  });

  const $q = useQuasar()

  // Check if the screen.orientation property is available in the browser
  // if ('orientation' in screen) {
  //   // Lock the screen orientation to portrait
  //   // @ts-ignore
  //   screen.orientation.lock('portrait').then(function success() {
  //     console.log('Screen orientation locked to portrait.');
  //   }).catch(function error(err) {
  //     console.error('Failed to lock screen orientation:', err);
  //   });
  // } else {
  //   console.log('Screen orientation API not supported in this browser.');
  // }
  
  async function onLoading(arg: boolean) {
    if (arg) {
      $q.loading.show({
        delay: 400,
        message: 'Loading...',
        spinnerSize: 100,
        spinnerColor: 'white',
        messageColor: 'white',
        backgroundColor: 'black',
        customClass: 'blackBox'
      })
      } else {
        $q.loading.hide()
      }
    }

</script>

<template>
  <meta meta name="viewport" content="width=device-width, user-scalable=no" />
      <div class="content">
        <Suspense>
          <router-view @app:loading="onLoading" />
        </Suspense>
      </div>
      <ItemDetailsModal />
</template>
