import axios from "axios";
import { defineStore } from "pinia";
import { Ref, ref, computed } from "vue";
import router from "../router";

export const inventoryStore = defineStore("inventory", () => {
  const core_url =
    import.meta.env.MODE == "development"
      ? "http://localhost:3050"
      : "https://movetrack-api-7hwn7ggbiq-uc.a.run.app";
  const url_suffix = import.meta.env.MODE == "development" ? "dev" : "demo";
  const qr_base_url =
    import.meta.env.VITE_QR_BASE_URL ||
    (import.meta.env.MODE === "production"
      ? "https://reloprep.com"
      : typeof window !== "undefined"
        ? window.location.origin
        : "http://localhost:5173");

  type ItemUpdateExtras = {
    estimatedValue?: number | null;
    fragile?: boolean;
    priority?: string | null;
    weightLbs?: number | null;
    lengthIn?: number | null;
    widthIn?: number | null;
    heightIn?: number | null;
    notes?: string | null;
    material?: string | null;
    primaryColor?: string | null;
    tags?: string[] | null;
  };

  type ItemUpdateOptions = {
    skipRedirect?: boolean;
    newImage?: Blob | null;
    removeImage?: boolean;
  };

  // Helper function to get headers with auth token
  function getHeaders(): Record<string, string> {
    const sessionToken = localStorage.getItem("session_token");
    if (sessionToken) {
      return { Authorization: "Bearer " + sessionToken };
    }
    return {};
  }

  const formatDimensions = (
    length?: number | null,
    width?: number | null,
    height?: number | null,
  ): string | null => {
    if (
      length === null ||
      length === undefined ||
      width === null ||
      width === undefined ||
      height === null ||
      height === undefined
    ) {
      return null;
    }
    const dims = [length, width, height].map((value) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) {
        return null;
      }
      return parsed % 1 === 0 ? parsed.toString() : parsed.toFixed(2);
    });
    if (dims.some((val) => val === null)) {
      return null;
    }
    return `${dims[0]}" × ${dims[1]}" × ${dims[2]}"`;
  };

  var collections: Ref<any[]> = ref([]);
  var locations: Ref<any[]> = ref([]);
  var containers: Ref<any[]> = ref([]);
  var items: Ref<any[]> = ref([]);
  const itemDetailsItemId: Ref<string | null> = ref(null);
  const itemDetailsUser: Ref<string | null> = ref(null);
  const itemDetailsMode: Ref<"view" | "create" | "edit"> = ref("view");
  const isItemDetailsOpen = ref(false);
  const activeItemDetails = computed(() => {
    if (itemDetailsItemId.value === null) {
      return undefined;
    }
    return items.value.find((i) => i.value === itemDetailsItemId.value);
  });

  // This is for toggles on desktop for location
  var collectionValues: Ref<Array<any>> = ref([]);
  var locationValues: Ref<Array<any>> = ref([]);
  var containerValues: Ref<Array<any>> = ref([]);

  // var activeLocation: Ref<number | undefined> = ref()
  var activeCollection: Ref<
    { label: string; value: string } | undefined
  > = ref();
  var activeContainer: Ref<
    { label: string; value: string } | undefined
  > = ref();

  const BOX_SIZE_PRESETS: Record<
    string,
    { length: number; width: number; height: number }
  > = {
    small: { length: 16, width: 12, height: 12 },
    medium: { length: 18, width: 18, height: 16 },
    large: { length: 24, width: 18, height: 18 },
    wardrobe: { length: 24, width: 24, height: 40 },
  };

  // var isLoaded = ref(false)
  // var leftUnactive = ref(false)

  const normalizeId = (id: any) => {
    if (id === null || id === undefined) return null;
    return String(id);
  };

  const trimTrailingSlash = (value: string) =>
    value.endsWith("/") ? value.slice(0, -1) : value;

  const buildQrUrl = (type: "item" | "container", token?: string | null) => {
    if (!token) return null;
    const sanitizedBase = trimTrailingSlash(qr_base_url);
    return `${sanitizedBase}/qr/${type}/${token}`;
  };

  async function loadInventory(user: string) {
    const headers = getHeaders();
    return axios({
      method: "get",
      url: core_url + "/snapshot/",
      params: {
        user: user,
      },
      headers: headers,
    })
      .then(async (response: any) => {
        try {
          const data = await response.data;
          console.log("data response is: ", data);

          const itemsData = Array.isArray(data.items) ? data.items : [];
          const containersData = Array.isArray(data.containers)
            ? data.containers
            : [];
          const collectionsData = Array.isArray(data.collections)
            ? data.collections
            : [];
          const locationsData = Array.isArray(data.locations)
            ? data.locations
            : [];

          // Build items array from data response
          items.value = itemsData.map((i) => {
            const collectionId = normalizeId(i.collection_id);
            const containerId = normalizeId(i.container_id);
            const locationId = normalizeId(i.location_id);
            const numericDimensions = formatDimensions(
              i.length_in ?? null,
              i.width_in ?? null,
              i.height_in ?? null,
            );
            const fallbackDimensions =
              numericDimensions ??
              (typeof i.dimensions === "string" ? i.dimensions : null);
            return {
              value: normalizeId(i.id),
              label: i.name,
              collection: collectionId,
              container: containerId,
              location: locationId,
              quantity: i.quantity,
              description: i.description,
              picture_url: i.picture_url,
              material: i.material,
              primary_color: i.primary_color,
              tags: i.tags || [],
              fragile: i.fragile || false,
              priority: i.priority || null,
              weight_lbs: i.weight_lbs || null,
              dimensions: fallbackDimensions,
              length_in: i.length_in ?? null,
              width_in: i.width_in ?? null,
              height_in: i.height_in ?? null,
              estimated_value: i.estimated_value ?? null,
              notes: i.notes || null,
              created_at: i.created_at || i.createdAt || null,
              qr_code: i.qr_code || null,
              qr_url: i.qr_code ? buildQrUrl("item", i.qr_code) : null,
            };
          });

          containers.value = containersData.map((i) => {
            const maxWeight =
              i.max_weight_lbs !== undefined && i.max_weight_lbs !== null
                ? Number(i.max_weight_lbs)
                : null;
            const explicitVolume =
              i.max_volume_cuft !== undefined && i.max_volume_cuft !== null
                ? Number(i.max_volume_cuft)
                : null;
            const preset = i.box_size
              ? BOX_SIZE_PRESETS[i.box_size]
              : undefined;
            const innerLength =
              i.inner_length_in !== undefined && i.inner_length_in !== null
                ? Number(i.inner_length_in)
                : null;
            const innerWidth =
              i.inner_width_in !== undefined && i.inner_width_in !== null
                ? Number(i.inner_width_in)
                : null;
            const innerHeight =
              i.inner_height_in !== undefined && i.inner_height_in !== null
                ? Number(i.inner_height_in)
                : null;
            const dimensionSource =
              innerLength && innerWidth && innerHeight
                ? {
                    length: innerLength,
                    width: innerWidth,
                    height: innerHeight,
                  }
                : preset;
            const derivedVolume = dimensionSource
              ? Number(
                  (
                    (dimensionSource.length *
                      dimensionSource.width *
                      dimensionSource.height) /
                    1728
                  ).toFixed(2),
                )
              : null;
            const maxVolume = explicitVolume ?? derivedVolume;
            return {
              value: normalizeId(i.id),
              label: i.name,
              description: i.description,
              collection: normalizeId(i.collection_id),
              location: normalizeId(i.location_id),
              active: false,
              disable: !items.value
                .map((item) => item.container)
                .includes(normalizeId(i.id)),
              box_number: i.box_number,
              box_type: i.box_type,
              box_size: i.box_size,
              sealed: i.sealed || false,
              sealed_at: i.sealed_at,
              weight_lbs: i.weight_lbs ? Number(i.weight_lbs) : null,
              fragile_contents: i.fragile_contents || false,
              color_code: i.color_code || null,
              qr_code: i.qr_code || null,
              qr_url: i.qr_code ? buildQrUrl("container", i.qr_code) : null,
              max_weight_lbs: maxWeight,
              max_volume_cuft: maxVolume,
              capacity_weight: maxWeight,
              capacity_volume: maxVolume,
              current_weight: i.current_weight || 0,
              current_volume: i.current_volume || 0,
              dimensions: dimensionSource ? { ...dimensionSource } : undefined,
              inner_length_in: innerLength,
              inner_width_in: innerWidth,
              inner_height_in: innerHeight,
            };
          });

          collections.value = collectionsData.map((i) => {
            return {
              value: normalizeId(i.id),
              label: i.name,
              description: i.description,
              location: normalizeId(i.location_id),
              disable: !items.value
                .map((i) => i.collection)
                .includes(normalizeId(i.id)),
            };
          });

          const parseCoordinate = (coord: any) => {
            if (coord === null || coord === undefined) return null;
            const numeric = typeof coord === "string" ? parseFloat(coord) : Number(coord);
            return Number.isFinite(numeric) ? numeric : null;
          };

          locations.value = locationsData.map((i) => {
            const locationType = i.location_type || "residence";
            return {
              value: normalizeId(i.id),
              label: i.name,
              description: i.description,
              address: i.address,
              address_2: i.address_2,
              city: i.city,
              state: i.state,
              zip: i.zip,
              country: i.country,
              lat: parseCoordinate(i.lat),
              lng: parseCoordinate(i.lng),
              disable: !items.value.map((i) => i.location).includes(i.id),
              location_type: locationType,
              isPrimary: locationType === "primary_residence",
            };
          });

          console.log(
            "[InventoryStore] Loaded collections:",
            collections.value,
          );
          console.log("[InventoryStore] Loaded containers:", containers.value);
          console.log("[InventoryStore] Loaded items:", items.value);
          console.log("[InventoryStore] Loaded locations:", locations.value);

          collectionValues.value = Array.from(
            new Set(collections.value.map((i) => i.value)),
          );
          console.log(
            "collectionValues in inventory store is: ",
            collectionValues.value,
          );
          containerValues.value = Array.from(
            new Set(containers.value.map((i) => i.value)),
          );
          console.log(
            "containerValues in inventory store is: ",
            containerValues.value,
          );
          locationValues.value = Array.from(
            new Set(locations.value.map((i) => i.value)),
          );
          console.log(
            "locationValues in inventory store is: ",
            locationValues.value,
          );
        } catch (error) {
          console.log(error);
        }
      })
      .then(async () => {
        // Auto-create default collection if none exists
        if (collections.value.length === 0 && locations.value.length > 0) {
          // Use the first available location (preferably primary residence)
          const defaultLocation =
            locations.value.find((l) => l.isPrimary) || locations.value[0];
          await createCollection(
            user,
            "My First Collection",
            "Your default collection",
            defaultLocation.value,
          );
        }

        if (
          activeCollection.value == undefined &&
          collections.value.length > 0
        ) {
          setActiveCollection({ value: collections.value[0].value });
        }
      })
      .catch((error) => {
        console.error("[InventoryStore] Failed to load inventory", error);
        throw error;
      });
  }

  function resolveCollectionLabel(value: string) {
    return collections.value.find((i) => i.value == value)?.label;
  }

  function resolveContainerLabel(value: string | undefined) {
    if (value == null) return undefined;
    return containers.value.find((i) => i.value == value)?.label;
  }

  function setActiveCollection(newCollection: {
    label?: string;
    value: string;
  }) {
    const label =
      newCollection.label ?? resolveCollectionLabel(newCollection.value);
    if (!label) {
      activeCollection.value = undefined;
      return;
    }
    activeCollection.value = { label, value: newCollection.value };

    // If current active container is not in the new collection, then set it to undefined
    if (
      containers.value.find((i) => i.value == activeContainer.value?.value)
        ?.collection != newCollection.value
    ) {
      setActiveContainer(undefined);
    }
  }

  function setActiveContainer(
    newContainer: { label?: string; value: string } | undefined,
  ) {
    if (!newContainer) {
      activeContainer.value = undefined;
    } else {
      const label =
        newContainer.label ?? resolveContainerLabel(newContainer.value);
      if (!label) {
        activeContainer.value = undefined;
      } else {
        activeContainer.value = { label, value: newContainer.value };
      }
    }

    containers.value.forEach((i) => {
      if (i.value == newContainer?.value) {
        i.active = true;
      } else {
        i.active = false;
      }
    });

    console.log("newContainer is in setActiveContainer: ", newContainer);

    // If current active container is not in the new collection, then change the active collection
    if (
      newContainer &&
      containers.value.find((i) => i.value == newContainer.value)?.collection !=
        activeCollection.value?.value
    ) {
      const parentCollection = containers.value.find(
        (j) => j.value == newContainer.value,
      )?.collection;
      if (parentCollection != null) {
        setActiveCollection({ value: parentCollection });
      }
    }
  }

  function openItemDetailsModal(
    itemId: string,
    user: string,
    mode: "view" | "edit" = "view",
  ) {
    itemDetailsItemId.value = itemId;
    itemDetailsUser.value = user;
    itemDetailsMode.value = mode;
    isItemDetailsOpen.value = true;
  }

  function startNewItem(user: string) {
    itemDetailsItemId.value = null;
    itemDetailsUser.value = user;
    itemDetailsMode.value = "create";
    isItemDetailsOpen.value = true;
  }

  function closeItemDetailsModal() {
    isItemDetailsOpen.value = false;
    itemDetailsItemId.value = null;
    itemDetailsUser.value = null;
    itemDetailsMode.value = "view";
  }

  async function createItem(
    user: string,
    name: string,
    description: string,
    quantity: number,
    collection: string,
    container?: string | undefined,
    image?: Blob | string,  // Now accepts either Blob (legacy) OR URL string (new)
    estimatedValue?: number | null,
    fragile?: boolean,
    priority?: string,
    weightLbs?: number | null,
    lengthIn?: number | null,
    widthIn?: number | null,
    heightIn?: number | null,
    notes?: string,
    material?: string,
    primaryColor?: string,
    tags?: string[],
    options?: { skipRedirect?: boolean },
  ) {
    // NEW FLOW:
    // 1. UPLOAD ALL THE TEXTUAL DATA
    // 2. RETURN AN ID
    // 3. IF IMAGE IS BLOB (legacy): UPLOAD IMAGE WITH ID AS IDENTIFIER
    //    IF IMAGE IS STRING (new): USE EXISTING URL
    // 4. UPDATE ITEMS TABLE WITH URL
    // 5. GET ITEMS LIST
    // 6. BUILD LISTS

    console.log("container is: ", container);

    const normalizedCollection = normalizeId(collection);
    const normalizedContainer =
      container !== undefined && container !== null
        ? normalizeId(container)
        : null;

    let params: any = {
      user: user,
      name: name,
      description: description,
      quantity: quantity,
      collection: collection,
    };

    if (container !== undefined) {
      params.container = container;
    } else {
      params.container = null;
    }

    // Add new Nexus Moves fields if provided
    if (estimatedValue !== null && estimatedValue !== undefined) {
      params.estimated_value = estimatedValue;
    }
    if (fragile !== undefined) {
      params.fragile = fragile;
    }
    if (priority) {
      params.priority = priority;
    }
    if (weightLbs !== null && weightLbs !== undefined) {
      params.weight_lbs = weightLbs;
    }
    if (lengthIn !== null && lengthIn !== undefined) {
      params.length_in = lengthIn;
    }
    if (widthIn !== null && widthIn !== undefined) {
      params.width_in = widthIn;
    }
    if (heightIn !== null && heightIn !== undefined) {
      params.height_in = heightIn;
    }
    if (notes) {
      params.notes = notes;
    }

    const uiDimensions = formatDimensions(
      lengthIn ?? null,
      widthIn ?? null,
      heightIn ?? null,
    );

    // Add tag fields if provided
    if (material) {
      params.material = material;
    }
    if (primaryColor) {
      params.primary_color = primaryColor;
    }
    if (tags && tags.length > 0) {
      params.tags = JSON.stringify(tags);
    }

    const headers = await getHeaders();
    let id = await axios({
      method: "post",
      url: core_url + "/items/post",
      params: params,
      headers: headers,
    })
      .then((value) => {
        // Validate response structure - handle both array and object formats
        const responseData = value.data;
        const itemId = Array.isArray(responseData)
          ? responseData[0]?.id
          : responseData?.id;

        if (!itemId) {
          throw new Error('Invalid response from items/post endpoint');
        }
        return itemId;
      })
      .then(async (id) => {
        if (image) {
          // NEW: Check if image is a URL string (already uploaded)
          if (typeof image === 'string') {
            console.log('[createItem] Using existing image URL:', image);
            return { url: image, id };
          }
          // LEGACY: Image is a Blob - upload it now
          else {
            console.log('[createItem] Uploading image blob...');
            const formData = new FormData();
            formData.append("file", image);
            let url = await axios({
              method: "post",
              data: formData,
              url: core_url + "/file/upload/movetrack-item-photos/",
              params: {
                folder: url_suffix + "/" + user,
                name: id,
              },
              headers: {
                ...headers,
                "Content-Type": "multipart/form-data",
              },
            }).then((value) => {
              return value.data.signed_url || value.data.url;
            });
            return { url, id };
          }
        } else {
          return { id };
        }
      })
      .then(async (value) => {
        console.log("container in update is: ", container);
        let id = value.id;

        params.item_id = id;
        const pictureUrl = value.url || undefined;

        // Data URLs are too large for query params — send in body instead
        let axiosBody: Record<string, string> | undefined;
        if (pictureUrl?.startsWith('data:')) {
          axiosBody = { picture_url: pictureUrl };
        } else {
          params.picture_url = pictureUrl;
        }

        axios({
          method: "put",
          url: core_url + "/items/update",
          params: params,
          data: axiosBody,
          headers: headers,
        });
        return { id };
      })
      .then((value) => {
        const parentCollection = collections.value.find(
          (c) => c.value === normalizedCollection,
        );
        const newItem = {
          value: normalizeId(value.id),
          label: name,
          collection: normalizedCollection,
          container: normalizedContainer,
          location: parentCollection?.location ?? null,
          quantity: quantity,
          description: description,
          picture_url: params.picture_url || null,
          material: material ?? null,
          primary_color: primaryColor ?? null,
          tags: tags || [],
          fragile: fragile || false,
          priority: priority || null,
          weight_lbs: weightLbs ?? null,
          dimensions: uiDimensions,
          length_in: lengthIn ?? null,
          width_in: widthIn ?? null,
          height_in: heightIn ?? null,
          estimated_value: estimatedValue ?? null,
          notes: notes || null,
          created_at: new Date().toISOString(),
          qr_code: null,
          qr_url: null,
        };
        items.value.push(newItem);
      })
      .then(() => {
        setActiveCollection({ value: normalizedCollection ?? collection });
        if (normalizedContainer) {
          setActiveContainer({ value: normalizedContainer });
        } else {
          setActiveContainer(undefined);
        }
      })
      .finally(() => {
        if (!options?.skipRedirect) {
          router.push("items");
        }
      });
  }

  async function createItemOutsideUrl(
    user: string,
    name: string,
    description: string,
    quantity: number,
    collection: string,
    container?: string | undefined,
    location?: string | undefined,
    picture_url?: string,
  ) {
    const normalizedContainer =
      container !== undefined && container !== null
        ? container
        : null;
    const normalizedLocation =
      location !== undefined && location !== null
        ? location
        : null;
    let params: any = {
      user: user,
      name: name,
      description: description,
      quantity: quantity,
      collection: collection,
      container: container ?? null,
      location: location ?? null,
    };

    if (picture_url !== undefined) {
      params.picture_url = picture_url;
    } else {
      params.picture_url = null;
    }

    const headers = await getHeaders();
    let id = await axios({
      method: "post",
      url: core_url + "/items/post",
      params: params,
      headers: headers,
    }).then((value) => {
      return value.data[0].id;
    });

    axios({
      method: "put",
      url: core_url + "/items/update",
      params: {
        item_id: id,
        user: user,
        name: name,
        description: description,
        quantity: quantity,
        collection: collection,
        container: container,
        location: location,
        picture_url: picture_url,
      },
      headers: headers,
    }).finally(() => {
      params.value = normalizeId(id);
      params.label = name;
      params.collection = collection;
      params.container = normalizedContainer;
      params.location = normalizedLocation;
      params.qr_code = null;
      params.qr_url = null;
      delete params.name;
      items.value.push(params);

      setActiveCollection({ value: collection });
      if (normalizedContainer) {
        setActiveContainer({ value: normalizedContainer });
      } else {
        setActiveContainer(undefined);
      }
    });
  }

  async function updateItem(
    id: string,
    user: string,
    name: string,
    description: string,
    quantity: number,
    collection: string,
    container?: string | undefined,
    picture_url?: string,
    extra?: ItemUpdateExtras,
    options?: ItemUpdateOptions,
  ) {
    console.log("picture url is: ", picture_url);
    const normalizedId = normalizeId(id);
    const normalizedCollectionId = normalizeId(collection);
    const normalizedContainerId =
      container !== undefined && container !== null
        ? normalizeId(container)
        : null;

    let params: any = {
      item_id: id,
      user: user,
      name: name,
      description: description,
      quantity: quantity,
      collection: collection,
    };

    if (container !== undefined) {
      params.container = container;
    } else {
      params.container = null;
    }

    // Note: location is now inherited from collection, so we don't pass it

    let uploadedUrl: string | undefined;
    const headers = await getHeaders();

    if (options?.removeImage) {
      params.picture_url = null;
    } else if (options?.newImage) {
      const formData = new FormData();
      formData.append("file", options.newImage);
      uploadedUrl = await axios({
        method: "post",
        data: formData,
        url: core_url + "/file/upload/movetrack-item-photos/",
        params: {
          folder: url_suffix + "/" + user,
          name: id,
        },
        headers: {
          ...headers,
          "Content-Type": "multipart/form-data",
        },
      }).then((value) => value.data.signed_url || value.data.url);
      params.picture_url = uploadedUrl;
    } else if (picture_url !== undefined) {
      params.picture_url = picture_url;
    }

    const extraFields = extra || {};
    if (extraFields.estimatedValue !== undefined) {
      params.estimated_value = extraFields.estimatedValue;
    }
    if (extraFields.fragile !== undefined) {
      params.fragile = extraFields.fragile;
    }
    if (extraFields.priority !== undefined) {
      params.priority = extraFields.priority;
    }
    if (extraFields.weightLbs !== undefined) {
      params.weight_lbs = extraFields.weightLbs;
    }
    if (extraFields.lengthIn !== undefined) {
      params.length_in = extraFields.lengthIn;
    }
    if (extraFields.widthIn !== undefined) {
      params.width_in = extraFields.widthIn;
    }
    if (extraFields.heightIn !== undefined) {
      params.height_in = extraFields.heightIn;
    }
    if (extraFields.notes !== undefined) {
      params.notes = extraFields.notes;
    }
    if (extraFields.material !== undefined) {
      params.material = extraFields.material;
    }
    if (extraFields.primaryColor !== undefined) {
      params.primary_color = extraFields.primaryColor;
    }
    if (extraFields.tags !== undefined) {
      params.tags = Array.isArray(extraFields.tags)
        ? JSON.stringify(extraFields.tags)
        : extraFields.tags;
    }
    console.log("params are: ", params);

    await axios({
      method: "put",
      url: core_url + "/items/update",
      params: params,
      headers: headers,
    });

    const index = items.value.findIndex((i) => i.value == normalizedId);
    if (index !== -1) {
      const finalPicture = options?.removeImage
        ? null
        : (uploadedUrl ??
          picture_url ??
          items.value[index].picture_url ??
          null);
      items.value[index].label = name;
      items.value[index].collection = normalizedCollectionId;
      items.value[index].container = normalizedContainerId;
      const parentCollection = collections.value.find(
        (c) => c.value === normalizedCollectionId,
      );
      items.value[index].location =
        parentCollection?.location ?? items.value[index].location;
      items.value[index].quantity = quantity;
      items.value[index].description = description;
      items.value[index].picture_url = finalPicture;
      if (extraFields.estimatedValue !== undefined) {
        items.value[index].estimated_value = extraFields.estimatedValue;
      }
      if (extraFields.fragile !== undefined) {
        items.value[index].fragile = extraFields.fragile;
      }
      if (extraFields.priority !== undefined) {
        items.value[index].priority = extraFields.priority;
      }
      if (extraFields.weightLbs !== undefined) {
        items.value[index].weight_lbs = extraFields.weightLbs;
      }
      if (extraFields.lengthIn !== undefined) {
        items.value[index].length_in = extraFields.lengthIn;
      }
      if (extraFields.widthIn !== undefined) {
        items.value[index].width_in = extraFields.widthIn;
      }
      if (extraFields.heightIn !== undefined) {
        items.value[index].height_in = extraFields.heightIn;
      }
      const updatedDimensions = formatDimensions(
        items.value[index].length_in ?? null,
        items.value[index].width_in ?? null,
        items.value[index].height_in ?? null,
      );
      items.value[index].dimensions = updatedDimensions;
      if (extraFields.notes !== undefined) {
        items.value[index].notes = extraFields.notes;
      }
      if (extraFields.material !== undefined) {
        items.value[index].material = extraFields.material;
      }
      if (extraFields.primaryColor !== undefined) {
        items.value[index].primary_color = extraFields.primaryColor;
      }
      if (extraFields.tags !== undefined) {
        items.value[index].tags = extraFields.tags || [];
      }
    }

    setActiveCollection({ value: normalizedCollectionId ?? collection });
    if (normalizedContainerId != undefined) {
      console.log("container is: ", container);
      setActiveContainer({ value: normalizedContainerId });
    } else {
      setActiveContainer(undefined);
    }

    if (!options?.skipRedirect) {
      router.push("items");
    }
  }

  async function deleteItem(
    id: number | string,
    user: string,
    tsPhoto?: boolean,
  ) {
    const normalizedId = normalizeId(id);
    const headers = await getHeaders();
    axios({
      method: "delete",
      url: core_url + "/items/delete",
      params: {
        item_id: id,
      },
      headers: headers,
    })
      .then(() => {
        const bucketName = "movetrack-item-photos";
        const encodedFilename = encodeURIComponent(
          `${url_suffix}/${user}/${id}`,
        );
        const apiUrl = `${core_url}/file/delete/${bucketName}/${encodedFilename}`;

        if (tsPhoto) {
          axios.delete(apiUrl, {
            headers: headers,
          });
        } else {
          return;
        }
      })
      .then(() => {
        items.value.splice(
          items.value.findIndex((i) => i.value == normalizedId),
          1,
        );
      })
      .finally(() => {
        router.push("items");
      });
  }

  async function createContainer(
    user: string,
    name: string,
    collection: string,
    boxNumber?: string,
    boxType?: string,
    sealed?: boolean,
    weightLbs?: number | null,
    fragileContents?: boolean,
    colorCode?: string,
    boxSize?: string,
    maxWeightLbs?: number | null,
    maxVolumeCuFt?: number | null,
    description?: string,
    innerLengthIn?: number | null,
    innerWidthIn?: number | null,
    innerHeightIn?: number | null,
  ) {
    const normalizedCollectionId = normalizeId(collection);
    const parameters: any = {
      user: user,
      name: name,
      collection: collection,
    };

    if (description) {
      parameters.description = description;
    }

    // Note: location is now inherited from collection, so we don't pass it

    // Add new Nexus Moves fields if provided
    if (boxNumber) {
      parameters.box_number = boxNumber;
    }
    if (boxType) {
      parameters.box_type = boxType;
    }
    if (sealed !== undefined) {
      parameters.sealed = sealed;
    }
    if (weightLbs !== null && weightLbs !== undefined) {
      parameters.weight_lbs = weightLbs;
    }
    if (fragileContents !== undefined) {
      parameters.fragile_contents = fragileContents;
    }
    if (colorCode) {
      parameters.color_code = colorCode;
    }
    if (boxSize) {
      parameters.box_size = boxSize;
    }
    if (maxWeightLbs !== null && maxWeightLbs !== undefined) {
      parameters.max_weight_lbs = maxWeightLbs;
    }
    if (maxVolumeCuFt !== null && maxVolumeCuFt !== undefined) {
      parameters.max_volume_cuft = maxVolumeCuFt;
    }
    if (innerLengthIn !== null && innerLengthIn !== undefined) {
      parameters.inner_length_in = innerLengthIn;
    }
    if (innerWidthIn !== null && innerWidthIn !== undefined) {
      parameters.inner_width_in = innerWidthIn;
    }
    if (innerHeightIn !== null && innerHeightIn !== undefined) {
      parameters.inner_height_in = innerHeightIn;
    }

    const headers = await getHeaders();
    axios({
      method: "post",
      url: core_url + "/containers/post",
      params: parameters,
      headers: headers,
    }).then(async (value) => {
      // Validate API response - handle both array and object formats
      const responseData = value.data;
      const containerId = Array.isArray(responseData)
        ? responseData[0]?.id
        : responseData?.id;

      if (!containerId) {
        console.error('Invalid container creation response:', value.data);
        throw new Error('Container creation failed: Invalid response from server');
      }

      const fallbackDimensions = boxSize
        ? BOX_SIZE_PRESETS[boxSize]
        : undefined;
      const dimensionForStore =
        innerLengthIn && innerWidthIn && innerHeightIn
          ? {
              length: innerLengthIn,
              width: innerWidthIn,
              height: innerHeightIn,
            }
          : fallbackDimensions;
      const normalizedContainerId = normalizeId(containerId);
      const parentCollection = collections.value.find(
        (c) => c.value === normalizedCollectionId,
      );
      const locationId = parentCollection?.location ?? null;

      let params = {
        value: normalizedContainerId,
        label: name,
        description: description,
        collection: normalizedCollectionId,
        location: locationId,
        active: false,
        disable: false,
        box_number: boxNumber || null,
        box_type: boxType || null,
        box_size: boxSize || null,
        sealed: sealed || false,
        weight_lbs: weightLbs ?? null,
        fragile_contents: fragileContents ?? false,
        color_code: colorCode || null,
        qr_code: null,
        qr_url: null,
        max_weight_lbs: maxWeightLbs ?? null,
        max_volume_cuft: maxVolumeCuFt ?? null,
        dimensions: dimensionForStore ? { ...dimensionForStore } : undefined,
        inner_length_in: innerLengthIn ?? null,
        inner_width_in: innerWidthIn ?? null,
        inner_height_in: innerHeightIn ?? null,
      };

      // Update containers array
      containers.value.push(params);

      console.log("containers after push is: ", containers.value);

      // Update containerValues set
      containerValues.value?.push(normalizedContainerId);

      // Set the actives
      setActiveCollection({ value: normalizedCollectionId ?? collection });
      if (normalizedContainerId) {
        setActiveContainer({ label: name, value: normalizedContainerId });
      }
    });
    // .finally(() => {
    //     router.push('items')
    // })
  }

  async function updateContainer(
    id: string,
    user: string,
    name: string,
    collection: string,
    options?: {
      boxNumber?: string;
      boxType?: string;
      sealed?: boolean;
      weightLbs?: number | null;
      fragileContents?: boolean;
      colorCode?: string;
      boxSize?: string;
      maxWeightLbs?: number | null;
      maxVolumeCuFt?: number | null;
      description?: string;
      innerLengthIn?: number | null;
      innerWidthIn?: number | null;
      innerHeightIn?: number | null;
    },
  ) {
    const containerOptions = options || {};
    const normalizedId = normalizeId(id);
    const normalizedCollectionId = normalizeId(collection);

    const headers = await getHeaders();
    axios({
      method: "put",
      url: core_url + "/containers/update",
      params: {
        container_id: id,
        user: user,
        name: name,
        collection: collection,
        // Note: location is now inherited from collection
        description: containerOptions.description,
        box_number: containerOptions.boxNumber,
        box_type: containerOptions.boxType,
        sealed: containerOptions.sealed,
        weight_lbs: containerOptions.weightLbs,
        fragile_contents: containerOptions.fragileContents,
        color_code: containerOptions.colorCode,
        box_size: containerOptions.boxSize,
        max_weight_lbs: containerOptions.maxWeightLbs,
        max_volume_cuft: containerOptions.maxVolumeCuFt,
        inner_length_in: containerOptions.innerLengthIn,
        inner_width_in: containerOptions.innerWidthIn,
        inner_height_in: containerOptions.innerHeightIn,
      },
      headers: headers,
    })
      .then(() => {
        // Update containers
        const index = containers.value.findIndex(
          (i) => i.value == normalizedId,
        );

        containers.value[index].label = name;
        containers.value[index].collection = normalizedCollectionId;
        // Note: location is now inherited from collection and populated from API
        if (containerOptions.description !== undefined) {
          containers.value[index].description = containerOptions.description;
        }
        if (containerOptions.boxNumber !== undefined) {
          containers.value[index].box_number = containerOptions.boxNumber;
        }
        if (containerOptions.boxType !== undefined) {
          containers.value[index].box_type = containerOptions.boxType;
        }
        if (containerOptions.boxSize !== undefined) {
          containers.value[index].box_size = containerOptions.boxSize;
        }
        if (containerOptions.sealed !== undefined) {
          containers.value[index].sealed = containerOptions.sealed;
        }
        if (containerOptions.weightLbs !== undefined) {
          containers.value[index].weight_lbs = containerOptions.weightLbs;
        }
        if (containerOptions.fragileContents !== undefined) {
          containers.value[index].fragile_contents =
            containerOptions.fragileContents;
        }
        if (containerOptions.colorCode !== undefined) {
          containers.value[index].color_code = containerOptions.colorCode;
        }
        if (containerOptions.maxWeightLbs !== undefined) {
          containers.value[index].max_weight_lbs =
            containerOptions.maxWeightLbs;
          containers.value[index].capacity_weight =
            containerOptions.maxWeightLbs;
        }
        if (containerOptions.maxVolumeCuFt !== undefined) {
          containers.value[index].max_volume_cuft =
            containerOptions.maxVolumeCuFt;
          containers.value[index].capacity_volume =
            containerOptions.maxVolumeCuFt;
        }
        if (containerOptions.innerLengthIn !== undefined) {
          containers.value[index].inner_length_in =
            containerOptions.innerLengthIn;
        }
        if (containerOptions.innerWidthIn !== undefined) {
          containers.value[index].inner_width_in =
            containerOptions.innerWidthIn;
        }
        if (containerOptions.innerHeightIn !== undefined) {
          containers.value[index].inner_height_in =
            containerOptions.innerHeightIn;
        }

        const updatedInnerLength =
          containers.value[index].inner_length_in ?? null;
        const updatedInnerWidth =
          containers.value[index].inner_width_in ?? null;
        const updatedInnerHeight =
          containers.value[index].inner_height_in ?? null;
        const fallbackPreset = containerOptions.boxSize
          ? BOX_SIZE_PRESETS[containerOptions.boxSize]
          : containers.value[index].box_size
            ? BOX_SIZE_PRESETS[
                containers.value[index]
                  .box_size as keyof typeof BOX_SIZE_PRESETS
              ]
            : undefined;
        const dimensionSource =
          updatedInnerLength && updatedInnerWidth && updatedInnerHeight
            ? {
                length: updatedInnerLength,
                width: updatedInnerWidth,
                height: updatedInnerHeight,
              }
            : fallbackPreset;
        containers.value[index].dimensions = dimensionSource
          ? { ...dimensionSource }
          : undefined;

        // Update items
        const tempItemsFilter = items.value
          .filter((i) => i.container == id)
          .map((j) => j.value);

        tempItemsFilter.forEach((i) => {
          items.value[items.value.findIndex((j) => j.value == i)].container =
            id;
          items.value[items.value.findIndex((j) => j.value == i)].collection =
            collection;
          items.value[items.value.findIndex((j) => j.value == i)].location =
            location;
        });
      })
      .then(() => {
        setActiveCollection({ value: collection });
        setActiveContainer({
          label:
            containers.value.find((i) => i.value == Number(id))?.label ?? name,
          value: id,
        });
      })
      .finally(() => {
        router.push("items");
      });
  }

  async function deleteContainer(id: number | string, user: string) {
    const normalizedId = normalizeId(id);
    const headers = await getHeaders();
    axios({
      method: "delete",
      url: core_url + "/containers/delete",
      params: {
        container_id: id,
      },
      headers: headers,
    })
      .then(() => {
        // Update containers array
        containers.value.splice(
          containers.value.findIndex((i) => i.value == normalizedId),
          1,
        );

        // Remove id from containerValues
        containerValues.value?.splice(
          containerValues.value?.findIndex((i) => i == normalizedId),
          1,
        );

        // Update items
        const tempItemsFilter = items.value
          .filter((i) => i.container == normalizedId)
          .map((j) => j.value);

        tempItemsFilter.forEach((i) => {
          items.value[items.value.findIndex((j) => j.value == i)].container =
            null;
        });
      })
      .finally(() => {
        router.push("items");
      });
  }

  async function createCollection(
    user: string,
    name: string,
    description: string,
    location: number | string,
  ) {
    const normalizedLocation = normalizeId(location);
    const headers = await getHeaders();
    axios({
      method: "post",
      url: core_url + "/collections/post",
      params: {
        user: user,
        name: name,
        description: description,
        location: location,
      },
      headers: headers,
    }).then(async (value) => {
      const newId = value?.data?.[0]?.id;
      const normalizedId = normalizeId(newId);
      let params = {
        value: normalizedId,
        label: name,
        description: description,
        disable: true,
        location: normalizedLocation,
      };

      // Update collections array
      collections.value.push(params);

      if (params.value) {
        collectionValues.value.push(params.value);

        // Update actives
        setActiveCollection({ value: params.value });
        setActiveContainer(undefined);
      }
    });
  }

  async function updateCollection(
    id: number | string,
    user: string,
    name: string,
    description: string,
  ) {
    const normalizedId = normalizeId(id);
    const headers = await getHeaders();
    axios({
      method: "put",
      url: core_url + "/collections/update",
      params: {
        collection_id: id,
        user: user,
        name: name,
        description: description,
      },
      headers: headers,
    })
      .then(() => {
        // Update collection
        const index = collections.value.findIndex(
          (i) => i.value == normalizedId,
        );
        collections.value[index].label = name;
        collections.value[index].description = description;
      })
      .then(() => {
        if (normalizedId) {
          setActiveCollection({ value: normalizedId });
          setActiveContainer(undefined);
        }
      })
      .finally(() => {
        router.push("items");
      });
  }

  async function deleteCollection(id: number | string, user: string) {
    const normalizedId = normalizeId(id);
    const headers = await getHeaders();
    axios({
      method: "delete",
      url: core_url + "/collections/delete",
      params: {
        collection_id: id,
      },
      headers: headers,
    }).then(() => {
      // Delete from collections
      collections.value.splice(
        collections.value.findIndex((i) => i.value == normalizedId),
        1,
      );

      // Remove id from collectionValues
      collectionValues.value?.splice(
        collectionValues.value?.findIndex((i) => i == normalizedId),
        1,
      );

      // Remove id from containerValues
      // containerValues.value?.splice(

      //     containerValues.value?.findIndex(i => i.collection == id), 1)

      // Delete from containers
      var containerLength = containers.value.length;
      while (containerLength--) {
        if (containers.value[containerLength].collection == normalizedId) {
          containerValues.value?.splice(
            containerValues.value?.findIndex(
              (i) => i == containers.value[containerLength].value,
            ),
            1,
          );
          containers.value.splice(containerLength, 1);
        }
      }

      // Delete from items
      var itemLength = items.value.length;
      while (itemLength--) {
        if (items.value[itemLength].collection == normalizedId) {
          items.value.splice(itemLength, 1);
        }
      }
    });
    // .finally(() => {
    //     router.push('items')
    // })
  }

  async function createLocation(
    user: string,
    name: string,
    description: string,
    address: string,
    address_2: string,
    city: string,
    state: string,
    zip: string,
    isPrimary = false,
    lat: number | null = null,
    lng: number | null = null,
    country: string | null = "USA",
  ) {
    let params: any = {
      user: user,
      name: name,
      description: description,
      address: address,
      address_2: address_2,
      city: city,
      state: state,
      zip: zip,
      is_primary: isPrimary,
      lat: lat ?? undefined,
      lng: lng ?? undefined,
      country: country ?? undefined,
    };

    const headers = await getHeaders();
    const response = await axios({
      method: "post",
      url: core_url + "/locations/post",
      params: params,
      headers: headers,
    });

    const newId = normalizeId(response.data[0].id);

    if (isPrimary) {
      locations.value.forEach((loc) => {
        loc.isPrimary = false;
        loc.location_type = "residence";
      });
    }

    locations.value.push({
      value: newId,
      label: name,
      description: description,
      address: address,
      address_2: address_2,
      city: city,
      state: state,
      zip: zip,
      country: country ?? "USA",
      lat: lat,
      lng: lng,
      disable: true,
      location_type: isPrimary ? "primary_residence" : "residence",
      isPrimary: isPrimary,
    });

    if (!locationValues.value?.includes(newId)) {
      locationValues.value?.push(newId);
    }

    console.log("locations is: ", locations.value);
    return newId;
  }

  async function updateLocation(
    id: string,
    user: string,
    name: string,
    description: string,
    address: string,
    address_2: string,
    city: string,
    state: string,
    zip: string,
    isPrimary = false,
    options?: { skipRedirect?: boolean; lat?: number | null; lng?: number | null; country?: string | null },
  ) {
    const normalizedId = normalizeId(id);
    const headers = await getHeaders();
    const locationType = isPrimary
      ? "primary_residence"
      : locations.value.find((i) => i.value == normalizedId)?.location_type ||
        "residence";

    await axios({
      method: "put",
      url: core_url + "/locations/update",
      params: {
        location_id: id,
        user: user,
        name: name,
        description: description,
        address: address,
        address_2: address_2,
        city: city,
        state: state,
        zip: zip,
        is_primary: isPrimary,
        location_type: locationType,
        lat: options?.lat ?? undefined,
        lng: options?.lng ?? undefined,
        country: options?.country ?? undefined,
      },
      headers: headers,
    });

    // Update locations array
    const index = locations.value.findIndex((i) => i.value == normalizedId);
    if (index !== -1) {
      locations.value[index].label = name;
      locations.value[index].description = description;
      locations.value[index].address = address;
      locations.value[index].address_2 = address_2;
      locations.value[index].city = city;
      locations.value[index].state = state;
      locations.value[index].zip = zip;
      locations.value[index].location_type = locationType;
      if (options?.country) {
        locations.value[index].country = options.country;
      }
      if (options?.lat != null) {
        locations.value[index].lat = options.lat;
      }
      if (options?.lng != null) {
        locations.value[index].lng = options.lng;
      }
      locations.value[index].isPrimary = isPrimary;
    }

    if (isPrimary) {
      locations.value.forEach((loc) => {
        loc.isPrimary = loc.value === id;
        loc.location_type =
          loc.value === id ? "primary_residence" : "residence";
      });
    }

    // Update locationValues set
    if (!locationValues.value?.includes(id)) {
      locationValues.value?.push(id);
    }

    if (!options?.skipRedirect) {
      router.push("items");
    }
  }

  async function deleteLocation(
    id: number,
    user: string,
    options?: { skipRedirect?: boolean },
  ) {
    const headers = await getHeaders();
    await axios({
      method: "delete",
      url: core_url + "/locations/delete",
      params: {
        location_id: id,
      },
      headers: headers,
    });

    await loadInventory(user);

    if (!options?.skipRedirect) {
      router.push("items");
    }
  }

  async function moveItemToContainer(
    itemId: number,
    containerId: number | null,
    user: string,
  ) {
    const item = items.value.find((i) => i.value === itemId);
    if (!item) {
      console.warn(`Item with id ${itemId} not found`);
      return;
    }

    const targetContainer =
      containerId !== null
        ? containers.value.find((i) => i.value === containerId)
        : undefined;
    const targetCollection = targetContainer?.collection ?? item.collection;
    const targetLocation = targetContainer?.location ?? item.location ?? null;

    const headers = await getHeaders();
    await axios({
      method: "put",
      url: core_url + "/items/update",
      params: {
        item_id: itemId,
        user,
        name: item.label,
        description: item.description,
        quantity: item.quantity,
        collection: targetCollection,
        container: containerId,
        location: targetLocation,
      },
      headers,
    });

    item.collection = targetCollection;
    item.container = containerId ?? null;
    item.location = targetLocation;
  }

  async function markPrimaryLocation(id: number | string, user: string) {
    const normalizedId = normalizeId(id);
    if (!normalizedId) {
      return;
    }
    const location = locations.value.find((i) => i.value === normalizedId);
    if (!location) {
      return;
    }

    await updateLocation(
      normalizedId,
      user,
      location.label,
      location.description || "",
      location.address || "",
      location.address_2 || "",
      location.city || "",
      location.state || "",
      location.zip || "",
      true,
      { skipRedirect: true },
    );
  }

  async function generateItemQr(
    itemId: number | string,
    user?: string | null,
    options?: { token?: string; regenerate?: boolean },
  ) {
    const normalizedId = normalizeId(itemId);
    if (!normalizedId) {
      throw new Error("Missing item id");
    }
    const headers = await getHeaders();
    const params: Record<string, any> = {};
    if (user) {
      params.user = user;
    }
    if (options?.regenerate) {
      params.regenerate = true;
    }
    const dataPayload =
      options?.token != null ? { token: options.token } : undefined;
    const response = await axios({
      method: "post",
      url: `${core_url}/items/${normalizedId}/qr`,
      params,
      data: dataPayload,
      headers,
    });
    console.log("[inventoryStore] generateItemQr response:", response.data);
    const target = items.value.find((item) => item.value === normalizedId);
    if (target) {
      target.qr_code = response.data.token;
      target.qr_url =
        response.data.url || buildQrUrl("item", response.data.token);
    }
    return response.data;
  }

  async function generateContainerQr(
    containerId: number | string,
    user?: string | null,
    options?: { token?: string; regenerate?: boolean },
  ) {
    const normalizedId = normalizeId(containerId);
    if (!normalizedId) {
      throw new Error("Missing container id");
    }
    const headers = await getHeaders();
    const params: Record<string, any> = {};
    if (user) {
      params.user = user;
    }
    if (options?.regenerate) {
      params.regenerate = true;
    }
    const dataPayload =
      options?.token != null ? { token: options.token } : undefined;
    const response = await axios({
      method: "post",
      url: `${core_url}/containers/${normalizedId}/qr`,
      params,
      data: dataPayload,
      headers,
    });
    console.log("[inventoryStore] generateContainerQr response:", response.data);
    const target = containers.value.find((c) => c.value === normalizedId);
    if (target) {
      target.qr_code = response.data.token;
      target.qr_url =
        response.data.url || buildQrUrl("container", response.data.token);
    }
    return response.data;
  }

  async function requestItemEstimate(
    itemId: string,
    payload?: {
      overrideFields?: Record<string, any>;
      model?: string;
    },
  ) {
    const normalizedId = normalizeId(itemId);
    if (!normalizedId) {
      throw new Error("Item ID is required for AI estimation");
    }
    const headers = getHeaders();
    const response = await axios({
      method: "post",
      url: `${core_url}/items/${normalizedId}/ai-estimate`,
      data: payload || {},
      headers,
    });
    return response.data;
  }

  return {
    locations,
    collections,
    containers,
    items,
    activeCollection,
    activeContainer,
    isItemDetailsOpen,
    activeItemDetails,
    itemDetailsItemId,
    itemDetailsUser,
    itemDetailsMode,
    locationValues,
    collectionValues,
    containerValues,

    loadInventory,
    setActiveCollection,
    setActiveContainer,
    createItem,
    updateItem,
    deleteItem,
    createItemOutsideUrl,
    createContainer,
    updateContainer,
    deleteContainer,
    createCollection,
    updateCollection,
    deleteCollection,
    createLocation,
    updateLocation,
    deleteLocation,
    moveItemToContainer,
    markPrimaryLocation,
    generateItemQr,
    generateContainerQr,
    openItemDetailsModal,
    closeItemDetailsModal,
    startNewItem,
    getQrUrl: buildQrUrl,
    requestItemEstimate,
  };
});
