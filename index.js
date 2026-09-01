const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const axios = require('axios');
const fs = require('fs');
const pino = require('pino');

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('Bot is Running Successfully! 🟢');
});

app.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});

const userSessions = {};

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false, // QR අයින් කර Pairing Code එක පාවිච්චි කිරීමට
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('creds.update', saveCreds);

    // Pairing Code එක ලබා ගැනීම
    if (!sock.authState.creds.registered) {
        const phoneNumber = "94774174158"; // ඔයාගේ නම්බර් එක
        setTimeout(async () => {
            try {
                let code = await sock.requestPairingCode(phoneNumber);
                console.log(`\n========================================`);
                console.log(`🔑 ඔන්න ඔයාගේ WhatsApp Pairing Code එක: ${code}`);
                console.log(`========================================\n`);
            } catch (err) {
                console.log("❌ Pairing Code එක ලබාගැනීමේදී දෝෂයක් ඇති විය:", err);
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
                console.log('⚠️ ලොග්আউট වී ඇත. කරුණාකර auth_info_baileys ෆෝල්ඩර් එක මකා නැවත ලොග් වන්න.');
            }
        }
    });
    
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return; 

        const senderNumber = msg.key.remoteJid;
        const pushName = msg.pushName || 'යාළුවා'; 
        const textMessage = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();

        if (textMessage === '.check') {
            await sock.sendMessage(senderNumber, { react: { text: '🟢', key: msg.key } });
            await sock.sendMessage(senderNumber, { 
                text: `🤖 *Bot Status:* ආයුබෝවන් ${pushName}, මගේ බොට් නම් පට්ට විදිහට වැඩ කරනවා! 🟢\n\n- Chalana Madhawa -` 
            }, { quoted: msg });
            return;
        }

        if (textMessage === '.menu') {
            await sock.sendMessage(senderNumber, { react: { text: '📋', key: msg.key } });
            const menuText = `👋 *ආයුබෝවන් ${pushName}! Chalana Madhawa ගේ Bot Menu එකට සාදරයෙන් පිළිගන්නවා!* 🎬🎵\n\n` +
                             `🔹 *.fb [Facebook Link]* - FB Video Download\n` +
                             `🔹 *.tik [TikTok Link]* - TikTok Video Download\n` +
                             `🔹 *.insta [Instagram Link]* - Insta Video Download\n` +
                             `🔹 *.yt [YouTube Link]* - YouTube Video Download\n` +
                             `🔹 *.song [සින්දුවේ නම]* - Song MP3 Download\n\n` +
                             `------------------------------------\n*Created by Chalana Madhawa*`;
            await sock.sendMessage(senderNumber, { text: menuText }, { quoted: msg });
            return;
        }

        if (userSessions[senderNumber]) {
            const session = userSessions[senderNumber];
            if (session.step === 'SELECT_SEARCH_RESULT') {
                const choice = parseInt(textMessage);
                if (choice >= 1 && choice <= session.results.length) {
                    const selectedItem = session.results[choice - 1];
                    delete userSessions[senderNumber];
                    if (session.type === 'song') {
                        await downloadAndSendMedia(sock, senderNumber, msg, selectedItem.url, 'audio', pushName, selectedItem.title);
                    } else if (session.type === 'yt') {
                        await downloadAndSendMedia(sock, senderNumber, msg, selectedItem.url, 'video', pushName, selectedItem.title);
                    }
                    return;
                } else {
                    await sock.sendMessage(senderNumber, { text: `කරුණාකර ${pushName}, නිවැරදි අංකයක් දෙන්න! ❌` }, { quoted: msg });
                    return;
                }
            }
        }

        if (textMessage.startsWith('.song ')) {
            const query = textMessage.replace('.song ', '').trim();
            if (!query) return;
            await sock.sendMessage(senderNumber, { react: { text: '🎵', key: msg.key } });
            await sock.sendMessage(senderNumber, { text: `පොඩ්ඩක් ඉන්න ${pushName}, සින්දුව සොයමින් පවතී... ⏳` }, { quoted: msg });
            try {
                const searchRes = await axios.get(`https://apis.davidcyriltech.my.id/youtube/search?query=${encodeURIComponent(query)}`);
                const results = searchRes.data.results || searchRes.data.data || [];
                if (!results.length) {
                    await sock.sendMessage(senderNumber, { text: `සින්දු හම්බුුණේ නැහැ බ්‍රෝ 🥲` }, { quoted: msg });
                    return;
                }
                let responseText = `🎵 *${pushName}, "${query}" සඳහා සොයාගත් සින්දු:* \n\n`;
                const topResults = results.slice(0, 10);
                topResults.forEach((item, index) => {
                    responseText += `*${index + 1}.* ${item.title}\n\n`;
                });
                responseText += `👉 *අංකය (1 - ${topResults.length}) Reply කරන්න:*`;
                userSessions[senderNumber] = { step: 'SELECT_SEARCH_RESULT', results: topResults, type: 'song' };
                await sock.sendMessage(senderNumber, { text: responseText }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(senderNumber, { text: `සෙවුම් දෝෂයක් ඇති විය 🥲` }, { quoted: msg });
            }
            return;
        }

        if (textMessage.startsWith('.tik ')) {
            const url = textMessage.split(' ')[1];
            if (!url) return;
            await downloadAndSendMedia(sock, senderNumber, msg, url, 'video', pushName, 'TikTok Video');
            return;
        }

        if (textMessage.startsWith('.insta ')) {
            const url = textMessage.split(' ')[1];
            if (!url) return;
            await downloadAndSendMedia(sock, senderNumber, msg, url, 'video', pushName, 'Instagram Video');
            return;
        }

        if (textMessage.startsWith('.fb ')) {
            const url = textMessage.split(' ')[1];
            if (!url) return;
            await downloadAndSendMedia(sock, senderNumber, msg, url, 'video', pushName, 'Facebook Video');
            return;
        }

        if (textMessage.startsWith('.yt ')) {
            const query = textMessage.replace('.yt ', '').trim();
            if (!query) return;
            if (query.startsWith('http://') || query.startsWith('https://')) {
                await downloadAndSendMedia(sock, senderNumber, msg, query, 'video', pushName, 'YouTube Video');
                return;
            }
            await sock.sendMessage(senderNumber, { react: { text: '📥', key: msg.key } });
            await sock.sendMessage(senderNumber, { text: `පොඩ්ඩක් ඉන්න ${pushName}, YouTube එකේ සොයමින් පවතී... ⏳` }, { quoted: msg });
            try {
                const searchRes = await axios.get(`https://apis.davidcyriltech.my.id/youtube/search?query=${encodeURIComponent(query)}`);
                const results = searchRes.data.results || searchRes.data.data || [];
                if (!results.length) {
                    await sock.sendMessage(senderNumber, { text: `වීඩියෝ හම්බුුණේ නැහැ බ්‍රෝ 🥲` }, { quoted: msg });
                    return;
                }
                let responseText = `🔎 *${pushName}, "${query}" සඳහා සොයාගත් වීඩියෝ:* \n\n`;
                const topResults = results.slice(0, 10);
                topResults.forEach((item, index) => {
                    responseText += `*${index + 1}.* ${item.title}\n\n`;
                });
                responseText += `👉 *අංකය (1 - ${topResults.length}) Reply කරන්න:*`;
                userSessions[senderNumber] = { step: 'SELECT_SEARCH_RESULT', results: topResults, type: 'yt' };
                await sock.sendMessage(senderNumber, { text: responseText }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(senderNumber, { text: `සෙවුම් දෝෂයක් ඇති විය 🥲` }, { quoted: msg });
            }
            return;
        }
    });
}

