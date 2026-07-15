// Fiber TV Telegram Bot — Cloudflare Worker
// Deploy: Copy this file into Cloudflare Workers dashboard
// Secrets (set via Dashboard → Settings → Variables):
//   TELEGRAM_TOKEN   — from @BotFather
//   GITHUB_TOKEN     — GitHub Personal Access Token (repo scope)
//   GITHUB_REPO      — "owner/repo-name"
//   GITHUB_BRANCH    — "main" (or "master")
//   ALLOWED_IDS      — comma-separated Telegram user IDs, e.g. "123456,789012"

addEventListener('fetch', event => {
    event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
    if (request.method !== 'POST') return new Response('ok', { status: 200 });
    const update = await request.json();
    if (!update.message) return new Response('ok', { status: 200 });
    const chatId = update.message.chat.id;
    const userId = update.message.from.id;
    const text = (update.message.text || '').trim();
    const isCmd = text.startsWith('/');
    if (!isCmd) return new Response('ok', { status: 200 });
    if (!isAllowed(userId)) {
        await sendMsg(chatId, '⛔无权使用此机器人 / غير مصرح لك باستخدام هذا البوت.');
        return new Response('ok', { status: 200 });
    }
    const parts = text.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');
    try {
        if (cmd === '/start') await cmdStart(chatId);
        else if (cmd === '/channels') await cmdChannels(chatId);
        else if (cmd === '/addchannel') await cmdAddChannel(chatId, args);
        else if (cmd === '/delchannel') await cmdDelChannel(chatId, args);
        else if (cmd === '/setchannel') await cmdSetChannel(chatId, parts);
        else if (cmd === '/notify') await cmdNotify(chatId, args);
        else await sendMsg(chatId, '❓ أمر غير معروف. الأوامر المتاحة:\n/channels\n/addchannel <url> <type>\n/delchannel <id>\n/setchannel <id> <url> <type>\n/notify title_ar | body_ar | title_en | body_en');
    } catch (e) {
        await sendMsg(chatId, '⚠️ خطأ: ' + e.message);
    }
    return new Response('ok', { status: 200 });
}

function isAllowed(userId) {
    const ids = (ALLOWED_IDS || '').split(',').map(s => parseInt(s.trim()));
    return ids.includes(userId);
}

async function sendMsg(chatId, text) {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
    await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'HTML' })
    });
}

// ---------- GitHub helpers ----------

async function ghGetFile(path) {
    const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}?ref=${GITHUB_BRANCH}`;
    const res = await fetch(url, {
        headers: { Authorization: 'token ' + GITHUB_TOKEN, Accept: 'application/vnd.github.v3+json' }
    });
    if (res.status === 404) return null;
    const data = await res.json();
    return { content: JSON.parse(decodeBase64(data.content)), sha: data.sha };
}

async function ghPutFile(path, content, sha) {
    const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`;
    const body = {
        message: 'Fiber TV Bot update: ' + path,
        content: encodeBase64(JSON.stringify(content, null, 2)),
        branch: GITHUB_BRANCH
    };
    if (sha) body.sha = sha;
    const res = await fetch(url, {
        method: 'PUT',
        headers: { Authorization: 'token ' + GITHUB_TOKEN, Accept: 'application/vnd.github.v3+json' },
        body: JSON.stringify(body)
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error('GitHub API error: ' + err);
    }
    return await res.json();
}

// ---------- Commands ----------

async function cmdStart(chatId) {
    await sendMsg(chatId, `مرحباً بك في بوت فايبر TV 🎯

الأوامر المتاحة:
/channels — عرض القنوات الحالية
/addchannel <url> <type> — إضافة قناة جديدة (type: stream أو web)
/delchannel <id> — حذف قناة
/setchannel <id> <url> <type> — تعديل قناة
/notify title_ar | body_ar | title_en | body_en — إرسال رسالة`);
}

async function cmdChannels(chatId) {
    const file = await ghGetFile('sports-channels.json');
    if (!file) return await sendMsg(chatId, '⚠️ sports-channels.json غير موجود.');
    const channels = file.content;
    if (!channels.length) return await sendMsg(chatId, '📭 لا توجد قنوات.');
    let msg = '📡 <b>القنوات الحالية:</b>\n\n';
    channels.forEach(ch => {
        const urlShort = ch.url.length > 50 ? ch.url.substring(0, 50) + '...' : ch.url;
        msg += `<b>#${ch.id}</b> ${ch.name || ''} [${ch.type}]\n<code>${urlShort}</code>\n\n`;
    });
    // Split if too long
    if (msg.length > 4000) msg = msg.substring(0, 4000) + '...';
    await sendMsg(chatId, msg);
}

