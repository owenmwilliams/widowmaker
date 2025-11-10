import { ref, computed, onMounted, onUnmounted, type Ref } from 'vue';
import type { InventoryItem } from '../data/inventoryItems';

export interface CarouselState {
  currentIndex: Ref<number>;
  isPaused: Ref<boolean>;
  currentItem: Ref<InventoryItem | null>;
  progress: Ref<string>;
  goToNext: () => void;
  goToPrev: () => void;
  goToSlide: (index: number) => void;
  pause: () => void;
  resume: () => void;
  handleKeyboard: (event: KeyboardEvent) => void;
}

export function useCarouselState(
  items: InventoryItem[],
  autoplayInterval = 4000
): CarouselState {
  const currentIndex = ref(0);
  const isPaused = ref(false);
  let autoplayTimer: number | null = null;

  const currentItem = computed(() => {
    return items[currentIndex.value] || null;
  });

  const progress = computed(() => {
    return `${currentIndex.value + 1} of ${items.length}`;
  });

  const goToNext = () => {
    currentIndex.value = (currentIndex.value + 1) % items.length;
    resetAutoplay();
  };

  const goToPrev = () => {
    currentIndex.value =
      currentIndex.value === 0 ? items.length - 1 : currentIndex.value - 1;
    resetAutoplay();
  };

  const goToSlide = (index: number) => {
    if (index >= 0 && index < items.length) {
      currentIndex.value = index;
      resetAutoplay();
    }
  };

  const pause = () => {
    isPaused.value = true;
    clearAutoplay();
  };

  const resume = () => {
    isPaused.value = false;
    startAutoplay();
  };

  const clearAutoplay = () => {
    if (autoplayTimer !== null) {
      clearInterval(autoplayTimer);
      autoplayTimer = null;
    }
  };

  const startAutoplay = () => {
    if (!isPaused.value && items.length > 1) {
      clearAutoplay();
      autoplayTimer = window.setInterval(() => {
        goToNext();
      }, autoplayInterval);
    }
  };

  const resetAutoplay = () => {
    clearAutoplay();
    startAutoplay();
  };

  const handleKeyboard = (event: KeyboardEvent) => {
    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault();
        goToPrev();
        break;
      case 'ArrowRight':
        event.preventDefault();
        goToNext();
        break;
      case 'Home':
        event.preventDefault();
        goToSlide(0);
        break;
      case 'End':
        event.preventDefault();
        goToSlide(items.length - 1);
        break;
    }
  };

  onMounted(() => {
    startAutoplay();
  });

  onUnmounted(() => {
    clearAutoplay();
  });

  return {
    currentIndex,
    isPaused,
    currentItem,
    progress,
    goToNext,
    goToPrev,
    goToSlide,
    pause,
    resume,
    handleKeyboard
  };
}
