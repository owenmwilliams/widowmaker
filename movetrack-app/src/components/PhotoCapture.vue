<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useQuasar } from "quasar";
import axios from "axios";
import type { InventoryItem } from "../data/inventoryItems";
import { inventoryStore } from "../stores/InventoryStore";

const $q = useQuasar();
const store = inventoryStore();

// To adjust url based on whether in prod or not
const core_url =
  import.meta.env.MODE == "development"
    ? "http://localhost:3050"
    : "https://movetrack-api-7hwn7ggbiq-uc.a.run.app";

const emit = defineEmits<{
  (e: "item-added", item: InventoryItem): void;
  (e: "close"): void;
}>();

// Vision provider (passed from parent or defaults to current backend setting)
const props = defineProps<{
  visionProvider?: string;
  user?: string;
  autoOpen?: boolean;
  defaultCaptureMode?: "single" | "multi";
}>();

// Camera/Photo state
const showCamera = ref(false);
const capturedImage = ref<string | null>(null);
const isProcessing = ref(false);

const multiScanLimit = ref<number | null>(null);
const multiScanRemaining = ref<number | null>(null);
const multiScanNextReset = ref<string | null>(null);
const multiPlanType = ref<"basic" | "pro">("basic");

// Capture mode: 'single' or 'multi'
const captureMode = ref<"single" | "multi">("single");
const showModeSelection = ref(true);

const applyDefaultCaptureMode = (mode?: "single" | "multi") => {
  if (mode) {
    captureMode.value = mode;
    showModeSelection.value = false;
  } else {
    captureMode.value = "single";
    showModeSelection.value = true;
  }
};

watch(
  () => props.defaultCaptureMode,
  (mode) => {
    applyDefaultCaptureMode(mode);
  },
  { immediate: true },
);

// Multi-item state
interface DetectedItem {
  id: number;
  name: string;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  confidence: number;
}

const detectedItems = ref<DetectedItem[]>([]);
const selectedItemIndex = ref<number | null>(null);
const imageNaturalDimensions = ref({ width: 0, height: 0 });
const processingMultiItemIds = ref<Set<number>>(new Set());
const nameEditIndex = ref<number | null>(null);
const editedName = ref("");
const isNameDialogOpen = computed({
  get() {
    return nameEditIndex.value !== null;
  },
  set(value: boolean) {
    if (!value) {
      nameEditIndex.value = null;
    }
  },
});

// Loading overlay state
const loadingMessage = ref("");
const loadingMessageInterval = ref<number | null>(null);

// Fun loading messages
const loadingMessages = [
  "Analyzing your treasure...",
  "Counting pixels...",
  "Consulting the AI oracle...",
  "Identifying mysterious objects...",
  "Channeling digital intuition...",
  "Teaching robots to see...",
  "Decoding visual mysteries...",
  "Summoning computer vision...",
  "Reading the item tea leaves...",
  "Activating neural networks...",
  "Examining every detail...",
  "Making educated guesses...",
  "Putting on AI glasses...",
  "Detecting object essence...",
  "Unleashing image recognition...",
];

// Item editing state
const newItem = ref<Partial<InventoryItem>>({
  name: "",
  qty: 1,
  size: "",
  weight: "",
  material: "",
  primaryColor: "",
  description: "",
  tags: [],
});

const editDimensions = ref({ length: 0, width: 0, height: 0 });
const editWeight = ref(0);
const editFragile = ref(false);
const duplicateThreshold = 0.4;
const activeCollectionId = computed<string | null>(() => {
  const refValue = store.activeCollection?.value;
  if (!refValue) return null;
  return typeof refValue === "string" ? refValue : String(refValue);
});

// Collection selector state
const selectedCollectionId = ref<string | null>(null);
const showNewCollectionDialog = ref(false);
const newCollectionName = ref("");
const newCollectionLocation = ref<string | null>(null);

// Initialize selectedCollectionId with activeCollectionId
watch(activeCollectionId, (newValue) => {
  if (newValue && !selectedCollectionId.value) {
    selectedCollectionId.value = newValue;
  }
}, { immediate: true });

// Create new collection
const createNewCollection = async () => {
  if (!newCollectionName.value.trim()) {
    $q.notify({
      type: "warning",
      message: "Please enter a collection name",
      position: "bottom",
    });
    return;
  }

  if (!newCollectionLocation.value) {
    $q.notify({
      type: "warning",
      message: "Please select a location",
      position: "bottom",
    });
    return;
  }

  try {
    $q.loading.show({
      message: "Creating collection...",
    });

    await store.createCollection(
      props.user,
      newCollectionName.value,
      newCollectionLocation.value,
      ""
    );

    await store.getCollections(props.user);

    // Find the newly created collection and select it
    const newCollection = store.collections.find(
      (c) => c.label === newCollectionName.value
    );
    if (newCollection) {
      selectedCollectionId.value = String(newCollection.value);
    }

    $q.notify({
      type: "positive",
      message: "Collection created successfully",
      position: "bottom",
    });

    showNewCollectionDialog.value = false;
    newCollectionName.value = "";
    newCollectionLocation.value = null;
  } catch (error) {
    console.error("Failed to create collection:", error);
    $q.notify({
      type: "negative",
      message: "Failed to create collection",
      position: "bottom",
    });
  } finally {
    $q.loading.hide();
  }
};