async function cmdAddChannel(chatId, args) {
    // /addchannel <url> <type>
    const parts = args.split(/\s+/);
    if (parts.length < 2) return await sendMsg(chatId, '⚠️ الاستخدام: /addchannel <url> <type>\nمثال: /addchannel https://example.com/stream.m3u8 stream');
    const url = parts[0];
    const type = parts[1] === 'web' ? 'web' : 'stream';
    const file = await ghGetFile('sports-channels.json');
    const channels = file ? file.content : [];
    const newId = channels.length > 0 ? Math.max(...channels.map(c => c.id)) + 1 : 1;
    channels.push({ id: newId, name: 'قناة ' + newId, url: url, type: type });
    await ghPutFile('sports-channels.json', channels, file ? file.sha : null);
    await sendMsg(chatId, `✅ تمت إضافة القناة #${newId} بنجاح.`);
}

async function cmdDelChannel(chatId, args) {
    const id = parseInt(args);
    if (!id) return await sendMsg(chatId, '⚠️ الاستخدام: /delchannel <id>\nمثال: /delchannel 4');
    const file = await ghGetFile('sports-channels.json');
    if (!file) return await sendMsg(chatId, '⚠️ الملف غير موجود.');
    const channels = file.content;
    const idx = channels.findIndex(c => c.id === id);
    if (idx === -1) return await sendMsg(chatId, `⚠️ القناة #${id} غير موجودة.`);
    channels.splice(idx, 1);
    await ghPutFile('sports-channels.json', channels, file.sha);
    await sendMsg(chatId, `✅ تم حذف القناة #${id}.`);
}

async function cmdSetChannel(chatId, parts) {
    // /setchannel <id> <url> <type>
    if (parts.length < 4) return await sendMsg(chatId, '⚠️ الاستخدام: /setchannel <id> <url> <type>\nمثال: /setchannel 2 https://new.url/stream.m3u8 stream');
    const id = parseInt(parts[1]);
    const url = parts[2];
    const type = parts[3] === 'web' ? 'web' : 'stream';
    const file = await ghGetFile('sports-channels.json');
    if (!file) return await sendMsg(chatId, '⚠️ الملف غير موجود.');
    const channels = file.content;
    const ch = channels.find(c => c.id === id);
    if (!ch) return await sendMsg(chatId, `⚠️ القناة #${id} غير موجودة.`);
    ch.url = url;
    ch.type = type;
    await ghPutFile('sports-channels.json', channels, file.sha);
    await sendMsg(chatId, `✅ تم تحديث القناة #${id}.`);
}

async function cmdNotify(chatId, args) {
    // /notify title_ar | body_ar | title_en | body_en
    const parts = args.split('|').map(s => s.trim());
    if (parts.length < 4) return await sendMsg(chatId, '⚠️ الاستخدام:\n/notify title_ar | body_ar | title_en | body_en\n\nمثال:\n/notify تنبيه جديد | يوجد تحديث للمنصة | New Alert | Platform has been updated');
    const file = await ghGetFile('notifications.json');
    const data = file ? file.content : { messages: [] };
    const newId = data.messages.length > 0 ? Math.max(...data.messages.map(m => m.id)) + 1 : 1;
    const today = new Date().toISOString().split('T')[0];
    data.messages.push({
        id: newId,
        title_ar: parts[0],
        title_en: parts[2],
        body_ar: parts[1],
        body_en: parts[3],
        date: today,
        active: true
    });
    await ghPutFile('notifications.json', data, file ? file.sha : null);
    await sendMsg(chatId, `✅ تم إرسال الرسالة (#${newId}). ستظهر للمستخدمين عند فتح المنصة.`);
}

// ---------- Base64 utils (Cloudflare Worker has no btoa/atob) ----------

function encodeBase64(str) {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(str);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}

function decodeBase64(str) {
    const binary = atob(str);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const decoder = new TextDecoder();
    return decoder.decode(bytes);
}
