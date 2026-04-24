require('dotenv').config();
const {
    default: makeWASocket,
    useMultiFileAuthState,
    downloadMediaMessage,
    DisconnectReason,
    Browsers,
    fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const fs = require('fs');
const pino = require('pino');
const path = require('path');
const qrcode = require('qrcode-terminal');
const { Boom } = require('@hapi/boom');
const mime = require('mime-types');
const https = require('https');
const { exec } = require('child_process');
// const { GoogleGenerativeAI } = require('@google/generative-ai'); // Removed Gemini
const {
    fetchPendingGroups,
    fetchGroupsNeedingAttendance,
    fetchBatchAttendance,
    lockGroupAsCreating,
    markGroupAsCreated,
    unlockGroupAsPending,
    updateSheetAttendance
} = require('./sheets');

// === TIMER & STATE MANAGEMENT ===
const activeTimers = {
    autoSync: null,
    attendanceReminder: null,
    dailyReport: null,
    reconnect: null
};

function clearAllTimers() {
    if (activeTimers.autoSync) clearInterval(activeTimers.autoSync);
    if (activeTimers.attendanceReminder) clearTimeout(activeTimers.attendanceReminder);
    if (activeTimers.dailyReport) clearTimeout(activeTimers.dailyReport);
    if (activeTimers.reconnect) clearTimeout(activeTimers.reconnect);

    activeTimers.autoSync = null;
    activeTimers.attendanceReminder = null;
    activeTimers.dailyReport = null;
    activeTimers.reconnect = null;
}

// === GROQ AI CONFIGURATION ===
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const AI_MODEL = process.env.AI_MODEL || 'llama-3.3-70b-versatile';
const KNOWLEDGE_BASE_PATH = path.join(__dirname, 'knowledge_base.json');

// Admin numbers — bot will NOT reply to these (they manage the bot)
const BOT_ADMIN_NUMBERS = [
    '918006685100@s.whatsapp.net',
    '918006133100@s.whatsapp.net',
    '918448758878@s.whatsapp.net',
    '918006134100@s.whatsapp.net',
    '916203620962@s.whatsapp.net',
    '919226816244@s.whatsapp.net'
];

// Load knowledge base from file (reads fresh every time so edits are instant)
function loadKnowledgeBase() {
    try {
        const raw = fs.readFileSync(KNOWLEDGE_BASE_PATH, 'utf-8');
        return JSON.parse(raw);
    } catch (err) {
        console.error('❌ Knowledge base load error:', err.message);
        return null;
    }
}

// Build system prompt dynamically from knowledge_base.json
function buildSystemPrompt() {
    const kb = loadKnowledgeBase();
    if (!kb) return null;

    let qaSection = '';
    for (const qa of kb.qa_pairs) {
        qaSection += `\nQ: ${qa.topic} (triggers: ${qa.triggers.join(', ')})\nA: ${qa.answer}\n`;
    }

    return `You are '${kb.bot_name}'. You work ONLY for ${kb.company}.

CRITICAL RULES:
${kb.instructions.map((inst, i) => `${i + 1}. ${inst}`).join('\n')}

If a question is not covered in the knowledge base below, reply EXACTLY:
"${kb.fallback_reply}"

KNOWLEDGE BASE:
${qaSection}

LANGUAGE RULE: Always reply in ${kb.language}. Never use markdown formatting (no *, no **, no bullets). Keep responses natural and conversational.`;
}

// Groq API call function (OpenAI Compatible)
function callAI(userMessage) {
    return new Promise((resolve, reject) => {
        const systemPrompt = buildSystemPrompt();
        if (!systemPrompt) {
            reject(new Error('Knowledge base not loaded'));
            return;
        }

        const data = JSON.stringify({
            model: AI_MODEL,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userMessage }
            ]
        });

        const options = {
            hostname: 'api.groq.com',
            path: '/openai/v1/chat/completions',
            method: 'POST',
            headers: {
                Authorization: `Bearer ${GROQ_API_KEY}`,
                'Content-Type': 'application/json'
            }
        };

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', (d) => (body += d));
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(body);
                    if (parsed.choices && parsed.choices[0]) {
                        resolve(parsed.choices[0].message.content);
                    } else {
                        reject(new Error('No AI response: ' + body));
                    }
                } catch (e) {
                    reject(new Error('Parse error: ' + body));
                }
            });
        });

        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

// Check if sender is a bot admin (skip AI reply for admins)
function isBotAdmin(senderJid) {
    return BOT_ADMIN_NUMBERS.includes(senderJid);
}

// === AI VISION FUNCTION (Placeholder for Groq - currently limited) ===
function callAIWithImage(base64Image, prompt, mimeType = 'image/jpeg') {
    return Promise.resolve('AI Vision features are currently being updated for Groq.');
}

// Group names ko baar-baar fetch na karna pade isliye cache
const groupCache = new Map();

// Media Categorization Modes
const chatModes = new Map();
const modeCounters = new Map();
const pendingRenames = new Map(); // Question Message ID -> File Path cache

// === ATTENDANCE TRACKER (For Multi-Day Batches) ===
const ATTENDANCE_FILE = path.join(__dirname, 'attendance_tracking.json');

function getAttendanceTracker() {
    if (fs.existsSync(ATTENDANCE_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(ATTENDANCE_FILE, 'utf8'));
        } catch (e) {
            return {};
        }
    }
    return {};
}

function saveAttendanceTracker(data) {
    fs.writeFileSync(ATTENDANCE_FILE, JSON.stringify(data, null, 2));
}

// === DAILY STATS TRACKING (Feature 2) ===
const dailyStats = {
    date: new Date().toDateString(),
    groupsCreated: 0,
    mediaSaved: 0,
    messagesSaved: 0,
    qualityWarnings: 0,
    reset() {
        const today = new Date().toDateString();
        if (this.date !== today) {
            this.groupsCreated = 0;
            this.mediaSaved = 0;
            this.messagesSaved = 0;
            this.qualityWarnings = 0;
            this.date = today;
        }
    }
};

// === EVIDENCE COMPLETENESS TRACKER (Feature 4) ===
const evidenceTracker = new Map(); // groupJid -> { arrival: false, infrastructure: false, ... }
const EVIDENCE_CATEGORIES = [
    'Arrival_Photo',
    'Infrastructure',
    'Aadhaar_Holding',
    'Theory_Session',
    'Practical_Session',
    'Viva_Session',
    'Group_Photo',
    'Assessor_Out'
];

function getOrCreateEvidenceRecord(groupJid) {
    if (!evidenceTracker.has(groupJid)) {
        const record = {};
        EVIDENCE_CATEGORIES.forEach((cat) => (record[cat] = 0));
        evidenceTracker.set(groupJid, record);
    }
    return evidenceTracker.get(groupJid);
}

function markEvidence(groupJid, category) {
    const record = getOrCreateEvidenceRecord(groupJid);
    // Map AI category to evidence category
    const mapping = {
        Aadhaar_Holding: 'Aadhaar_Holding',
        Group_Photo: 'Group_Photo',
        Theory_Photo: 'Theory_Session',
        Theory_Video: 'Theory_Session',
        Practical_Photo: 'Practical_Session',
        Practical_Video: 'Practical_Session',
        Viva_Photo: 'Viva_Session',
        Viva_Video: 'Viva_Session',
        Arrival_Photo: 'Arrival_Photo',
        Infrastructure: 'Infrastructure',
        Assessor_Out: 'Assessor_Out',
        Document: null // Documents are not evidence categories
    };
    const evidenceCat = mapping[category];
    if (evidenceCat && record[evidenceCat] !== undefined) {
        record[evidenceCat]++;
    }
}

// === SAFETY: Daily Group Creation Limiter ===
const MAX_GROUPS_PER_DAY = 10;
const GROUP_COOLDOWN_MS = 3 * 60 * 1000; // 3 minute gap between groups
let dailyGroupCount = 0;
let lastGroupDate = new Date().toDateString();
let lastGroupCreatedAt = 0; // timestamp of last group creation

// === MULTI-BOT: Admin Control Group ===
// Ye group ID set karo jab group ban jaye (format: 120363XXXXXXXXX@g.us)
// Agar koi command is group mein aayega, toh jo bot pehle online hai wo handle karega
const ADMIN_GROUP_JID = ''; // <-- Group banne ke baad yahan ID paste karo

// Processed commands tracker — taaki same command 2 bots execute na karein
const processedCommands = new Set();
const COMMAND_CACHE_LIMIT = 500; // Memory overflow se bachne ke liye

function isCommandAlreadyProcessed(messageId) {
    if (processedCommands.has(messageId)) return true;
    processedCommands.add(messageId);
    // Purane entries hata do agar limit cross ho jaye
    if (processedCommands.size > COMMAND_CACHE_LIMIT) {
        const first = processedCommands.values().next().value;
        processedCommands.delete(first);
    }
    return false;
}

function canCreateGroup() {
    // Reset counter if new day
    const today = new Date().toDateString();
    if (today !== lastGroupDate) {
        dailyGroupCount = 0;
        lastGroupDate = today;
    }
    if (dailyGroupCount >= MAX_GROUPS_PER_DAY) {
        console.log(`🚫 Daily limit reached (${MAX_GROUPS_PER_DAY} groups). Kal phir try karna.`);
        return false;
    }
    return true;
}

async function waitForCooldown() {
    const elapsed = Date.now() - lastGroupCreatedAt;
    if (lastGroupCreatedAt > 0 && elapsed < GROUP_COOLDOWN_MS) {
        const waitTime = GROUP_COOLDOWN_MS - elapsed;
        console.log(`⏳ Cooldown: ${Math.ceil(waitTime / 1000)} seconds wait...`);
        await new Promise((r) => setTimeout(r, waitTime));
    }
}

function recordGroupCreation() {
    dailyGroupCount++;
    lastGroupCreatedAt = Date.now();
    console.log(`📊 Daily count: ${dailyGroupCount}/${MAX_GROUPS_PER_DAY}`);
}