const analyzeItemBlob = async (blob: Blob) => {
  const sessionToken = localStorage.getItem("session_token");
  if (!sessionToken) {
    throw new Error("Please log in to analyze items");
  }

  const formData = new FormData();
  formData.append("image", blob, "item.jpg");
  const providerParam = props.visionProvider
    ? `?provider=${props.visionProvider}`
    : "";

  const response = await axios.post(
    `${core_url}/vision/analyze-item${providerParam}`,
    formData,
    {
      headers: {
        "Content-Type": "multipart/form-data",
        Authorization: `Bearer ${sessionToken}`,
      },
    },
  );

  if (response.data?.success) {
    return response.data.data;
  }

  throw new Error(response.data?.error || "Vision analysis failed");
};

const boundingBoxStyle = (box: DetectedItem["boundingBox"]) => {
  const padding = 0.02;
  const left = Math.max(box.x - padding, 0) * 100;
  const top = Math.max(box.y - padding, 0) * 100;
  const width = Math.min(box.width + padding * 2, 1 - box.x) * 100;
  const height = Math.min(box.height + padding * 2, 1 - box.y) * 100;
  return {
    left: `${left}%`,
    top: `${top}%`,
    width: `${width}%`,
    height: `${height}%`,
  };
};

const tokenize = (value?: string | null) => {
  if (!value) return [];
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
};

const similarityScore = (aTokens: string[], bTokens: string[]) => {
  if (!aTokens.length || !bTokens.length) return 0;
  const setA = new Set(aTokens);
  const setB = new Set(bTokens);
  const intersection = [...setA].filter((token) => setB.has(token));
  return intersection.length / Math.min(setA.size, setB.size);
};

const potentialMatches = computed(() => {
  const targetTokens = tokenize(newItem.value.name);
  if (!targetTokens.length) return [];

  return store.items
    .map((item) => {
      const tokens = tokenize(item.label);
      const score = similarityScore(targetTokens, tokens);
      const isExact =
        newItem.value?.name?.trim().toLowerCase() ===
        item.label?.trim().toLowerCase();
      const sameCollection =
        !!activeCollectionId.value &&
        item.collection === activeCollectionId.value;
      return {
        id: item.value,
        name: item.label,
        collection:
          store.collections.find((c) => c.value === item.collection)?.label ||
          "Unassigned",
        container:
          store.containers.find((c) => c.value === item.container)?.label ||
          "No container",
        score: isExact ? 1 : score,
        sameCollection,
      };
    })
    .filter(
      (match) => match.score >= duplicateThreshold || match.sameCollection,
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
});

const handleUseExistingItem = (itemId: number) => {
  if (!props.user) {
    $q.notify({
      type: "warning",
      message: "Please log in again to edit existing items.",
    });
    return;
  }
  store.openItemDetailsModal(itemId, props.user);
  emit("close");
  $q.notify({
    type: "info",
    message: "Opening existing item for review",
    position: "bottom",
  });
};

// File input ref
const fileInput = ref<HTMLInputElement | null>(null);

const isMobile = computed(() => {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent,
  );
});

const multiScanDisplay = computed(() => {
  if (multiScanLimit.value == null) return null;
  const remaining = Math.max(
    multiScanRemaining.value ?? multiScanLimit.value,
    0,
  );
  return `${remaining}/${multiScanLimit.value}`;
});

const hasMultiQuota = computed(() => multiScanLimit.value !== null);
const multiScanLabel = computed(() => {
  const display = multiScanDisplay.value;
  return display ? `Multiple Items (${display})` : "Multiple Items";
});

const fetchMultiQuota = async () => {
  const sessionToken = localStorage.getItem("session_token");
  if (!sessionToken) return;
  try {
    const response = await axios.get(`${core_url}/vision/multi-quota`, {
      headers: {
        Authorization: `Bearer ${sessionToken}`,
      },
    });
    multiPlanType.value = response.data.plan || "basic";
    if (response.data.limit != null) {
      multiScanLimit.value = response.data.limit;
      multiScanRemaining.value =
        typeof response.data.remaining === "number"
          ? Math.max(response.data.remaining, 0)
          : response.data.limit;
      multiScanNextReset.value = response.data.nextReset || null;
    } else {
      multiScanLimit.value = null;
      multiScanRemaining.value = null;
      multiScanNextReset.value = null;
    }
  } catch (error) {
    console.error("Error fetching multi quota:", error);
  }
};

// Start loading message rotation
const startLoadingMessages = () => {
  // Set initial message
  loadingMessage.value =
    loadingMessages[Math.floor(Math.random() * loadingMessages.length)];

  // Rotate messages every 2.5 seconds
  loadingMessageInterval.value = window.setInterval(() => {
    loadingMessage.value =
      loadingMessages[Math.floor(Math.random() * loadingMessages.length)];
  }, 2500);
};

// Stop loading message rotation
const stopLoadingMessages = () => {
  if (loadingMessageInterval.value) {
    clearInterval(loadingMessageInterval.value);
    loadingMessageInterval.value = null;
  }
  loadingMessage.value = "";
};

