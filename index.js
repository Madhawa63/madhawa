const { default: makeWASocket, useMultiFileAuthState, delay } = require('@whiskeysockets/baileys');
const { exec } = require('child_process');
const fs = require('fs');
const pino = require('pino');
const ytdlp = require('yt-dlp-exec');

const userSessions = {};
const TARGET_PHONE_NUMBER = '94774174158'; // ඔයාගේ WhatsApp අංකය

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' })
    });

    // Pair Code එක ස්වයංක්‍රීයව ලබා ගැනීම
    if (!sock.authState.creds.registered) {
        console.log('\n📱 WhatsApp Pair Code එක ලබා ගැනීමට උත්සාහ කරමින් පවතී...');
        await delay(4000);
        try {
            let code = await sock.requestPairingCode(TARGET_PHONE_NUMBER);
            console.log(`\n✨ ඔබගේ WhatsApp Pairing Code එක මෙන්න: \x1b[32m${code}\x1b[0m\n`);
            console.log('👉 ඉක්මනින් WhatsApp -> Linked Devices -> Link with phone number වෙත ගොස් මෙම කෝඩ් එක ඇතුළත් කරන්න!\n');
        } catch (error) {
            console.error('❌ Pairing Code එක ලබාගැනීමේදී දෝෂයක් සිදු විය:', error);
        }
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection } = update;
        if (connection === 'open') {
            console.log('\n✅ WhatsApp Bot එක සාර්ථකව Connect විය! (Owner: Chalana Madhawa)\n');
        } else if (connection === 'close') {
            console.log('\n❌ කනෙක්ෂන් එක විසන්ධි වුණා. නැවත කනෙක්ට් වෙමින් පවතී...\n');
            startBot(); 
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
                             `🔹 *.fb [Facebook Link]*\n` +
                             `   └ Facebook වීඩියෝ Download කරගන්න.\n\n` +
                             `🔹 *.tik [TikTok Link]*\n` +
                             `   └ TikTok වීඩියෝ Download කරගන්න.\n\n` +
                             `🔹 *.insta [Instagram Link]*\n` +
                             `   └ Instagram Reels/Videos Download කරගන්න.\n\n` +
                             `🔹 *.yt [YouTube Link හෝ වීඩියෝවේ නම]*\n` +
                             `   └ වීඩියෝ Download කරන්න හෝ Search කරලා 10කින් තෝරන්න.\n\n` +
                             `🔹 *.song [සින්දුවේ නම]*\n` +
                             `   └ සින්දු Search කරලා MP3 විදිහට කෙළින්ම Download කරගන්න.\n\n` +
                             `🔹 *.check*\n` +
                             `   └ Bot Active ද කියලා පරීක්ෂා කරන්න.\n\n` +
                             `------------------------------------\n*Created by Chalana Madhawa*`;

            if (fs.existsSync('./menu.jpg')) {
                await sock.sendMessage(senderNumber, { image: { url: './menu.jpg' }, caption: menuText }, { quoted: msg });
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

                        const fileName = `song_${Date.now()}.mp3`;
                        try {
                            await ytdlp(selectedItem.url, {
                                extractAudio: true,
                                audioFormat: 'mp3',
                                output: fileName
                            });

                            await sock.sendMessage(senderNumber, { 
                                audio: { url: `./${fileName}` }, 
                                mimetype: 'audio/mp4',
                                caption: `🎵 *${selectedItem.title}*\n- Chalana Madhawa -`
                            }, { quoted: msg });

                            if (fs.existsSync(`./${fileName}`)) fs.unlinkSync(`./${fileName}`);
                        } catch (err) {
                            await sock.sendMessage(senderNumber, { text: `අම්මට සිරි ${pushName}.. සින්දුව ඩවුන්ලෝඩ් කරගන්න බැරි වුණා 🥲` }, { quoted: msg });
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
                let isAudio = false;
                let formatOpt = 'best';

                if (choice === '1') {
                    formatOpt = 'bestvideo[height<=720]+bestaudio/best';
                } else if (choice === '2') {
                    formatOpt = 'worst';
                } else if (choice === '3') {
                    formatOpt = 'bestaudio/best';
                    isAudio = true;
                } else {
                    await sock.sendMessage(senderNumber, { text: `කරුණාකර 1, 2 හෝ 3 තෝරන්න! ❌` }, { quoted: msg });
                    return;
                }

                const targetUrl = session.url;
                delete userSessions[senderNumber];

                await sock.sendMessage(senderNumber, { react: { text: '⏳', key: msg.key } });
                await sock.sendMessage(senderNumber, { text: `පොඩ්ඩක් ඉන්න ${pushName}, ගොනුව සකස් වෙමින් පවතී... ⏳` }, { quoted: msg });

                const ext = isAudio ? 'mp3' : 'mp4';
                const fileName = `download_${Date.now()}.${ext}`;

                try {
                    if (isAudio) {
                        await ytdlp(targetUrl, { extractAudio: true, audioFormat: 'mp3', output: fileName });
                        await sock.sendMessage(senderNumber, { audio: { url: `./${fileName}` }, mimetype: 'audio/mp4', caption: `🎵 Audio Downloaded!\n- Chalana Madhawa -` }, { quoted: msg });
                    } else {
                        await ytdlp(targetUrl, { format: formatOpt, output: fileName });
                        await sock.sendMessage(senderNumber, { video: { url: `./${fileName}` }, caption: `ඔන්න ඔයාගේ වීඩියෝ එක ${pushName}! 🎬\n- Chalana Madhawa -` }, { quoted: msg });
                    }
                    if (fs.existsSync(`./${fileName}`)) fs.unlinkSync(`./${fileName}`);
                } catch (err) {
                    await sock.sendMessage(senderNumber, { text: `අම්මට සිරි ${pushName}.. ඩවුන්ලෝඩ් කරගන්න බැරි වුණා 🥲` }, { quoted: msg });
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
                const output = await ytdlp(`ytsearch10:${query}`, {
                    dumpJson: true,
                    flatPlaylist: true
                });
                
                // Parse results safely
                const lines = output.trim().split('\n');
                const results = [];
                let responseText = `🎵 *${pushName}, "${query}" සඳහා සොයාගත් සින්දු:* \n\n`;

                lines.forEach((line, index) => {
                    try {
                        const item = JSON.parse(line);
                        if (item.title && item.id) {
                            results.push({ title: item.title, url: `https://www.youtube.com/watch?v=${item.id}` });
                            responseText += `*${index + 1}.* ${item.title}\n\n`;
                        }
                    } catch (e) {}
                });

                if (results.length === 0) {
                    await sock.sendMessage(senderNumber, { text: `සින්දු හම්බුුණේ නැහැ ${pushName} 🥲` }, { quoted: msg });
                    return;
                }

                responseText += `------------------------------------\n👉 *ඔයාට ඕන සින්දුවේ අංකය Reply කරන්න:*`;

                userSessions[senderNumber] = {
                    step: 'SELECT_SEARCH_RESULT',
                    results: results,
                    type: 'song'
                };

                await sock.sendMessage(senderNumber, { text: responseText }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(senderNumber, { text: `සින්දු සෙවීමේදී දෝෂයක් සිදු විය 🥲` }, { quoted: msg });
            }
            return;
        }

        // 5. .tik, .insta, .fb, .yt Commands handling
        if (textMessage.startsWith('.tik ') || textMessage.startsWith('.insta ') || textMessage.startsWith('.fb ')) {
            const url = textMessage.split(' ')[1];
            if (!url) return;

            await sock.sendMessage(senderNumber, { react: { text: '📥', key: msg.key } });
            await sock.sendMessage(senderNumber, { text: `පොඩ්ඩක් ඉන්න ${pushName}, බාගත වෙමින් පවතී... ⏳` }, { quoted: msg });
            const fileName = `media_${Date.now()}.mp4`;
            
            try {
                await ytdlp(url, { format: 'best', output: fileName });
                await sock.sendMessage(senderNumber, { video: { url: `./${fileName}` }, caption: `Downloaded Successfully! 🎬\n- Chalana Madhawa -` }, { quoted: msg });
                if (fs.existsSync(`./${fileName}`)) fs.unlinkSync(`./${fileName}`);
            } catch (error) {
                await sock.sendMessage(senderNumber, { text: `ඩවුන්ලෝඩ් කරගන්න බැරි වුණා බ්‍රෝ 🥲` }, { quoted: msg });
            }
            return;
        }

        if (textMessage.startsWith('.yt ')) {
            const query = textMessage.replace('.yt ', '').trim();
            if (!query) return;

            if (query.startsWith('http://') || query.startsWith('https://')) {
                userSessions[senderNumber] = { step: 'SELECT_QUALITY', url: query };
                await sendQualityPrompt(sock, senderNumber, msg, 'YouTube Video', pushName);
                return;
            }

            await sock.sendMessage(senderNumber, { react: { text: '📥', key: msg.key } });
            await sock.sendMessage(senderNumber, { text: `පොඩ්ඩක් ඉන්න ${pushName}, YouTube එකේ සොයමින් පවතී... ⏳` }, { quoted: msg });
            
            // Simple search and direct play/download logic can be added similarly if needed
        }
    });
}

async function sendQualityPrompt(sock, senderNumber, msg, title, pushName) {
    const text = `🎬 *${title}*\n\n` +
                 `හායි ${pushName}, ඔයාට ඕනෙ quality එක මොකද්ද?\n\n` +
                 `1. HD Quality (720p)\n` +
                 `2. Normal Quality (SD)\n` +
                 `3. MP3 Audio (සින්දුව විතරක් 🎵)\n\n` +
                 `👉 *අංකය (1, 2, හෝ 3) Reply කරන්න:*` +
                 `\n\n- Chalana Madhawa -`;

    await sock.sendMessage(senderNumber, { text: text }, { quoted: msg });
}

startBot();
