const { Telegraf } = require('telegraf');
const fs = require('fs').promises;
const crypto = require('crypto');
const http = require('http');
const fetch = require('node-fetch');

const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_USER_ID = parseInt(process.env.OWNER_USER_ID);
const SESSION_DURATION = parseInt(process.env.SESSION_DURATION || 21600);
const DEFAULT_COOLDOWN = parseInt(process.env.COOLDOWN_DEFAULT || 2);
const PORT = process.env.PORT || 3000;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_FILE_PATH = process.env.GITHUB_FILE_PATH || 'config.json';
const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;

const userSessions = {};
const userStates = {};
let commandPrefix = '/';
const CONFIG_FILE = './lib/config.json';

const bot = new Telegraf(BOT_TOKEN);

async function makeLibFolder() {
    try {
        await fs.mkdir('./lib', { recursive: true });
    } catch (e) {
        
    }
}

async function getConfig() {
    await makeLibFolder();
    
    let config = await loadFromGitHub();
    
    if (!config) {
        try {
            const configData = await fs.readFile(CONFIG_FILE, 'utf8');
            config = JSON.parse(configData);
        } catch (err) {
            config = {
                users: {
                    "firekidffx": hashPass("ahmed@ibmk")
                },
                keywords: [],
                channels: {},
                groups: {},
                destination_group: null,
                cooldown: DEFAULT_COOLDOWN,
                monitoring_active: false,
                command_prefix: '/',
                statistics: {
                    messages_forwarded: 0,
                    keywords_triggered: 0,
                    last_reset: new Date().toISOString()
                }
            };
            await writeConfig(config);
        }
    } else {
        await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
    }
    
    return config;
}

function makeTag() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let tag = '';
    for (let i = 0; i < 5; i++) {
        tag += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return tag;
}

async function saveToGitHub(config) {
    if (!GITHUB_TOKEN || !GITHUB_REPO) {
        return;
    }
    
    try {
        const content = JSON.stringify(config, null, 2);
        const encodedContent = Buffer.from(content).toString('base64');
        
        let sha = '';
        try {
            const getResponse = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_FILE_PATH}`, {
                headers: {
                    'Authorization': `token ${GITHUB_TOKEN}`,
                    'User-Agent': 'TelegramBot'
                }
            });
            
            if (getResponse.ok) {
                const fileData = await getResponse.json();
                sha = fileData.sha;
            }
        } catch (e) {
            
        }
        
        const body = {
            message: 'Update config from bot',
            content: encodedContent,
            ...(sha && { sha })
        };
        
        const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_FILE_PATH}`, {
            method: 'PUT',
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Content-Type': 'application/json',
                'User-Agent': 'TelegramBot'
            },
            body: JSON.stringify(body)
        });
        
        if (!response.ok) {
            console.log('GitHub sync failed:', response.status);
        }
    } catch (error) {
        console.log('GitHub sync error:', error.message);
    }
}