// Crop image based on bounding box
const cropImageFromBoundingBox = async (
  imageDataUrl: string,
  boundingBox: { x: number; y: number; width: number; height: number },
  naturalDimensions: { width: number; height: number },
  paddingPercent = 0.1,
): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      // Create canvas for cropping
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");

      if (!ctx) {
        reject(new Error("Failed to get canvas context"));
        return;
      }

      // Calculate actual pixel coordinates from normalized values
      const padX = boundingBox.width * naturalDimensions.width * paddingPercent;
      const padY =
        boundingBox.height * naturalDimensions.height * paddingPercent;
      const cropX = Math.max(boundingBox.x * naturalDimensions.width - padX, 0);
      const cropY = Math.max(
        boundingBox.y * naturalDimensions.height - padY,
        0,
      );
      const cropWidth = Math.min(
        boundingBox.width * naturalDimensions.width + padX * 2,
        naturalDimensions.width - cropX,
      );
      const cropHeight = Math.min(
        boundingBox.height * naturalDimensions.height + padY * 2,
        naturalDimensions.height - cropY,
      );

      // Set canvas size to crop dimensions
      canvas.width = cropWidth;
      canvas.height = cropHeight;

      // Draw the cropped portion
      ctx.drawImage(
        img,
        cropX,
        cropY,
        cropWidth,
        cropHeight, // Source rectangle
        0,
        0,
        cropWidth,
        cropHeight, // Destination rectangle
      );

      // Convert canvas to blob
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error("Failed to create blob from canvas"));
          }
        },
        "image/jpeg",
        0.9,
      );
    };

    img.onerror = () => {
      reject(new Error("Failed to load image"));
    };

    img.src = imageDataUrl;
  });
};

// Open camera or file picker
const openCamera = () => {
  showModeSelection.value = false;
  if (fileInput.value) {
    fileInput.value.click();
  }
};

// Select capture mode
const selectMode = (mode: "single" | "multi") => {
  captureMode.value = mode;
  openCamera();
};

// Handle photo capture
const handlePhotoCapture = async (event: Event) => {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];

  if (!file) return;

  isProcessing.value = true;

  // Create image preview
  const reader = new FileReader();
  reader.onload = (e) => {
    capturedImage.value = e.target?.result as string;

    // For multi-item mode, also get image dimensions
    if (captureMode.value === "multi") {
      const img = new Image();
      img.onload = () => {
        imageNaturalDimensions.value = {
          width: img.naturalWidth,
          height: img.naturalHeight,
        };
      };
      img.src = e.target?.result as string;
    }
  };
  reader.readAsDataURL(file);

  // Branch based on capture mode
  if (captureMode.value === "single") {
    await handleSingleItemCapture(file);
  } else {
    await handleMultiItemCapture(file);
  }
};

// Handle single-item capture (original behavior)
const handleSingleItemCapture = async (file: File) => {
  // Start rotating loading messages
  startLoadingMessages();

  try {
    // Get session token for authentication
    const sessionToken = localStorage.getItem("session_token");

    if (!sessionToken) {
      throw new Error("Please log in to use AI-powered photo analysis");
    }

    // Call vision API
    const formData = new FormData();
    formData.append("image", file);

    const providerParam = props.visionProvider
      ? `?provider=${props.visionProvider}`
      : "";
    const response = await axios.post(
      `${core_url}/vision/analyze-item${providerParam}`,
      formData,
      {
        headers: {
          "Content-Type": "multipart/form-data",
          Authorization: `Bearer ${sessionToken}`,
        },
      },
    );

    if (response.data.success) {
      const aiData = response.data.data;

      // Safely extract dimensions with fallback values
      const dimensions = aiData.estimatedDimensions || {
        length: 6,
        width: 4,
        height: 4,
      };
      const weight = aiData.estimatedWeight || 1.0;

      // Map AI response to item format
      newItem.value = {
        name: aiData.name || detectItemName(file.name),
        qty: 1,
        size: `${dimensions.length}"×${dimensions.width}"×${dimensions.height}"`,
        weight: `${weight} lbs`,
        material: aiData.material || "",
        primaryColor: aiData.color || "",
        description: aiData.reasoning || "Item detected from photo",
        tags: Array.isArray(aiData.tags) ? aiData.tags : [],
        image: capturedImage.value || "",
      };

      editDimensions.value = {
        length: dimensions.length || 0,
        width: dimensions.width || 0,
        height: dimensions.height || 0,
      };
      editWeight.value = weight;
      editFragile.value = aiData.fragile || false;

      const providerName = response.data.provider || "AI";
      const confidencePercent = aiData.confidence
        ? Math.round(aiData.confidence * 100)
        : 80;

      $q.notify({
        type: "positive",
        message: `Item detected! (${providerName}, ${confidencePercent}% confidence)`,
        caption: "Review and confirm details below",
        position: "bottom",
        timeout: 3000,
      });
    } else {
      throw new Error(response.data.error || "Failed to analyze image");
    }
  } catch (error: any) {
    console.error("Vision API error:", error);

    // Fallback to basic detection
    newItem.value = {
      name: detectItemName(file.name),
      qty: 1,
      size: '6"×4"×4"',
      weight: "1.0 lbs",
      material: "",
      primaryColor: "",
      description: "Please update item details manually",
      tags: [],
      image: capturedImage.value || "",
    };

    editDimensions.value = { length: 6, width: 4, height: 4 };
    editWeight.value = 1.0;
    editFragile.value = false;

    $q.notify({
      type: "warning",
      message: "Could not analyze image automatically",
      caption:
        error.response?.data?.error ||
        error.message ||
        "Please enter details manually",
      position: "bottom",
      timeout: 3000,
    });
  } finally {
    isProcessing.value = false;
    showCamera.value = false;
    stopLoadingMessages();
  }
};