// ==== GROUP GUIDELINES TEMPLATES ====
const BATCH_GUIDELINES = {
    SCGJ: {
        text: `*Official Assessment Guidelines | Cee Vision Technologies*
Welcome to the Cee Vision Technologies Assessment Team.

This group has been created to ensure smooth coordination and high-quality standards for our upcoming assessments. As an Assessor, it is mandatory to follow the specific evidence collection and documentation protocols mentioned below. Please ensure all data is captured accurately to avoid any issues with the validation or payment process.

📌 *Important Instructions*
1. Assessor Arrival Photo: Take a photo of the Assessor immediately upon arrival at the center.

2. Infrastructure Photos: Capture clear photos of the Center, Tools, and Equipment available for the assessment.

3. Trainer Verification: Ensure the Trainer’s certificate is collected and verified.

4. Candidate Identification: Capture photographs of all present candidates holding their Aadhaar Cards. Ensure that the Aadhaar details are clearly visible in the photos.

5. Theory Session: Capture photos and videos of the Theory session. Ensure all candidates are visible and each candidate has a pen and paper. (Extract 4–5 photos from each recorded video as supporting evidence).

6. Viva (Oral Assessment): Capture Viva photos and videos. Ensure 3–4 candidates are included in each video and the audio is clearly audible. (Extract 4–5 photos from each video).

7. Practical Session: Capture photos and videos of the Practical session. Ensure 4–5 candidates are demonstrating practical tasks in each video. (Extract 4–5 photos from each video).

8. Group Photo: Capture a group photo including all Candidates, SPOC, Trainer, and Assessor. Ensure the Assessor, Trainer, and SPOC are holding their respective identification tags clearly.

9. Attendance Management: Maintain a proper Attendance Sheet for all candidates. It must include Candidate signatures, Assessor name and signature, and the TP signature along with an official stamp.

📌 *Document Collection: Collect all required documents from the center after the assessment, including*:

i). VTP/TP Feedback Form
ii). Assessor Feedback Form
iii). Candidate Feedback Forms
iv). Assessor-Out Photo: Take a final "Assessor-Out" photo after the completion of all tasks.

⚠️ *Key Requirements*
Video Duration: Each video must have a duration of more than 2 minutes.

Photo Extraction: Ensure 4–5 clear photographs are extracted from every video for documentation purposes.

Approval Policy: Ensure that no candidate is permitted to leave the center without receiving prior confirmation/approval from the operations team.

*Regards, Operations Team Cee Vision Technologies*`,
        folder: 'SCGJ',
        documents: [
            { file: "Assessor's Feedback Form.pdf", displayName: 'Assessor Feedback Form.pdf' },
            { file: 'Candidate Feedback Form.pdf', displayName: 'Candidate Feedback Form.pdf' },
            { file: 'SCGJ VTP Declaration.pdf', displayName: 'SCGJ VTP Declaration.pdf' },
            { file: 'TP LETTER.pdf', displayName: 'TP LETTER.pdf' }
        ]
    },

    HCSSC: {
        text: `🏺 Welcome to the Handicraft SSC (HCSSC) Batch!\n\nGuidelines:\n1. Be creative and respectful.\n2. Daily updates are mandatory.\n3. No unrelated forwards.`,
        folder: 'HCSSC',
        documents: [
            { file: 'Assessment Plan.pdf', displayName: 'Assessment Plan.pdf' },
            { file: 'Assessor Feedback Form.pdf', displayName: 'Assessor Feedback Form.pdf' },
            { file: 'New VTP Feedback Form.pdf', displayName: 'New VTP Feedback Form.pdf' },
            { file: 'Trainee Feedback Form.pdf', displayName: 'Trainee Feedback Form.pdf' }
        ]
    },

    CSDCI: {
        text: `*Official Assessment Guidelines | Cee Vision Technologies*
Welcome to the Cee Vision Technologies Assessment Team.

This group has been created to ensure smooth coordination and high-quality standards for our upcoming assessments. As an Assessor, it is mandatory to follow the specific evidence collection and documentation protocols mentioned below. Please ensure all data is captured accurately to avoid any issues with the validation or payment process.

📸 *Assessment Evidence Guidelines for Assessors*
1. Center Reaching Photos: Capture clear photos upon arrival at the assessment center.

2. Tools & Infrastructure Photos: Minimum of 12 clear photos covering all tools, equipment, and infrastructure available at the center.

3. Tagging of Each Candidate: Each candidate must be tagged as per the attendance sheet for verification purposes.

4. Individual Candidate Photos: Each candidate must be photographed holding their Aadhaar Card. Tag them with their serial number as per the attendance sheet; ensure Aadhaar details are clearly visible in the photo.

5. Theory Session Photos & Video: Record a 2-minute video of the theory session with the assessor present (all candidates need to be captured).

6. Minimum of 12 photos capturing the theory session with the assessor included in the frame.

7. Practical Session Videos: Record practical videos of each group while they are performing their assigned NOS tasks (2-minute video per group). Each group needs to perform a practical on each NOS.

8. Group Photo: One group photo with all candidates clearly visible, tagged with attendance sheet Serial Numbers, and the center banner displayed. (Assessor and Trainer must be present in the photo).

9. Center Leaving Photos: Capture photos at the end of the assessment showing at least 8 hours of presence at the center.


📄 *Required Documents to be Collected by the Assessor*
Please ensure the following documents are collected, signed, and stamped properly:

i) Assessment Planning Sheet – Pre-approved plan for conducting the assessment.

ii) Attendance Sheet – Signed by candidates and assessor with TP (Training Partner) Stamp & Signature.

iii) Training Center (TC) Feedback Form – Feedback from the center with TP stamp.

iv) Assessor Feedback Form – Self-observation and remarks from the assessor.

v). Trainee Feedback Forms – Feedback from the candidates on the assessment process with the TP stamp.

vi). Question Papers – Used during the theory session.

vii). Tools & Equipment List – As per job role and NOS with TP Stamp & Signature.

viii). Practical Summary Sheet – Practical summary of candidate performance.

ix). AEBAS Attendance Record – Biometric attendance with TP Stamp & Signature.

*Note: Ensure all uploaded images and videos are of high quality. Failure to provide any of the above evidence may result in the assessment being marked as invalid.*

Best regards,

Operations Team Cee Vision Technologies`,
        folder: 'CSDCI',
        documents: [
            { file: 'Assessment Plan.pdf', displayName: 'Assessment Plan.pdf' },
            { file: 'Assessor Feedback Form.pdf', displayName: 'Assessor Feedback Form.pdf' },
            { file: 'New VTP Feedback Form.pdf', displayName: 'New VTP Feedback Form.pdf' },
            { file: 'Trainee Feedback Form.pdf', displayName: 'Trainee Feedback Form.pdf' }
        ]
    },

    MESC: {
        text: `*Official Assessment Guidelines | Cee Vision Technologies*
Welcome to the Cee Vision Technologies Assessment Team.

This group has been created to ensure smooth coordination and high-quality standards for our upcoming assessments. As an Assessor, it is mandatory to follow the specific evidence collection and documentation protocols mentioned below. Please ensure all data is captured accurately to avoid any issues with the validation or payment process.

📌 *Important Instructions*
1. Assessor Arrival Photo: Take a photo of the Assessor immediately upon arrival at the center.

2. Infrastructure Photos: Capture clear photos of the Center, Tools, and Equipment available for the assessment.

3. Trainer Verification: Ensure the Trainer’s certificate is collected and verified.

4. Candidate Identification: Capture photographs of all present candidates holding their Aadhaar Cards. Ensure that the Aadhaar details are clearly visible in the photos.

5. Theory Session: Capture photos and videos of the Theory session. Ensure all candidates are visible and each candidate has a pen and paper. (Extract 4–5 photos from each recorded video as supporting evidence).

6. Viva (Oral Assessment): Capture Viva photos and videos. Ensure 3–4 candidates are included in each video and the audio is clearly audible. (Extract 4–5 photos from each video).

7. Practical Session: Capture photos and videos of the Practical session. Ensure 4–5 candidates are demonstrating practical tasks in each video. (Extract 4–5 photos from each video).

8. Group Photo: Capture a group photo including all Candidates, SPOC, Trainer, and Assessor. Ensure the Assessor, Trainer, and SPOC are holding their respective identification tags clearly.

9. Attendance Management: Maintain a proper Attendance Sheet for all candidates. It must include Candidate signatures, Assessor name and signature, and the TP signature along with an official stamp.

📌 *Document Collection: Collect all required documents from the center after the assessment, including*:

i). VTP/TP Feedback Form
ii). Assessor Feedback Form
iii). Candidate Feedback Forms
iv). Assessor-Out Photo: Take a final "Assessor-Out" photo after the completion of all tasks.

⚠️ *Key Requirements*
Video Duration: Each video must have a duration of more than 2 minutes.

Photo Extraction: Ensure 4–5 clear photographs are extracted from every video for documentation purposes.

Approval Policy: Ensure that no candidate is permitted to leave the center without receiving prior confirmation/approval from the operations team.

*Regards, Operations Team Cee Vision Technologies*`,
        folder: 'MESC',
        documents: [
            { file: 'Assessor_s Feedback Form.pdf', displayName: 'Assessor Feedback Form.pdf' },
            { file: 'Candidate Feedback Form.pdf', displayName: 'Candidate Feedback Form.pdf' },
            { file: 'MESC VTP Declaration.pdf', displayName: 'MESC VTP Declaration.pdf' },
            {
                file: 'Training Partner Report on Assessment Conducted.pdf',
                displayName: 'Training Partner Report on Assessment Conducted.pdf'
            }
        ]
    },

    GJSCI: {
        text: `💎 Welcome to the Gems & Jewellery SSC (GJSCI) Batch!\n\nGuidelines:\n1. Precision & respect are key.\n2. Update assignments timely.\n3. Follow admin instructions.`,
        folder: 'CSDCI',
        documents: [
            { file: 'Assessment Plan.pdf', displayName: 'Assessment Plan.pdf' },
            { file: 'Assessor Feedback Form.pdf', displayName: 'Assessor Feedback Form.pdf' },
            { file: 'New VTP Feedback Form.pdf', displayName: 'New VTP Feedback Form.pdf' },
            { file: 'Trainee Feedback Form.pdf', displayName: 'Trainee Feedback Form.pdf' }
        ]
    },

    PM_VISHWAKARMA: {
        text: `*Official Assessment Guidelines | Cee Vision Technologies.*
*PM-Vishwakarma Batch Evidence & Documentation Requirements*

Welcome to the Cee Vision Technologies Assessment Team. To ensure a smooth validation process and timely payments, all Assessors must strictly follow these updated protocols for the Vishwakarma Batch.

📸 *Mandatory Photographic & Video Evidence*
All photos and videos must be captured using a Timestamp & Geo-tag Camera App.

1. *Center & Infrastructure:*
   - Capture at least 4–5 photos and a video (minimum 2 minutes) of the Center.
   - Include clear photos and a 2-minute video of the Tools, Equipment, and Materials available for the practical session.

2. *Theory Session:*
   - Capture 4–5 photos and a video (minimum 2 minutes). Ensure all candidates are visible and seated properly.

3. *Practical & Viva Sessions:*
   - *Practical:* Record a 2-minute video for each group (groups of 2–3 candidates). Extract 4–5 photos from each video.
   - *Viva (Oral):* Record a 2-minute video for each group (groups of 2–3 candidates). Extract 4–5 photos from each video.
   - *Audio Quality:* Ensure the candidate's voice is clearly audible in all Viva recordings.

4. *Candidate Identification:*
   - Capture a photo of each candidate holding their Aadhaar Card. The Aadhaar details and the candidate's face must be perfectly clear and visible.

5. *Branding & Group Photos:*
   - *Center Branding:* Clear photo of the center's branding/signage.
   - *Assessor Presence:* A photo of the Assessor with the Center Banner.
   - *Group Photo:* One final group photo with all candidates, ensuring everyone is clearly visible.
   - *Center Leaving Photo:* A final "Assessor-Out" photo must be taken after the assessment is fully completed.

📄 *Document Collection Checklist*
Collect the following documents from the center before leaving:
- Attendance Sheet: Must be duly signed and stamped by the Training Partner (TP) and signed by the Assessor.
- Assessor Invoice: Fully filled and signed.
- Feedback Forms: (If applicable) VTP, Assessor, and Candidate feedback.

⚠️ *Critical Compliance Rules*
- *Video Length:* Every session video (Theory, Practical, and Viva) must be 2 minutes or longer.
- *Geo-Tagging:* Every single piece of evidence (photo or video) must have a Geo-tag and Timestamp.
- *Photo Extraction:* You are required to extract 4–5 clear still photos from every video recorded for documentation.
- *Approval Policy:* No candidate is permitted to leave the center until the Assessor receives prior confirmation or approval from the Cee Vision Operations Team.

*Regards, Operations Team Cee Vision Technologies*`,
        folder: '',
        documents: []
    },

    default: {
        text: `👋 Welcome to the Training Batch!\n\nGuidelines:\n1. Be respectful to peers and instructors.\n2. Do NOT spam or send unnecessary forwards.\n3. Strictly follow admin instructions.`,
        folder: '',
        documents: []
    }
};
// ===================================

