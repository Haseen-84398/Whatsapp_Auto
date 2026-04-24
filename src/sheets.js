const https = require('https');
const http = require('http');

const SCRIPT_URL =
    'https://script.google.com/macros/s/AKfycbxr1eHyqRNiBVH83ioZPA1M1VWOniZPE9Q0eUMlGrCeriP4snpURXpWHJ88c7viZWic/exec';
const SHEET_NAME = 'Assessment Tracker';

function makeRequest(url, method = 'GET', data = null, maxRedirects = 5) {
    return new Promise((resolve, reject) => {
        if (maxRedirects <= 0) {
            return reject(new Error('Too many redirects'));
        }

        const urlObj = new URL(url);
        const transport = urlObj.protocol === 'https:' ? https : http;

        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method: method,
            headers: {
                'Content-Type': 'application/json'
            }
        };

        const req = transport.request(options, (res) => {
            // Handle Redirects (Google Apps Script always redirects)
            if (res.statusCode === 302 || res.statusCode === 301) {
                const redirectUrl = res.headers.location;
                // Consume response to free up socket
                res.resume();
                // Google Apps Script redirects POST to a GET url. Send GET without data.
                return makeRequest(redirectUrl, 'GET', null, maxRedirects - 1)
                    .then(resolve)
                    .catch(reject);
            }

            let body = '';
            res.on('data', (chunk) => (body += chunk));
            res.on('end', () => {
                try {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(body ? JSON.parse(body) : {});
                    } else {
                        reject(new Error(`Status ${res.statusCode}: ${body}`));
                    }
                } catch (e) {
                    resolve(body); // Return as string if not JSON
                }
            });
        });

        req.on('error', reject);
        req.setTimeout(30000, () => {
            req.destroy(new Error('Request timeout (30s)'));
        });
        if (data) req.write(JSON.stringify(data));
        req.end();
    });
}

async function fetchSheetData() {
    try {
        return await makeRequest(`${SCRIPT_URL}?action=fetch`);
    } catch (error) {
        console.error('❌ Error fetching data from Apps Script:', error.message);
        return [];
    }
}

async function updateSheetValue(range, value) {
    try {
        await makeRequest(SCRIPT_URL, 'POST', { range, value });
        return true;
    } catch (error) {
        console.error(`❌ Error updating sheet at ${range}:`, error.message);
        return false;
    }
}

function mapSectorToSSC(sector) {
    const s = sector.toLowerCase();
    if (s.includes('green jobs')) return 'SCGJ';
    if (s.includes('handicraft')) return 'HCSSC';
    if (s.includes('construction')) return 'CSDCI';
    if (s.includes('gems and jewellery')) return 'GJSCI';
    if (s.includes('media')) return 'MESC';
    return sector.substring(0, 5).toUpperCase();
}

function indexToColumnLetter(colIndex) {
    let letter = '';
    while (colIndex >= 0) {
        letter = String.fromCharCode((colIndex % 26) + 65) + letter;
        colIndex = Math.floor(colIndex / 26) - 1;
    }
    return letter;
}

