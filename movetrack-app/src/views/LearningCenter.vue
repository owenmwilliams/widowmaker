
<script setup>
    import { ref } from 'vue';
    import router from '../router';
    import UnlimitedAuctionContract from './UnlimitedAuctionContract.vue'
    import BlockchainPrimer from './BlockchainPrimer.vue';
    import FAQ from './FAQ.vue';
    import WhyBlockchain from './WhyBlockchain.vue';

    const page = ref('why blockchain')

</script>


<template>
    <q-layout view="hHh lpR fFf">
        <div class="bg-transparent text-dark q-ma-xl">
            <q-toolbar>
                <q-toolbar-title align="center" class="text-weight-medium text-h4">
                    Buying and selling on skwurlit
                </q-toolbar-title>
            </q-toolbar>
            <q-tabs class="text-weight-thin">
                <q-btn flat no-caps @click="page = 'why blockchain'" label="Why Blockchain" class="q-px-sm text-weight-thin" />
                <q-btn flat no-caps @click="page = 'blockchain primer'" label="Blockchain Basics" class="q-px-sm text-weight-thin" />
                <q-btn flat no-caps @click="page = 'unlimited auction contract'" label="Unlimited Auction Contract" class="q-px-sm text-weight-thin" />
                <q-btn flat no-caps @click="page = 'frequently asked questions'" label="FAQ" class="q-px-sm text-weight-thin" />
                
                <q-btn flat no-caps @click="router.push({path : '/'})" label="Home" class="q-px-sm text-weight-thin" />
            </q-tabs>
        </div>
        <q-page-container class="q-ma-xl">
            <q-page class="q-pa-md">
                <WhyBlockchain v-if="page=='why blockchain'" />
                <UnlimitedAuctionContract v-else-if="page=='unlimited auction contract'" />
                <BlockchainPrimer v-else-if="page=='blockchain primer'" />
                <FAQ v-else-if="page=='frequently asked questions'" />
            </q-page>
        </q-page-container>
    </q-layout> 
</template>
  

  