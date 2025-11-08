<script setup lang="ts">
import { ref } from 'vue';


    const props = defineProps<{
        cardsTrack: Array<any>,
        cardsShare: Array<any>
    }>()

    const trackShow = ref('track')
</script>

<template>

<div class="row">
    <div style="min-width: 100%; display: flex; justify-content: center; align-items: center;">
        <q-btn-toggle
            v-model="trackShow"
            toggle-color="secondary"
            flat
            :options="[
            {label: 'Manage your collections', value: 'track'},
            {label: 'List on the marketplace', value: 'share'}
            ]"
        />
    </div>
</div>

<div class="row q-mx-xl" v-if="trackShow == 'track'">
    <div class="row">
        <div class="text-body1 text-weight-light q-pa-lg">
            With skwurlit, you have the perfect tool to organize and manage your collection like never before. Easily log and categorize your 
            items, whether they're rare coins, vintage stamps, exquisite jewelry, or anything in between. Our intuitive interface allows you to create a 
            detailed catalog of your collection, making it a breeze to track, update, and cherish your treasures. Say goodbye to the hassle of manual record-keeping 
            and enjoy the convenience of a digital collection management system.
        </div>
    </div>
    <div class="row q-my-xl">
        <q-card
            flat
            v-for="card in cardsTrack"
            :key="card.id"
            class="card bg-none q-pa-none col-4"
            elevation="2"
        >
            <q-card-section vertical centered class="q-mx-md">
                <q-card-section class="icon-section q-pa-none">
                    <q-img
                    class="icons"
                    :src="card.icon"
                    />
                </q-card-section>
                <q-card-section class="q-pa-none">
                    <q-card-section class="title-section q-pa-none">
                        <h3 class="title">{{ card.title }}</h3>
                    </q-card-section>
                    <q-card-section class="description-section q-pa-none">
                        <p class="description">{{ card.description }}</p>
                    </q-card-section>
                </q-card-section>
            </q-card-section>
        </q-card>
    </div>
</div>

<div class="row q-mx-xl" v-else>
    <div class="row">
        <div class="text-body1 text-weight-light q-pa-lg">
            This is a new type of marketplace, where trust and efficiency are at the forefront of every transaction. 
            Leveraging the power of Ethereum, we provide a transaction experience that's security-first and also cost-effective.
            Every item you see is represented by a unique digital token on the blockchain, ensuring authenticity and a seamless selling process. 
            Curious about the nuts and bolts of this technology? Dive deeper and discover more on our information page. 
            Join us in reshaping the marketplace, where every transaction is a step towards the future of secure, efficient, and trustworthy trading.
        </div>
    </div>
    <div class="row q-my-xl">
        <q-card
            flat
            v-for="card in cardsShare"
            :key="card.id"
            class="card bg-none q-pa-none col-4"
            elevation="2"
        >
            <q-card-section vertical centered class="q-mx-md">
                <q-card-section class="icon-section q-pa-none">
                    <q-img
                    class="icons"
                    :src="card.icon"
                    />
                </q-card-section>
                <q-card-section class="q-pa-none">
                    <q-card-section class="title-section q-pa-none">
                        <h3 class="title">{{ card.title }}</h3>
                    </q-card-section>
                    <q-card-section class="description-section q-pa-none">
                        <p class="description">{{ card.description }}</p>
                    </q-card-section>
                </q-card-section>
            </q-card-section>
        </q-card>
    </div>
</div>
    


</template>

<style scoped>
    .card {
        background-color: rgba(255, 255, 255, 0);
    }
    /* .icon-section {

    } */
    .icons{
    text-align: center;
    padding: 10px;
    height: 150px;
    width: 150px;
    border-radius: 20px;
    }
    /* .title-section {

    } */
    .title {
    font-size: 18px;
    margin: 0;
    font-weight: 600;
    }
    .description-section {
    display: flex;
    align-items: center;
    }
    .description {
    font-weight: 200;
    margin: 0;
    padding: 0
    }

</style>