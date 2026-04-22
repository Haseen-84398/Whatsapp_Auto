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
const { pipeline } = require('stream/promises');
const { exec } = require('child_process');
const { fetchPendingGroups, lockGroupAsCreating, markGroupAsCreated, unlockGroupAsPending } = require('./sheets');

// Group names ko baar-baar fetch na karna pade isliye cache
const groupCache = new Map();

// Media Categorization Modes
const chatModes = new Map();
const modeCounters = new Map();
const pendingRenames = new Map(); // Question Message ID -> File Path cache

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
            { file: "Assessor's Feedback Form.pdf", displayName: 'Assessor Feedback Form.pdf' },
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
        folder: 'GJSCI',
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

async function processMessage(m, sock) {
    if (!m.message) return;

    const msgType = Object.keys(m.message)[0];
    const isMedia = ['imageMessage', 'videoMessage', 'documentMessage', 'audioMessage'].includes(msgType);
    const textMessage = m.message.conversation || m.message.extendedTextMessage?.text;

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

            // Identify Group Type and Select Guidelines
            let selectedConfig = BATCH_GUIDELINES['default'];
            // upperTitle was already declared above

            // Checking exact SSC abbreviations present in the title
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
            // -----------------------------

            // Send Guidelines directly to the newly created group
            if (selectedConfig.text) {
                await sock.sendMessage(group.id, { text: selectedConfig.text + COMPANY_ADDRESS_APPENDIX });
            }

            // --- DOCUMENT SENDING LOGIC ---
            let docsToSend = [];
            if (selectedConfig.folder) {
                const folderPath = path.join(__dirname, 'ssc_documents', selectedConfig.folder);
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
            if (docsToSend.length === 0) {
                docsToSend = selectedConfig.documents || [];
            }

            for (const docObj of docsToSend) {
                // Dynamically fetch from the specific SSC nested folder
                const docPath = docObj.isAbsolutePath
                    ? docObj.file
                    : path.join(__dirname, 'ssc_documents', selectedConfig.folder, docObj.file);

                if (fs.existsSync(docPath)) {
                    await sock.sendMessage(group.id, {
                        document: fs.readFileSync(docPath),
                        mimetype: 'application/pdf',
                        fileName: docObj.displayName || docObj.file
                    });

                    // Thoda delay taki WhatsApp server itni jaldi file bhejne par ban ya rate-limit na kare
                    await new Promise((resolve) => setTimeout(resolve, 1500));
                } else {
                    console.log(`⚠️ Document missing at path: ${docPath}, please ensure file exists.`);
                }
            }

            await sock.sendMessage(jid, {
                text: `✅ Group "${group.subject}" successfully ban gaya hai!\nNaye group me ${members.length} members add kiye gaye hain aur Guidelines bhi bhej di gayi hain.`
            });
            console.log(`🚀 New Group Created: ${groupTitle}`);
            return; // Command process hone ke baad yahin ruk jaye, chat save me na dale
        } catch (err) {
            console.error('Error creating group:', err);
            await sock.sendMessage(jid, { text: `❌ Group nahi ban paya: ${err.message}` });
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
            await sock.sendMessage(jid, { text: `❌ Error: Paper lene mein takleef hui.` });
        }
        return; // Normal chat saving system skip kar dein
    }

    // --- COMMAND: Guidelines Auto Sender ---
    if (textMessage && textMessage.toLowerCase() === '!guidelines') {
        const jid = m.key.remoteJid;
        try {
            let selectedConfig = BATCH_GUIDELINES['default'];
            let upperTitle = 'UNKNOWN';

            if (jid.endsWith('@g.us')) {
                if (groupCache.has(jid)) {
                    upperTitle = groupCache.get(jid).toUpperCase();
                } else {
                    const metadata = await sock.groupMetadata(jid);
                    upperTitle = metadata.subject.toUpperCase();
                    groupCache.set(jid, metadata.subject);
                }
            }

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

            if (
                (upperTitle.includes('HCSSC') || upperTitle.includes('GJSCI')) &&
                (upperTitle.includes('DAY 0') || upperTitle.includes('DAY 6'))
            ) {
                selectedConfig = BATCH_GUIDELINES['PM_VISHWAKARMA'];
            }

            if (selectedConfig.text) {
                await sock.sendMessage(jid, { text: selectedConfig.text + COMPANY_ADDRESS_APPENDIX });
                console.log(`📜 [On-Demand] Guidelines sent for title: ${upperTitle}`);
            }

            // --- DOCUMENT SENDING LOGIC ---
            let docsToSend = [];
            if (selectedConfig.folder) {
                const folderPath = path.join(__dirname, 'ssc_documents', selectedConfig.folder);
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
            if (docsToSend.length === 0) {
                docsToSend = selectedConfig.documents || [];
            }
            for (const docObj of docsToSend) {
                const docPath = docObj.isAbsolutePath
                    ? docObj.file
                    : path.join(__dirname, 'ssc_documents', selectedConfig.folder || '', docObj.file);

                if (fs.existsSync(docPath)) {
                    await sock.sendMessage(jid, {
                        document: fs.readFileSync(docPath),
                        mimetype: 'application/pdf',
                        fileName: docObj.displayName || docObj.file
                    });
                    await new Promise((resolve) => setTimeout(resolve, 1500));
                } else {
                    console.log(`⚠️ Document missing at path: ${docPath}, please ensure file exists.`);
                }
            }
        } catch (err) {
            console.error('Error sending guidelines:', err);
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
                    await lockGroupAsCreating(group.rowIndex);

                    await waitForCooldown();
                    await sock.sendMessage(jid, { text: `⏳ Creating: ${group.groupName}...` });

                    // STEP 2: Group banao
                    const groupInfo = await sock.groupCreate(group.groupName, defaultMembers);
                    recordGroupCreation();

                    // STEP 3: Success — "Created" mark karo
                    console.log(`✅ Group Created: ${groupInfo.id} - ${group.groupName}`);
                    await markGroupAsCreated(group.rowIndex);

                    await sock.sendMessage(groupInfo.id, {
                        text: `✅ *${group.groupName}* group successfully ban gaya hai sheet ke data se!`
                    });

                    createdCount++;
                } catch (createErr) {
                    // STEP 4: Fail — wapas "Pending" karo taaki dusra system try kare
                    console.error(`❌ Failed to create group ${group.groupName}:`, createErr);
                    await unlockGroupAsPending(group.rowIndex);
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
                await sock.sendMessage(jid, { text: `⏹️ Mode OFF. Ab normal filenames use honge.` });
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
                const buffer = await downloadMediaMessage(
                    m,
                    'buffer',
                    {},
                    {
                        logger: pino({ level: 'silent' }),
                        reuploadRequest: sock.updateMediaMessage
                    }
                );

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

                console.log(`✅ [${safeChatName}] mein file save ho gayi: ${fileName}`);

                // --- ASK FOR CATEGORY IF NO MODE ACTIVE ---
                if (!chatModes.has(jid) && !m.message[msgType].fileName) {
                    if (!jid.endsWith('@g.us')) {
                        const question = `❓ *Identify this file* (Reply with number):\n\n1️⃣ Aadhar Holding\n2️⃣ Group Photo\n3️⃣ Theory Photo\n4️⃣ Practical Photo\n5️⃣ Viva Photo\n6️⃣ Document`;
                        const sentMsg = await sock.sendMessage(jid, { text: question }, { quoted: m });
                        // Store for 1 hour
                        pendingRenames.set(sentMsg.key.id, finalFilePath);
                        setTimeout(() => pendingRenames.delete(sentMsg.key.id), 60 * 60 * 1000);
                    } else {
                        console.log(
                            `ℹ️ [Group] AI failed to identify, but skipping manual prompt to avoid group spam.`
                        );
                    }
                }
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
                // Fresh start for new QR code
                startAutomation();
            } else {
                // Koi aur error (network issue, etc.) — normal reconnect
                console.log('🔄 Reconnecting in 5 seconds...');
                setTimeout(() => startAutomation(), 5000);
            }
        } else if (connection === 'open') {
            console.log('✅ WhatsApp Connected Successfully!');

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
                            console.log(`🚫 [Auto-Sync] Daily limit (${MAX_GROUPS_PER_DAY}) reach. Baaki kal.`);
                            break;
                        }
                        try {
                            // STEP 1: Lock
                            await lockGroupAsCreating(group.rowIndex);

                            await waitForCooldown();

                            // STEP 2: Create
                            const groupInfo = await sock.groupCreate(group.groupName, defaultMembers);
                            recordGroupCreation();
                            console.log(`✅ [Auto-Sync] Group Created: ${group.groupName}`);

                            // STEP 3: Success
                            await markGroupAsCreated(group.rowIndex);

                            await sock.sendMessage(groupInfo.id, {
                                text: `✅ *${group.groupName}* group automatically ban gaya hai Google Sheet se!`
                            });
                        } catch (err) {
                            // STEP 4: Fail — unlock back to Pending
                            console.error(`❌ [Auto-Sync] Failed: ${group.groupName}:`, err.message);
                            await unlockGroupAsPending(group.rowIndex);
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
            setInterval(autoSyncFromSheet, 5 * 60 * 1000);
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
            if (m.messageTimestamp >= threeDaysAgoTimestamp) {
                await processMessage(m, sock);
                recoveredCount++;
            }
        }
        console.log(`✅ History processing complete! Recovered and saved ${recoveredCount} missing texts/media.`);
    });
}

startAutomation();
