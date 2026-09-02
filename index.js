const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const fs = require('fs');
const pino = require('pino');
const { MongoClient } = require('mongodb');
const axios = require('axios');

// 1. Render Port Setup
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('Bot is Running Successfully! 🟢');
});

app.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});

// 2. MongoDB Setup
const mongoUrl = process.env.MONGO_URI || "mongodb+srv://chalanamadhawa63_db_user:Chalana1234@cluster0.vq5jidq.mongodb.net/?appName=Cluster0";
const client = new MongoClient(mongoUrl);

async function connectDB() {
    try {
        await client.connect();
        console.log("🟢 MongoDB එකට සාර්ථකව සම්බන්ධ විය!");
    } catch (err) {
        console.error("🔴 MongoDB සම්බන්ධ වීමේ දෝෂයක්:", err);
    }
}

connectDB();

const userSessions = {};

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('creds.update', saveCreds);

    if (!sock.authState.creds.registered) {
        const phoneNumber = "94774174158"; 
        setTimeout(async () => {
            try {
                let code = await sock.requestPairingCode(phoneNumber);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                console.log(`\n========================================`);
                console.log(`🔑 ඔන්න ඔයාගේ WhatsApp Pairing Code එක: ${code}`);
                console.log(`========================================\n`);
            } catch (err) {
                console.log("❌ Pairing Code ලබාගැනීමේදී දෝෂයක්:", err);
            }
        }, 5000);
    }

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open') {
            console.log('\n✅ WhatsApp Bot එක සාර්ථකව Connect විය! (Owner: Chalana Madhawa)\n');
        } else if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut);
            console.log('\n❌ කනෙක්ෂන් එක විසන්ධි වුණා. නැවත කනෙක්ට් වෙමින් පවතී...\n');
            if (shouldReconnect) {
                startBot();
            } else {
                console.log('⚠️ ලොග්අවුට් වී ඇත. auth_info_baileys ෆෝල්ඩර් එක මකා නැවත ලොග් වන්න.');
            }
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return; 

        const senderNumber = msg.key.remoteJid;
        const pushName = msg.pushName || 'යාළුවා'; 
        const textMessage = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();

        // 1. .check Command
        if (textMessage === '.check') {
            await sock.sendMessage(senderNumber, { react: { text: '🟢', key: msg.key } });
            await sock.sendMessage(senderNumber, { 
                text: `🤖 *Bot Status:* ආයුබෝවන් ${pushName}, මගේ බොට් නම් පට්ට විදිහට වැඩ කරනවා! 🟢\n\n- Chalana Madhawa -` 
            }, { quoted: msg });
            return;
        }

        // 2. .menu Command
        if (textMessage === '.menu') {
            await sock.sendMessage(senderNumber, { react: { text: '📋', key: msg.key } });
            const menuText = `👋 *ආයුබෝවන් ${pushName}! Chalana Madhawa ගේ Bot Menu එකට සාදරයෙන් පිළිගන්නවා!* 🎬🎵\n\n` +
                             `මෙන්න බොට්ගෙන් කරගන්න පුළුවන් වැඩ ටික:\n\n` +
                             `🔹 *.yt [YouTube Link හෝ නම]*\n` +
                             `   └ වීඩියෝ Download කරන්න හෝ Search කරන්න.\n\n` +
                             `🔹 *.song [සින්දුවේ නම]*\n` +
                             `   └ සින්දු Search කරලා MP3 Download කරගන්න.\n\n` +
                             `🔹 *.check*\n` +
                             `   └ Bot Active ද බලන්න.\n\n` +
                             `------------------------------------\n*Created by Chalana Madhawa*`;

            if (fs.existsSync('./menu.jpg')) {
                await sock.sendMessage(senderNumber, { 
                    image: { url: './menu.jpg' }, 
                    caption: menuText 
                }, { quoted: msg });
            } else {
                await sock.sendMessage(senderNumber, { text: menuText }, { quoted: msg });
            }
            return;
        }

        // 3. Session Management (Search Results & Quality Selection)
        if (userSessions[senderNumber]) {
            const session = userSessions[senderNumber];

            if (session.step === 'SELECT_SEARCH_RESULT') {
                const choice = parseInt(textMessage);
                if (choice >= 1 && choice <= session.results.length) {
                    const selectedItem = session.results[choice - 1];

                    if (session.type === 'song') {
                        delete userSessions[senderNumber];
                        await sock.sendMessage(senderNumber, { react: { text: '⏳', key: msg.key } });
                        await sock.sendMessage(senderNumber, { text: `පොඩ්ඩක් ඉන්න ${pushName}, සින්දුව බාගත වෙමින් පවතී... ⏳` }, { quoted: msg });

                        try {
                            const apiRes = await axios.get(`https://api.vyt.workers.dev/download?url=${encodeURIComponent(selectedItem.url)}&quality=mp3`);
                            const downloadUrl = apiRes.data?.url || apiRes.data?.downloadUrl;

                            if (downloadUrl) {
                                await sock.sendMessage(senderNumber, { 
                                    audio: { url: downloadUrl }, 
                                    mimetype: 'audio/mp4',
                                    caption: `🎵 *${selectedItem.title}*\n- Chalana Madhawa -`
                                }, { quoted: msg });
                            } else {
                                throw new Error('Download URL not found');
                            }
                        } catch (err) {
                            await sock.sendMessage(senderNumber, { text: `අම්මට සිරි ${pushName}.. සින්දුව හොයා ගන්න බැරි උනා 🥲` }, { quoted: msg });
                        }
                        return;
                    }

                    if (session.type === 'yt') {
                        userSessions[senderNumber] = {
                            step: 'SELECT_QUALITY',
                            url: selectedItem.url,
                            title: selectedItem.title
                        };
                        await sendQualityPrompt(sock, senderNumber, msg, selectedItem.title, pushName);
                        return;
                    }

                } else {
                    await sock.sendMessage(senderNumber, { text: `කරුණාකර ${pushName}, නිවැරදි අංකයක් දෙන්න! ❌` }, { quoted: msg });
                    return;
                }
            }

            else if (session.step === 'SELECT_QUALITY') {
                const choice = textMessage;
                let quality = '360';
                let isAudio = false;

                if (choice === '1') {
                    quality = '720';
                } else if (choice === '2') {
                    quality = '360';
                } else if (choice === '3') {
                    quality = 'mp3';
                    isAudio = true;
                } else {
                    await sock.sendMessage(senderNumber, { text: `කරුණාකර ${pushName}, 1, 2 හෝ 3 අංක වලින් එකක් තෝරන්න! ❌` }, { quoted: msg });
                    return;
                }

                const targetUrl = session.url;
                delete userSessions[senderNumber];

                await sock.sendMessage(senderNumber, { react: { text: '⏳', key: msg.key } });
                await sock.sendMessage(senderNumber, { text: `පොඩ්ඩක් ඉන්න ${pushName}, ගොනුව සකස් වෙමින් පවතී... ⏳` }, { quoted: msg });

                try {
                    const apiRes = await axios.get(`https://api.vyt.workers.dev/download?url=${encodeURIComponent(targetUrl)}&quality=${quality}`);
                    const downloadUrl = apiRes.data?.url || apiRes.data?.downloadUrl;

                    if (downloadUrl) {
                        if (isAudio) {
                            await sock.sendMessage(senderNumber, { audio: { url: downloadUrl }, mimetype: 'audio/mp4', caption: `🎵 Audio Downloaded!\n- Chalana Madhawa -` }, { quoted: msg });
                        } else {
                            await sock.sendMessage(senderNumber, { video: { url: downloadUrl }, caption: `ඔන්න ඔයාගේ වීඩියෝ එක ${pushName}! 🎬\n- Chalana Madhawa -` }, { quoted: msg });
                        }
                    } else {
                        throw new Error('Download URL not found');
                    }
                } catch (err) {
                    await sock.sendMessage(senderNumber, { text: `අම්මට සිරි ${pushName}.. ගොනුව ඩවුන්ලෝඩ් කරගන්න බැරි වුණා 🥲` }, { quoted: msg });
                }
                return;
            }
        }

        // 4. .song Command
        if (textMessage.startsWith('.song ')) {
            const query = textMessage.replace('.song ', '').trim();
            if (!query) return;

            await sock.sendMessage(senderNumber, { react: { text: '🎵', key: msg.key } });
            await sock.sendMessage(senderNumber, { text: `පොඩ්ඩක් ඉන්න ${pushName}, සින්දුව සොයමින් පවතී... ⏳` }, { quoted: msg });

            try {
                const searchRes = await axios.get(`https://api.vyt.workers.dev/search?q=${encodeURIComponent(query)}`);
                const results = searchRes.data?.results || [];

                if (results.length === 0) {
                    await sock.sendMessage(senderNumber, { text: `අම්මට සිරි ${pushName}.. ඒ නමට අදාළ සින්දු හම්බුුණේ නැහැ 🥲` }, { quoted: msg });
                    return;
                }

                let responseText = `🎵 *${pushName}, "${query}" සඳහා සොයාගත් සින්දු:* \n\n`;
                const formattedResults = [];

                results.slice(0, 10).forEach((item, index) => {
                    formattedResults.push({ title: item.title, url: item.url });
                    responseText += `*${index + 1}.* ${item.title}\n\n`;
                });

                responseText += `------------------------------------\n👉 *අංකය (1 - ${formattedResults.length}) Reply කරන්න:*`;

                userSessions[senderNumber] = {
                    step: 'SELECT_SEARCH_RESULT',
                    results: formattedResults,
                    type: 'song'
                };

                await sock.sendMessage(senderNumber, { text: responseText }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(senderNumber, { text: `සින්දු සෙවීමේදී දෝෂයක් සිදු විය 🥲` }, { quoted: msg });
            }
            return;
        }

        // 5. .yt Command
        if (textMessage.startsWith('.yt ')) {
            const query = textMessage.replace('.yt ', '').trim();
            if (!query) return;

            await sock.sendMessage(senderNumber, { react: { text: '📥', key: msg.key } });

            if (query.startsWith('http://') || query.startsWith('https://')) {
                userSessions[senderNumber] = { step: 'SELECT_QUALITY', url: query };
                await sendQualityPrompt(sock, senderNumber, msg, 'YouTube Video', pushName);
                return;
            }

            await sock.sendMessage(senderNumber, { text: `පොඩ්ඩක් ඉන්න ${pushName}, YouTube එකේ සොයමින් පවතී... ⏳` }, { quoted: msg });

            try {
                const searchRes = await axios.get(`https://api.vyt.workers.dev/search?q=${encodeURIComponent(query)}`);
                const results = searchRes.data?.results || [];

                if (results.length === 0) {
                    await sock.sendMessage(senderNumber, { text: `අම්මට සිරි ${pushName}.. වීඩියෝ හම්බුුණේ නැහැ 🥲` }, { quoted: msg });
                    return;
                }

                let responseText = `🔎 *${pushName}, "${query}" සඳහා සොයාගත් වීඩියෝ:* \n\n`;
                const formattedResults = [];

                results.slice(0, 10).forEach((item, index) => {
                    formattedResults.push({ title: item.title, url: item.url });
                    responseText += `*${index + 1}.* ${item.title}\n\n`;
                });

                responseText += `------------------------------------\n👉 *අංකය (1 - ${formattedResults.length}) Reply කරන්න:*`;

                userSessions[senderNumber] = {
                    step: 'SELECT_SEARCH_RESULT',
                    results: formattedResults,
                    type: 'yt'
                };

                await sock.sendMessage(senderNumber, { text: responseText }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(senderNumber, { text: `වීඩියෝ සෙවීමේදී දෝෂයක් සිදු විය 🥲` }, { quoted: msg });
            }
            return;
        }
    });
}

async function sendQualityPrompt(sock, senderNumber, msg, title, pushName) {
    const text = `🎬 *${title}*\n\n` +
                 `හායි ${pushName}, ඔයාට ඕනෙ quality එක මොකද්ද?\n\n` +
                 `1. Best Quality (Standard HD)\n` +
                 `2. Data Saving / SD Quality\n` +
                 `3. MP3 Audio (සින්දුව විතරක් 🎵)\n\n` +
                 `👉 *අංකය (1, 2, හෝ 3) Reply කරන්න:*` +
                 `\n\n- Chalana Madhawa -`;

    await sock.sendMessage(senderNumber, { text: text }, { quoted: msg });
}

startBot();