const COMPANY_ADDRESS_APPENDIX = `

📬 *Courier Address for Hard Copies:*
Pls courier hard copy of pending documents:
Priya
Cee Vision Technologies Pvt. Ltd.
A-173, sector 43,
Noida, Uttar Pradesh – 201303
    Mb. 84487 58878`;

// Removed duplicate getGuidelinesForTitle and sendGuidelines functions.

// --- REUSABLE FUNCTION: Send Guidelines & Documents ---
async function sendGroupGuidelines(jid, groupName, sock) {
    try {
        let selectedConfig = BATCH_GUIDELINES['default'];
        const upperTitle = (groupName || '').toUpperCase();

        // 1. Determine SSC Configuration
        if (upperTitle.includes('SCGJ')) {
            selectedConfig = BATCH_GUIDELINES['SCGJ'];
        } else if (upperTitle.includes('HCSSC')) {
            selectedConfig = BATCH_GUIDELINES['HCSSC'];
        } else if (upperTitle.includes('CSDCI')) {
            selectedConfig = BATCH_GUIDELINES['CSDCI'];
        } else if (upperTitle.includes('MESC')) {
            selectedConfig = BATCH_GUIDELINES['MESC'];
        } else if (upperTitle.includes('GJSCI')) {
            selectedConfig = BATCH_GUIDELINES['GJSCI'];
        }

        // PM-Vishwakarma Special Case
        if (
            (upperTitle.includes('HCSSC') || upperTitle.includes('GJSCI')) &&
            (upperTitle.includes('DAY 0') || upperTitle.includes('DAY 6'))
        ) {
            selectedConfig = BATCH_GUIDELINES['PM_VISHWAKARMA'];
        }

        // 2. Send Guidelines Text
        if (selectedConfig.text) {
            const footer = typeof COMPANY_ADDRESS_APPENDIX !== 'undefined' ? COMPANY_ADDRESS_APPENDIX : '';
            await sock.sendMessage(jid, { text: selectedConfig.text + footer });
            console.log(`📜 Guidelines sent to: ${jid} (${groupName})`);
        }

        // 3. Collect Documents
        let docsToSend = [];
        if (selectedConfig.folder) {
            const folderPath = path.join(process.cwd(), 'ssc_documents', selectedConfig.folder);
            if (fs.existsSync(folderPath)) {
                const files = fs.readdirSync(folderPath).filter((f) => {
                    const ext = path.extname(f).toLowerCase();
                    return ['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png'].includes(ext);
                });
                docsToSend = files.map((f) => ({
                    file: path.join(folderPath, f),
                    displayName: f,
                    isAbsolutePath: true
                }));
            }
        }

        // Fallback to static documents if folder is empty or not defined
        if (docsToSend.length === 0) {
            docsToSend = selectedConfig.documents || [];
        }

        // 4. Send Documents
        for (const docObj of docsToSend) {
            const docPath = docObj.isAbsolutePath
                ? docObj.file
                : path.join(process.cwd(), 'ssc_documents', selectedConfig.folder || '', docObj.file);

            if (fs.existsSync(docPath)) {
                await sock.sendMessage(jid, {
                    document: fs.readFileSync(docPath),
                    mimetype: 'application/pdf',
                    fileName: docObj.displayName || path.basename(docPath)
                });
                await new Promise((r) => setTimeout(r, 1000)); // Delay between docs
            }
        }
    } catch (err) {
        console.error(`❌ Error sending guidelines to ${jid}:`, err.message);
    }
}