async function downloadAndSendMedia(sock, senderNumber, msg, targetUrl, type, pushName, title) {
    await sock.sendMessage(senderNumber, { react: { text: '⏳', key: msg.key } });
    await sock.sendMessage(senderNumber, { text: `පොඩ්ඩක් ඉන්න ${pushName}, ගොනුව සකස් වෙමින් පවතී... ⏳` }, { quoted: msg });
    try {
        let downloadApiUrl = `https://apis.davidcyriltech.my.id/download?url=${encodeURIComponent(targetUrl)}`;
        const response = await axios.get(downloadApiUrl);
        const data = response.data;
        let mediaUrl = data.download_url || data.url || data.video || (data.result && data.result.url);
        if (!mediaUrl) {
            await sock.sendMessage(senderNumber, { text: `අම්මට සිරි ${pushName}.. ඩවුන්ලෝඩ් ලින්ක් එක ලබාගන්න බැරි වුණා 🥲` }, { quoted: msg });
            return;
        }
        if (type === 'audio') {
            await sock.sendMessage(senderNumber, { audio: { url: mediaUrl }, mimetype: 'audio/mp4', caption: `🎵 *${title || 'Audio'}*\n- Chalana Madhawa -` }, { quoted: msg });
        } else {
            await sock.sendMessage(senderNumber, { video: { url: mediaUrl }, caption: `🎬 *${title || 'Video'}*\n- Chalana Madhawa -` }, { quoted: msg });
        }
    } catch (err) {
        console.log("Download Error:", err);
        await sock.sendMessage(senderNumber, { text: `සමාවෙන්න ${pushName}, ෆයිල් එක ඩවුන්ලෝඩ් කරද්දී දෝෂයක් මතු වුණා 🥲` }, { quoted: msg });
    }
}

startBot();
