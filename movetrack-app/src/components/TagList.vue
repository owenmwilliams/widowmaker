<script setup lang="ts">
import { Ref, ref } from 'vue';

const { tagsArray } = defineProps(['tagsArray']);
const emit = defineEmits();

const tags: Ref<Array<string>> = ref(Array.from(tagsArray as string));
const newTag = ref('')
const addingTag = ref(false)

const removeTag = (tagToRemove: string) => {
  // addingTag.value = false
  const index = tags.value.indexOf(tagToRemove);
  if (index !== -1) {
    tags.value.splice(index, 1);
    emit('tag-changed', tags.value);
  }
};

const handleSwipe = ({ evt, ...newInfo }) => {
  console.log(evt.target.firstChild.data)
  const index = tags.value.indexOf(evt.target.firstChild.data);
  if (index !== -1) {
    tags.value.splice(index, 1);
    emit('tag-removed', tags.value);
  }
  emit('tag-swiped', evt.target.firstChild.data)
}

const addTag = () => {
  if (newTag.value != '') {
    console.log('add tag function')
    tags.value.push(newTag.value)
    emit('tag-changed', tags.value)
    newTag.value = ''
    addingTag.value = false
  } else {
    addingTag.value = false
  }
}

const addToggle = () => {
  addingTag.value = !addingTag.value
}

</script>

<template>
  <div class="tag-list">
    <q-chip
      size="md"
      icon="add"
      color="info"
      outlined
      clickable
      class="centered-tag"
      @click="addToggle()"
    >
      Add Tag
    </q-chip>
    <q-chip
      v-for="tag in tags"
      :key="tag"
      icon="close"
      size="md"
      color="warning"
      dark
      outlined
      clickable
      class="centered-tag"
      v-touch-swipe.mouse="handleSwipe"
      @click="removeTag(tag)"
    >
      {{ tag }}
    </q-chip>

    

    <q-dialog v-model="addingTag">
      <!-- Have to use VANT here because of this issue:  -->
      <!-- https://github.com/quasarframework/quasar/issues/13831 -->
      <van-field
        v-model="newTag"
        @keyup.enter="addTag()"
        type="textarea"
        input-align="center"
        autofocus
        rows="1"
        autosize
      />
        <!-- <q-input v-model="newTag" no-focus dense bg-color="white" filled @keyup.enter="addTag()" /> -->
    </q-dialog>
  </div>
</template>
  

  
<style scoped>
.tag-list {
  display: flex;
  justify-content: center; /* Center the tags horizontally */
  flex-wrap: wrap; /* Allow tags to wrap to the next line */
}

.centered-tag {
  margin: 0.2rem; /* Add some spacing between tags */
}</style>
  