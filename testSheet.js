const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');

async function testAssessmentTracker() {
    const auth = new GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
    });
    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });

    const spreadsheetId = '189cGMDqpEbeXm2DQDvbAuST8YXePwSgnS83-6PpkY-I';
    const sheetName = 'Assessment Tracker';

    try {
        console.log(`🔍 Checking sheet: "${sheetName}"...`);

        const res = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `'${sheetName}'!A1:ZZ1` // Fetch all headers
        });

        if (res.data.values && res.data.values[0]) {
            console.log('✅ Success! Headers found:');
            console.log(JSON.stringify(res.data.values[0], null, 2));

            // Check for specific columns
            const headers = res.data.values[0];
            console.log('\n📊 Column Mapping Check:');
            console.log(`- Column C (Batch ID): ${headers[2] || 'Missing'}`);
            console.log(`- Column E (Sector): ${headers[4] || 'Missing'}`);
            console.log(`- Column F (Status): ${headers[5] || 'Missing'}`);
        } else {
            console.log(`❌ Sheet "${sheetName}" mili to hai par khali hai.`);
        }
    } catch (error) {
        console.error(`❌ Error: "${sheetName}" sheet nahi mili. Kripya check karein ki spelling sahi hai ya nahi.`);
        console.error('Details:', error.message);
    }
}

testAssessmentTracker();