// Handle multi-item capture (new feature)
const handleMultiItemCapture = async (file: File) => {
  // Start rotating loading messages
  startLoadingMessages();

  try {
    // Get session token for authentication
    const sessionToken = localStorage.getItem("session_token");

    if (!sessionToken) {
      throw new Error("Please log in to use AI-powered photo analysis");
    }

    // Call multi-item vision API
    const formData = new FormData();
    formData.append("image", file);

    const providerParam = props.visionProvider
      ? `?provider=${props.visionProvider}`
      : "";
    const response = await axios.post(
      `${core_url}/vision/analyze-multi-item${providerParam}`,
      formData,
      {
        headers: {
          "Content-Type": "multipart/form-data",
          Authorization: `Bearer ${sessionToken}`,
        },
      },
    );

    if (response.data.success) {
      const aiData = response.data.data;

      // Store detected items
      detectedItems.value = aiData.items || [];

      const providerName = response.data.provider || "AI";
      const itemCount = aiData.itemCount || detectedItems.value.length;

      if (response.data.demoInfo) {
        const info = response.data.demoInfo;
        if (typeof info.limit === "number") {
          multiScanLimit.value = info.limit;
        }
        if (typeof info.remaining === "number") {
          multiScanRemaining.value = Math.max(info.remaining, 0);
        }
        if (info.nextReset) {
          multiScanNextReset.value = info.nextReset;
        }
        multiPlanType.value = "basic";
      }

      $q.notify({
        type: "positive",
        message: `${itemCount} items detected! (${providerName})`,
        caption: "Click on an item to add it to inventory",
        position: "bottom",
        timeout: 3000,
      });
    } else {
      throw new Error(response.data.error || "Failed to analyze image");
    }
  } catch (error: any) {
    console.error("Multi-item Vision API error:", error);

    if (
      error.response?.status === 402 &&
      error.response?.data?.demoLimitReached
    ) {
      multiScanLimit.value = error.response.data.limit ?? multiScanLimit.value;
      multiScanRemaining.value = 0;
      multiScanNextReset.value =
        error.response.data.nextReset || multiScanNextReset.value;
      $q.notify({
        type: "warning",
        message: "Weekly multi-item scan limit reached",
        caption: "Upgrade to Pro for unlimited scans",
        position: "bottom",
        timeout: 4000,
      });
    } else {
      $q.notify({
        type: "warning",
        message: "Could not detect multiple items",
        caption:
          error.response?.data?.error ||
          error.message ||
          "Try single-item mode instead",
        position: "bottom",
        timeout: 3000,
      });
    }

    // Reset to mode selection
    resetForm();
    showModeSelection.value = true;
  } finally {
    isProcessing.value = false;
    showCamera.value = false;
    stopLoadingMessages();
  }
};

// Simple name detection from filename
const detectItemName = (filename: string): string => {
  return filename
    .replace(/\.[^/.]+$/, "") // Remove extension
    .replace(/[_-]/g, " ") // Replace underscores/hyphens with spaces
    .replace(/\b\w/g, (l) => l.toUpperCase()); // Capitalize
};

// Save item
const saveItem = async () => {
  if (!newItem.value.name) {
    $q.notify({
      type: "warning",
      message: "Please enter an item name",
      position: "bottom",
    });
    return;
  }

  // Check if we have a selected collection (required for items)
  if (!selectedCollectionId.value) {
    $q.notify({
      type: "warning",
      message: "Please select a collection first",
      caption: "Items must be added to a collection",
      position: "bottom",
    });
    return;
  }

  // Check if user is provided
  if (!props.user) {
    $q.notify({
      type: "negative",
      message: "User not found. Please log in again.",
      position: "bottom",
    });
    return;
  }

  try {
    // Show loading
    $q.loading.show({
      message: "Saving item to inventory...",
    });

    // Convert base64 image to blob if available
    let imageBlob: Blob | undefined;
    if (capturedImage.value) {
      const response = await fetch(capturedImage.value);
      imageBlob = await response.blob();
    }

    // Call the inventory store's createItem function
    await store.createItem(
      props.user,
      newItem.value.name,
      newItem.value.description || "",
      newItem.value.qty || 1,
      selectedCollectionId.value,
      store.activeContainer?.value,
      imageBlob,
      null, // estimatedValue
      editFragile.value,
      undefined, // priority
      editWeight.value,
      editDimensions.value.length || null,
      editDimensions.value.width || null,
      editDimensions.value.height || null,
      `Material: ${newItem.value.material || "N/A"}, Color: ${newItem.value.primaryColor || "N/A"}`,
      newItem.value.material || undefined,
      newItem.value.primaryColor || undefined,
      newItem.value.tags || [],
    );

    // Reload inventory to show new item
    await store.loadInventory(props.user);

    $q.notify({
      type: "positive",
      message: `${newItem.value.name} added to inventory!`,
      position: "bottom",
      timeout: 2000,
    });

    resetForm();
    emit("close");
  } catch (error: any) {
    console.error("Error saving item:", error);

    // Check if it's a 401 authentication error
    if (error.response?.status === 401) {
      $q.notify({
        type: "negative",
        message: "Session Expired",
        caption: "Please log out and log back in to continue",
        position: "bottom",
        timeout: 5000,
        actions: [{ label: "Dismiss", color: "white" }],
      });
    } else {
      $q.notify({
        type: "negative",
        message: "Failed to save item",
        caption: error.message || "Please try again",
        position: "bottom",
      });
    }
  } finally {
    $q.loading.hide();
  }
};

