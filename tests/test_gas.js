const https = require('https');

function testGasPost(url, payload) {
    const urlObj = new URL(url);
    const options = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    };

    const req = https.request(options, (res) => {
        console.log(`Initial status: ${res.statusCode}`);
        if (res.statusCode === 302) {
            const redirectUrl = res.headers.location;
            console.log(`Redirecting to: ${redirectUrl}`);

            // Try GET
            const urlObj2 = new URL(redirectUrl);
            const options2 = {
                hostname: urlObj2.hostname,
                path: urlObj2.pathname + urlObj2.search,
                method: 'GET'
            };
            const req2 = https.request(options2, (res2) => {
                console.log(`Redirect GET status: ${res2.statusCode}`);
                let body = '';
                res2.on('data', (d) => (body += d));
                res2.on('end', () => console.log('Redirect GET body:', body));
            });
            req2.end();

            // Try POST
            const options3 = {
                hostname: urlObj2.hostname,
                path: urlObj2.pathname + urlObj2.search,
                method: 'POST'
            };
            const req3 = https.request(options3, (res3) => {
                console.log(`Redirect POST status: ${res3.statusCode}`);
            });
            req3.end();
        }
    });

    req.write(JSON.stringify(payload));
    req.end();
}

testGasPost(
    'https://script.google.com/macros/s/AKfycbxr1eHyqRNiBVH83ioZPA1M1VWOniZPE9Q0eUMlGrCeriP4snpURXpWHJ88c7viZWic/exec',
    { range: 'A1', value: 'test' }
);
