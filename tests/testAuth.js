const { GoogleAuth } = require('google-auth-library');

async function testAuth() {
    const auth = new GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/cloud-platform']
    });

    const client = await auth.getClient();
    const token = await client.getAccessToken();
    console.log('✅ Authentication successful!');
    console.log('Access Token:', token.token.substring(0, 30) + '...');
}

testAuth().catch(console.error);
