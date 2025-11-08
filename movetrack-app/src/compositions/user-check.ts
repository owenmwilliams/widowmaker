import axios from 'axios';

export default function useCheckUser() {
    // What does this function do? It should probably take the user_id 
    // input and check to see if authorized for that user id and if so, 
    // return it and if not return one for which they are authorized
    async function checkUser(user_name: string, user_id: string, token: string): Promise<String> {
        const core_url = import.meta.env.MODE == 'development' ? 'http://localhost:3050' : 'https://movetrack-api-7hwn7ggbiq-uc.a.run.app'
        const returnValue = await axios({
            method: 'get',
            url: core_url + '/users/',
            params: {
            user_id: user_id
            },
            headers: {
            Authorization: 'Bearer ' + token
            }
        })
        .then(response => {
            if (response.data == 'nodata') {
                return 'no-username-push-profile'
            } else if (!(response.data.user_name == user_name)) {
                return 'username-wrong-push-new-route'
            } else {
                return 'username-owned'
            }
        })
        
        return returnValue
    };

    async function returnUsername(user_id: string, token: string): Promise<String> {
        const core_url = import.meta.env.MODE == 'development' ? 'http://localhost:3050' : 'https://movetrack-api-7hwn7ggbiq-uc.a.run.app'
        const username = await axios({
            method: 'get',
            url: core_url + '/users/',
            params: {
            user_id: user_id
            },
            headers: {
            Authorization: 'Bearer ' + token
            }
        })
        .then(response => {
            if (!(response.data == 'nodata')) {
                return response.data.user_name
            }
        })
        return username
    }
    return { 
        checkUser,
        returnUsername
    }
}