// Quick confirm (uses AI-detected values as-is)
const quickConfirm = () => {
  saveItem();
};

// Handle adding a multi-item detection result
const setProcessingMultiItem = (id: number, processing: boolean) => {
  const next = new Set(processingMultiItemIds.value);
  if (processing) {
    next.add(id);
  } else {
    next.delete(id);
  }
  processingMultiItemIds.value = next;
};

const isProcessingMultiItem = (id: number) =>
  processingMultiItemIds.value.has(id);

const openNameEditDialog = (index: number) => {
  nameEditIndex.value = index;
  editedName.value = detectedItems.value[index]?.name || "";
};

const saveEditedName = () => {
  if (nameEditIndex.value === null) return;
  const target = detectedItems.value[nameEditIndex.value];
  if (target && editedName.value.trim()) {
    target.name = editedName.value.trim();
  }
  nameEditIndex.value = null;
};

const cancelEditedName = () => {
  nameEditIndex.value = null;
};

const handleMultiItemAdd = async (item: DetectedItem, index: number) => {
  // Safety check for item
  if (!item || !item.id) {
    console.error("Invalid item provided to handleMultiItemAdd:", item);
    return;
  }

  // Check if we have a selected collection (required for items)
  if (!selectedCollectionId.value) {
    $q.notify({
      type: "warning",
      message: "Please select a collection first",
      caption: "Items must be added to a collection",
      position: "bottom",
    });
    return;
  }

  // Check if user is provided
  if (!props.user) {
    $q.notify({
      type: "negative",
      message: "User not found. Please log in again.",
      position: "bottom",
    });
    return;
  }

  if (processingMultiItemIds.value.has(item.id)) {
    return;
  }

  try {
    setProcessingMultiItem(item.id, true);
    $q.notify({
      type: "info",
      message: `Adding ${item.name} in the background...`,
      position: "bottom",
      timeout: 1500,
    });

    // Crop the image based on bounding box
    let imageBlob: Blob | undefined;
    if (capturedImage.value) {
      try {
        imageBlob = await cropImageFromBoundingBox(
          capturedImage.value,
          item.boundingBox,
          imageNaturalDimensions.value,
          0.15,
        );
      } catch (error) {
        console.error("Failed to crop image, using full image instead:", error);
        // Fallback to full image if cropping fails
        const response = await fetch(capturedImage.value);
        imageBlob = await response.blob();
      }
    }

    let aiDetails: any = null;
    if (imageBlob) {
      try {
        aiDetails = await analyzeItemBlob(imageBlob);
      } catch (analysisError) {
        console.warn(
          "Unable to fetch AI details for multi-item capture",
          analysisError,
        );
      }
    }

    const dimensions = aiDetails?.estimatedDimensions;
    const weightEstimate = aiDetails?.estimatedWeight;
    const description =
      aiDetails?.reasoning || "Detected from multi-item photo";
    const tags = Array.isArray(aiDetails?.tags) ? aiDetails.tags : [];
    const material = aiDetails?.material ?? "";
    const color = aiDetails?.color ?? "";

    const dimensionString = dimensions
      ? `${dimensions.length}"×${dimensions.width}"×${dimensions.height}"`
      : "";

    const lengthIn = dimensions?.length ?? null;
    const widthIn = dimensions?.width ?? null;
    const heightIn = dimensions?.height ?? null;

    // Call the inventory store's createItem function with minimal details
    const notes = [
      description,
      dimensionString ? `Dimensions: ${dimensionString}` : null,
      material ? `Material: ${material}` : null,
      color ? `Color: ${color}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    await store.createItem(
      props.user,
      item.name,
      description,
      1,
      selectedCollectionId.value,
      store.activeContainer?.value,
      imageBlob,
      null,
      aiDetails?.fragile ?? false,
      undefined,
      weightEstimate ?? null,
      lengthIn,
      widthIn,
      heightIn,
      notes || undefined,
      material || undefined,
      color || undefined,
      tags,
    );

    $q.notify({
      type: "positive",
      message: aiDetails
        ? `${item.name} added with AI details!`
        : `${item.name} added!`,
      position: "bottom",
      timeout: 2000,
    });

    // Remove the item from the detected items list
    detectedItems.value.splice(index, 1);

    // If no more items, close and reset
    if (detectedItems.value.length === 0) {
      $q.notify({
        type: "info",
        message: "All items added!",
        position: "bottom",
        timeout: 2000,
      });
      resetForm();
      emit("close");
    }
  } catch (error: any) {
    console.error("Error adding multi-item:", error);

    $q.notify({
      type: "negative",
      message: "Failed to add item",
      caption: error.message || "Please try again",
      position: "bottom",
    });
  } finally {
    setProcessingMultiItem(item.id, false);
  }
};

// Reset form
const resetForm = () => {
  capturedImage.value = null;
  detectedItems.value = [];
  selectedItemIndex.value = null;
  newItem.value = {
    name: "",
    qty: 1,
    size: "",
    weight: "",
    material: "",
    primaryColor: "",
    description: "",
    tags: [],
  };
  editDimensions.value = { length: 0, width: 0, height: 0 };
  editWeight.value = 0;
  editFragile.value = false;
};

// Cancel and close
const cancel = () => {
  resetForm();
  emit("close");
};

// Auto-open camera if prop is set
onMounted(() => {
  if (props.autoOpen) {
    openCamera();
  }
  fetchMultiQuota();
});
</script>

<template>
  <div class="photo-capture-container">
    <!-- Hidden file input -->
    <input
      ref="fileInput"
      type="file"
      accept="image/*"
      capture="environment"
      style="display: none"
      @change="handlePhotoCapture"
    />

    <!-- Full-screen loading overlay with image and rotating messages -->
    <div v-if="isProcessing && capturedImage" class="loading-overlay">
      <img
        :src="capturedImage || undefined"
        alt="Processing"
        class="loading-overlay-image"
      />
      <div class="loading-overlay-content">
        <q-spinner-dots color="white" size="60px" />
        <div class="loading-message">{{ loadingMessage }}</div>
      </div>
    </div>

    <!-- No photo captured - show mode selection or camera button -->
    <div v-if="!capturedImage && !detectedItems.length" class="camera-prompt">
      <!-- Mode selection -->
      <div v-if="showModeSelection">
        <q-icon
          name="photo_camera"
          size="80px"
          color="primary"
          class="camera-icon"
        />
        <h3 class="prompt-title">Photograph Items</h3>
        <p class="prompt-text">
          Choose how many items to detect in your photo:
        </p>

        <div class="mode-selection">
          <q-btn
            unelevated
            color="primary"
            size="lg"
            icon="filter_1"
            label="Single Item"
            class="mode-btn"
            @click="selectMode('single')"
          />

          <q-btn
            unelevated
            color="secondary"
            size="lg"
            icon="filter_9_plus"
            :label="multiScanLabel"
            class="mode-btn q-mt-sm"
            @click="selectMode('multi')"
          />
          <div v-if="hasMultiQuota" class="multi-quota-note">
            {{ multiScanDisplay }} scans remaining · resets weekly. Upgrade to
            Pro for unlimited scans.
          </div>
        </div>

        <q-btn
          flat
          color="grey-7"
          label="Cancel"
          class="q-mt-md"
          @click="cancel"
        />
      </div>

      <!-- Direct camera button (when mode already selected) -->
      <div v-else>
        <q-icon
          name="photo_camera"
          size="80px"
          color="primary"
          class="camera-icon"
        />
        <h3 class="prompt-title">Photograph an Item</h3>
        <p class="prompt-text">
          Tap below to take a photo. Our AI will automatically detect item
          details.
        </p>

        <q-btn
          unelevated
          color="primary"
          size="lg"
          icon="photo_camera"
          label="Take Photo"
          class="camera-btn"
          :loading="isProcessing"
          @click="openCamera"
        />

        <q-btn
          flat
          color="grey-7"
          label="Cancel"
          class="q-mt-md"
          @click="cancel"
        />
      </div>
    </div>

    <!-- Multi-item detection results - show bounding boxes -->
    <div v-else-if="detectedItems.length > 0" class="multi-item-container">
      <div class="image-preview">
        <img
          :src="capturedImage || undefined"
          ref="multiItemImage"
          alt="Captured items"
          class="preview-img"
        />
        <q-btn
          round
          flat
          icon="close"
          color="white"
          class="retake-btn"
          @click="resetForm"
        />

        <!-- Bounding boxes -->
        <div
          v-for="(item, index) in detectedItems"
          :key="item.id"
          class="bounding-box"
          :class="{ selected: selectedItemIndex === index }"
          :style="boundingBoxStyle(item.boundingBox)"
          @click="selectedItemIndex = index"
        >
          <div class="item-label">{{ item.name }}</div>
        </div>
      </div>

      <div class="multi-item-info">
        <h4 class="form-title">{{ detectedItems.length }} Items Detected</h4>
        <p class="info-text">Tap an item below to add it to your inventory.</p>

        <q-list bordered separator class="detected-items-list">
          <q-item
            v-for="(item, index) in detectedItems"
            :key="item.id"
            clickable
            :disable="isProcessingMultiItem(item.id)"
            :active="selectedItemIndex === index"
          >
            <q-item-section>
              <q-item-label clickable @click.stop="openNameEditDialog(index)">
                {{ item.name }}
              </q-item-label>
            </q-item-section>
            <q-item-section side>
              <q-spinner
                v-if="isProcessingMultiItem(item.id)"
                size="20px"
                color="primary"
              />
              <q-btn
                v-else
                round
                dense
                color="primary"
                icon="add_circle"
                @click.stop="handleMultiItemAdd(item, index)"
              >
                <q-tooltip>Add this item</q-tooltip>
              </q-btn>
            </q-item-section>
          </q-item>
        </q-list>

        <q-btn
          flat
          color="grey-7"
          label="Start Over"
          class="q-mt-md"
          @click="
            resetForm();
            showModeSelection = true;
          "
        />
      </div>
    </div>

    <!-- Photo captured - show quick edit -->
    <div v-else class="photo-preview-container">
      <!-- Image preview -->
      <div class="image-preview">
        <img
          :src="capturedImage || undefined"
          alt="Captured item"
          class="preview-img"
        />
        <q-btn
          round
          flat
          icon="close"
          color="white"
          class="retake-btn"
          @click="resetForm"
        />
      </div>

      <!-- Quick edit form -->
      <div class="quick-edit-form">
        <h4 class="form-title">Review Item Details</h4>

        <q-input
          v-model="newItem.name"
          label="Item Name *"
          outlined
          dense
          class="form-field"
        />

        <!-- Collection selector -->
        <div class="collection-selector">
          <q-select
            v-model="selectedCollectionId"
            :options="store.collections"
            label="Collection *"
            outlined
            dense
            emit-value
            map-options
            option-value="value"
            option-label="label"
            class="form-field"
          >
            <template v-slot:append>
              <q-btn
                flat
                dense
                round
                icon="add"
                size="sm"
                color="primary"
                @click.stop="showNewCollectionDialog = true"
              >
                <q-tooltip>Create new collection</q-tooltip>
              </q-btn>
            </template>
          </q-select>
        </div>

        <div class="dimensions-row">
          <q-input
            v-model.number="editDimensions.length"
            label="L (in)"
            type="number"
            outlined
            dense
            class="dimension-input"
          />
          <q-input
            v-model.number="editDimensions.width"
            label="W (in)"
            type="number"
            outlined
            dense
            class="dimension-input"
          />
          <q-input
            v-model.number="editDimensions.height"
            label="H (in)"
            type="number"
            outlined
            dense
            class="dimension-input"
          />
        </div>

        <q-input
          v-model.number="editWeight"
          label="Weight"
          type="number"
          suffix="lbs"
          outlined
          dense
          class="form-field"
        />

        <div class="expandable-fields">
          <q-expansion-item
            label="More Details (Optional)"
            icon="tune"
            dense
            header-class="text-grey-7"
          >
            <div class="q-pa-md">
              <q-input
                v-model="newItem.material"
                label="Material"
                outlined
                dense
                class="form-field"
              />

              <q-input
                v-model="newItem.primaryColor"
                label="Color"
                outlined
                dense
                class="form-field"
              />

              <q-input
                v-model.number="newItem.qty"
                label="Quantity"
                type="number"
                outlined
                dense
                class="form-field"
              />

              <q-toggle
                v-model="editFragile"
                label="Fragile"
                color="orange"
                class="q-mt-sm"
              />

              <q-input
                v-model="newItem.description"
                label="Notes"
                type="textarea"
                outlined
                rows="2"
                dense
                class="form-field"
              />
            </div>
          </q-expansion-item>
        </div>

        <div v-if="potentialMatches.length" class="duplicate-alert">
          <q-banner dense rounded class="bg-warning text-dark duplicate-banner">
            Possible duplicate{{ potentialMatches.length > 1 ? "s" : "" }}
            detected. Review before saving to avoid double entries.
          </q-banner>
          <q-list dense class="duplicate-list">
            <q-item
              v-for="match in potentialMatches"
              :key="match.id"
              class="duplicate-item"
            >
              <q-item-section>
                <q-item-label class="text-weight-medium">{{
                  match.name
                }}</q-item-label>
                <q-item-label caption>
                  {{ match.collection }} • {{ match.container }}
                </q-item-label>
              </q-item-section>
              <q-item-section side class="duplicate-actions">
                <q-chip
                  dense
                  :color="match.score === 1 ? 'primary' : 'secondary'"
                  text-color="white"
                >
                  {{
                    match.score === 1
                      ? "Exact"
                      : `${Math.round(match.score * 100)}%`
                  }}
                </q-chip>
                <q-btn
                  dense
                  flat
                  color="primary"
                  icon="visibility"
                  label="Review"
                  @click="handleUseExistingItem(match.id)"
                />
              </q-item-section>
            </q-item>
          </q-list>
        </div>

        <!-- Action buttons -->
        <div class="action-buttons">
          <q-btn
            unelevated
            color="positive"
            icon="check"
            label="Save to Inventory"
            class="confirm-btn"
            @click="saveItem"
          />
        </div>
      </div>
    </div>
  </div>
  <q-dialog v-model="isNameDialogOpen">
    <q-card>
      <q-card-section>
        <div class="text-h6">Edit Item Name</div>
      </q-card-section>
      <q-card-section>
        <q-input v-model="editedName" label="Item Name" autofocus />
      </q-card-section>
      <q-card-actions align="right">
        <q-btn flat label="Cancel" color="primary" @click="cancelEditedName" />
        <q-btn flat label="Save" color="primary" @click="saveEditedName" />
      </q-card-actions>
    </q-card>
  </q-dialog>

  <!-- New Collection Dialog -->
  <q-dialog v-model="showNewCollectionDialog">
    <q-card style="min-width: 350px">
      <q-card-section>
        <div class="text-h6">Create New Collection</div>
      </q-card-section>
      <q-card-section>
        <q-input
          v-model="newCollectionName"
          label="Collection Name *"
          outlined
          dense
          autofocus
          class="q-mb-md"
        />
        <q-select
          v-model="newCollectionLocation"
          :options="store.locations"
          label="Location *"
          outlined
          dense
          emit-value
          map-options
          option-value="value"
          option-label="label"
        />
      </q-card-section>
      <q-card-actions align="right">
        <q-btn
          flat
          label="Cancel"
          color="primary"
          @click="showNewCollectionDialog = false"
        />
        <q-btn
          flat
          label="Create"
          color="primary"
          @click="createNewCollection"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<style scoped>
.photo-capture-container {
  min-height: 60vh;
  display: flex;
  flex-direction: column;
  background: white;
}

/* Loading overlay */
.loading-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #000;
}

.loading-overlay-image {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  opacity: 0.4;
}

.loading-overlay-content {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 24px;
}

.loading-message {
  color: white;
  font-size: 1.25rem;
  font-weight: 500;
  text-align: center;
  padding: 16px 32px;
  background: rgba(0, 0, 0, 0.7);
  border-radius: 12px;
  min-width: 250px;
  animation: fadeIn 0.5s ease-in-out;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Camera prompt */
.camera-prompt {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 24px;
  text-align: center;
}

.camera-icon {
  margin-bottom: 16px;
  opacity: 0.7;
}

.prompt-title {
  font-size: 1.5rem;
  font-weight: 600;
  color: #212121;
  margin: 0 0 8px 0;
}

.prompt-text {
  font-size: 0.95rem;
  color: #616161;
  margin: 0 0 32px 0;
  max-width: 300px;
}

.camera-btn {
  min-width: 200px;
  padding: 16px 32px;
  font-size: 1.1rem;
}

/* Photo preview */
.photo-preview-container {
  display: flex;
  flex-direction: column;
  max-height: 90vh;
  overflow: hidden;
}

.image-preview {
  position: relative;
  width: 100%;
  max-height: 300px;
  background: #000;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.preview-img {
  max-width: 100%;
  max-height: 300px;
  width: auto;
  height: auto;
  object-fit: contain;
}

.retake-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  background: rgba(0, 0, 0, 0.5);
}

/* Quick edit form */
.quick-edit-form {
  flex: 1;
  padding: 20px;
  overflow-y: auto;
}

.form-title {
  font-size: 1.2rem;
  font-weight: 600;
  color: #212121;
  margin: 0 0 16px 0;
}

.form-field {
  margin-bottom: 12px;
}

.dimensions-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-bottom: 12px;
}

.dimension-input {
  margin-bottom: 0;
}

.expandable-fields {
  margin: 16px 0;
}

/* Action buttons */
.action-buttons {
  display: flex;
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid #e0e0e0;
}

.confirm-btn {
  width: 100%;
  padding: 14px;
  font-weight: 600;
  font-size: 1.05rem;
}

.duplicate-alert {
  margin-top: 24px;
  padding: 16px;
  border-radius: 12px;
  border: 1px solid #f4e0a1;
  background: #fff9e6;
}

.duplicate-banner {
  margin-bottom: 12px;
}

.duplicate-list {
  border-radius: 10px;
  background: white;
  border: 1px solid #f0f0f0;
}

.duplicate-item + .duplicate-item {
  border-top: 1px solid #f5f5f5;
}

.duplicate-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* Mode selection */
.mode-selection {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 300px;
  margin: 0 auto 24px;
}

.mode-btn {
  min-width: 250px;
  padding: 16px 32px;
  font-size: 1.05rem;
}

.multi-quota-note {
  font-size: 0.8rem;
  color: #374151;
  margin-top: 8px;
  text-align: center;
}

/* Multi-item detection */
.multi-item-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

.multi-item-container .image-preview {
  flex: 0 0 50vh; /* Fixed 50% of viewport height */
  max-height: 50vh;
  min-height: 50vh;
}

.multi-item-container .preview-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  max-width: 100%;
  max-height: 50vh;
}

.multi-item-info {
  flex: 1;
  padding: 20px;
  overflow-y: auto;
  max-height: 50vh; /* Fixed 50% of viewport height with scroll */
}

.info-text {
  font-size: 0.95rem;
  color: #616161;
  margin: 0 0 16px 0;
}

.detected-items-list {
  margin-top: 16px;
  border-radius: 8px;
  overflow: hidden;
}

/* Bounding boxes */
.bounding-box {
  position: absolute;
  border: 2px solid #1976d2;
  background: rgba(25, 118, 210, 0.1);
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: flex-start;
  padding: 4px;
}

.bounding-box:hover {
  background: rgba(25, 118, 210, 0.2);
  border-width: 3px;
}

.bounding-box.selected {
  border-color: #ff9800;
  background: rgba(255, 152, 0, 0.2);
  border-width: 3px;
}

.item-label {
  background: rgba(0, 0, 0, 0.7);
  color: white;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

/* Mobile optimizations */
@media (max-width: 600px) {
  .photo-preview-container {
    max-height: 100vh;
  }

  .image-preview {
    max-height: 250px;
  }

  .quick-edit-form {
    padding: 16px;
  }

  .multi-item-info {
    padding: 16px;
  }

  .mode-btn {
    min-width: 200px;
    font-size: 1rem;
  }
}
</style>
