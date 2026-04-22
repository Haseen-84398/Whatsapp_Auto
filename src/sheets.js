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

// Helper to convert index (e.g. 5) to letter (e.g. 'F')
function indexToColumnLetter(colIndex) {
    let letter = '';
    while (colIndex >= 0) {
        letter = String.fromCharCode((colIndex % 26) + 65) + letter;
        colIndex = Math.floor(colIndex / 26) - 1;
    }
    return letter;
}

async function fetchPendingGroups() {
    const sheets = await getSheetsClient();
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `'${SHEET_NAME}'!A1:ZZ` // Fetch headers and all data
        });

        const rows = response.data.values || [];
        if (rows.length < 2) return []; // Empty or only headers

        const headers = rows[0].map((h) => (h ? h.toString().trim().toLowerCase() : ''));

        // Find indices dynamically
        const idxBatchId = headers.findIndex((h) => h.includes('batch id'));
        const idxDay = headers.findIndex((h) => h === 'day');
        const idxSector = headers.findIndex((h) => h === 'sector');
        const idxStatus = headers.findIndex((h) => h.includes('group status'));
        const idxStartDate = headers.findIndex((h) => h.includes('assessment start date'));
        const idxAssessorMobile = headers.findIndex((h) => h.includes('assessor mobile number'));

        if (idxStatus === -1) {
            console.error('❌ "Group Status" column nahi mila headers mein!');
            return [];
        }

        const statusColLetter = indexToColumnLetter(idxStatus);
        const pendingGroups = [];

        // Loop from row 1 (data)
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const batchId = idxBatchId !== -1 ? row[idxBatchId] || '' : '';
            const day = idxDay !== -1 ? row[idxDay] || '' : '';
            const sector = idxSector !== -1 ? row[idxSector] || '' : '';
            const status = row[idxStatus] || '';
            const startDate = idxStartDate !== -1 ? row[idxStartDate] || '' : '';
            const assessorMobile = idxAssessorMobile !== -1 ? row[idxAssessorMobile] || '' : '';

            // Sirf wahi rows jahan Status mein "Pending" likha ho
            if (batchId && sector && status.trim().toLowerCase() === 'pending') {
                const sscShort = mapSectorToSSC(sector);
                const groupName = `${batchId}_${sscShort}_${startDate}_${day}`;

                pendingGroups.push({
                    rowIndex: i + 1, // Excel row number (0-indexed + 1 = Excel row)
                    statusColLetter: statusColLetter,
                    groupName: groupName,
                    batchId: batchId,
                    day: day,
                    sector: sector,
                    assessorMobile: assessorMobile.toString().trim()
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
async function lockGroupAsCreating(rowIndex, colLetter) {
    const sheets = await getSheetsClient();
    try {
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `'${SHEET_NAME}'!${colLetter}${rowIndex}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: [['Creating...']]
            }
        });
        console.log(`🔒 Row ${rowIndex} (${colLetter}) LOCKED as 'Creating...'`);
    } catch (error) {
        console.error(`Error locking row ${rowIndex}:`, error);
    }
}

// SUCCESS: Group ban gaya, "Created" mark karo
async function markGroupAsCreated(rowIndex, colLetter) {
    const sheets = await getSheetsClient();
    try {
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `'${SHEET_NAME}'!${colLetter}${rowIndex}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: [['Created']]
            }
        });
        console.log(`✅ Row ${rowIndex} (${colLetter}) marked as Created in Google Sheet.`);
    } catch (error) {
        console.error(`Error updating row ${rowIndex}:`, error);
    }
}