function formatDate(dateStr) {
    if (!dateStr) return 'NoDate';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr.toString().replace(/[/\\?%*:|"<>]/g, '-');

    const day = d.getDate().toString().padStart(2, '0');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[d.getMonth()];
    return `${day}-${month}`;
}

function constructGroupName(batchId, sscShort, startDate, day) {
    const cleanDate = formatDate(startDate);
    return `${batchId}_${sscShort}_${cleanDate}_${day}`;
}

async function fetchPendingGroups() {
    const rows = await fetchSheetData();
    if (!rows || rows.length < 2) return [];

    const headers = rows[0].map((h) => (h ? h.toString().trim().toLowerCase() : ''));
    const idxBatchId = headers.findIndex((h) => h.includes('batch id'));
    const idxDay = headers.findIndex((h) => h === 'day');
    const idxSector = headers.findIndex((h) => h === 'sector');
    const idxStatus = headers.findIndex((h) => h.includes('group status') || h === 'status');
    const idxStartDate = headers.findIndex((h) => h.includes('assessment start date'));
    const idxAssessorMobile = headers.findIndex((h) => h.includes('assessor mobile number'));

    if (idxStatus === -1) {
        console.error('❌ "Group Status" column nahi mila!');
        return [];
    }

    const statusColLetter = indexToColumnLetter(idxStatus);
    const pendingGroups = [];

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const batchId = idxBatchId !== -1 ? row[idxBatchId] || '' : '';
        const day = idxDay !== -1 ? row[idxDay] || '' : '';
        const sector = idxSector !== -1 ? row[idxSector] || '' : '';
        const status = (row[idxStatus] || '').toString().trim().toLowerCase();
        const startDate = idxStartDate !== -1 ? row[idxStartDate] || '' : '';
        const assessorMobile = idxAssessorMobile !== -1 ? row[idxAssessorMobile] || '' : '';

        if (batchId && sector && status === 'pending') {
            const sscShort = mapSectorToSSC(sector);
            const groupName = constructGroupName(batchId, sscShort, startDate, day);

            pendingGroups.push({
                rowIndex: i + 1,
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
}

async function lockGroupAsCreating(rowIndex, colLetter) {
    const range = `'${SHEET_NAME}'!${colLetter}${rowIndex}`;
    await updateSheetValue(range, 'Creating...');
    console.log(`🔒 Row ${rowIndex} locked as 'Creating...'`);
}

async function markGroupAsCreated(rowIndex, colLetter) {
    const range = `'${SHEET_NAME}'!${colLetter}${rowIndex}`;
    await updateSheetValue(range, 'Created');
    console.log(`✅ Row ${rowIndex} marked as 'Created'`);
}

async function unlockGroupAsPending(rowIndex, colLetter) {
    const range = `'${SHEET_NAME}'!${colLetter}${rowIndex}`;
    await updateSheetValue(range, 'Pending');
    console.log(`🔓 Row ${rowIndex} unlocked to 'Pending'`);
}

async function fetchGroupsNeedingAttendance() {
    const rows = await fetchSheetData();
    if (!rows || rows.length < 2) return [];

    const headers = rows[0].map((h) => (h ? h.toString().trim().toLowerCase() : ''));
    const idxBatchId = headers.findIndex((h) => h.includes('batch id'));
    const idxStatus = headers.findIndex((h) => h.includes('group status') || h === 'status');
    const idxPresent = headers.findIndex((h) => h === 'present' || h.startsWith('present'));
    const idxStartDate = headers.findIndex((h) => h.includes('assessment start date'));
    const idxDay = headers.findIndex((h) => h === 'day');
    const idxSector = headers.findIndex((h) => h === 'sector');

    const needingReminder = [];
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const status = (row[idxStatus] || '').toString().trim().toLowerCase();
        const presentCount = (row[idxPresent] || '').toString().trim();
        const batchId = row[idxBatchId] || '';
        const sector = row[idxSector] || '';
        const startDate = row[idxStartDate] || '';
        const day = row[idxDay] || '';

        if (status === 'created' && (!presentCount || presentCount === '0' || presentCount === '')) {
            const sscShort = mapSectorToSSC(sector);
            const groupName = constructGroupName(batchId, sscShort, startDate, day);
            needingReminder.push({ batchId, groupName });
        }
    }
    return needingReminder;
}

async function fetchBatchAttendance(batchId) {
    const rows = await fetchSheetData();
    if (!rows || rows.length < 2) return null;

    const headers = rows[0].map((h) => (h ? h.toString().trim().toLowerCase() : ''));
    const idxBatchId = headers.findIndex((h) => h.includes('batch id'));
    const idxPresent = headers.findIndex((h) => h === 'present' || h.startsWith('present'));
    const idxAbsent = headers.findIndex((h) => h === 'absent' || h.startsWith('absent'));
    const idxMale = headers.findIndex((h) => h.includes('male'));
    const idxFemale = headers.findIndex((h) => h.includes('female'));

    if (idxBatchId === -1 || idxPresent === -1) return null;

    for (let i = 1; i < rows.length; i++) {
        const rowVal = rows[i][idxBatchId];
        if (rowVal && rowVal.toString().trim() === batchId.toString().trim()) {
            return {
                present: parseInt(rows[i][idxPresent] || '0'),
                absent: parseInt(rows[i][idxAbsent] || '0'),
                male: idxMale !== -1 ? parseInt(rows[i][idxMale] || '0') : 0,
                female: idxFemale !== -1 ? parseInt(rows[i][idxFemale] || '0') : 0
            };
        }
    }
    return null;
}


async function updateSheetAttendance(batchId, attendance) {
    const rows = await fetchSheetData();
    if (!rows || rows.length < 2) throw new Error('Sheet data nahi mila.');

    const headers = rows[0].map((h) => (h ? h.toString().trim().toLowerCase() : ''));
    const idxBatchId = headers.findIndex((h) => h.includes('batch id'));
    const idxTotal = headers.findIndex((h) => h.includes('total candidates') || h.includes('scheduled'));
    const idxPresent = headers.findIndex((h) => h === 'present' || h.startsWith('present'));
    const idxAbsent = headers.findIndex((h) => h === 'absent' || h.startsWith('absent'));
    const idxMale = headers.findIndex((h) => h.includes('male'));
    const idxFemale = headers.findIndex((h) => h.includes('female'));

    if (idxBatchId === -1 || idxPresent === -1 || idxAbsent === -1) {
        throw new Error('Sheet mein columns nahi mile.');
    }

    let rowIndex = -1;
    let totalCandidates = 0;
    for (let i = 1; i < rows.length; i++) {
        const rowVal = rows[i][idxBatchId];
        if (rowVal && rowVal.toString().trim() === batchId.toString().trim()) {
            rowIndex = i + 1;
            totalCandidates = parseInt(rows[i][idxTotal] || '0');
            break;
        }
    }

    if (rowIndex === -1) throw new Error(`Batch ID ${batchId} nahi mila.`);

    let p =
        attendance.present !== undefined
            ? parseInt(attendance.present)
            : parseInt(rows[rowIndex - 1][idxPresent] || '0');
    let a =
        attendance.absent !== undefined ? parseInt(attendance.absent) : parseInt(rows[rowIndex - 1][idxAbsent] || '0');
    let m = attendance.male !== undefined ? parseInt(attendance.male) : parseInt(rows[rowIndex - 1][idxMale] || '0');
    let f =
        attendance.female !== undefined ? parseInt(attendance.female) : parseInt(rows[rowIndex - 1][idxFemale] || '0');

    // Smart Adjustments
    if (totalCandidates > 0) {
        // If present is provided but absent is missing, calculate absent
        if (attendance.present !== undefined && attendance.absent === undefined) {
            a = totalCandidates - p;
        }
        // If absent is provided but present is missing, calculate present
        if (attendance.absent !== undefined && attendance.present === undefined) {
            p = totalCandidates - a;
        }
    }

    // Adjust Male/Female based on Present
    if (attendance.female !== undefined && attendance.male === undefined) {
        m = p - f;
    }
    if (attendance.male !== undefined && attendance.female === undefined) {
        f = p - m;
    }

    // Prevent negative numbers
    if (a < 0) a = 0;
    if (p < 0) p = 0;
    if (m < 0) m = 0;
    if (f < 0) f = 0;

    if (p + a > totalCandidates && totalCandidates > 0) {
        throw new Error(`Total candidates (${totalCandidates}) se zyada entry nahi ho sakti.`);
    }

    // Always update sheet with the final calculated values
    await updateSheetValue(`'${SHEET_NAME}'!${indexToColumnLetter(idxPresent)}${rowIndex}`, p);
    await updateSheetValue(`'${SHEET_NAME}'!${indexToColumnLetter(idxAbsent)}${rowIndex}`, a);
    if (idxMale !== -1) await updateSheetValue(`'${SHEET_NAME}'!${indexToColumnLetter(idxMale)}${rowIndex}`, m);
    if (idxFemale !== -1) await updateSheetValue(`'${SHEET_NAME}'!${indexToColumnLetter(idxFemale)}${rowIndex}`, f);

    return { success: true, total: totalCandidates, present: p, absent: a, male: m, female: f };
}

module.exports = {
    fetchPendingGroups,
    fetchGroupsNeedingAttendance,
    fetchBatchAttendance,
    lockGroupAsCreating,
    markGroupAsCreated,
    unlockGroupAsPending,
    updateSheetAttendance,
    fetchSheetData
};
