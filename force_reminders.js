const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const pino = require('pino');
const { fetchGroupsNeedingAttendance } = require('./src/sheets');

async function run() {
    const needingReminder = await fetchGroupsNeedingAttendance();
    const todaysGroups = needingReminder.filter(g => {
        const name = g.groupName.toLowerCase();
        return name.includes('24-apr') || name.includes('24_apr') || name.includes('24 apr');
    });

    if (todaysGroups.length === 0) {
        console.log('No groups for 24 Apr need reminders.');
        process.exit(0);
    }

    const { state, saveCreds } = await useMultiFileAuthState('wa_session_data');
    const sock = makeWASocket({ auth: state, logger: pino({ level: 'silent' }) });

    sock.ev.on('connection.update', async (update) => {
        if (update.connection === 'open') {
            const allGroups = await sock.groupFetchAllParticipating();
            const groupsArray = Object.values(allGroups);
            for (const item of todaysGroups) {
                const targetGroup = groupsArray.find((g) => g.subject === item.groupName);
                if (targetGroup) {
                    await sock.sendMessage(targetGroup.id, {
                        text: `📢 *Attendance Reminder!* 📊\n\nPllease update the today's batch attendance (Present, Absent, Male, Female) in this group to maintain the records.\n\n*Format:* \nPresent - 20\nAbsent - 5\nMale - 15\nFemale - 5`
                    });
                    console.log(`Sent to: ${item.groupName}`);
                }
            }
            process.exit(0);
        }
    });
}
run();
