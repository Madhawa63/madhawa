const { default: makeWASocket, useMultiFileAuthState, delay } = require('@whiskeysockets/baileys');
const readline = require('readline');
const { exec } = require('child_process');
const fs = require('fs');
const pino = require('pino');

const userSessions = {};

// Terminal එකෙන් නම්බර් එක ලබා ගැනීමට
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});
const question = (text) => new Promise((resolve) => rl.question(text, resolve));

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' })
    });

    // Pair Code එක සඳහා පහසුකම
    if (!sock.authState.creds.registered) {
        console.log('\n📱 WhatsApp Pair Code එක ලබා ගැනීමට ඔබේ දුරකථන අංකය ඇතුළත් කරන්න (උදා: 94771234567):');
        const phoneNumber = await question('');
        await delay(3000);
        try {
            let code = await sock.requestPairingCode(phoneNumber.trim());
            console.log(`\n✨ ඔබගේ WhatsApp Pairing Code එක මෙන්න: \x1b[32m${code}\x1b[0m\n`);
            console.log('👉 WhatsApp -> Linked Devices -> Link with phone number වෙත ගොස් මෙම කෝඩ් එක ඇතුළත් කරන්න!\n');
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

        // 🔍 ටර්මිනල් එකේ JID එක බලාගැනීමට
        console.log("📍 Chat JID එක: ", senderNumber);

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
                             `------------------------------------\n` +
                             `💡 *උදාහරණයක් ලෙස:* \n` +
                             `.insta https://www.instagram.com/reel/...` +
                             `\n\n*Created by Chalana Madhawa*`;

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

                        const fileName = `song_${Date.now()}.mp3`;
                        const command = `.\\yt-dlp.exe -x --audio-format mp3 -o "${fileName}" "${selectedItem.url}"`;

                        exec(command, async (error) => {
                            if (error) {
                                await sock.sendMessage(senderNumber, { text: `අම්මට සිරි ${pushName}.. සින්දුව හොයා ගන්න බැරි උනා 🥲` }, { quoted: msg });
                                return;
                            }
                            try {
                                await sock.sendMessage(senderNumber, { 
                                    audio: { url: `./${fileName}` }, 
                                    mimetype: 'audio/mp4',
                                    caption: `🎵 *${selectedItem.title}*\n- Chalana Madhawa -`
                                }, { quoted: msg });

                                if (fs.existsSync(`./${fileName}`)) fs.unlinkSync(`./${fileName}`);
                            } catch (err) {
                                await sock.sendMessage(senderNumber, { text: 'සින්දුව යවද්දී අවුලක් වුණා බ්‍රෝ 🥲' });
                            }
                        });
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
                    await sock.sendMessage(senderNumber, { text: `කරුණාකර ${pushName}, 1 ත් 10 ත් අතර අංකයක් දෙන්න! ❌` }, { quoted: msg });
                    return;
                }
            }

            else if (session.step === 'SELECT_QUALITY') {
                const choice = textMessage;
                let formatCmd = 'best';
                let isAudio = false;

                if (choice === '1') {
                    formatCmd = 'bestvideo[height<=720]+bestaudio/best';
                } else if (choice === '2') {
                    formatCmd = 'worstvideo+worstaudio/worst';
                } else if (choice === '3') {
                    formatCmd = 'bestaudio/best';
                    isAudio = true;
                } else {
                    await sock.sendMessage(senderNumber, { text: `කරුණාකර ${pushName}, 1, 2 හෝ 3 අංක වලින් එකක් තෝරන්න! ❌` }, { quoted: msg });
                    return;
                }

                const targetUrl = session.url;
                delete userSessions[senderNumber];

                await sock.sendMessage(senderNumber, { react: { text: '⏳', key: msg.key } });
                await sock.sendMessage(senderNumber, { text: `පොඩ්ඩක් ඉන්න ${pushName}, ගොනුව සකස් වෙමින් පවතී... ⏳` }, { quoted: msg });

                const ext = isAudio ? 'mp3' : 'mp4';
                const fileName = `download_${Date.now()}.${ext}`;
                const cmdOptions = isAudio ? `-x --audio-format mp3 -o "${fileName}"` : `-f "${formatCmd}" -o "${fileName}"`;
                const command = `.\\yt-dlp.exe ${cmdOptions} "${targetUrl}"`;

                exec(command, async (error) => {
                    if (error) {
                        await sock.sendMessage(senderNumber, { text: `අම්මට සිරි ${pushName}.. ගොනුව ඩවුන්ලෝඩ් කරගන්න බැරි වුණා 🥲` }, { quoted: msg });
                        return;
                    }

                    try {
                        if (isAudio) {
                            await sock.sendMessage(senderNumber, { audio: { url: `./${fileName}` }, mimetype: 'audio/mp4', caption: `🎵 Audio Downloaded!\n- Chalana Madhawa -` }, { quoted: msg });
                        } else {
                            await sock.sendMessage(senderNumber, { video: { url: `./${fileName}` }, caption: `ඔන්න ඔයාගේ වීඩියෝ එක ${pushName}! 🎬\n- Chalana Madhawa -` }, { quoted: msg });
                        }
                        if (fs.existsSync(`./${fileName}`)) fs.unlinkSync(`./${fileName}`);
                    } catch (err) {
                        await sock.sendMessage(senderNumber, { text: 'ෆයිල් එක යවද්දී අවුලක් වුණා බ්‍රෝ 🥲' });
                    }
                });
                return;
            }
        }

        // 4. .song Command
        if (textMessage.startsWith('.song ')) {
            const query = textMessage.replace('.song ', '').trim();
            if (!query) return;

            await sock.sendMessage(senderNumber, { react: { text: '🎵', key: msg.key } });
            await sock.sendMessage(senderNumber, { text: `පොඩ්ඩක් ඉන්න ${pushName}, සින්දුව සොයමින් පවතී... ⏳` }, { quoted: msg });

            const searchCmd = `.\\yt-dlp.exe "ytsearch10:${query}" --flat-playlist --print "%(title)s|https://www.youtube.com/watch?v=%(id)s"`;

            exec(searchCmd, async (error, stdout) => {
                if (error || !stdout.trim()) {
                    await sock.sendMessage(senderNumber, { text: `අම්මට සිරි ${pushName}.. ඒ නමට අදාළ සින්දු හම්බුුණේ නැහැ 🥲` }, { quoted: msg });
                    return;
                }

                const lines = stdout.trim().split('\n');
                const results = [];
                let responseText = `🎵 *${pushName}, "${query}" සඳහා සොයාගත් සින්දු:* \n\n`;

                lines.forEach((line, index) => {
                    const [title, url] = line.split('|');
                    if (title && url) {
                        results.push({ title: title.trim(), url: url.trim() });
                        responseText += `*${index + 1}.* ${title.trim()}\n\n`;
                    }
                });

                responseText += `------------------------------------\n👉 *ඔයාට ඕන සින්දුවේ අංකය (1 - ${results.length}) Reply කරන්න:*`;

                userSessions[senderNumber] = {
                    step: 'SELECT_SEARCH_RESULT',
                    results: results,
                    type: 'song'
                };

                await sock.sendMessage(senderNumber, { text: responseText }, { quoted: msg });
            });
            return;
        }

        // 5. .tik Command
        if (textMessage.startsWith('.tik ')) {
            const url = textMessage.split(' ')[1];
            if (!url) return;

            await sock.sendMessage(senderNumber, { react: { text: '📥', key: msg.key } });
            await sock.sendMessage(senderNumber, { text: `පොඩ්ඩක් ඉන්න ${pushName}, TikTok වීඩියෝව බාගත වෙමින් පවතී... ⏳` }, { quoted: msg });
            const fileName = `tiktok_${Date.now()}.mp4`;
            
            exec(`.\\yt-dlp.exe -f "best" -o "${fileName}" "${url}"`, async (error) => {
                if (error) {
                    await sock.sendMessage(senderNumber, { text: `අම්මට සිරි ${pushName}.. TikTok වීඩියෝ එක ඩවුන්ලෝඩ් කරන්න බැරි වුණා 🥲` }, { quoted: msg });
                    return;
                }
                await sock.sendMessage(senderNumber, { video: { url: `./${fileName}` }, caption: `TikTok Video Downloaded ${pushName}! 🎬\n- Chalana Madhawa -` }, { quoted: msg });
                if (fs.existsSync(`./${fileName}`)) fs.unlinkSync(`./${fileName}`);
            });
            return;
        }

        // 6. .insta Command
        if (textMessage.startsWith('.insta ')) {
            const url = textMessage.split(' ')[1];
            if (!url) return;

            await sock.sendMessage(senderNumber, { react: { text: '📥', key: msg.key } });
            await sock.sendMessage(senderNumber, { text: `පොඩ්ඩක් ඉන්න ${pushName}, Instagram වීඩියෝව බාගත වෙමින් පවතී... ⏳` }, { quoted: msg });
            const fileName = `insta_${Date.now()}.mp4`;
            
            exec(`.\\yt-dlp.exe -f "best" -o "${fileName}" "${url}"`, async (error) => {
                if (error) {
                    await sock.sendMessage(senderNumber, { text: `අම්මට සිරි ${pushName}.. Instagram වීඩියෝ එක ඩවුන්ලෝඩ් කරන්න බැරි වුණා 🥲` }, { quoted: msg });
                    return;
                }
                await sock.sendMessage(senderNumber, { video: { url: `./${fileName}` }, caption: `Instagram Video Downloaded ${pushName}! 🎬\n- Chalana Madhawa -` }, { quoted: msg });
                if (fs.existsSync(`./${fileName}`)) fs.unlinkSync(`./${fileName}`);
            });
            return;
        }

        // 7. .fb Command
        if (textMessage.startsWith('.fb ')) {
            const url = textMessage.split(' ')[1];
            if (!url) return;

            await sock.sendMessage(senderNumber, { react: { text: '📥', key: msg.key } });
            userSessions[senderNumber] = { step: 'SELECT_QUALITY', url: url };
            await sendQualityPrompt(sock, senderNumber, msg, 'Facebook Video', pushName);
            return;
        }

        // 8. .yt Command
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

            const searchCmd = `.\\yt-dlp.exe "ytsearch10:${query}" --flat-playlist --print "%(title)s|https://www.youtube.com/watch?v=%(id)s"`;

            exec(searchCmd, async (error, stdout) => {
                if (error || !stdout.trim()) {
                    await sock.sendMessage(senderNumber, { text: `අම්මට සිරි ${pushName}.. ඒ නමට අදාළ වීඩියෝ හම්බුුණේ නැහැ 🥲` }, { quoted: msg });
                    return;
                }

                const lines = stdout.trim().split('\n');
                const results = [];
                let responseText = `🔎 *${pushName}, "${query}" සඳහා සොයාගත් වීඩියෝ:* \n\n`;

                lines.forEach((line, index) => {
                    const [title, url] = line.split('|');
                    if (title && url) {
                        results.push({ title: title.trim(), url: url.trim() });
                        responseText += `*${index + 1}.* ${title.trim()}\n\n`;
                    }
                });

                responseText += `------------------------------------\n👉 *ඔයාට ඕන වීඩියෝ එකේ අංකය (1 - ${results.length}) Reply කරන්න:*`;

                userSessions[senderNumber] = {
                    step: 'SELECT_SEARCH_RESULT',
                    results: results,
                    type: 'yt'
                };

                await sock.sendMessage(senderNumber, { text: responseText }, { quoted: msg });
            });
            return;
        }
    });
}

async function sendQualityPrompt(sock, senderNumber, msg, title, pushName) {
    const text = `🎬 *${title}*\n\n` +
                 `හායි ${pushName}, ඔයාට ඕනෙ quality එක මොකද්ද?\n\n` +
                 `1. HD Quality (720p/1080p)\n` +
                 `2. Normal/SD Quality (360p - Data ඉතුරුයි)\n` +
                 `3. MP3 Audio (සින්දුව විතරක් 🎵)\n\n` +
                 `👉 *කරුණාකර අංකය (1, 2, හෝ 3) Reply කරන්න:*` +
                 `\n\n- Chalana Madhawa -`;

    await sock.sendMessage(senderNumber, { text: text }, { quoted: msg });
}

startBot();
