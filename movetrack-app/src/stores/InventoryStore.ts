import axios from 'axios';
import { defineStore } from 'pinia';
import { Ref, ref } from 'vue';
import router from '../router';

export const inventoryStore = defineStore("inventory", () => {
    const core_url = import.meta.env.MODE == 'development' ? 'http://localhost:3050' : 'https://movetrack-api-7hwn7ggbiq-uc.a.run.app'
    const url_suffix = import.meta.env.MODE == 'development' ? 'dev' : 'demo'

    // Helper function to get headers with auth token
    function getHeaders() {
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
                            picture_url: i.picture_url
                        }
                    })

                    containers.value = response.data.containers.map(i => {
                        return {
                            value: Number(i.id),
                            label: i.name,
                            collection: i.collection_id,
                            location: i.location_id,
                            active: false,
                            disable: !items.value.map(i => i.container).includes(Number(i.id))
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
                        return {
                            value: Number(i.id),
                            label: i.name,
                            description: i.description,
                            address: i.address,
                            address_2: i.address_2,
                            city: i.city,
                            state: i.state,
                            zip: i.zip,
                            disable: !items.value.map(i => i.location).includes(Number(i.id))
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
            .then(() => {
                if (activeCollection.value == undefined && collections.value.length > 0) {
                    setActiveCollection({ label: collections.value[0].label, value: collections.value[0].value})
                }
            })
    }

    function setActiveCollection(newCollection: {label: string, value: number}) {
        activeCollection.value = newCollection

        // If current active container is not in the new collection, then set it to undefined
        if (containers.value.find(i => i.value == activeContainer.value?.value)?.collection != newCollection.value) {
            setActiveContainer(undefined)
        }
    }

    function setActiveContainer(newContainer: {label: string, value: number} | undefined) {
        activeContainer.value = newContainer

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
            setActiveCollection({label: collections.value.find(i => i.value == containers.value.find(j => j.value == newContainer.value)?.collection)?.label, value: containers.value.find(i => i.value == newContainer.value)?.collection})
        }
    }

    async function createItem (user: string, name: string, description: string, quantity: number, collection: number, container?: number | undefined, location?: number | undefined, image?: Blob, estimatedValue?: number | null, fragile?: boolean, priority?: string, weightLbs?: number | null, dimensions?: string, notes?: string) {
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
                    url: core_url + '/file/upload/take-stock-item-photos/',
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
            setActiveCollection({label: collections.value.find(i => i.value == Number(collection)).label, value: collection})
            if (container !== undefined) {
                setActiveContainer({label: containers.value.find(i => i.value == Number(container)).label, value: container})
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

            setActiveCollection({label: collections.value.find(i => i.value == Number(collection)).label, value: collection})
            if (container != undefined) {
                setActiveContainer({label: containers.value.find(i => i.value == Number(container)).label, value: container})
            }
        })
    }

    async function updateItem (id: number, user: string, name: string, description: string, quantity: number, collection: number, container?: number | undefined, location?: number | undefined, picture_url?: string) {
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
        
        console.log('params are: ', params)

        const headers = await getHeaders();
        axios({
            method: 'put',
            url: core_url + '/items/update',
            params: params,
            headers: headers
        })
        .then(() => {
            const index = items.value.findIndex((i) => i.value == id)

            console.log('index is: ', index)
            console.log('items at index is: ', items.value[index])

            
            items.value[index].label = name
            items.value[index].collection = collection
            items.value[index].container = container ?? null
            items.value[index].location = location ?? null
            items.value[index].quantity = quantity
            items.value[index].description = description
            items.value[index].picture_url = picture_url ?? null


            console.log('items at index after update is: ', items.value[index])
        })
        .then(() => {
            setActiveCollection({label: collections.value.find(i => i.value == collection).label, value: collection})
            if (container != undefined) {

                console.log('container is: ', container)
                setActiveContainer({label: containers.value.find(i => i.value == container).label, value: container})
            }
        })
        .finally(() => {
            router.push('items')
        })
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
            const bucketName = 'take-stock-item-photos'
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

    async function createContainer (user: string, name: string, collection: number, location?: number, boxNumber?: string, boxType?: string, sealed?: boolean, weightLbs?: number | null, fragileContents?: boolean, colorCode?: string) {



        const parameters: any = {
            user: user,
            name: name,
            collection: collection,
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
                collection: collection,
                location: location ?? null,
                active: false,
                disable: false
            }

            // Update containers array
            containers.value.push(params)

            console.log('containers after push is: ', containers.value)

            // Update containerValues set
            containerValues.value?.push(Number(value.data[0].id))
            

            // Set the actives
            setActiveCollection({label: collections.value.find(i => i.value == collection).label, value: collection})
            setActiveContainer({label: name, value: Number(value.data[0].id)})
        })
        // .finally(() => {
        //     router.push('items')
        // })
    }

    async function updateContainer (id: number, user: string, name: string, collection: number, location?: number) {
        console.log('location in inventory store is: ', location)

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
            },
            headers: headers
        })
        .then(() => {
            // Update containers
            const index = containers.value.findIndex((i) => i.value == id)

            containers.value[index].label = name
            containers.value[index].collection = collection
            containers.value[index].location = location

            // Update items
            const tempItemsFilter = items.value.filter(i => i.container == id).map(j => j.value)

            tempItemsFilter.forEach(i => {
                items.value[items.value.findIndex(j => j.value == i)].container = id
                items.value[items.value.findIndex(j => j.value == i)].collection = collection
                items.value[items.value.findIndex(j => j.value == i)].location = location
            })
        })
        .then(() => {
            setActiveCollection({label: collections.value.find(i => i.value == Number(collection)).label, value: collection})
            setActiveContainer({label: containers.value.find(i => i.value == Number(id)).label, value: id})
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
            setActiveCollection({label: collections.value.find(i => i.value == value.data[0].id).label, value: value.data[0].id})
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
            setActiveCollection({label: collections.value.find(i => i.value == Number(id)).label, value: Number(id)})
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

    async function createLocation (user: string, name: string, description: string, address: string, address_2: string, city: string, state: string, zip: string) {
        let params: any = {
            user: user,
            name: name,
            description: description,
            address: address,
            address_2: address_2,
            city: city,
            state: state,
            zip: zip
        }
        
        const headers = await getHeaders();
        axios({
            method: 'post',
            url: core_url + '/locations/post',
            params: params,
            headers: headers
        })
        .then(async (value) => {
            locations.value.push({
                value: Number(value.data[0].id),
                label: name,
                description: description,
                address: address,
                address_2: address_2,
                city: city,
                state: state,
                zip: zip,
                disable: true
            })

            locationValues.value?.push(Number(value.data[0].id))

            console.log('locations is: ', locations.value)
        })
    }

    async function updateLocation (id: number, user: string, name: string, description: string, address: string, address_2: string, city: string, state: string, zip: string) {
        const headers = await getHeaders();
        axios({
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
              zip: zip
            },
            headers: headers
        })
        .then(() => {
            // Update locations array
            const index = locations.value.findIndex((i) => i.value == id)
            locations.value[index].label = name
            locations.value[index].description = description
            locations.value[index].address = address
            locations.value[index].address_2 = address_2
            locations.value[index].city = city
            locations.value[index].state = state
            locations.value[index].zip = zip

            // Update locationValues set
            if (!locationValues.value?.includes(id)) {
                locationValues.value?.push(id)
            }
        })
        .finally(() => {
            router.push('items')
        })
    }

    async function deleteLocation (id: number, user: string) {
        const headers = await getHeaders();
        axios({
            method: 'delete',
            url: core_url + '/locations/delete',
            params: {
              location_id: id
            },
            headers: headers
        })
        .then(() => {
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
        })
        .finally(() => {
            router.push('items')
        })
    }

    return { locations, collections, containers, items, 
        activeCollection, activeContainer, 
        locationValues, collectionValues, containerValues,
        
        loadInventory, setActiveCollection, setActiveContainer, 
        createItem, updateItem, deleteItem, createItemOutsideUrl,
        createContainer, updateContainer, deleteContainer,
        createCollection, updateCollection, deleteCollection,
        createLocation, updateLocation, deleteLocation,
    }
})
