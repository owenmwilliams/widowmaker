<script setup lang="ts">
    import { computed, ref } from 'vue';

    const props = defineProps<{
        highlights: Array<any>,
        picture_size: number
    }>()

    const count_items = computed(() => { 
            if (props.highlights.length <= 5) {
                return props.highlights.length
            } else if (props.highlights.length % 5 == 0) {
                return 5
            } else if (props.highlights.length % 4 == 0) {
                return 4
            } else {
                return 3
            };
        })
</script>

<template>
    <div class="fit row wrap justify-center items-center content-center">
        <div v-for="highlight in highlights" class="col-grow">
            <div class="highlight">
                <q-img
                    :src="highlight.image_url"
                    spinner-color="white"
                    class="image-circle"
                />
                <h4>{{ highlight.title }}</h4>
                <p>{{ highlight.description }}</p>
            </div>
        </div>
    </div>
</template>

<style scoped>
    .highlight {
        text-align: center;
        padding: 10px;
        width: calc(100vw / v-bind('count_items'));
        /* height: 100px; */
    }
    .highlight h4 {
        margin: 10px;
    }
    .highlight p {
        font-weight: 200;
        width: 75%;
        position: relative;
        left: 12.5%;
    }
    .image-circle {
        
        height: calc(100vh * (v-bind('picture_size')/100));
        width: calc(100vh * (v-bind('picture_size')/100));
        overflow: hidden;
        border-radius: 100%;
    }
</style>