import { defineStore } from 'pinia';
import { ref } from 'vue';
import { Detector, createDetector, DetectorType } from './detectors';

export const useDetectorStore = defineStore('detector', () => {
  const detector = ref<Detector | null>(null);
  const detectorType = ref<DetectorType>('yolo-world-v2');
  const detectorLoaded = ref(false);
  const modelUrl = ref<string | undefined>(undefined);

  async function loadDetector(type: DetectorType, customUrl?: string) {
    // Clean up old detector
    if (detector.value) {
      try {
        // @ts-ignore
        detector.value.dispose?.();
      } catch (e) {
        console.warn('Error disposing detector:', e);
      }
      detector.value = null;
    }

    detectorType.value = type;
    modelUrl.value = customUrl;
    detectorLoaded.value = false;

    const newDetector = createDetector(type, customUrl);
    await newDetector.load();

    detector.value = newDetector;
    detectorLoaded.value = true;
  }

  function clearDetector() {
    if (detector.value) {
      try {
        // @ts-ignore
        detector.value.dispose?.();
      } catch (e) {
        console.warn('Error disposing detector:', e);
      }
      detector.value = null;
    }
    detectorLoaded.value = false;
  }

  return {
    detector,
    detectorType,
    detectorLoaded,
    modelUrl,
    loadDetector,
    clearDetector
  };
});
