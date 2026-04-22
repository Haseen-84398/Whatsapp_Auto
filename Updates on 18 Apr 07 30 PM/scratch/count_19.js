const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');

const SPREADSHEET_ID = '189cGMDqpEbeXm2DQDvbAuST8YXePwSgnS83-6PpkY-I';
const SHEET_NAME = 'Assessment Tracker';

async function getSheetsClient() {
    const auth = new GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    const client = await auth.getClient();
    return google.sheets({ version: 'v4', auth: client });
}

async function countForDate(targetDate) {
    const sheets = await getSheetsClient();
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${SHEET_NAME}'!A2:K`
    });

    const rows = response.data.values || [];
    const matches = rows.filter((row) => {
        const dateVal = row[10] || ''; // Column K
        return dateVal.includes(targetDate);
    });

    console.log(`\n📅 Date: ${targetDate}`);
    console.log(`📊 Total Batches: ${matches.length}`);
    matches.forEach((row, i) => {
        console.log(`${i + 1}. Batch ID: ${row[2]} | Sector: ${row[4]} | Status: ${row[5] || 'Empty'}`);
    });
}

countForDate('19/04/2026').catch(console.error);