async function loadFromGitHub() {
    if (!GITHUB_TOKEN || !GITHUB_REPO) {
        return null;
    }
    
    try {
        const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_FILE_PATH}`, {
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'User-Agent': 'TelegramBot'
            }
        });
        
        if (response.ok) {
            const fileData = await response.json();
            const content = Buffer.from(fileData.content, 'base64').toString();
            return JSON.parse(content);
        }
    } catch (error) {
        
    }
    
    return null;
}

function hashPass(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

function checkPass(password, hashedPassword) {
    return crypto.createHash('sha256').update(password).digest('hex') === hashedPassword;
}

async function writeConfig(configData) {
    await makeLibFolder();
    await fs.writeFile(CONFIG_FILE, JSON.stringify(configData, null, 2));
    await saveToGitHub(configData);
}

function isOwner(userId) {
    return userId === OWNER_USER_ID;
}

function isAdmin(username, userId) {
    return username === 'firekidffx' || userId === OWNER_USER_ID;
}

function isLoggedIn(userId) {
    if (isAdmin(null, userId)) {
        return true;
    }
    
    if (!userSessions[userId]) {
        return false;
    }
    const sessionTime = new Date(userSessions[userId]);
    const now = new Date();
    return (now - sessionTime) < (SESSION_DURATION * 1000);
}

function loginUser(userId) {
    userSessions[userId] = new Date().toISOString();
}

bot.start((ctx) => {
    const username = ctx.from.username;
    const userId = ctx.from.id;
    
    if (isAdmin(username, userId)) {
        ctx.reply(`Welcome admin @${username}! You have full access. Use /commands to see available commands.`);
    } else {
        ctx.reply("Whatsup, i think you are lost, if you are not, Please state your business");
    }
});

bot.command('login', (ctx) => {
    const userId = ctx.from.id;
    const username = ctx.from.username;
    
    if (isAdmin(username, userId)) {
        ctx.reply("You are admin, no login needed!");
        return;
    }
    
    if (isLoggedIn(userId)) {
        ctx.reply("You are already logged in!");
        return;
    }
    
    userStates[userId] = { state: "need_username" };
    ctx.reply("Enter your username:");
});

bot.command('newuser', async (ctx) => {
    const userId = ctx.from.id;
    const username = ctx.from.username;
    
    if (!isOwner(userId) && !isAdmin(username, userId)) {
        ctx.reply("Access denied");
        return;
    }
    
    if (!isLoggedIn(userId)) {
        ctx.reply("Please login first");
        return;
    }
    
    userStates[userId] = { state: "new_user_name" };
    ctx.reply("Enter new username:");
});

bot.command('activate', async (ctx) => {
    const userId = ctx.from.id;
    const username = ctx.from.username;
    
    if (!isOwner(userId) && !isAdmin(username, userId)) {
        ctx.reply("Access denied");
        return;
    }
    
    if (!isLoggedIn(userId)) {
        ctx.reply("Please login first");
        return;
    }
    
    const config = await getConfig();
    config.monitoring_active = true;
    await writeConfig(config);
    ctx.reply("Monitoring activated!");
});

bot.command('deactivate', async (ctx) => {
    const userId = ctx.from.id;
    const username = ctx.from.username;
    
    if (!isOwner(userId) && !isAdmin(username, userId)) {
        ctx.reply("Access denied");
        return;
    }
    
    if (!isLoggedIn(userId)) {
        ctx.reply("Please login first");
        return;
    }
    
    const config = await getConfig();
    config.monitoring_active = false;
    await writeConfig(config);
    ctx.reply("Monitoring deactivated!");
});

bot.command('prefix', async (ctx) => {
    const userId = ctx.from.id;
    const username = ctx.from.username;
    
    if (!isOwner(userId) && !isAdmin(username, userId)) {
        ctx.reply("Access denied");
        return;
    }
    
    if (!isLoggedIn(userId)) {
        ctx.reply("Please login first");
        return;
    }
    
    const newPrefix = ctx.message.text.split(' ')[1];
    if (!newPrefix) {
        ctx.reply("Usage: /prefix <new_prefix>");
        return;
    }
    
    const config = await getConfig();
    config.command_prefix = newPrefix;
    await writeConfig(config);
    commandPrefix = newPrefix;
    ctx.reply(`Command prefix changed to: ${newPrefix}`);
});

bot.command('forwardgrp', async (ctx) => {
    const userId = ctx.from.id;
    
    if (!isLoggedIn(userId)) {
        ctx.reply("Please login first");
        return;
    }
    
    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
        const config = await getConfig();
        const currentDestination = config.destination_group || "Not set";
        ctx.reply(`Current forward destination: ${currentDestination}\nUsage: /forwardgrp @groupname`);
        return;
    }
    
    const destinationGroup = args[1];
    if (!destinationGroup.startsWith('@')) {
        ctx.reply("Group name must start with @ (e.g., @mygroup)");
        return;
    }
    
    const config = await getConfig();
    config.destination_group = destinationGroup;
    await writeConfig(config);
    
    ctx.reply(`✅ Forward destination set to: ${destinationGroup}\n\nAll monitored messages will now be forwarded to this group.`);
});

bot.command('commands', async (ctx) => {
    const userId = ctx.from.id;
    const username = ctx.from.username;
    
    if (!isLoggedIn(userId)) {
        ctx.reply("Please login first");
        return;
    }
    
    let commandText = `Available commands:
${commandPrefix}commands - Show this list
${commandPrefix}stats - Show statistics
${commandPrefix}cooldown <minutes> - Set cooldown
${commandPrefix}forwardgrp @group - Set forward destination
${commandPrefix}channeladd @channel - Add channel
${commandPrefix}groupadd @group - Add group
${commandPrefix}removechannel <tag> - Remove channel
${commandPrefix}removegroup <tag> - Remove group
${commandPrefix}words word1,word2,word3 - Set keywords
${commandPrefix}removeword <word> - Remove keyword
${commandPrefix}listkeywords - List keywords
${commandPrefix}listchannels - List channels
${commandPrefix}listgroups - List groups
${commandPrefix}showconfig - Show configuration
${commandPrefix}logout - Logout`;
    
    if (isOwner(userId) || isAdmin(username, userId)) {
        commandText += `

Owner/Admin only:
${commandPrefix}newuser - Add new user
${commandPrefix}activate - Start monitoring
${commandPrefix}deactivate - Stop monitoring
${commandPrefix}prefix <new> - Change prefix`;
    }
    
    ctx.reply(commandText);
});

bot.command('stats', async (ctx) => {
    const userId = ctx.from.id;
    
    if (!isLoggedIn(userId)) {
        ctx.reply("Please login first");
        return;
    }
    
    const config = await getConfig();
    const stats = config.statistics || {};
    
    const lastReset = new Date(stats.last_reset || new Date());
    const daysSince = Math.floor((new Date() - lastReset) / (1000 * 60 * 60 * 24));
    
    const status = config.monitoring_active ? "Active" : "Inactive";
    
    const statsText = `📊 Statistics (Last 7 days):
Status: ${status}
Messages forwarded: ${stats.messages_forwarded || 0}
Keywords triggered: ${stats.keywords_triggered || 0}
Monitored channels: ${Object.keys(config.channels || {}).length}
Monitored groups: ${Object.keys(config.groups || {}).length}
Active keywords: ${(config.keywords || []).length}
Days since reset: ${daysSince}`;
    
    ctx.reply(statsText);
});

bot.command('cooldown', async (ctx) => {
    const userId = ctx.from.id;
    
    if (!isLoggedIn(userId)) {
        ctx.reply("Please login first");
        return;
    }
    
    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
        const config = await getConfig();
        const currentCooldown = config.cooldown || DEFAULT_COOLDOWN;
        ctx.reply(`Current cooldown: ${currentCooldown} minutes\nUsage: /cooldown <minutes>`);
        return;
    }
    
    const minutes = parseInt(args[1]);
    if (isNaN(minutes) || minutes < 1 || minutes > 60) {
        ctx.reply("Cooldown must be between 1 and 60 minutes");
        return;
    }
    
    const config = await getConfig();
    config.cooldown = minutes;
    await writeConfig(config);
    ctx.reply(`Cooldown set to ${minutes} minutes`);
});

bot.command('channeladd', async (ctx) => {
    const userId = ctx.from.id;
    
    if (!isLoggedIn(userId)) {
        ctx.reply("Please login first");
        return;
    }
    
    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
        ctx.reply("Usage: /channeladd @channel");
        return;
    }
    
    const channelName = args[1];
    if (!channelName.startsWith('@')) {
        ctx.reply("Channel name must start with @");
        return;
    }
    
    const config = await getConfig();
    let tag = makeTag();
    
    while (config.channels && config.channels[tag]) {
        tag = makeTag();
    }
    
    if (!config.channels) {
        config.channels = {};
    }
    
    config.channels[tag] = {
        name: channelName,
        added_date: new Date().toISOString()
    };
    
    await writeConfig(config);
    ctx.reply(`Channel ${channelName} added with tag: CH${tag}`);
});

bot.command('groupadd', async (ctx) => {
    const userId = ctx.from.id;
    
    if (!isLoggedIn(userId)) {
        ctx.reply("Please login first");
        return;
    }
    
    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
        ctx.reply("Usage: /groupadd @group");
        return;
    }
    
    const groupName = args[1];
    if (!groupName.startsWith('@')) {
        ctx.reply("Group name must start with @");
        return;
    }
    
    const config = await getConfig();
    let tag = makeTag();
    
    while (config.groups && config.groups[tag]) {
        tag = makeTag();
    }
    
    if (!config.groups) {
        config.groups = {};
    }
    
    config.groups[tag] = {
        name: groupName,
        added_date: new Date().toISOString()
    };
    
    await writeConfig(config);
    ctx.reply(`Group ${groupName} added with tag: GR${tag}`);
});

bot.command('removechannel', async (ctx) => {
    const userId = ctx.from.id;
    
    if (!isLoggedIn(userId)) {
        ctx.reply("Please login first");
        return;
    }
    
    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
        ctx.reply("Usage: /removechannel CH12345");
        return;
    }
    
    const tagInput = args[1];
    const tag = tagInput.replace("CH", "");
    
    const config = await getConfig();
    if (config.channels && config.channels[tag]) {
        const channelName = config.channels[tag].name;
        delete config.channels[tag];
        await writeConfig(config);
        ctx.reply(`Channel ${channelName} removed`);
    } else {
        ctx.reply("Channel tag not found");
    }
});

bot.command('removegroup', async (ctx) => {
    const userId = ctx.from.id;
    
    if (!isLoggedIn(userId)) {
        ctx.reply("Please login first");
        return;
    }
    
    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
        ctx.reply("Usage: /removegroup GR12345");
        return;
    }
    
    const tagInput = args[1];
    const tag = tagInput.replace("GR", "");
    
    const config = await getConfig();
    if (config.groups && config.groups[tag]) {
        const groupName = config.groups[tag].name;
        delete config.groups[tag];
        await writeConfig(config);
        ctx.reply(`Group ${groupName} removed`);
    } else {
        ctx.reply("Group tag not found");
    }
});

bot.command('words', async (ctx) => {
    const userId = ctx.from.id;
    
    if (!isLoggedIn(userId)) {
        ctx.reply("Please login first");
        return;
    }
    
    const args = ctx.message.text.split(' ').slice(1);
    if (args.length === 0) {
        ctx.reply("Usage: /words crypto,bitcoin,news");
        return;
    }
    
    const keywordsInput = args.join(' ');
    const keywordsList = keywordsInput.split(',').map(word => word.trim()).filter(word => word.length > 0);
    
    const config = await getConfig();
    config.keywords = keywordsList;
    await writeConfig(config);
    
    ctx.reply(`Keywords set: ${keywordsList.join(', ')}`);
});

bot.command('removeword', async (ctx) => {
    const userId = ctx.from.id;
    
    if (!isLoggedIn(userId)) {
        ctx.reply("Please login first");
        return;
    }
    
    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
        ctx.reply("Usage: /removeword keyword");
        return;
    }
    
    const wordToRemove = args[1].trim();
    const config = await getConfig();
    
    if (config.keywords && config.keywords.includes(wordToRemove)) {
        config.keywords = config.keywords.filter(word => word !== wordToRemove);
        await writeConfig(config);
        ctx.reply(`Keyword '${wordToRemove}' removed`);
    } else {
        ctx.reply("Keyword not found");
    }
});

bot.command('listkeywords', async (ctx) => {
    const userId = ctx.from.id;
    
    if (!isLoggedIn(userId)) {
        ctx.reply("Please login first");
        return;
    }
    
    const config = await getConfig();
    const keywords = config.keywords || [];
    
    if (keywords.length === 0) {
        ctx.reply("No keywords set");
        return;
    }
    
    const keywordsText = "Current keywords:\n" + keywords.map(word => `• ${word}`).join('\n');
    ctx.reply(keywordsText);
});

bot.command('listchannels', async (ctx) => {
    const userId = ctx.from.id;
    
    if (!isLoggedIn(userId)) {
        ctx.reply("Please login first");
        return;
    }
    
    const config = await getConfig();
    const channels = config.channels || {};
    
    if (Object.keys(channels).length === 0) {
        ctx.reply("No channels added");
        return;
    }
    
    let channelsText = "Monitored channels:\n";
    for (const [tag, data] of Object.entries(channels)) {
        channelsText += `• CH${tag}: ${data.name}\n`;
    }
    
    ctx.reply(channelsText);
});

bot.command('listgroups', async (ctx) => {
    const userId = ctx.from.id;
    
    if (!isLoggedIn(userId)) {
        ctx.reply("Please login first");
        return;
    }
    
    const config = await getConfig();
    const groups = config.groups || {};
    
    if (Object.keys(groups).length === 0) {
        ctx.reply("No groups added");
        return;
    }
    
    let groupsText = "Monitored groups:\n";
    for (const [tag, data] of Object.entries(groups)) {
        groupsText += `• GR${tag}: ${data.name}\n`;
    }
    
    ctx.reply(groupsText);
});

bot.command('showconfig', async (ctx) => {
    const userId = ctx.from.id;
    
    if (!isLoggedIn(userId)) {
        ctx.reply("Please login first");
        return;
    }
    
    const config = await getConfig();
    
    let configText = `📋 Configuration:

Status: ${config.monitoring_active ? 'Active' : 'Inactive'}
Forward destination: ${config.destination_group || 'Not set'}
Cooldown: ${config.cooldown || DEFAULT_COOLDOWN} minutes
Command prefix: ${config.command_prefix || '/'}

Keywords (${(config.keywords || []).length}): ${(config.keywords || []).join(', ')}

Channels (${Object.keys(config.channels || {}).length}):`;
    
    for (const [tag, data] of Object.entries(config.channels || {})) {
        configText += `\n• CH${tag}: ${data.name}`;
    }
    
    configText += `\n\nGroups (${Object.keys(config.groups || {}).length}):`;
    for (const [tag, data] of Object.entries(config.groups || {})) {
        configText += `\n• GR${tag}: ${data.name}`;
    }
    
    ctx.reply(configText);
});

bot.command('logout', (ctx) => {
    const userId = ctx.from.id;
    
    if (userSessions[userId]) {
        delete userSessions[userId];
        ctx.reply("Logged out successfully!");
    } else {
        ctx.reply("You are not logged in.");
    }
});

bot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    const messageText = ctx.message.text;
    
    if (!userStates[userId]) {
        return;
    }
    
    const userState = userStates[userId];
    
    if (userState.state === "need_username") {
        userStates[userId] = { state: "need_password", username: messageText };
        ctx.reply("Enter your password:");
    } else if (userState.state === "need_password") {
        const username = userState.username;
        const config = await getConfig();
        
        if (config.users && config.users[username]) {
            const storedHash = config.users[username];
            
            if (checkPass(messageText, storedHash)) {
                loginUser(userId);
                delete userStates[userId];
                ctx.reply("Login successful!");
                return;
            }
        }
        
        delete userStates[userId];
        ctx.reply("Invalid credentials");
    } else if (userState.state === "new_user_name") {
        userStates[userId] = { state: "new_user_pass", new_username: messageText };
        ctx.reply("Enter password for new user:");
    } else if (userState.state === "new_user_pass") {
        const newUsername = userState.new_username;
        const newPasswordHash = hashPass(messageText);
        
        const config = await getConfig();
        if (!config.users) {
            config.users = {};
        }
        
        config.users[newUsername] = newPasswordHash;
        await writeConfig(config);
        
        delete userStates[userId];
        ctx.reply(`User '${newUsername}' created successfully!`);
    }
});

if (!BOT_TOKEN) {
    console.log('Bot token not found');
    process.exit(1);
}

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot is running');
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

async function selfPing() {
    if (RENDER_EXTERNAL_URL) {
        try {
            const response = await fetch(RENDER_EXTERNAL_URL);
            if (response.ok) {
                console.log('✅ Self-ping successful');
            } else {
                console.log('❌ Self-ping failed:', response.status);
            }
        } catch (error) {
            console.log('❌ Self-ping error:', error.message);
        }
    } else {
        console.log('💓 Keep-alive ping (no external URL configured)');
    }
}

setInterval(selfPing, 10 * 60 * 1000);

console.log('Starting bot...');
bot.launch().then(() => {
    console.log('Bot is running');
}).catch(err => {
    console.log('Error starting bot:', err);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
