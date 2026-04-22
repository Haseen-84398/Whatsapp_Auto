const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    Browsers
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const { fetchPendingGroups, markGroupAsCreated } = require('./src/sheets');

async function startSync() {
    console.log('🚀 Starting One-Time Sync...');
    const { state, saveCreds } = await useMultiFileAuthState('wa_session_data');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: Browsers.macOS('Desktop')
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection } = update;
        if (connection === 'open') {
            console.log('✅ Connected to WhatsApp!');

            const pendingGroups = await fetchPendingGroups();
            console.log(`📋 Found ${pendingGroups.length} pending groups.`);

            if (pendingGroups.length === 0) {
                console.log('✅ No groups to create. Closing...');
                process.exit(0);
            }

            for (const group of pendingGroups) {
                try {
                    console.log(`🔨 Creating: ${group.groupName}...`);
                    const defaultMembers = [
                        '918006685100@s.whatsapp.net',
                        '918006133100@s.whatsapp.net',
                        '916203620962@s.whatsapp.net',
                        '918448758878@s.whatsapp.net',
                        '918006134100@s.whatsapp.net',
                        '919226816244@s.whatsapp.net'
                    ];
                    const groupInfo = await sock.groupCreate(group.groupName, defaultMembers);
                    console.log(`✅ Created: ${groupInfo.id}`);

                    await markGroupAsCreated(group.rowIndex);

                    // Small delay to avoid ban
                    await new Promise((r) => setTimeout(r, 3000));
                } catch (err) {
                    console.error(`❌ Failed to create ${group.groupName}:`, err.message);
                    if (err.message.includes('rate-limit')) {
                        console.log('⚠️ Rate limit hit! Waiting 1 minute...');
                        await new Promise((r) => setTimeout(r, 60000));
                    }
                }
            }
            console.log('🎉 All groups processed!');
            process.exit(0);
        }
    });
}

startSync().catch((err) => {
    console.error('Fatal Error:', err);
    process.exit(1);
});