// UNLOCK: Group nahi ban paaya, wapas "Pending" kar do taaki dusra system try kare
async function unlockGroupAsPending(rowIndex, colLetter) {
    const sheets = await getSheetsClient();
    try {
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `'${SHEET_NAME}'!${colLetter}${rowIndex}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: [['Pending']]
            }
        });
        console.log(`🔓 Row ${rowIndex} (${colLetter}) UNLOCKED back to 'Pending'.`);
    } catch (error) {
        console.error(`Error unlocking row ${rowIndex}:`, error);
    }
}
async function fetchGroupsNeedingAttendance() {
    const sheets = await getSheetsClient();
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `'${SHEET_NAME}'!A1:ZZ`
        });

        const rows = response.data.values || [];
        if (rows.length < 2) return [];

        const headers = rows[0].map((h) => (h ? h.toString().trim().toLowerCase() : ''));
        const idxBatchId = headers.findIndex((h) => h.includes('batch id'));
        const idxStatus = headers.findIndex((h) => h.includes('group status'));
        const idxPresent = headers.findIndex((h) => h === 'present' || h.startsWith('present'));
        const idxStartDate = headers.findIndex((h) => h.includes('assessment start date'));
        const idxDay = headers.findIndex((h) => h === 'day');
        const idxSector = headers.findIndex((h) => h === 'sector');

        const needingReminder = [];
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const status = (row[idxStatus] || '').trim().toLowerCase();
            const presentCount = (row[idxPresent] || '').trim();
            const batchId = row[idxBatchId] || '';
            const sector = row[idxSector] || '';
            const startDate = row[idxStartDate] || '';
            const day = row[idxDay] || '';

            // Agar Status 'Created' hai par 'Present' khali hai
            if (status === 'created' && (!presentCount || presentCount === '0' || presentCount === '')) {
                const sscShort = mapSectorToSSC(sector);
                const groupName = `${batchId}_${sscShort}_${startDate}_${day}`;
                needingReminder.push({
                    batchId,
                    groupName
                });
            }
        }
        return needingReminder;
    } catch (error) {
        console.error('Error fetching needing attendance:', error);
        return [];
    }
}

async function updateSheetAttendance(batchId, attendance) {
    const sheets = await getSheetsClient();
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `'${SHEET_NAME}'!A1:ZZ`
        });

        const rows = response.data.values || [];
        if (rows.length < 2) throw new Error('Sheet khali hai ya data nahi mila.');

        const headers = rows[0].map((h) => (h ? h.toString().trim().toLowerCase() : ''));

        const idxBatchId = headers.findIndex((h) => h.includes('batch id'));
        const idxTotal = headers.findIndex((h) => h.includes('total candidates') || h.includes('scheduled'));
        const idxPresent = headers.findIndex((h) => h === 'present' || h.startsWith('present'));
        const idxAbsent = headers.findIndex((h) => h === 'absent' || h.startsWith('absent'));
        const idxMale = headers.findIndex((h) => h.includes('male'));
        const idxFemale = headers.findIndex((h) => h.includes('female'));

        console.log(
            `📊 [Attendance Mapping] P: ${idxPresent}, A: ${idxAbsent}, M: ${idxMale}, F: ${idxFemale}, Total: ${idxTotal}`
        );

        if (idxBatchId === -1 || idxPresent === -1 || idxAbsent === -1) {
            throw new Error(
                `Sheet mein columns nahi mile (Present: ${idxPresent}, Absent: ${idxAbsent}, BatchID: ${idxBatchId})`
            );
        }

        // Find the correct row
        let rowIndex = -1;
        let totalCandidates = 0;
        for (let i = 1; i < rows.length; i++) {
            const rowVal = rows[i][idxBatchId];
            if (rowVal && rowVal.toString().trim() === batchId.toString().trim()) {
                rowIndex = i + 1; // 1-indexed for Excel
                totalCandidates = parseInt(rows[i][idxTotal] || '0');
                break;
            }
        }

        if (rowIndex === -1) throw new Error(`Batch ID ${batchId} sheet mein nahi mila.`);

        const p =
            attendance.present !== undefined
                ? parseInt(attendance.present)
                : parseInt(rows[rowIndex - 1][idxPresent] || '0');
        const a =
            attendance.absent !== undefined
                ? parseInt(attendance.absent)
                : parseInt(rows[rowIndex - 1][idxAbsent] || '0');
        const m =
            attendance.male !== undefined ? parseInt(attendance.male) : parseInt(rows[rowIndex - 1][idxMale] || '0');
        const f =
            attendance.female !== undefined
                ? parseInt(attendance.female)
                : parseInt(rows[rowIndex - 1][idxFemale] || '0');

        // Validation: Present + Absent <= Total Candidates
        if (p + a > totalCandidates && totalCandidates > 0) {
            throw new Error(
                `Total candidates (${totalCandidates}) se zyada entry nahi ho sakti. (Current/New Total: P:${p} + A:${a} = ${p + a})`
            );
        }

        // Prepare updates (ONLY for provided fields to save API calls and avoid overwriting with defaults)
        const updates = [];
        if (attendance.present !== undefined)
            updates.push({ range: `'${SHEET_NAME}'!${indexToColumnLetter(idxPresent)}${rowIndex}`, val: p });
        if (attendance.absent !== undefined)
            updates.push({ range: `'${SHEET_NAME}'!${indexToColumnLetter(idxAbsent)}${rowIndex}`, val: a });
        if (attendance.male !== undefined && idxMale !== -1)
            updates.push({ range: `'${SHEET_NAME}'!${indexToColumnLetter(idxMale)}${rowIndex}`, val: m });
        if (attendance.female !== undefined && idxFemale !== -1)
            updates.push({ range: `'${SHEET_NAME}'!${indexToColumnLetter(idxFemale)}${rowIndex}`, val: f });

        for (const update of updates) {
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: update.range,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [[update.val]] }
            });
        }

        return { success: true, total: totalCandidates, present: p, absent: a, male: m, female: f };
    } catch (error) {
        console.error('Attendance Update Error:', error.message);
        throw error;
    }
}

module.exports = {
    fetchPendingGroups,
    fetchGroupsNeedingAttendance,
    lockGroupAsCreating,
    markGroupAsCreated,
    unlockGroupAsPending,
    updateSheetAttendance
};