async function processMessage(m, sock) {
    if (!m.message) return;

    // Default skip own messages UNLESS it's an attendance update or a command
    // This allows the user to type attendance manually on the same phone.
    const tempText = m.message.conversation || m.message.extendedTextMessage?.text || '';

    // Check if this is a bot-generated message (to prevent infinite loops)
    const isBotMessage = tempText.includes('Attendance Logged') || 
                         tempText.includes('Total Scheduled') || 
                         tempText.includes('Attendance Reminder!') ||
                         tempText.includes('Please Share attendance') ||
                         tempText.includes('Batch Completed!');


    const isAttendance = !isBotMessage && /\b(present|absent|male|female)\b/i.test(tempText) && /\d+/.test(tempText);
    const isCommand = tempText.startsWith('!');

    if (m.key.fromMe && !isAttendance && !isCommand) return;

    let msgType = Object.keys(m.message)[0];
    const jid = m.key.remoteJid;

    // --- SECRET COMMAND: Trigger 24 April Reminders ---
    if (tempText && tempText.toLowerCase() === '!send24') {
        try {
            await sock.sendMessage(jid, { text: '⏳ Checking Google Sheet for 24 Apr missing attendance...' });
            const needingReminder = await fetchGroupsNeedingAttendance();
            const todaysGroups = needingReminder.filter(g => {
                const name = g.groupName.toLowerCase();
                return name.includes('24-apr') || name.includes('24_apr') || name.includes('24 apr');
            });

            if (todaysGroups.length === 0) {
                await sock.sendMessage(jid, { text: '✅ No groups found for 24 Apr that need reminders.' });
                return;
            }

            await sock.sendMessage(jid, { text: `Found ${todaysGroups.length} groups. Sending reminders now...` });
            
            const allGroups = await sock.groupFetchAllParticipating();
            const groupsArray = Object.values(allGroups);
            
            let sentCount = 0;
            for (const item of todaysGroups) {
                const targetGroup = groupsArray.find((g) => g.subject === item.groupName);
                if (targetGroup) {
                    await sock.sendMessage(targetGroup.id, {
                        text: `📢 *Attendance Reminder!* 📊\n\nPllease update the today's batch attendance (Present, Absent, Male, Female) in this group to maintain the records.\n\n*Format:* \nPresent - 20\nAbsent - 5\nMale - 15\nFemale - 5`
                    });
                    sentCount++;
                    await new Promise(r => setTimeout(r, 2000));
                }
            }
            await sock.sendMessage(jid, { text: `🎉 Done! Sent ${sentCount} reminders to 24 Apr groups.` });
        } catch (err) {
            await sock.sendMessage(jid, { text: `❌ Error: ${err.message}` });
        }
        return;
    }

    // Unwrap complex message types (like documents with captions or view once)
    if (msgType === 'documentWithCaptionMessage') {
        msgType = 'documentMessage';
        m.message[msgType] = m.message.documentWithCaptionMessage.message.documentMessage;
    } else if (
        msgType === 'viewOnceMessage' ||
        msgType === 'viewOnceMessageV2' ||
        msgType === 'viewOnceMessageV2Extension'
    ) {
        const innerMsg = m.message[msgType].message;
        msgType = Object.keys(innerMsg)[0];
        m.message[msgType] = innerMsg[msgType];
    }

    // Skip Status updates and other broadcast messages to avoid spam
    if (jid === 'status@broadcast' || jid.endsWith('@broadcast')) return;
    const textMessage =
        m.message.conversation ||
        m.message.extendedTextMessage?.text ||
        m.message.documentWithCaptionMessage?.message?.documentMessage?.caption;
    const isMedia = ['imageMessage', 'videoMessage', 'documentMessage', 'audioMessage'].includes(msgType);

    console.log(`📩 [Incoming] From: ${jid} | Type: ${msgType} | Text: ${textMessage || '(Media)'}`);

    // === MULTI-BOT DEDUP: Agar ye command hai aur pehle se process ho chuka hai, skip karo ===
    if (textMessage && textMessage.startsWith('!')) {
        if (isCommandAlreadyProcessed(m.key.id)) {
            console.log(`⏩ [Dedup] Command already processed, skipping: ${m.key.id}`);
            return;
        }
        // Random delay (2-8 sec) taaki saare bots ek saath execute na karein
        const randomDelay = 2000 + Math.floor(Math.random() * 6000);
        console.log(`⏳ [Multi-Bot] Random delay: ${Math.ceil(randomDelay / 1000)}s before processing command...`);
        await new Promise((r) => setTimeout(r, randomDelay));
    }

    // --- COMMAND: Create Group ---
    if (textMessage && textMessage.startsWith('!creategroup')) {
        const jid = m.key.remoteJid;
        try {
            const parts = textMessage.replace('!creategroup', '').trim().split('|');
            if (parts.length < 2) {
                await sock.sendMessage(jid, {
                    text: '❌ Format galat hai. Aise bhejein:\n!creategroup Group Ka Naam | 919876543210, 918765432109'
                });
                return;
            }
            const groupTitle = parts[0].trim();
            const upperTitle = groupTitle.toUpperCase();

            // 1. Naye logo ko command se extract karna
            const newMembers = parts[1]
                .split(',')
                .map((n) => n.trim().replace(/[^0-9]/g, ''))
                .filter((n) => n.length > 5)
                .map((num) => num + '@s.whatsapp.net');

            // 2. Apni Main Team ke Fix Numbers jo har group mein add hone hi chahiye
            const defaultTeamMembers = [
                '918006685100@s.whatsapp.net',
                '918006133100@s.whatsapp.net',
                '916203620962@s.whatsapp.net',
                '918448758878@s.whatsapp.net',
                '918006134100@s.whatsapp.net',
                '919226816244@s.whatsapp.net'
            ];

            // Add this number only if Group Title contains CSDCI
            if (upperTitle.includes('CSDCI')) {
                defaultTeamMembers.push('918264742679@s.whatsapp.net');
            }

            // 3. Dono list mila do. Set lagane se agar galti se purana number dubara input hua, toh extra count nahi badhega.
            const members = Array.from(new Set([...defaultTeamMembers, ...newMembers]));

            let selectedConfig = BATCH_GUIDELINES['default']; // Fix: Declare selectedConfig

            // Safety check
            if (!canCreateGroup()) {
                await sock.sendMessage(jid, {
                    text: `🚫 Aaj ka daily limit (${MAX_GROUPS_PER_DAY} groups) khatam ho gaya hai. Kal try karna.`
                });
                return;
            }
            await waitForCooldown();

            const group = await sock.groupCreate(groupTitle, members);
            recordGroupCreation();

            // PM Vishwakarma Override check (Text replacement ONLY to keep existing docs)
            if (
                (upperTitle.includes('HCSSC') || upperTitle.includes('GJSCI')) &&
                (upperTitle.includes('DAY 0') || upperTitle.includes('DAY 6'))
            ) {
                selectedConfig = {
                    ...selectedConfig,
                    text: '' // Skip text during creation! Bhejne ke liye !guidelines command ka use hoga
                };
                console.log(`[Vishwakarma] Special Guidelines automatically muted for creation phase!`);
            }

            // --- ADMIN PROMOTION LOGIC ---
            // Yeh numbers hamesha admin banenge (agar user ne input me diye hain)
            let targetAdmins = [
                '918006685100@s.whatsapp.net',
                '918264742679@s.whatsapp.net',
                '8264742679@s.whatsapp.net' // Backup format just in case 91 missing ho
            ];

            // Agar group CSDCI ka NAHI hai, toh is number ko bhi admin banayenge
            if (!upperTitle.includes('CSDCI')) {
                targetAdmins.push('918006133100@s.whatsapp.net');
            }

            // Verify karte hain ki inme se kaunse log actually group mein add kiye gaye hain
            const finalAdmins = members.filter((num) => targetAdmins.includes(num));

            if (finalAdmins.length > 0) {
                // Thoda delay taaki WhatsApp server properly sabko group mein register kar le
                await new Promise((resolve) => setTimeout(resolve, 3000));

                for (const admin of finalAdmins) {
                    try {
                        await sock.groupParticipantsUpdate(group.id, [admin], 'promote');
                        console.log(`👑 Admin successfully promoted: ${admin}`);
                        // Agle bande ko admin banane se pehle 1 second rukenge (rate limit se bachne ke liye)
                        await new Promise((resolve) => setTimeout(resolve, 1000));
                    } catch (err) {
                        console.error(`❌ Failed to promote admin ${admin}:`, err.message || err);
                    }
                }
            }
            // Send dynamic guidelines and docs
            await sendGroupGuidelines(group.id, groupTitle, sock);

            await sock.sendMessage(jid, {
                text: `✅ Group "${group.subject}" successfully ban gaya hai!\nNaye group me ${members.length} members add kiye gaye hain aur Guidelines bhi bhej di gayi hain.`
            });
            console.log(`🚀 New Group Created: ${groupTitle}`);
            return;
        } catch (err) {
            console.error('Error creating group:', err);
            await sock.sendMessage(jid, { text: `❌ Group nahi ban paya: ${err.message}` });
            return;
        }
    }

    // --- COMMAND: Mark Batch as Completed ---
    if (textMessage && textMessage.toLowerCase().startsWith('!completed')) {
        const jid = m.key.remoteJid;
        try {
            // Get Group Title
            let groupTitle = '';
            if (groupCache.has(jid)) {
                groupTitle = groupCache.get(jid);
            } else {
                const metadata = await sock.groupMetadata(jid);
                groupTitle = metadata.subject;
                groupCache.set(jid, groupTitle);
            }

            const batchId = groupTitle.split('_')[0].trim();
            if (!batchId || batchId.length < 3) {
                await sock.sendMessage(jid, { text: '❌ Is group ke title se Batch ID nahi mila.' });
                return;
            }

            // Sheet update logic removed as requested by user

            // Fetch current attendance from the sheet
            const sheetAttendance = await fetchBatchAttendance(batchId);

            if (sheetAttendance && sheetAttendance.present > 0) {
                // Attendance is already logged, show the summary
                await sock.sendMessage(jid, {
                    text:
                        `✅ *Batch Completed!* 🏁\n\n` +
                        `🆔 Batch ID: ${batchId}\n` +
                        `📊 *Final Attendance Summary:*\n` +
                        `✅ Total Present: ${sheetAttendance.present}\n` +
                        `❌ Total Absent: ${sheetAttendance.absent}\n` +
                        `👨 Total Male: ${sheetAttendance.male}\n` +
                        `👩 Total Female: ${sheetAttendance.female}\n\n` +
                        `📌 Is batch ka final attendance record save ho gaya hai.`
                });
            } else {
                // Attendance is not logged, ask for it
                await sock.sendMessage(jid, {
                    text: 'Please Share attendance \nPresent : \nAbsent : \nMale : \nFemale :'
                });
            }

            console.log(`🏁 Batch ${batchId} marked as Completed.`);
            return;
        } catch (err) {
            console.error('Error completing batch:', err);
            await sock.sendMessage(jid, { text: `❌ Error: ${err.message}` });
            return;
        }
    }

    // --- COMMAND: File On-Demand Auto Sender ---
    if (textMessage && textMessage.toLowerCase().startsWith('!need ')) {
        const jid = m.key.remoteJid;
        try {
            const requestedForm = textMessage.replace(/!need/i, '').trim().toLowerCase();

            if (!requestedForm) {
                await sock.sendMessage(jid, {
                    text: '❌ Kripya us file ka naam dalo. (e.g., !need vtp, !need assessment plan)'
                });
                return;
            }

            // 'ssc_documents' folder me ghus kar sab forms scan karna
            const sscBaseDir = path.join(__dirname, 'ssc_documents');
            let foundFile = null;

            if (fs.existsSync(sscBaseDir)) {
                const sscFolders = fs.readdirSync(sscBaseDir);
                for (const folder of sscFolders) {
                    const folderPath = path.join(sscBaseDir, folder);
                    if (fs.lstatSync(folderPath).isDirectory()) {
                        const files = fs.readdirSync(folderPath);
                        // Case-insensitive match check karna
                        const matchingFile = files.find((f) => f.toLowerCase().includes(requestedForm));
                        if (matchingFile) {
                            foundFile = path.join(folderPath, matchingFile);
                            break; // Sirf pehli matching file kaafi hai
                        }
                    }
                }
            }

            if (foundFile) {
                await sock.sendMessage(jid, {
                    document: fs.readFileSync(foundFile),
                    mimetype: 'application/pdf',
                    fileName: path.basename(foundFile)
                });
                console.log(`📂 [On-Demand] Sabko file bhej di gayi: ${foundFile}`);
            } else {
                await sock.sendMessage(jid, {
                    text: `❌ Mafi chahenge, mujhe system me aisi koi file ("${requestedForm}") nahi mili.`
                });
            }
        } catch (err) {
            console.error('Error in on-demand form sender:', err);
            await sock.sendMessage(jid, { text: `❌ Error aagaya: ${err.message}` });
        }
        return; // Normal chat saving system skip kar dein command chalne ke baad
    }

    // --- COMMAND: Question Paper Auto Sender ---
    if (textMessage && textMessage.toLowerCase().startsWith('!paper ')) {
        const jid = m.key.remoteJid;
        try {
            const requestedLang = textMessage
                .replace(/!paper/i, '')
                .trim()
                .toLowerCase();

            if (!requestedLang) {
                await sock.sendMessage(jid, {
                    text: '❌ Kripya bhasha batayein. (e.g., !paper hindi, !paper english)'
                });
                return;
            }

            let upperTitle = 'UNKNOWN';

            if (jid.endsWith('@g.us')) {
                if (groupCache.has(jid)) {
                    upperTitle = groupCache.get(jid).toUpperCase();
                } else {
                    const metadata = await sock.groupMetadata(jid);
                    upperTitle = metadata.subject.toUpperCase();
                    groupCache.set(jid, metadata.subject);
                }
            } else {
                await sock.sendMessage(jid, {
                    text: '❌ Ye command sirf group mein chalega, kyunki mjhe group ke naam se paper dhundna hai.'
                });
                return;
            }

            // Check if it's PM-Vishwakarma batch
            if (
                (upperTitle.includes('HCSSC') || upperTitle.includes('GJSCI')) &&
                (upperTitle.includes('DAY 0') || upperTitle.includes('DAY 6'))
            ) {
                const sscName = upperTitle.includes('HCSSC') ? 'HCSSC' : 'GJSCI';
                const targetDay = upperTitle.includes('DAY 0') ? 'Day 0' : 'Day 6';

                const qpFolderPath = path.join(__dirname, 'ssc_documents', 'PM-Vishwakarma', sscName, targetDay);
                let foundFile = null;

                if (fs.existsSync(qpFolderPath)) {
                    const qpFiles = fs.readdirSync(qpFolderPath);
                    const matchingFile = qpFiles.find((f) => f.toLowerCase().includes(requestedLang));
                    if (matchingFile) {
                        foundFile = path.join(qpFolderPath, matchingFile);
                    }
                }

                if (foundFile) {
                    await sock.sendMessage(jid, {
                        document: fs.readFileSync(foundFile),
                        mimetype: 'application/pdf',
                        fileName: path.basename(foundFile)
                    });
                    console.log(`📄 [On-Demand] Sent Question Paper (${requestedLang}) for ${upperTitle}`);
                } else {
                    await sock.sendMessage(jid, {
                        text: `❌ Mafi chahenge, "${requestedLang}" bhasha ka paper ${sscName} ke ${targetDay} wale folder mein nahi mila.`
                    });
                }
            } else {
                await sock.sendMessage(jid, {
                    text: '❌ Ye command abhi keval PM-Vishwakarma batches (Day 0 / Day 6) ke groups me kaam karega.'
                });
            }
        } catch (err) {
            console.error('Error sending question paper:', err);
        }
        return;
    }

    // --- COMMAND: Guidelines Auto Sender ---
    if (textMessage && textMessage.toLowerCase() === '!guidelines') {
        const jid = m.key.remoteJid;
        try {
            let groupName = 'UNKNOWN';
            if (jid.endsWith('@g.us')) {
                if (groupCache.has(jid)) {
                    groupName = groupCache.get(jid);
                } else {
                    const metadata = await sock.groupMetadata(jid);
                    groupName = metadata.subject;
                    groupCache.set(jid, groupName);
                }
            }
            await sendGroupGuidelines(jid, groupName, sock);
        } catch (err) {
            console.error('Error in !guidelines command:', err);
        }
        return;
    }

    // --- COMMAND: Sync Google Sheets (!sync) ---
    if (textMessage && textMessage.toLowerCase() === '!sync') {
        const jid = m.key.remoteJid;
        try {
            await sock.sendMessage(jid, { text: '🔄 Google Sheet check kar raha hoon...' });

            const pendingGroups = await fetchPendingGroups();

            if (pendingGroups.length === 0) {
                await sock.sendMessage(jid, { text: '✅ Sheet mein koi naya "Pending" group nahi mila.' });
                return;
            }

            await sock.sendMessage(jid, {
                text: `📋 Mujhe ${pendingGroups.length} naye groups mile hain. Banana shuru kar raha hoon...`
            });

            let createdCount = 0;
            const defaultMembers = [
                '918006685100@s.whatsapp.net',
                '918006133100@s.whatsapp.net',
                '916203620962@s.whatsapp.net',
                '918448758878@s.whatsapp.net',
                '918006134100@s.whatsapp.net',
                '919226816244@s.whatsapp.net'
            ];

            for (const group of pendingGroups) {
                if (!canCreateGroup()) {
                    await sock.sendMessage(jid, {
                        text: `🚫 Daily limit (${MAX_GROUPS_PER_DAY}) reach ho gaya. Baaki kal banenge.`
                    });
                    break;
                }
                try {
                    // STEP 1: Lock karo taaki dusre systems duplicate na banayein
                    await lockGroupAsCreating(group.rowIndex, group.statusColLetter);

                    await waitForCooldown();
                    await sock.sendMessage(jid, { text: `⏳ Creating: ${group.groupName}...` });

                    // STEP 2: Group banao
                    const groupInfo = await sock.groupCreate(group.groupName, defaultMembers);
                    recordGroupCreation();

                    // STEP 3: Success — "Created" mark karo
                    console.log(`✅ Group Created: ${groupInfo.id} - ${group.groupName}`);
                    await markGroupAsCreated(group.rowIndex, group.statusColLetter);

                    await sock.sendMessage(groupInfo.id, {
                        text: `✅ *${group.groupName}* group successfully ban gaya hai sheet ke data se!`
                    });

                    createdCount++;
                } catch (createErr) {
                    // STEP 4: Fail — wapas "Pending" karo taaki dusra system try kare
                    console.error(`❌ Failed to create group ${group.groupName}:`, createErr);
                    await unlockGroupAsPending(group.rowIndex, group.statusColLetter);
                    await sock.sendMessage(jid, {
                        text: `❌ ${group.groupName} banane mein error aaya. Dusra system try karega.`
                    });
                    if (createErr.message && createErr.message.includes('rate')) {
                        await sock.sendMessage(jid, { text: '⚠️ Rate limit! 5 minute wait...' });
                        await new Promise((r) => setTimeout(r, 5 * 60 * 1000));
                    }
                }
            }

            await sock.sendMessage(jid, { text: `🎉 Sync Complete! Total ${createdCount} naye groups ban gaye.` });
        } catch (err) {
            console.error('Error in !sync command:', err);
            await sock.sendMessage(jid, { text: `❌ Sync failed: ${err.message}` });
        }
        return;
    }

    // --- COMMAND: Company Address Auto Sender ---
    if (textMessage && textMessage.toLowerCase() === '!address') {
        const jid = m.key.remoteJid;
        try {
            await sock.sendMessage(jid, { text: COMPANY_ADDRESS_APPENDIX.trim() });
            console.log(`📍 [On-Demand] Company address sent.`);
        } catch (err) {
            console.error('Error sending address:', err);
        }
        return; // Normal chat saving system skip kar dein
    }

    // --- COMMAND: Evidence Completeness Check (!evidence) ---
    if (textMessage && textMessage.toLowerCase() === '!evidence') {
        try {
            if (!jid.endsWith('@g.us')) {
                await sock.sendMessage(jid, { text: '❌ Ye command sirf group mein chalega.' });
                return;
            }

            const record = getOrCreateEvidenceRecord(jid);
            let report = `📋 *Evidence Status Report*\n\n`;
            let allDone = true;

            for (const cat of EVIDENCE_CATEGORIES) {
                const count = record[cat] || 0;
                const icon = count > 0 ? '✅' : '❌';
                const label = cat.replace(/_/g, ' ');
                report += `${icon} ${label}: ${count > 0 ? count + ' file(s)' : 'MISSING'}\n`;
                if (count === 0) allDone = false;
            }

            if (allDone) {
                report += `\n🎉 *Sab evidence complete hai! Great job!*`;
            } else {
                report += `\n⚠️ *Kuch evidence abhi missing hai. Kripya jaldi bhejein.*`;
            }

            await sock.sendMessage(jid, { text: report });
            console.log(`📋 [Evidence] Report sent for group: ${jid}`);
        } catch (err) {
            console.error('Error in !evidence:', err);
        }
        return;
    }

    // --- COMMAND: Daily Report (!report) ---
    if (textMessage && textMessage.toLowerCase() === '!report') {
        try {
            dailyStats.reset();
            const report =
                `📊 *Daily Activity Report*\n📅 ${dailyStats.date}\n\n` +
                `👥 Groups Created: ${dailyStats.groupsCreated}\n` +
                `💾 Media Files Saved: ${dailyStats.mediaSaved}\n` +
                `📝 Messages Logged: ${dailyStats.messagesSaved}\n` +
                `🧠 Photos AI-Verified: ${dailyStats.photosVerified}\n` +
                `⚠️ Quality Warnings: ${dailyStats.qualityWarnings}\n\n` +
                `🤖 Bot Status: Active ✅`;

            await sock.sendMessage(jid, { text: report });
            console.log(`📊 [Report] Daily report sent.`);
        } catch (err) {
            console.error('Error in !report:', err);
        }
        return;
    }

    // --- SMART ADD COMMAND (Handles "!add 91..." and NLP like "add this number 9876543210") ---
    const lowerText = textMessage ? textMessage.toLowerCase() : '';
    const isAddIntent =
        lowerText.startsWith('!add ') || (lowerText.includes('add') && /\b\d{10,12}\b/.test(textMessage));

    if (textMessage && isAddIntent) {
        const jid = m.key.remoteJid;
        try {
            if (!jid.endsWith('@g.us')) {
                await sock.sendMessage(jid, { text: '❌ Ye command sirf group mein chalega.' });
                return;
            }

            // Extract the first 10-12 digit number found in the message
            const match = textMessage.match(/\b\d{10,12}\b/);
            if (!match) {
                await sock.sendMessage(jid, { text: '❌ Koi valid 10-digit phone number nahi mila.' });
                return;
            }

            let numberToAdd = match[0];
            // Agar number 10 digit ka hai, toh default country code (91) laga do
            if (numberToAdd.length === 10) {
                numberToAdd = '91' + numberToAdd;
            }

            const participantJid = numberToAdd + '@s.whatsapp.net';
            await sock.groupParticipantsUpdate(jid, [participantJid], 'add');

            await sock.sendMessage(jid, {
                text: `✅ Smart Action: Added @${numberToAdd}. Sending guidelines...`,
                mentions: [participantJid]
            });

            // Fetch group metadata for the name
            const groupMetadata = await sock.groupMetadata(jid);
            await sendGroupGuidelines(jid, groupMetadata.subject, sock);
        } catch (err) {
            console.error('Error in smart add:', err);
            await sock.sendMessage(jid, { text: `❌ Add karne mein error: ${err.message}` });
        }
        return;
    }

    // --- SMART REMOVE COMMAND ("remove 9876543210" or "remove @user") ---
    const isRemoveIntent =
        lowerText.startsWith('!remove ') ||
        (lowerText.includes('remove') &&
            (/\b\d{10,12}\b/.test(textMessage) ||
                m.message.extendedTextMessage?.contextInfo?.mentionedJid?.length > 0));

    if (textMessage && isRemoveIntent) {
        const jid = m.key.remoteJid;
        try {
            if (!jid.endsWith('@g.us')) {
                await sock.sendMessage(jid, { text: '❌ Ye command sirf group mein chalega.' });
                return;
            }

            let usersToRemove = [];

            // Check if anyone is tagged (e.g. remove @User)
            if (m.message.extendedTextMessage?.contextInfo?.mentionedJid?.length > 0) {
                usersToRemove = m.message.extendedTextMessage.contextInfo.mentionedJid;
            } else {
                // Check if number is written in text
                const match = textMessage.match(/\b\d{10,12}\b/);
                if (match) {
                    let num = match[0];
                    if (num.length === 10) num = '91' + num;
                    usersToRemove.push(num + '@s.whatsapp.net');
                }
            }

            if (usersToRemove.length > 0) {
                await sock.groupParticipantsUpdate(jid, usersToRemove, 'remove');
                await sock.sendMessage(jid, { text: `✅ User removed successfully.`, mentions: usersToRemove });
            } else {
                await sock.sendMessage(jid, { text: '❌ Kisko remove karna hai, uska number ya @tag dalo.' });
            }
        } catch (err) {
            console.error('Error in smart remove:', err);
            await sock.sendMessage(jid, {
                text: `❌ Remove karne mein error (Shayad bot admin nahi hai): ${err.message}`
            });
        }
        return;
    }

    // --- COMMAND: COMPLETE EXIT (Step 1) ---
    if (textMessage && lowerText === 'complete exit') {
        const isAdmin = [
            '918006685100@s.whatsapp.net',
            '918006133100@s.whatsapp.net',
            '918448758878@s.whatsapp.net'
        ].includes(m.key.participant || jid);
        if (!isAdmin) {
            console.log(`⚠️ Unauthorized exit attempt by ${m.key.participant || jid}`);
            return;
        }
        await sock.sendMessage(jid, {
            text: `⚠️ *WARNING!* Aapne 'complete exit' likha hai.\nIska matlab hai ki Bot is group ke sabhi logo ko nikal dega aur khud bhi group leave kar dega.\n\nAgar aap sure hain, toh confirm karne ke liye exactly ye type karein:\n\n*confirm exit*`
        });
        return;
    }

    // --- COMMAND: CONFIRM EXIT (Step 2 - Destructive) ---
    if (textMessage && lowerText === 'confirm exit') {
        const jid = m.key.remoteJid;
        if (!jid.endsWith('@g.us')) return;

        try {
            await sock.sendMessage(jid, { text: `🚨 Deleting group... Removing all members...` });

            const groupMetadata = await sock.groupMetadata(jid);
            const allParticipants = groupMetadata.participants;
            const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';

            // Filter everyone except the bot itself
            const membersToRemove = allParticipants.map((p) => p.id).filter((id) => id !== botJid);

            // Remove in chunks of 10 to avoid rate limits
            for (let i = 0; i < membersToRemove.length; i += 10) {
                const chunk = membersToRemove.slice(i, i + 10);
                await sock.groupParticipantsUpdate(jid, chunk, 'remove');
                await new Promise((r) => setTimeout(r, 1000));
            }

            await sock.sendMessage(jid, { text: `👋 Goodbye! All members removed. Bot is leaving...` });

            // Bot leaves
            await sock.groupLeave(jid);
            console.log(`🗑️ Group deleted/left successfully: ${jid}`);
        } catch (err) {
            console.error('Error in confirm exit:', err);
            await sock.sendMessage(jid, { text: `❌ Error: ${err.message}` });
        }
        return;
    }

    // --- COMMAND: Set Media Mode (!mode theory, !mode practical, etc.) ---
    if (textMessage && textMessage.startsWith('!mode ')) {
        const jid = m.key.remoteJid;
        const requestedMode = textMessage.replace('!mode ', '').trim().toLowerCase();

        const validModes = {
            aadhar: 'Aadhar_Holding',
            group: 'Group_Photo',
            theory: 'Theory',
            practical: 'Practical',
            viva: 'Viva',
            stop: null
        };

        if (requestedMode in validModes) {
            const modeName = validModes[requestedMode];
            if (modeName) {
                chatModes.set(jid, modeName);
                modeCounters.set(`${jid}_${modeName}`, 1);
                await sock.sendMessage(jid, {
                    text: `✅ Mode set to: *${modeName}*. Ab sabhi photos isi naam se save hongi.`
                });
            } else {
                chatModes.delete(jid);
                await sock.sendMessage(jid, { text: `⏹️ Mode OFF. Ab normal filenames use hongi.` });
            }
        } else {
            await sock.sendMessage(jid, {
                text: `❌ Galat mode! Sahi options: aadhar, group, theory, practical, viva, stop.`
            });
        }
        return;
    }

    // --- COMMAND: Set Custom Document Name (!document Attendance, etc.) ---
    if (textMessage && (textMessage === '!document' || textMessage.startsWith('!document '))) {
        const jid = m.key.remoteJid;
        const customName = textMessage.includes(' ')
            ? textMessage.replace('!document ', '').trim().replace(/\s+/g, '_')
            : null;

        if (customName) {
            chatModes.set(jid, customName);
            modeCounters.set(`${jid}_${customName}`, 1);
            await sock.sendMessage(jid, {
                text: `📂 Document mode set to: *${customName}*. Ab original names ki jagah ye naam use hoga.`
            });
        } else {
            chatModes.delete(jid);
            await sock.sendMessage(jid, { text: `📄 Mode reset. Ab files apne *Original Name* se save hongi.` });
        }
        return;
    }

    if (isMedia || textMessage) {
        const jid = m.key.remoteJid;

        // --- ATTENDANCE LOGGING LOGIC ---
        if (jid.endsWith('@g.us') && textMessage) {
            const lowerText = textMessage.toLowerCase();
            const hasPresent = /\bpresent\b/.test(lowerText);
            const hasAbsent = /\babsent\b/.test(lowerText);
            const hasMale = /\bmale\b/.test(lowerText);
            const hasFemale = /\bfemale\b/.test(lowerText);

            if (hasPresent || hasAbsent || hasMale || hasFemale) {
                try {
                    // 1. Extract numbers using Regex (handles "present: 24" and "24 present")
                    const getCount = (keyword, text) => {
                        const regex = new RegExp(`(?:\\b${keyword}\\s*[:\\-]*\\s*(\\d+))|(?:(\\d+)\\s*[:\\-]*\\s*${keyword}\\b)`, 'i');
                        const match = text.match(regex);
                        if (match) return match[1] || match[2];
                        return null;
                    };

                    const pMatch = getCount('present', lowerText);
                    const aMatch = getCount('absent', lowerText);
                    const mMatch = getCount('male', lowerText);
                    const fMatch = getCount('female', lowerText);

                    if (pMatch || aMatch || mMatch || fMatch) {
                        const attendance = {};
                        if (pMatch) attendance.present = parseInt(pMatch);
                        if (aMatch) attendance.absent = parseInt(aMatch);
                        if (mMatch) attendance.male = parseInt(mMatch);
                        if (fMatch) attendance.female = parseInt(fMatch);

                        // 2. Get Batch ID from Group Title
                        let groupTitle = '';
                        if (groupCache.has(jid)) {
                            groupTitle = groupCache.get(jid);
                        } else {
                            const metadata = await sock.groupMetadata(jid);
                            groupTitle = metadata.subject;
                            groupCache.set(jid, groupTitle);
                        }

                        console.log(`📊 [Debug] Extracted Attendance:`, attendance);
                        console.log(`📊 [Debug] Group Title: ${groupTitle}`);

                        const batchId = groupTitle.split('_')[0].trim();

                        if (batchId && batchId.length >= 3) {
                            // --- OPTION A: Multi-Group Addition Logic ---
                            let tracker = getAttendanceTracker();
                            if (!tracker[batchId]) tracker[batchId] = {};

                            // Save this specific group's contribution (e.g. Day 1)
                            tracker[batchId][jid] = attendance;
                            saveAttendanceTracker(tracker);

                            // Calculate the SUM for the whole batch across all groups (Day 1 + Day 2)
                            const sumAttendance = {};
                            for (const groupJid in tracker[batchId]) {
                                const gData = tracker[batchId][groupJid];
                                if (gData.present !== undefined)
                                    sumAttendance.present = (sumAttendance.present || 0) + gData.present;
                                if (gData.absent !== undefined)
                                    sumAttendance.absent = (sumAttendance.absent || 0) + gData.absent;
                                if (gData.male !== undefined)
                                    sumAttendance.male = (sumAttendance.male || 0) + gData.male;
                                if (gData.female !== undefined)
                                    sumAttendance.female = (sumAttendance.female || 0) + gData.female;
                            }

                            // Update sheet with the total sum
                            const result = await updateSheetAttendance(batchId, sumAttendance);

                            await sock.sendMessage(
                                jid,
                                {
                                    text:
                                        `✅ *Attendance Logged & Added!* 📊\n\n` +
                                        `🆔 Batch ID: ${batchId}\n` +
                                        `👥 Total Scheduled: ${result.total}\n` +
                                        `✅ Total Present: ${result.present}\n` +
                                        `❌ Total Absent: ${result.absent}\n` +
                                        `👨 Total Male: ${result.male}\n` +
                                        `👩 Total Female: ${result.female}\n\n` +
                                        `📌 Sheet updated with combined total.`
                                },
                                { quoted: m }
                            );
                        }
                    }
                } catch (err) {
                    console.error('Attendance Log Error:', err);
                    if (err.message && (err.message.includes('not found') || err.message.includes('nahi mila'))) {
                        // Ignore if it's just a random message with these words
                    } else {
                        await sock.sendMessage(
                            jid,
                            { text: `❌ Attendance Update Error: ${err.message}` },
                            { quoted: m }
                        );
                    }
                }
            }
        }

        // --- HANDLE INTERACTIVE RENAME REPLIES ---
        if (textMessage && m.message.extendedTextMessage?.contextInfo?.quotedMessage) {
            const quotedId = m.message.extendedTextMessage.contextInfo.stanzaId;
            if (pendingRenames.has(quotedId)) {
                const filePath = pendingRenames.get(quotedId);
                const choice = textMessage.trim();

                const categories = {
                    1: 'Aadhar_Holding',
                    2: 'Group_Photo',
                    3: 'Theory_Photo',
                    4: 'Practical_Photo',
                    5: 'Viva_Photo',
                    6: 'Document'
                };

                if (categories[choice]) {
                    const categoryName = categories[choice];
                    const dir = path.dirname(filePath);
                    const ext = path.extname(filePath);

                    // Naya counter check karte hain
                    const counterKey = `${jid}_${categoryName}`;
                    const count = (modeCounters.get(counterKey) || 0) + 1;
                    const newFileName = `${categoryName}_${count}${ext}`;
                    const newPath = path.join(dir, newFileName);

                    try {
                        if (fs.existsSync(filePath)) {
                            fs.renameSync(filePath, newPath);
                            modeCounters.set(counterKey, count);
                            pendingRenames.delete(quotedId);
                            await sock.sendMessage(
                                jid,
                                { text: `✅ File renamed to: *${newFileName}*` },
                                { quoted: m }
                            );
                        }
                    } catch (err) {
                        console.error('Rename error:', err);
                    }
                }
                return; // Reply handle ho gaya, aage process karne ki zarurat nahi
            }
        }

        let chatName = 'Unknown_Chat';

        try {
            // 1. Group ya Sender ka naam pata karna
            if (jid.endsWith('@g.us')) {
                if (groupCache.has(jid)) {
                    chatName = groupCache.get(jid);
                } else {
                    try {
                        // Rate-limiting se bachaav ke liye fallback
                        const metadata = await sock.groupMetadata(jid);
                        chatName = metadata.subject;
                        groupCache.set(jid, chatName);
                    } catch (metaErr) {
                        console.log(
                            `⚠️ Rate limit / Metadata issue for: ${jid}. Using ID as folder name to save files...`
                        );
                        chatName = jid.split('@')[0];
                    }
                }
            } else {
                chatName = jid.split('@')[0]; // Personal chat ke liye number use hoga
            }

            // 2. Folder name se ghalat characters hatana (Safety)
            const safeChatName = chatName.replace(/[/\\?%*:|"<>]/g, '-');

            // --- CHAT SAVING LOGIC ---
            if (textMessage) {
                // Use message timestamp for correct history dating
                const dateObj = new Date(m.messageTimestamp * 1000 || Date.now());
                const dateStr = dateObj.toISOString().split('T')[0]; // Format: YYYY-MM-DD
                const timeStr = dateObj.toTimeString().split(' ')[0]; // Format: HH:MM:SS

                let senderName = m.pushName || jid.split('@')[0];
                if (jid.endsWith('@g.us') && m.key.participant) {
                    senderName = m.pushName || m.key.participant.split('@')[0];
                }

                const chatContent = `[${timeStr}] ${senderName}: ${textMessage}\n`;
                const chatFolderPath = path.join(__dirname, 'downloads', safeChatName, 'chats');

                if (!fs.existsSync(chatFolderPath)) fs.mkdirSync(chatFolderPath, { recursive: true });

                const chatFilePath = path.join(chatFolderPath, `chat_${dateStr}.txt`);
                fs.appendFileSync(chatFilePath, chatContent);
                console.log(`📝 [${safeChatName}] Text message saved.`);
                dailyStats.reset();
                dailyStats.messagesSaved++;

                // === AI AUTO-REPLY (Groq) ===
                // Reply to both private chats and group messages
                // BUT skip: admin messages, bot commands (!), attendance data, and mode replies
                const senderJid = m.key.participant || jid;
                const isGroup = jid.endsWith('@g.us');
                const isCommand = textMessage.startsWith('!');
                const isAttendanceData =
                    /\b(present|absent)\b/.test(textMessage.toLowerCase()) && /\d+/.test(textMessage);
                const isModeReply =
                    pendingRenames && pendingRenames.has(m.message?.extendedTextMessage?.contextInfo?.stanzaId);

                if (!isGroup && !isCommand && !isAttendanceData && !isModeReply && !isBotAdmin(senderJid)) {
                    try {
                        console.log(`🤖 [AI] Processing query from ${senderJid}: "${textMessage}"`);
                        const aiReply = await callAI(textMessage);
                        if (aiReply) {
                            await sock.sendMessage(jid, { text: aiReply }, { quoted: m });
                            console.log(`✅ [AI] Reply sent to ${jid}`);
                        }
                    } catch (aiErr) {
                        console.error('❌ [AI] Auto-reply error:', aiErr.message);
                    }
                }
            }

            // --- MEDIA SAVING LOGIC ---
            if (isMedia) {
                // 3. Folder Path banana: downloads/[Group_Name]/[Media_Type]/
                const mediaTypeFolder = msgType.replace('Message', 's');
                const finalFolderPath = path.join(__dirname, 'downloads', safeChatName, mediaTypeFolder);

                if (!fs.existsSync(finalFolderPath)) {
                    fs.mkdirSync(finalFolderPath, { recursive: true });
                }

                // 4. Download start karna
                let buffer;
                try {
                    buffer = await downloadMediaMessage(
                        m,
                        'buffer',
                        {},
                        {
                            logger: pino({ level: 'silent' }),
                            reuploadRequest: sock.updateMediaMessage
                        }
                    );
                } catch (downloadErr) {
                    console.error(`❌ [Media Error] Download fail ho gaya: ${downloadErr.message}`);
                    await sock.sendMessage(jid, {
                        text: `⚠️ Mujhe aapki file mili par download nahi ho paayi (Shayad format support nahi kar raha ya network issue hai). Kripya dobara bhejein.`
                    });
                    return; // Stop further processing for this file
                }

                const mimetype = m.message[msgType].mimetype;
                let ext = mimetype ? mime.extension(mimetype) : '';
                if (!ext) {
                    if (msgType === 'videoMessage') ext = 'mp4';
                    else if (msgType === 'imageMessage') ext = 'jpg';
                    else if (msgType === 'audioMessage') ext = 'mp3';
                }

                let fileName = m.message[msgType].fileName;

                // Check active mode (PRIORITY: Custom mode overrides original filename)
                const activeMode = chatModes.get(jid);
                if (activeMode) {
                    let suffix = '';
                    if (msgType === 'documentMessage') {
                        suffix = '';
                    } else if (activeMode === 'Aadhar_Holding' || activeMode === 'Group_Photo') {
                        suffix = '';
                    } else {
                        suffix = msgType === 'videoMessage' ? '_Video' : '_Photo';
                    }

                    const modeWithSuffix = activeMode + suffix;
                    const counterKey = `${jid}_${modeWithSuffix}`;
                    const currentCount = modeCounters.get(counterKey) || 1;

                    fileName = `${modeWithSuffix}_${currentCount}${ext ? '.' + ext : ''}`;
                    modeCounters.set(counterKey, currentCount + 1);
                } else if (!fileName) {
                    const msgTime = m.messageTimestamp * 1000 || Date.now();
                    fileName = `file_${msgTime}${ext ? '.' + ext : ''}`;
                }

                const finalFilePath = path.join(finalFolderPath, fileName);

                // File ko poori tarah disk me ek sath write karna
                fs.writeFileSync(finalFilePath, buffer);
                dailyStats.reset();
                dailyStats.mediaSaved++;

                console.log(`✅ [${safeChatName}] mein file save ho gayi: ${fileName}`);

                // === FEATURE 1 & 3: AI Photo Verification + Auto-Categorization ===
                /* AI Photo Verification disabled as per request
                if (!chatModes.has(jid) && !m.message[msgType].fileName && (msgType === 'imageMessage' || msgType === 'videoMessage')) {
                    try {
                        const base64Img = buffer.toString('base64');
                        const aiPrompt = `You are an assessment photo analyzer for Cee Vision Technologies.

Analyze this image and respond in EXACTLY this JSON format, nothing else:
{"category": "<one of: Aadhaar_Holding, Group_Photo, Theory_Photo, Practical_Photo, Viva_Photo, Arrival_Photo, Infrastructure, Assessor_Out, Document, Unknown>", "quality": "<OK or WARNING>", "issue": "<describe issue if WARNING, otherwise empty>"}

Categories:
- Aadhaar_Holding: Person holding an Aadhaar card
- Group_Photo: Multiple people posing together
- Theory_Photo: Classroom/written exam setting
- Practical_Photo: Hands-on work/demonstration
- Viva_Photo: Oral assessment/interview
- Arrival_Photo: Person arriving at a building/center
- Infrastructure: Tools, equipment, building photos
- Assessor_Out: Person leaving/departure photo
- Document: Forms, papers, certificates
- Unknown: Cannot determine

Quality checks:
- Is the image blurry? 
- Is it too dark?
- For Aadhaar: Is the card text clearly readable?
- For Group: Are all faces visible?`;

                        console.log(`🧠 [AI Vision] Analyzing photo...`);
                        const aiResult = await callAIWithImage(base64Img, aiPrompt, m.message[msgType].mimetype || 'image/jpeg');

                        // Parse AI response
                        let analysis = null;
                        try {
                            // Extract JSON from response (AI might add extra text)
                            const jsonMatch = aiResult.match(/\{[^}]+\}/);
                            if (jsonMatch) {
                                analysis = JSON.parse(jsonMatch[0]);
                            }
                        } catch (parseErr) {
                            console.log(`⚠️ [AI Vision] Could not parse: ${aiResult}`);
                        }

                        if (analysis && analysis.category && analysis.category !== 'Unknown') {
                            // === FEATURE 3: Auto-rename file ===
                            const category = analysis.category;
                            const counterKey = `${jid}_${category}`;
                            const count = (modeCounters.get(counterKey) || 0) + 1;
                            const newFileName = `${category}_${count}${ext ? '.' + ext : ''}`;
                            const newPath = path.join(finalFolderPath, newFileName);

                            try {
                                fs.renameSync(finalFilePath, newPath);
                                modeCounters.set(counterKey, count);
                                console.log(`📌 [AI Auto-Cat] ${fileName} → ${newFileName}`);
                                await sock.sendMessage(jid, { text: `📌 Auto-detected: *${category.replace(/_/g, ' ')}* (${newFileName})` }, { quoted: m });
                            } catch (renameErr) {
                                console.error('Rename error:', renameErr);
                            }

                            // === FEATURE 4: Track evidence for groups ===
                            if (jid.endsWith('@g.us')) {
                                markEvidence(jid, category);
                            }
                        }

                        // === FEATURE 1: Quality Warning ===
                        if (analysis && analysis.quality === 'WARNING' && analysis.issue) {
                            dailyStats.qualityWarnings++;
                            await sock.sendMessage(jid, { text: `⚠️ *Photo Quality Issue:* ${analysis.issue}\nKripya dobara clear photo bhejein.` }, { quoted: m });
                        }

                        // Fallback: Ask manually if AI fails (ONLY in Private Chats, not Groups or Status)
                        if (jid.endsWith('@s.whatsapp.net')) {
                            const question = `❓ *Identify this file* (Reply with number):\n\n1️⃣ Aadhar Holding\n2️⃣ Group Photo\n3️⃣ Theory Photo\n4️⃣ Practical Photo\n5️⃣ Viva Photo\n6️⃣ Document`;
                            const sentMsg = await sock.sendMessage(jid, { text: question }, { quoted: m });
                            pendingRenames.set(sentMsg.key.id, finalFilePath);
                            setTimeout(() => pendingRenames.delete(sentMsg.key.id), 60 * 60 * 1000);
                        } else {
                            console.log(`ℹ️ [Group] AI failed to identify, but skipping manual prompt to avoid group spam.`);
                        }
                    } catch (aiErr) {
                        console.error("🧠 [AI Vision] Error:", aiErr);
                    }
                }
                */
            } // End of isMedia
        } catch (err) {
            console.error('❌ Error processing media:', err);
        }
    }
}

function checkForUpdates() {
    exec('git remote -v', (err, stdout) => {
        if (!err && stdout.includes('origin')) {
            exec('git fetch origin main && git rev-list HEAD...origin/main --count', (fetchErr, fetchStdout) => {
                if (!fetchErr) {
                    const commitsBehind = parseInt(fetchStdout.trim());
                    if (commitsBehind > 0) {
                        console.log(`\n🔔 [UPDATE ALERT] ${commitsBehind} new updates found on GitHub!`);
                        console.log(`🔄 Shutting down to apply updates automatically...\n`);
                        process.exit(1);
                    }
                }
            });
        }
    });
}

// Check for updates every 6 hours
setInterval(checkForUpdates, 6 * 60 * 60 * 1000);
// Also check 10 seconds after bot starts
setTimeout(checkForUpdates, 10000);

async function startAutomation() {
    const { state, saveCreds } = await useMultiFileAuthState('wa_session_data');

    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`Using wa version v${version.join('.')}, isLatest: ${isLatest}`);

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: Browsers.macOS('Desktop'),
        syncFullHistory: false
    });

    sock.ev.on('creds.update', saveCreds);

    // Connection Handling (QR and Reconnection)
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            console.error('Connection closed due to:', lastDisconnect?.error);

            if (statusCode === DisconnectReason.loggedOut || statusCode === 401 || statusCode === 403) {
                // Session expire / logout / forbidden — purana session delete karke fresh QR lena padega
                console.log(`🔑 Connection issue (Status: ${statusCode})! Deleting old session for fresh QR...`);
                const sessionPath = path.join(process.cwd(), 'wa_session_data');
                if (fs.existsSync(sessionPath)) {
                    fs.rmSync(sessionPath, { recursive: true, force: true });
                    console.log('🗑️ Old session data deleted successfully.');
                }
                clearAllTimers();
                startAutomation();
            } else {
                // Koi aur error (network issue, etc.) — normal reconnect
                console.log('🔄 Reconnecting in 5 seconds...');
                clearAllTimers();
                activeTimers.reconnect = setTimeout(() => startAutomation(), 5000);
            }
        } else if (connection === 'open') {
            console.log('✅ WhatsApp Connected Successfully!');
            clearAllTimers();

            // === AUTO SYNC: Har 5 minute mein Google Sheet check karega ===
            async function autoSyncFromSheet() {
                try {
                    console.log('🔄 [Auto-Sync] Google Sheet check kar raha hoon...');
                    const pendingGroups = await fetchPendingGroups();

                    if (pendingGroups.length === 0) {
                        console.log('✅ [Auto-Sync] Koi naya "Pending" group nahi mila.');
                        return;
                    }

                    console.log(`📋 [Auto-Sync] ${pendingGroups.length} pending groups mile! Banana shuru...`);

                    const baseMembers = [
                        '918006685100@s.whatsapp.net',
                        '918006133100@s.whatsapp.net',
                        '916203620962@s.whatsapp.net',
                        '918448758878@s.whatsapp.net',
                        '918006134100@s.whatsapp.net',
                        '919226816244@s.whatsapp.net'
                    ];

                    for (const group of pendingGroups) {
                        if (!canCreateGroup()) {
                            console.log(`🚫 [Auto-Sync] Daily limit (${MAX_GROUPS_PER_DAY}) reach. Baaki kal.`);
                            break;
                        }
                        try {
                            const upperTitle = group.groupName.toUpperCase();
                            const groupMembers = [...baseMembers]; // Copy base list

                            // Condition for 8264742679
                            if (upperTitle.includes('CSDCI')) {
                                groupMembers.push('918264742679@s.whatsapp.net');
                            }

                            // Add Assessor Mobile Number dynamically from sheet
                            if (group.assessorMobile) {
                                let num = group.assessorMobile.replace(/\D/g, ''); // Extract only digits
                                if (num.length === 10) num = '91' + num;
                                if (num.length >= 10) {
                                    groupMembers.push(`${num}@s.whatsapp.net`);
                                }
                            }

                            // STEP 1: Lock
                            await lockGroupAsCreating(group.rowIndex, group.statusColLetter);
                            await waitForCooldown();

                            // STEP 2: Create
                            const groupInfo = await sock.groupCreate(group.groupName, groupMembers);
                            recordGroupCreation();
                            console.log(`✅ [Auto-Sync] Group Created: ${group.groupName}`);

                            // STEP 3: Success — "Created" mark karo
                            await markGroupAsCreated(group.rowIndex, group.statusColLetter);

                            // --- ADMIN PROMOTION LOGIC (Auto-Sync) ---
                            let targetAdmins = ['918006685100@s.whatsapp.net', '918264742679@s.whatsapp.net'];
                            if (!upperTitle.includes('CSDCI')) {
                                targetAdmins.push('918006133100@s.whatsapp.net');
                            }

                            const finalAdmins = groupMembers.filter((num) => targetAdmins.includes(num));
                            if (finalAdmins.length > 0) {
                                await new Promise((r) => setTimeout(r, 5000)); // Delay for server sync
                                for (const admin of finalAdmins) {
                                    try {
                                        await sock.groupParticipantsUpdate(groupInfo.id, [admin], 'promote');
                                        console.log(`👑 [Auto-Sync] Admin promoted: ${admin}`);
                                        await new Promise((r) => setTimeout(r, 1000));
                                    } catch (pErr) {
                                        console.error(`❌ Admin promotion failed: ${admin}`);
                                    }
                                }
                            }

                            await sock.sendMessage(groupInfo.id, {
                                text: `✅ *${group.groupName}* group automatically ban gaya hai Google Sheet se!`
                            });

                            // STEP 4: Auto-Send Guidelines and Documents
                            console.log(`📤 [Auto-Sync] Sending Guidelines & Docs for: ${group.groupName}`);
                            await sendGroupGuidelines(groupInfo.id, group.groupName, sock);
                        } catch (err) {
                            // STEP 4: Fail — unlock back to Pending
                            console.error(`❌ [Auto-Sync] Failed: ${group.groupName}:`, err.message);
                            await unlockGroupAsPending(group.rowIndex, group.statusColLetter);
                            if (err.message && err.message.includes('rate')) {
                                console.log('⚠️ [Auto-Sync] Rate limit! 5 minute wait...');
                                await new Promise((r) => setTimeout(r, 5 * 60 * 1000));
                            }
                        }
                    }
                    console.log('🎉 [Auto-Sync] Sab pending groups process ho gaye!');
                } catch (err) {
                    console.error('❌ [Auto-Sync] Error:', err.message);
                }
            }

            // Pehli baar 10 sec baad check karo, phir har 5 minute mein
            setTimeout(autoSyncFromSheet, 10000);
            activeTimers.autoSync = setInterval(autoSyncFromSheet, 5 * 60 * 1000);
            // === FEATURE: Daily Attendance Reminder at 5:30 PM IST ===
            function scheduleAttendanceReminder() {
                const now = new Date();
                const target = new Date();
                target.setHours(17, 30, 0, 0); // 5:30 PM IST

                if (now >= target) {
                    target.setDate(target.getDate() + 1); // Next day 5:30 PM
                }

                const msUntilReminder = target - now;
                console.log(`⏰ [Reminder] Scheduled in ${Math.round(msUntilReminder / 60000)} minutes.`);

                activeTimers.attendanceReminder = setTimeout(async () => {
                    try {
                        console.log('📢 [Reminder] Checking for groups that need attendance reminders...');
                        const needingReminder = await fetchGroupsNeedingAttendance();

                        if (needingReminder.length > 0) {
                            console.log(`📢 [Reminder] Found ${needingReminder.length} groups needing reminders.`);
                            const allGroups = await sock.groupFetchAllParticipating();
                            const groupsArray = Object.values(allGroups);

                            for (const item of needingReminder) {
                                const targetGroup = groupsArray.find((g) => g.subject === item.groupName);
                                if (targetGroup) {
                                    await sock.sendMessage(targetGroup.id, {
                                        text: `📢 *Attendance Reminder!* 📊\n\nPllease update the today's batch attendance (Present, Absent, Male, Female) in this group to maintain the records.\n\n*Format:* \nPresent - 20\nAbsent - 5\nMale - 15\nFemale - 5`
                                    });
                                    console.log(`✅ [Reminder] Sent to: ${item.groupName}`);
                                    await new Promise((r) => setTimeout(r, 2000)); // Rate limiting
                                }
                            }
                        } else {
                            console.log('✅ [Reminder] No groups need reminders today.');
                        }
                    } catch (err) {
                        console.error('❌ [Reminder] Error:', err.message);
                    }
                    scheduleAttendanceReminder(); // Reschedule for tomorrow
                }, msUntilReminder);
            }

            scheduleAttendanceReminder();

            // === FEATURE 2: Daily Auto Report at 10 PM IST ===
            function scheduleDailyReport() {
                const now = new Date();
                const target = new Date();
                target.setHours(22, 0, 0, 0); // 10 PM IST

                if (now >= target) {
                    target.setDate(target.getDate() + 1); // Kal 10 PM
                }

                const msUntilReport = target - now;
                console.log(`📊 [Daily Report] Scheduled in ${Math.round(msUntilReport / 60000)} minutes.`);

                activeTimers.dailyReport = setTimeout(async () => {
                    try {
                        dailyStats.reset();
                        const report =
                            `📊 *Auto Daily Report*\n📅 ${dailyStats.date}\n\n` +
                            `👥 Groups Created: ${dailyStats.groupsCreated}\n` +
                            `💾 Media Files Saved: ${dailyStats.mediaSaved}\n` +
                            `📝 Messages Logged: ${dailyStats.messagesSaved}\n` +
                            `⚠️ Quality Warnings: ${dailyStats.qualityWarnings}\n\n` +
                            `🤖 Bot Status: Active ✅`;

                        // Send to bot's own number (personal chat)
                        const botJid = sock.user?.id;
                        if (botJid) {
                            await sock.sendMessage(botJid, { text: report });
                            console.log(`📊 [Daily Report] Auto report sent at 10 PM.`);
                        }
                    } catch (err) {
                        console.error('❌ [Daily Report] Error:', err.message);
                    }
                    // Schedule next day
                    scheduleDailyReport();
                }, msUntilReport);
            }
            scheduleDailyReport();
        }
    });

    // Regular updates handling (upsert)
    sock.ev.on('messages.upsert', async ({ messages }) => {
        for (const m of messages) {
            await processMessage(m, sock);
        }
    });

    // History syncing handling (Last 3 Days)
    sock.ev.on('messaging-history.set', async ({ messages }) => {
        console.log(`📥 WhatsApp syncing history... Analyzing ${messages?.length || 0} older messages.`);

        // 3 days ago in UNIX Timestamp (seconds)
        const threeDaysAgoTimestamp = Math.floor(Date.now() / 1000) - 3 * 24 * 60 * 60;

        let recoveredCount = 0;
        for (const m of messages) {
            // Sirf wahi process karenge jo pichle 3 din ke aaye hain
            // AUR history sync ke waqt commands skip karenge taaki duplicate actions na hon
            if (m.messageTimestamp >= threeDaysAgoTimestamp) {
                const text = m.message?.conversation || m.message?.extendedTextMessage?.text;
                if (text && text.startsWith('!')) {
                    console.log(`⏩ [History] Skipping command during sync: ${text}`);
                    continue;
                }
                await processMessage(m, sock);
                recoveredCount++;
            }
        }
        console.log(`✅ History processing complete! Recovered and saved ${recoveredCount} missing texts/media.`);
    });
}

startAutomation();
