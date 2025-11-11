import axios from 'axios';
import { defineStore } from 'pinia';
import { Ref, ref, computed } from 'vue';
import router from '../router';

export const inventoryStore = defineStore("inventory", () => {
    const core_url = import.meta.env.MODE == 'development' ? 'http://localhost:3050' : 'https://movetrack-api-7hwn7ggbiq-uc.a.run.app'
    const url_suffix = import.meta.env.MODE == 'development' ? 'dev' : 'demo'

    type ItemUpdateExtras = {
        estimatedValue?: number | null,
        fragile?: boolean,
        priority?: string | null,
        weightLbs?: number | null,
        dimensions?: string | null,
        notes?: string | null,
        material?: string | null,
        primaryColor?: string | null,
        tags?: string[] | null
    }

    type ItemUpdateOptions = {
        skipRedirect?: boolean
    }

    // Helper function to get headers with auth token
    function getHeaders(): Record<string, string> {
        const sessionToken = localStorage.getItem('session_token');
        if (sessionToken) {
            return { Authorization: 'Bearer ' + sessionToken };
        }
        return {};
    }

    var collections: Ref<any[]> = ref([])
    var locations: Ref<any[]> = ref([])
    var containers: Ref<any[]> = ref([])
    var items: Ref<any[]> = ref([])
    const itemDetailsItemId: Ref<number | null> = ref(null)
    const itemDetailsUser: Ref<string | null> = ref(null)
    const itemDetailsMode: Ref<'view' | 'create'> = ref('view')
    const isItemDetailsOpen = ref(false)
    const activeItemDetails = computed(() => {
        if (itemDetailsItemId.value === null) {
            return undefined
        }
        return items.value.find(i => i.value === itemDetailsItemId.value)
    })
    
    // This is for toggles on desktop for location
    var collectionValues: Ref<Array<any>> = ref([])
    var locationValues: Ref<Array<any>> = ref([])
    var containerValues: Ref<Array<any>> = ref([])

    // var activeLocation: Ref<number | undefined> = ref()
    var activeCollection: Ref<{label: string, value: number} | undefined> = ref()
    var activeContainer: Ref<{label: string, value: number} | undefined> = ref()
    

    // var isLoaded = ref(false)
    // var leftUnactive = ref(false)

    async function loadInventory (user: string) {
        const headers = getHeaders();
        axios({
            method: 'get',
            url: core_url + '/lists/',
            params: {
            user: user
            },
            headers: headers
        })
            .then(async (response: any) => {
                try {
                    console.log('data response is: ', await response.data)

                    // Build items array from data response
                    items.value = response.data.items.map(i => {
                        return {
                            value: Number(i.id),
                            label: i.name,
                            collection: i.collection_id,
                            container: i.container_id,
                            location: i.location_id,
                            quantity: i.quantity,
                            description: i.description,
                            picture_url: i.picture_url,
                            material: i.material,
                            primary_color: i.primary_color,
                            tags: i.tags || [],
                            fragile: i.fragile || false,
                            priority: i.priority || null,
                            weight_lbs: i.weight_lbs || null,
                            dimensions: i.dimensions || null,
                            estimated_value: i.estimated_value ?? null,
                            notes: i.notes || null
                        }
                    })

                    containers.value = response.data.containers.map(i => {
                        const maxWeight = i.max_weight_lbs !== undefined && i.max_weight_lbs !== null ? Number(i.max_weight_lbs) : null
                        const maxVolume = i.max_volume_cuft !== undefined && i.max_volume_cuft !== null ? Number(i.max_volume_cuft) : null
                        return {
                            value: Number(i.id),
                            label: i.name,
                            description: i.description,
                            collection: i.collection_id,
                            location: i.location_id,
                            active: false,
                            disable: !items.value.map(i => i.container).includes(Number(i.id)),
                            box_number: i.box_number,
                            box_type: i.box_type,
                            box_size: i.box_size,
                            sealed: i.sealed || false,
                            sealed_at: i.sealed_at,
                            weight_lbs: i.weight_lbs ? Number(i.weight_lbs) : null,
                            fragile_contents: i.fragile_contents || false,
                            color_code: i.color_code || null,
                            qr_code: i.qr_code || null,
                            max_weight_lbs: maxWeight,
                            max_volume_cuft: maxVolume,
                            capacity_weight: maxWeight,
                            capacity_volume: maxVolume,
                            current_weight: i.current_weight || 0,
                            current_volume: i.current_volume || 0
                        }
                    })

                    collections.value = response.data.collections.map(i => {
                        return {
                            value: Number(i.id),
                            label: i.name,
                            description: i.description,
                            disable: !items.value.map(i => i.collection).includes(Number(i.id))
                        }
                    })

                    locations.value = response.data.locations.map(i => {
                        const locationType = i.location_type || 'residence'
                        return {
                            value: Number(i.id),
                            label: i.name,
                            description: i.description,
                            address: i.address,
                            address_2: i.address_2,
                            city: i.city,
                            state: i.state,
                            zip: i.zip,
                            disable: !items.value.map(i => i.location).includes(Number(i.id)),
                            location_type: locationType,
                            isPrimary: locationType === 'primary_residence'
                        }
                    })

                    collectionValues.value = Array.from(new Set(collections.value.map(i => i.value)))
                    console.log('collectionValues in inventory store is: ', collectionValues.value)
                    containerValues.value = Array.from(new Set(containers.value.map(i => i.value)))
                    console.log('containerValues in inventory store is: ', containerValues.value)
                    locationValues.value = Array.from(new Set(locations.value.map(i => i.value)))
                    console.log('locationValues in inventory store is: ', locationValues.value)
                } catch (error) {
                    console.log(error)
                }
            })
            .then(async () => {
                // Auto-create default collection if none exists
                if (collections.value.length === 0) {
                    await createCollection(user, 'My First Collection', 'Your default collection');
                }

                if (activeCollection.value == undefined && collections.value.length > 0) {
                    setActiveCollection({ value: collections.value[0].value})
                }
            })
    }

    function resolveCollectionLabel(value: number) {
        return collections.value.find(i => i.value == value)?.label
    }

    function resolveContainerLabel(value: number | undefined) {
        if (value == null) return undefined
        return containers.value.find(i => i.value == value)?.label
    }

    function setActiveCollection(newCollection: {label?: string, value: number}) {
        const label = newCollection.label ?? resolveCollectionLabel(newCollection.value)
        if (!label) {
            activeCollection.value = undefined
            return
        }
        activeCollection.value = { label, value: newCollection.value }

        // If current active container is not in the new collection, then set it to undefined
        if (containers.value.find(i => i.value == activeContainer.value?.value)?.collection != newCollection.value) {
            setActiveContainer(undefined)
        }
    }

    function setActiveContainer(newContainer: {label?: string, value: number} | undefined) {
        if (!newContainer) {
            activeContainer.value = undefined
        } else {
            const label = newContainer.label ?? resolveContainerLabel(newContainer.value)
            if (!label) {
                activeContainer.value = undefined
            } else {
                activeContainer.value = { label, value: newContainer.value }
            }
        }

        containers.value.forEach(i => {
            if (i.value == newContainer?.value) {
                i.active = true
            } else {
                i.active = false
            }
        })

        console.log('newContainer is in setActiveContainer: ', newContainer)

        // If current active container is not in the new collection, then change the active collection
        if (newContainer && containers.value.find(i => i.value == newContainer.value)?.collection != activeCollection.value?.value) {
            const parentCollection = containers.value.find(j => j.value == newContainer.value)?.collection
            if (parentCollection != null) {
                setActiveCollection({ value: parentCollection })
            }
        }
    }

    function openItemDetailsModal(itemId: number, user: string) {
        itemDetailsItemId.value = itemId
        itemDetailsUser.value = user
        itemDetailsMode.value = 'view'
        isItemDetailsOpen.value = true
    }

    function startNewItem(user: string) {
        itemDetailsItemId.value = null
        itemDetailsUser.value = user
        itemDetailsMode.value = 'create'
        isItemDetailsOpen.value = true
    }

    function closeItemDetailsModal() {
        isItemDetailsOpen.value = false
        itemDetailsItemId.value = null
        itemDetailsUser.value = null
        itemDetailsMode.value = 'view'
    }

    async function createItem (user: string, name: string, description: string, quantity: number, collection: number, container?: number | undefined, location?: number | undefined, image?: Blob, estimatedValue?: number | null, fragile?: boolean, priority?: string, weightLbs?: number | null, dimensions?: string, notes?: string, material?: string, primaryColor?: string, tags?: string[]) {
        // 1. UPLOAD ALL THE TEXTUAL DATA
        // 2. RETURN AN ID
        // 3. UPLOAD IMAGE WITH THAT ID AS A UNIQUE IDENTIFIER
        // 4. UPDATE ITEMS TABLE WITH URL
        // 5. GET ITEMS LIST
        // 6. BUILD LISTS

        console.log('container is: ', container)

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

        if (location !== undefined) {
            params.location = location;
        } else {
            params.location = null;
        }

        // Add new MoveTrack fields if provided
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
        if (dimensions) {
            params.dimensions = dimensions;
        }
        if (notes) {
            params.notes = notes;
        }

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
            method: 'post',
            url: core_url + '/items/post',
            params: params,
            headers: headers
        })
        .then(value => {
            return value.data[0].id
        })
        .then(async (id) => {
            if (image) {
                const formData = new FormData();
                formData.append('file', image);
                let url = await axios({
                    method: 'post',
                    data: formData,
                    url: core_url + '/file/upload/movetrack-item-photos/',
                    params: {
                        folder: url_suffix + '/' + user,
                        name: id
                    },
                    headers: {
                        ...headers,
                        'Content-Type': 'multipart/form-data',
                    }
                })
                .then(value => {
                    return value.data.url
                })
                return { url, id }
            } else {
                return { id }
            }
        })
        .then(async (value) => {
            console.log('container in update is: ', container)
            let id = value.id

            params.item_id = id
            params.picture_url = value.url ? value.url : undefined

            axios({
                method: 'put',
                url: core_url + '/items/update',
                params: params,
                headers: headers
            })
            return { id }
        })
        .then(value => {
            // Add the value to params
            params.value = value.id
            params.label = name
            
            // Remove the name parameter from params
            delete params.name
            items.value.push(params)

        })
        .then(() => {
            setActiveCollection({ value: collection})
            if (container !== undefined) {
                setActiveContainer({ value: container})
            } else {
                setActiveContainer(undefined)
            }
        })
        .finally(() => {
            router.push('items')
        })
    }

    async function createItemOutsideUrl (user: string, name: string, description: string, quantity: number, collection: number, container?: number | undefined, location?: number | undefined, picture_url?: string) {
        // 1. UPLOAD ALL THE TEXTUAL DATA
        // 2. RETURN AN ID
        // 3. UPLOAD IMAGE WITH THAT ID AS A UNIQUE IDENTIFIER
        // 4. UPDATE ITEMS TABLE WITH URL
        // 5. GET ITEMS LIST
        // 6. BUILD LISTS
        
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
        
        if (location !== undefined) {
            params.location = location;
        } else {
            params.location = null;
        }

        if (picture_url !== undefined) {
            params.picture_url = picture_url;
        } else {
            params.picture_url = null;
        }

        const headers = await getHeaders();
        let id = await axios({
            method: 'post',
            url: core_url + '/items/post',
            params: params,
            headers: headers
        })
        .then(value => {
            return value.data[0].id
        })

        axios({
            method: 'put',
            url: core_url + '/items/update',
            params: {
              item_id: id,
              user: user,
              name: name,
              description: description,
              quantity: quantity,
              collection: collection,
              container: container,
              location: location,
              picture_url: picture_url
            },
            headers: headers
        })
        .finally(() => {
            // Add the value to params
            params.value = id
            params.label = name

            // Remove the name parameter from params
            delete params.name
            items.value.push(params)

            setActiveCollection({ value: collection})
            if (container != undefined) {
                setActiveContainer({ value: container})
            } else {
                setActiveContainer(undefined)
            }
        })
    }

    async function updateItem (
        id: number,
        user: string,
        name: string,
        description: string,
        quantity: number,
        collection: number,
        container?: number | undefined,
        location?: number | undefined,
        picture_url?: string,
        extra?: ItemUpdateExtras,
        options?: ItemUpdateOptions
    ) {
        console.log('picture url is: ', picture_url)
        
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
        
        if (location !== undefined) {
            params.location = location;
        } else {
            params.location = null;
        }

        if (picture_url !== undefined) {
            params.picture_url = picture_url;
        } else {
            params.picture_url = null;
        }

        const extraFields = extra || {}
        if (extraFields.estimatedValue !== undefined) {
            params.estimated_value = extraFields.estimatedValue
        }
        if (extraFields.fragile !== undefined) {
            params.fragile = extraFields.fragile
        }
        if (extraFields.priority !== undefined) {
            params.priority = extraFields.priority
        }
        if (extraFields.weightLbs !== undefined) {
            params.weight_lbs = extraFields.weightLbs
        }
        if (extraFields.dimensions !== undefined) {
            params.dimensions = extraFields.dimensions
        }
        if (extraFields.notes !== undefined) {
            params.notes = extraFields.notes
        }
        if (extraFields.material !== undefined) {
            params.material = extraFields.material
        }
        if (extraFields.primaryColor !== undefined) {
            params.primary_color = extraFields.primaryColor
        }
        if (extraFields.tags !== undefined) {
            params.tags = Array.isArray(extraFields.tags) ? JSON.stringify(extraFields.tags) : extraFields.tags
        }
        
        console.log('params are: ', params)

        const headers = await getHeaders();
        await axios({
            method: 'put',
            url: core_url + '/items/update',
            params: params,
            headers: headers
        })
        
        const index = items.value.findIndex((i) => i.value == id)
        if (index !== -1) {
            items.value[index].label = name
            items.value[index].collection = collection
            items.value[index].container = container ?? null
            items.value[index].location = location ?? null
            items.value[index].quantity = quantity
            items.value[index].description = description
            items.value[index].picture_url = picture_url ?? null
            if (extraFields.estimatedValue !== undefined) {
                items.value[index].estimated_value = extraFields.estimatedValue
            }
            if (extraFields.fragile !== undefined) {
                items.value[index].fragile = extraFields.fragile
            }
            if (extraFields.priority !== undefined) {
                items.value[index].priority = extraFields.priority
            }
            if (extraFields.weightLbs !== undefined) {
                items.value[index].weight_lbs = extraFields.weightLbs
            }
            if (extraFields.dimensions !== undefined) {
                items.value[index].dimensions = extraFields.dimensions
            }
            if (extraFields.notes !== undefined) {
                items.value[index].notes = extraFields.notes
            }
            if (extraFields.material !== undefined) {
                items.value[index].material = extraFields.material
            }
            if (extraFields.primaryColor !== undefined) {
                items.value[index].primary_color = extraFields.primaryColor
            }
            if (extraFields.tags !== undefined) {
                items.value[index].tags = extraFields.tags || []
            }
        }

        setActiveCollection({ value: collection })
        if (container != undefined) {
            console.log('container is: ', container)
            setActiveContainer({ value: container })
        } else {
            setActiveContainer(undefined)
        }

        if (!options?.skipRedirect) {
            router.push('items')
        }
    }

    async function deleteItem (id: number, user: string, tsPhoto?: boolean) {
        const headers = await getHeaders();
        axios({
            method: 'delete',
            url: core_url + '/items/delete',
            params: {
                item_id: id
            },
            headers: headers
        })
        .then(() => {
            const bucketName = 'movetrack-item-photos'
            const encodedFilename = encodeURIComponent(`${url_suffix}/${user}/${id}`);
            const apiUrl = `${core_url}/file/delete/${bucketName}/${encodedFilename}`;

            if (tsPhoto) {
                axios.delete(apiUrl, {
                    headers: headers
                })
            } else {
                return
            }
        })
        .then(() => {
            items.value.splice(items.value.findIndex((i) => i.value == id), 1)
        })
        .finally(() => {
            router.push('items')
        })
    }

    async function createContainer (
        user: string,
        name: string,
        collection: number,
        location?: number,
        boxNumber?: string,
        boxType?: string,
        sealed?: boolean,
        weightLbs?: number | null,
        fragileContents?: boolean,
        colorCode?: string,
        boxSize?: string,
        maxWeightLbs?: number | null,
        maxVolumeCuFt?: number | null,
        description?: string
    ) {
        const parameters: any = {
            user: user,
            name: name,
            collection: collection,
        }

        if (description) {
            parameters.description = description
        }

        if (location != undefined) {
            parameters.location_id = location
        } else {
            parameters.location_id = null
        }

        // Add new MoveTrack fields if provided
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

        const headers = await getHeaders();
        axios({
            method: 'post',
            url: core_url + '/containers/post',
            params: parameters,
            headers: headers
        })
        .then(async (value) => {
            // value: Number(i.id),
            // label: i.name,
            // collection: i.collection_id,
            // location: i.location_id,
            // active: false,
            // disable: !items.value.map(i => i.container).includes(Number(i.id))
            
            let params = {
                value: Number(value.data[0].id),
                label: name,
                description: description,
                collection: collection,
                location: location ?? null,
                active: false,
                disable: false,
                box_number: boxNumber || null,
                box_type: boxType || null,
                box_size: boxSize || null,
                sealed: sealed || false,
                weight_lbs: weightLbs ?? null,
                fragile_contents: fragileContents ?? false,
                color_code: colorCode || null,
                max_weight_lbs: maxWeightLbs ?? null,
                max_volume_cuft: maxVolumeCuFt ?? null
            }

            // Update containers array
            containers.value.push(params)

            console.log('containers after push is: ', containers.value)

            // Update containerValues set
            containerValues.value?.push(Number(value.data[0].id))
            

            // Set the actives
            setActiveCollection({ value: collection})
            setActiveContainer({label: name, value: Number(value.data[0].id)})
        })
        // .finally(() => {
        //     router.push('items')
        // })
    }

    async function updateContainer (
        id: number,
        user: string,
        name: string,
        collection: number,
        location?: number,
        options?: {
            boxNumber?: string,
            boxType?: string,
            sealed?: boolean,
            weightLbs?: number | null,
            fragileContents?: boolean,
            colorCode?: string,
            boxSize?: string,
            maxWeightLbs?: number | null,
            maxVolumeCuFt?: number | null,
            description?: string
        }
    ) {
        console.log('location in inventory store is: ', location)

        const containerOptions = options || {}

        const headers = await getHeaders();
        axios({
            method: 'put',
            url: core_url + '/containers/update',
            params: {
                container_id: id,
                user: user,
                name: name,
                collection: collection,
                location: location,
                description: containerOptions.description,
                box_number: containerOptions.boxNumber,
                box_type: containerOptions.boxType,
                sealed: containerOptions.sealed,
                weight_lbs: containerOptions.weightLbs,
                fragile_contents: containerOptions.fragileContents,
                color_code: containerOptions.colorCode,
                box_size: containerOptions.boxSize,
                max_weight_lbs: containerOptions.maxWeightLbs,
                max_volume_cuft: containerOptions.maxVolumeCuFt
            },
            headers: headers
        })
        .then(() => {
            // Update containers
            const index = containers.value.findIndex((i) => i.value == id)

            containers.value[index].label = name
            containers.value[index].collection = collection
            containers.value[index].location = location
            if (containerOptions.description !== undefined) {
                containers.value[index].description = containerOptions.description
            }
            if (containerOptions.boxNumber !== undefined) {
                containers.value[index].box_number = containerOptions.boxNumber
            }
            if (containerOptions.boxType !== undefined) {
                containers.value[index].box_type = containerOptions.boxType
            }
            if (containerOptions.boxSize !== undefined) {
                containers.value[index].box_size = containerOptions.boxSize
            }
            if (containerOptions.sealed !== undefined) {
                containers.value[index].sealed = containerOptions.sealed
            }
            if (containerOptions.weightLbs !== undefined) {
                containers.value[index].weight_lbs = containerOptions.weightLbs
            }
            if (containerOptions.fragileContents !== undefined) {
                containers.value[index].fragile_contents = containerOptions.fragileContents
            }
            if (containerOptions.colorCode !== undefined) {
                containers.value[index].color_code = containerOptions.colorCode
            }
            if (containerOptions.maxWeightLbs !== undefined) {
                containers.value[index].max_weight_lbs = containerOptions.maxWeightLbs
                containers.value[index].capacity_weight = containerOptions.maxWeightLbs
            }
            if (containerOptions.maxVolumeCuFt !== undefined) {
                containers.value[index].max_volume_cuft = containerOptions.maxVolumeCuFt
                containers.value[index].capacity_volume = containerOptions.maxVolumeCuFt
            }

            // Update items
            const tempItemsFilter = items.value.filter(i => i.container == id).map(j => j.value)

            tempItemsFilter.forEach(i => {
                items.value[items.value.findIndex(j => j.value == i)].container = id
                items.value[items.value.findIndex(j => j.value == i)].collection = collection
                items.value[items.value.findIndex(j => j.value == i)].location = location
            })
        })
        .then(() => {
            setActiveCollection({ value: collection})
            setActiveContainer({label: containers.value.find(i => i.value == Number(id))?.label ?? name, value: id})
        })
        .finally(() => {
            router.push('items')
        })
    }

    async function deleteContainer (id: number, user: string) {
        const headers = await getHeaders();
        axios({
            method: 'delete',
            url: core_url + '/containers/delete',
            params: {
                container_id: id
            },
            headers: headers
        })
        .then(() => {
            // Update containers array
            containers.value.splice(containers.value.findIndex((i) => i.value == id), 1)

            // Remove id from containerValues
            containerValues.value?.splice(containerValues.value?.findIndex(i => i == id), 1)

            // Update items
            const tempItemsFilter = items.value.filter(i => i.container == id).map(j => j.value)

            tempItemsFilter.forEach(i => {
                items.value[items.value.findIndex(j => j.value == i)].container = null
            })
        })
        .finally(() => {
            router.push('items')
        })
    }

    async function createCollection (user: string, name: string, description: string) {
        const headers = await getHeaders();
        axios({
            method: 'post',
            url: core_url + '/collections/post',
            params: {
                user: user,
                name: name,
                description: description
            },
            headers: headers
        })
        .then(async (value) => {
            let params = {
                value: Number(value.data[0].id),
                label: name,
                description: description,
                disable: true
            }

            // Update collections array
            collections.value.push(params)

            collectionValues.value.push(Number(value.data[0].id))

            // Update actives
            setActiveCollection({ value: value.data[0].id})
            setActiveContainer(undefined)
        })
    }

    async function updateCollection (id: number, user: string, name: string, description: string) {
        const headers = await getHeaders();
        axios({
            method: 'put',
            url: core_url + '/collections/update',
            params: {
              collection_id: id,
              user: user,
              name: name,
              description: description,
            },
            headers: headers
        })
        .then(() => {
            // Update collection
            const index = collections.value.findIndex((i) => i.value == id)
            collections.value[index].label = name
            collections.value[index].description = description
        })
        .then(() => {
            setActiveCollection({ value: Number(id)})
            setActiveContainer(undefined)
        })
        .finally(() => {
            router.push('items')
        })
    }

    async function deleteCollection (id: number, user: string) {
        const headers = await getHeaders();
        axios({
            method: 'delete',
            url: core_url + '/collections/delete',
            params: {
                collection_id: id
            },
            headers: headers
        })
        .then(() => {
            // Delete from collections
            collections.value.splice(collections.value.findIndex((i) => i.value == id), 1)

            // Remove id from collectionValues
            collectionValues.value?.splice(collectionValues.value?.findIndex(i => i == id), 1)

            // Remove id from containerValues 
            // containerValues.value?.splice(
                
            //     containerValues.value?.findIndex(i => i.collection == id), 1)

            // Delete from containers
            var containerLength = containers.value.length
            while (containerLength--) {
                if (containers.value[containerLength].collection == id) {
                    containerValues.value?.splice(containerValues.value?.findIndex(i => i == containers.value[containerLength].value), 1)
                    containers.value.splice(containerLength, 1)
                }
            }

            // Delete from items
            var itemLength = items.value.length
            while (itemLength--) {
                if (items.value[itemLength].collection == id) {
                    items.value.splice(itemLength, 1)
                }
            }
        })
        // .finally(() => {
        //     router.push('items')
        // })
    }

    async function createLocation (user: string, name: string, description: string, address: string, address_2: string, city: string, state: string, zip: string, isPrimary = false) {
        let params: any = {
            user: user,
            name: name,
            description: description,
            address: address,
            address_2: address_2,
            city: city,
            state: state,
            zip: zip,
            is_primary: isPrimary
        }
        
        const headers = await getHeaders();
        const response = await axios({
            method: 'post',
            url: core_url + '/locations/post',
            params: params,
            headers: headers
        })

        const newId = Number(response.data[0].id)

        if (isPrimary) {
            locations.value.forEach(loc => {
                loc.isPrimary = false
                loc.location_type = 'residence'
            })
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
            disable: true,
            location_type: isPrimary ? 'primary_residence' : 'residence',
            isPrimary: isPrimary
        })

        if (!locationValues.value?.includes(newId)) {
            locationValues.value?.push(newId)
        }

        console.log('locations is: ', locations.value)
    }

    async function updateLocation (id: number, user: string, name: string, description: string, address: string, address_2: string, city: string, state: string, zip: string, isPrimary = false, options?: { skipRedirect?: boolean }) {
        const headers = await getHeaders();
        const locationType = isPrimary ? 'primary_residence' : (locations.value.find(i => i.value == id)?.location_type || 'residence')

        await axios({
            method: 'put',
            url: core_url + '/locations/update',
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
              location_type: locationType
            },
            headers: headers
        })

        // Update locations array
        const index = locations.value.findIndex((i) => i.value == id)
        if (index !== -1) {
            locations.value[index].label = name
            locations.value[index].description = description
            locations.value[index].address = address
            locations.value[index].address_2 = address_2
            locations.value[index].city = city
            locations.value[index].state = state
            locations.value[index].zip = zip
            locations.value[index].location_type = locationType
            locations.value[index].isPrimary = isPrimary
        }

        if (isPrimary) {
            locations.value.forEach(loc => {
                loc.isPrimary = loc.value === id
                loc.location_type = loc.value === id ? 'primary_residence' : 'residence'
            })
        }

        // Update locationValues set
        if (!locationValues.value?.includes(id)) {
            locationValues.value?.push(id)
        }

        if (!options?.skipRedirect) {
            router.push('items')
        }
    }

    async function deleteLocation (id: number, user: string, options?: { skipRedirect?: boolean }) {
        const headers = await getHeaders();
        await axios({
            method: 'delete',
            url: core_url + '/locations/delete',
            params: {
              location_id: id
            },
            headers: headers
        })

        // Remove from locations
        locations.value.splice(locations.value.findIndex((i) => i.value == id), 1)

        // Remove id from locationValues
        locationValues.value?.splice(locationValues.value?.findIndex(i => i == id), 1)

        // Remove from containers
        containers.value.forEach(i => {
            if (i.location == id) {
                i.location = null
            }
        })

        // Remove from items
        items.value.forEach(i => {
            if (i.location == id) {
                i.location = null
            }
        })

        if (!options?.skipRedirect) {
            router.push('items')
        }
    }

    async function moveItemToContainer(itemId: number, containerId: number | null, user: string) {
        const item = items.value.find(i => i.value === itemId);
        if (!item) {
            console.warn(`Item with id ${itemId} not found`);
            return;
        }

        const targetContainer = containerId !== null ? containers.value.find(i => i.value === containerId) : undefined;
        const targetCollection = targetContainer?.collection ?? item.collection;
        const targetLocation = targetContainer?.location ?? item.location ?? null;

        const headers = await getHeaders();
        await axios({
            method: 'put',
            url: core_url + '/items/update',
            params: {
                item_id: itemId,
                user,
                name: item.label,
                description: item.description,
                quantity: item.quantity,
                collection: targetCollection,
                container: containerId,
                location: targetLocation
            },
            headers
        });

        item.collection = targetCollection;
        item.container = containerId ?? null;
        item.location = targetLocation;
    }

    async function markPrimaryLocation (id: number, user: string) {
        const location = locations.value.find(i => i.value === id)
        if (!location) {
            return
        }

        await updateLocation(
            id,
            user,
            location.label,
            location.description || '',
            location.address || '',
            location.address_2 || '',
            location.city || '',
            location.state || '',
            location.zip || '',
            true,
            { skipRedirect: true }
        )
    }

    return { locations, collections, containers, items, 
        activeCollection, activeContainer, 
        isItemDetailsOpen, activeItemDetails, itemDetailsItemId, itemDetailsUser, itemDetailsMode,
        locationValues, collectionValues, containerValues,
        
        loadInventory, setActiveCollection, setActiveContainer, 
        createItem, updateItem, deleteItem, createItemOutsideUrl,
        createContainer, updateContainer, deleteContainer,
        createCollection, updateCollection, deleteCollection,
        createLocation, updateLocation, deleteLocation, moveItemToContainer,
        markPrimaryLocation,
        openItemDetailsModal, closeItemDetailsModal, startNewItem
    }
})
