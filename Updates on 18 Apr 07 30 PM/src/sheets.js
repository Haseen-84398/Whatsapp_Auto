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

function mapSectorToSSC(sector) {
    const s = sector.toLowerCase();
    if (s.includes('green jobs')) return 'SCGJ';
    if (s.includes('handicraft')) return 'HCSSC';
    if (s.includes('construction')) return 'CSDCI';
    if (s.includes('gems and jewellery')) return 'GJSCI';
    if (s.includes('media')) return 'MESC';
    return sector.substring(0, 5).toUpperCase(); // Fallback
}

async function fetchPendingGroups() {
    const sheets = await getSheetsClient();
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `'${SHEET_NAME}'!A2:K` // Fetch from A to K
        });

        const rows = response.data.values || [];
        const pendingGroups = [];

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const batchId = row[2] || ''; // Column C
            const day = row[3] || ''; // Column D
            const sector = row[4] || ''; // Column E
            const status = row[5] || ''; // Column F (Group Status)
            const colK = row[10] || ''; // Column K

            // Sirf wahi rows jahan Column F mein "Pending" likha ho
            if (batchId && sector && status.trim().toLowerCase() === 'pending') {
                const sscShort = mapSectorToSSC(sector);
                const groupName = `${batchId}_${sscShort}_${colK}_${day}`;

                pendingGroups.push({
                    rowIndex: i + 2, // Excel row number
                    groupName: groupName,
                    batchId: batchId,
                    day: day,
                    sector: sector
                });
            }
        }
        return pendingGroups;
    } catch (error) {
        console.error('Error reading sheet:', error);
        return [];
    }
}

// LOCK: Turant "Creating..." likh do taaki dusre systems duplicate na banayein
async function lockGroupAsCreating(rowIndex) {
    const sheets = await getSheetsClient();
    try {
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `'${SHEET_NAME}'!F${rowIndex}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: [['Creating...']]
            }
        });
        console.log(`🔒 Row ${rowIndex} LOCKED as 'Creating...'`);
    } catch (error) {
        console.error(`Error locking row ${rowIndex}:`, error);
    }
}

// SUCCESS: Group ban gaya, "Created" mark karo
async function markGroupAsCreated(rowIndex) {
    const sheets = await getSheetsClient();
    try {
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `'${SHEET_NAME}'!F${rowIndex}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: [['Created']]
            }
        });
        console.log(`✅ Row ${rowIndex} marked as Created in Google Sheet.`);
    } catch (error) {
        console.error(`Error updating row ${rowIndex}:`, error);
    }
}

// UNLOCK: Group nahi ban paaya, wapas "Pending" kar do taaki dusra system try kare
async function unlockGroupAsPending(rowIndex) {
    const sheets = await getSheetsClient();
    try {
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `'${SHEET_NAME}'!F${rowIndex}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: [['Pending']]
            }
        });
        console.log(`🔓 Row ${rowIndex} UNLOCKED back to 'Pending'.`);
    } catch (error) {
        console.error(`Error unlocking row ${rowIndex}:`, error);
    }
}

module.exports = {
    fetchPendingGroups,
    lockGroupAsCreating,
    markGroupAsCreated,
    unlockGroupAsPending
};
