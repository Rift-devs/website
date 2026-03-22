// API is permanently at api.rift.baby via Cloudflare Worker — no Gist needed.
const CLIENT_ID = "1329184069426348052";
const API_BASE  = "https://api.rift.baby/api";
const WS_URL    = "wss://api.rift.baby/ws";
console.log('[Config] API_BASE=https://api.rift.baby/api (static)');

async function loadConfig() {
    // Nothing to load — URL is permanent
}

// State
let ws = null;
let userProfile = null;
let selectedGuildId = null;
let currentTrackDuration = 0;
let isSeeking = false;
let isPlaying = false;

// Interpolation Engine (For smooth lyrics)
let localTimeMs = 0;
let lastSyncTimestamp = 0;
let lyricsData = [];
let activeLyricIndex = -1;

// Initialization
document.addEventListener('DOMContentLoaded', async () => {
    await loadConfig();
    initFallingStars();
    initTabs();
    initWebSocket();
    checkAuth();
    
    // Music Event Listeners
    document.getElementById('musicGuildSelect')?.addEventListener('change', (e) => {
        selectedGuildId = e.target.value;
        updateMusicState();
    });

    const seekBar = document.getElementById('seekBar');
    seekBar.addEventListener('input', () => { isSeeking = true; updateRangeFill(seekBar); });
    seekBar.addEventListener('change', (e) => {
        isSeeking = false;
        const newPos = (e.target.value / 100) * currentTrackDuration;
        musicControl('seek', newPos);
        localTimeMs = newPos;
        lastSyncTimestamp = Date.now();
        updateRangeFill(seekBar);
    });

    const volumeSlider = document.getElementById('volumeSlider');
    volumeSlider.addEventListener('input', () => {
        updateRangeFill(volumeSlider);
        const val = document.getElementById('volumeVal');
        if (val) val.textContent = volumeSlider.value + '%';
    });
    volumeSlider.addEventListener('change', (e) => {
        musicControl('volume', e.target.value);
        updateRangeFill(volumeSlider);
    });
    updateRangeFill(volumeSlider);

    // Search Box Listener
    let searchTimeout;
    const searchInput = document.getElementById('songSearchInput');
    searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        const q = e.target.value.trim();
        if (!q) {
            document.getElementById('searchResults').classList.add('hidden');
            return;
        }
        searchTimeout = setTimeout(() => searchMusic(q), 500);
    });

    // Start Animation Loop for smooth progress & lyrics
    requestAnimationFrame(animationLoop);

    // Init waveform visualizer (deferred so canvas is sized)
    setTimeout(() => _wv.init(), 100);
});

/* ================= BACKGROUND ANIMATION ================= */
function initFallingStars() {
    const canvas = document.getElementById('dashboard-stars-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let width, height, stars = [];

    function resize() {
        width = canvas.width = window.innerWidth;
        height = canvas.height = window.innerHeight;
    }

    function createStar() {
        return {
            x: Math.random() * width,
            y: Math.random() * height,
            r: Math.random() * 1.5 + 0.5,
            speed: Math.random() * 0.5 + 0.1,
            opacity: Math.random() * 0.5 + 0.1,
            pulseSpeed: Math.random() * 0.02 + 0.005,
            pulseOffset: Math.random() * Math.PI * 2
        };
    }

    function init() {
        resize();
        stars = Array.from({ length: 150 }, createStar);
    }

    let frame = 0;
    let _lastStarDraw = 0;
    function draw(ts) {
        requestAnimationFrame(draw);
        if (ts - _lastStarDraw < 50) return; // ~20fps
        _lastStarDraw = ts;
        ctx.clearRect(0, 0, width, height);
        frame++;
        for (let s of stars) {
            s.y += s.speed;
            if (s.y > height + 5) {
                s.y = -5;
                s.x = Math.random() * width;
            }
            const pulse = s.opacity * (0.5 + 0.5 * Math.sin(frame * s.pulseSpeed + s.pulseOffset));
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255,255,255,${pulse})`;
            ctx.fill();
        }
    }

    window.addEventListener('resize', resize);
    init();
    draw();
}

/* ================= NAVIGATION ================= */
function initTabs() {
    const links = document.querySelectorAll('.nav-links li:not(.nav-coming-soon)');
    links.forEach(link => {
        link.addEventListener('click', () => {
            const target = link.dataset.tab;
            if (!target) return;

            links.forEach(l => l.classList.remove('active'));
            link.classList.add('active');

            document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
            document.getElementById(target).classList.add('active');

            const titles = { music: 'Music Player', stocks: 'Stock Market', lastfm: 'Last.fm',
                             moderation: 'Moderation & Analytics', settings: 'Settings', vccall: 'VC Calls' };
            document.getElementById('activeTabTitle').textContent = titles[target] || target;

            // Sync mobile bottom nav highlight
            document.querySelectorAll('.mobile-tab[data-maintab]').forEach(t => {
                t.classList.toggle('active', t.dataset.maintab === target);
            });

            if (target === 'stocks'     && typeof window.initStocks     === 'function') window.initStocks();
            if (target === 'lastfm'     && typeof window.initLastfm     === 'function') window.initLastfm();
            if (target === 'moderation' && typeof window.initModeration === 'function') window.initModeration();
            if (target === 'settings'   && typeof window.initSettings   === 'function') window.initSettings();
            if (target === 'vccall'     && typeof window.initVcCall     === 'function') window.initVcCall();

            if (window.innerWidth <= 768) closeSidebar();
        });
    });
}

/* ================= WEBSOCKET (STATS) ================= */
let _wsRetryDelay = 3000;  // declared outside so backoff persists across reconnects
function initWebSocket() {
    ws = new WebSocket(WS_URL);
    
    ws.onopen = () => {
        _wsRetryDelay = 3000; // reset on successful connect
        document.getElementById('connectionStatus').textContent = "Connected";
        document.querySelector('.status-indicator').className = "status-indicator online";
    };
    
    ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.type === 'stats') {
            updateStats(message.data);
        } else if (message.type === 'music_state' && message.guild_id === String(selectedGuildId)) {
            // Server pushed music state -- apply it directly, no HTTP needed
            _applyMusicState(message.data);
        }
    };
    
    ws.onclose = () => {
        document.getElementById('connectionStatus').textContent = "Reconnecting...";
        document.querySelector('.status-indicator').className = "status-indicator";
        // Exponential backoff: 3s → 6s → 12s → 24s → cap at 30s
        setTimeout(initWebSocket, _wsRetryDelay);
        _wsRetryDelay = Math.min(_wsRetryDelay * 2, 30000);
    };
}

function updateStats(data) {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    const setStyle = (id, prop, val) => { const el = document.getElementById(id); if (el) el.style[prop] = val; };
    set('stat-servers', data.servers);
    set('stat-users', data.users);
    set('stat-ping', `${data.latency}ms`);
    const h = Math.floor(data.uptime / 3600);
    const m = Math.floor((data.uptime % 3600) / 60);
    set('stat-uptime', `${h}h ${m}m`);
    set('stat-cpu', `${data.cpu}%`);
    setStyle('cpu-progress', 'width', `${data.cpu}%`);
    set('stat-ram', `${data.ram_percent}%`);
    setStyle('ram-progress', 'width', `${data.ram_percent}%`);
}

/* ================= AUTHENTICATION ================= */
function login() {
    const redirect = encodeURIComponent(window.location.href.split('#')[0]);
    window.location.href = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${redirect}&response_type=token&scope=identify%20guilds`;
}

async function checkAuth() {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    let token = fragment.get('access_token') || localStorage.getItem('d_token');
    
    if (token) {
        localStorage.setItem('d_token', token);
        window.history.replaceState({}, document.title, window.location.pathname);
        await fetchProfile(token);
    } else {
        showLoginWall();
    }
}

function showLoginWall() {
    // Blur everything and force login
    let wall = document.getElementById('loginWall');
    if (!wall) {
        wall = document.createElement('div');
        wall.id = 'loginWall';
        wall.innerHTML = `
            <div class="login-wall-inner">
                <img src="https://i.postimg.cc/D0DrrFt3/110c46fc7f5cf0c4e29f872107d7bf97.png" class="login-wall-logo">
                <h1 class="login-wall-title">RIFT</h1>
                <p class="login-wall-sub">Sign in with Discord to access the dashboard</p>
                <button class="login-wall-btn" onclick="login()">
                    <i class="fa-brands fa-discord"></i> Login with Discord
                </button>
            </div>`;
        document.body.appendChild(wall);
    }
    wall.classList.add('active');
}

function hideLoginWall() {
    const wall = document.getElementById('loginWall');
    if (wall) wall.classList.remove('active');
}

async function fetchProfile(token) {
    try {
        const res = await fetch('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${token}` }
        });
        userProfile = await res.json();

        if (!userProfile.id) {
            localStorage.removeItem('d_token');
            showLoginWall();
            return;
        }

        hideLoginWall();
        // Apply saved theme prefs immediately on login
        if (typeof window.applyStoredPrefs === 'function') window.applyStoredPrefs();
        renderUserCard(userProfile);
        fetchGuilds(token);
    } catch (e) {
        localStorage.removeItem('d_token');
        showLoginWall();
    }
}

function renderUserCard(u) {
    const avatar = u.avatar
        ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.${u.avatar.startsWith('a_') ? 'gif' : 'png'}?size=128`
        : `https://cdn.discordapp.com/embed/avatars/${parseInt(u.id) % 5}.png`;

    const statusColor = '#23a559'; // online green — we show them as online since they're here

    document.getElementById('userCard').innerHTML = `
        <div class="sidebar-user-card" onclick="toggleProfilePopup()" id="sidebarUserTrigger">
            <div class="sidebar-user-avatar-wrap">
                <img src="${avatar}" class="sidebar-user-avatar" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'">
                <span class="sidebar-user-status"></span>
            </div>
            <div class="sidebar-user-info">
                <span class="sidebar-user-name">${escProfile(u.global_name || u.username)}</span>
                <span class="sidebar-user-tag">@${escProfile(u.username)}</span>
            </div>
            <button class="sidebar-logout-btn" onclick="event.stopPropagation(); logout()" title="Log out">
                <i class="fa-solid fa-right-from-bracket"></i>
            </button>
        </div>
    `;

    buildProfilePopup(u, avatar);
}

function buildProfilePopup(u, avatar) {
    // Remove old popup if exists
    const old = document.getElementById('discordProfilePopup');
    if (old) old.remove();

    const banner = u.banner
        ? `https://cdn.discordapp.com/banners/${u.id}/${u.banner}.${u.banner.startsWith('a_') ? 'gif' : 'png'}?size=480`
        : null;

    const accentColor = u.accent_color
        ? `#${u.accent_color.toString(16).padStart(6, '0')}`
        : '#7289da';

    const badges = buildBadges(u);
    const nitroSince = u.premium_type > 0 ? getNitroLabel(u.premium_type) : null;

    const popup = document.createElement('div');
    popup.id = 'discordProfilePopup';
    popup.className = 'discord-profile-popup hidden';
    popup.innerHTML = `
        <div class="dpp-banner" style="${banner
            ? `background-image:url(${banner})`
            : `background-color:${accentColor}`}">
        </div>
        <div class="dpp-avatar-row">
            <div class="dpp-avatar-wrap">
                <img src="${avatar}" class="dpp-avatar" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'">
                <span class="dpp-status-dot"></span>
            </div>
            ${badges ? `<div class="dpp-badges">${badges}</div>` : ''}
        </div>
        <div class="dpp-body">
            <div class="dpp-name">${escProfile(u.global_name || u.username)}</div>
            <div class="dpp-username">@${escProfile(u.username)}${u.discriminator && u.discriminator !== '0' ? '#' + u.discriminator : ''}</div>
            ${nitroSince ? `<div class="dpp-nitro"><i class="fa-solid fa-gem"></i> ${nitroSince}</div>` : ''}
            <div class="dpp-divider"></div>
            <div class="dpp-section-label">MEMBER SINCE</div>
            <div class="dpp-since">${getDiscordMemberSince(u.id)}</div>
            <div class="dpp-divider"></div>
            <button class="dpp-logout-btn" onclick="logout()">
                <i class="fa-solid fa-right-from-bracket"></i> Log Out
            </button>
        </div>
    `;
    document.body.appendChild(popup);

    // Close on outside click
    document.addEventListener('click', function _close(e) {
        if (!e.target.closest('#discordProfilePopup') && !e.target.closest('#sidebarUserTrigger')) {
            popup.classList.add('hidden');
            document.removeEventListener('click', _close);
        }
    });
}

function buildBadges(u) {
    const flags = u.public_flags || 0;
    const badges = [];
    if (flags & (1 << 0))  badges.push('<span class="dpp-badge" title="Discord Staff">🛡️</span>');
    if (flags & (1 << 2))  badges.push('<span class="dpp-badge" title="HypeSquad Bravery">🏠</span>');
    if (flags & (1 << 6))  badges.push('<span class="dpp-badge" title="HypeSquad Brilliance">💎</span>');
    if (flags & (1 << 7))  badges.push('<span class="dpp-badge" title="HypeSquad Balance">⚖️</span>');
    if (flags & (1 << 3))  badges.push('<span class="dpp-badge" title="Early Supporter">🏷️</span>');
    if (flags & (1 << 17)) badges.push('<span class="dpp-badge" title="Bug Hunter">🐛</span>');
    if (flags & (1 << 14)) badges.push('<span class="dpp-badge" title="Bug Hunter Gold">🏅</span>');
    if (flags & (1 << 18)) badges.push('<span class="dpp-badge" title="Active Developer">💻</span>');
    if (u.premium_type > 0) badges.push('<span class="dpp-badge" title="Nitro">💜</span>');
    return badges.join('');
}

function getNitroLabel(type) {
    if (type === 1) return 'Nitro Classic';
    if (type === 2) return 'Nitro';
    if (type === 3) return 'Nitro Basic';
    return 'Nitro';
}

function getDiscordMemberSince(userId) {
    // Snowflake timestamp
    const ms = (BigInt(userId) >> 22n) + 1420070400000n;
    return new Date(Number(ms)).toLocaleDateString('en', { day: 'numeric', month: 'long', year: 'numeric' });
}

function escProfile(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

window.toggleProfilePopup = function() {
    const popup = document.getElementById('discordProfilePopup');
    if (!popup) return;
    popup.classList.toggle('hidden');
    if (!popup.classList.contains('hidden')) {
        // Position above the user card
        const trigger = document.getElementById('sidebarUserTrigger');
        const rect = trigger.getBoundingClientRect();
        popup.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
        popup.style.left = rect.left + 'px';
    }
};

window.logout = function() {
    localStorage.removeItem('d_token');
    userProfile = null;
    const popup = document.getElementById('discordProfilePopup');
    if (popup) popup.remove();
    document.getElementById('userCard').innerHTML = `
        <button class="login-btn" onclick="login()">
            <i class="fa-brands fa-discord"></i> Login
        </button>`;
    showLoginWall();
};

async function fetchGuilds(token) {
    const res = await fetch('https://discord.com/api/users/@me/guilds', {
        headers: { Authorization: `Bearer ${token}` }
    });
    const guilds = await res.json();
    const adminGuilds = guilds.filter(g => (BigInt(g.permissions) & 0x8n) || (BigInt(g.permissions) & 0x20n));
    
    const menu = document.getElementById('guildDropdownMenu');
    menu.innerHTML = '';

    adminGuilds.forEach(g => {
        const iconUrl = g.icon
            ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png`
            : null;

        const item = document.createElement('div');
        item.className = 'guild-dropdown-item';
        item.dataset.id = g.id;
        item.dataset.name = g.name;
        item.dataset.icon = iconUrl || '';
        item.innerHTML = iconUrl
            ? `<img src="${iconUrl}" alt="${g.name}">`
            : `<div class="guild-initial">${g.name.charAt(0).toUpperCase()}</div>`;
        item.innerHTML += `<span>${g.name}</span>`;

        item.addEventListener('click', () => {
            selectedGuildId = g.id;
            window._selectedGuildId = g.id;
            if (typeof window._onGuildSelected === 'function') window._onGuildSelected(g.id);

            // Update selected display
            const selected = document.getElementById('guildDropdownSelected');
            selected.innerHTML = iconUrl
                ? `<div class="guild-dropdown-current"><img src="${iconUrl}" alt="${g.name}"><span>${g.name}</span></div>`
                : `<div class="guild-dropdown-current"><div class="guild-initial">${g.name.charAt(0).toUpperCase()}</div><span>${g.name}</span></div>`;
            selected.innerHTML += `<i class="fa-solid fa-chevron-down guild-dropdown-arrow"></i>`;

            // Mark active
            document.querySelectorAll('.guild-dropdown-item').forEach(el => el.classList.remove('active'));
            item.classList.add('active');

            closeGuildDropdown();
            // Debounced: batches all guild-change side-effects into one 150ms window
            _onGuildSelectDebounced(g.id, g.name);
        });

        menu.appendChild(item);
    });

    renderServerGrid(adminGuilds);

    // Populate tab-specific guild dropdowns (stocks + moderation)
    populateTabGuildDropdowns(adminGuilds);
}

/* ── Tab Guild Dropdowns (Stocks + Moderation) ──────────────── */
let _allGuilds = [];

function populateTabGuildDropdowns(guilds) {
    _allGuilds = guilds;
    ['stocks', 'mod'].forEach(tab => {
        const menu = document.getElementById(`${tab}GuildMenu`);
        if (!menu) return;
        menu.innerHTML = guilds.map(g => {
            const icon = g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png` : null;
            return `<div class="tab-guild-item" onclick="selectTabGuild('${tab}','${g.id}','${g.name.replace(/'/g,"\\'")}','${icon||''}')">
                ${icon ? `<img src="${icon}" alt="">` : `<div class="guild-initial" style="width:20px;height:20px;font-size:10px">${g.name[0]}</div>`}
                <span>${g.name}</span>
            </div>`;
        }).join('');
    });
}

window.toggleTabGuildDropdown = function(tab) {
    const menu = document.getElementById(`${tab}GuildMenu`);
    if (!menu) return;
    const isOpen = !menu.classList.contains('hidden');
    // close all first
    document.querySelectorAll('.tab-guild-menu').forEach(m => m.classList.add('hidden'));
    if (!isOpen) menu.classList.remove('hidden');
    // close on outside click
    setTimeout(() => {
        document.addEventListener('click', function _close(e) {
            if (!e.target.closest(`#${tab}GuildDropdown`)) {
                menu.classList.add('hidden');
                document.removeEventListener('click', _close);
            }
        });
    }, 10);
};

window.selectTabGuild = function(tab, guildId, guildName, iconUrl) {
    const label = document.getElementById(`${tab}GuildLabel`);
    if (label) label.textContent = guildName;
    const menu = document.getElementById(`${tab}GuildMenu`);
    if (menu) menu.classList.add('hidden');

    if (tab === 'stocks') {
        window._selectedGuildId = guildId;
        window._stocksGuildId   = guildId;
        if (typeof window.initStocks === 'function') window.initStocks();
    } else if (tab === 'mod') {
        window._modGuildId = guildId;
        // Also sync modGuildId in moderation module
        if (typeof window.initModeration === 'function') {
            window._selectedGuildId = guildId;
            window.initModeration();
        }
    }
};

function toggleGuildDropdown() {
    const menu = document.getElementById('guildDropdownMenu');
    const selected = document.getElementById('guildDropdownSelected');
    const isOpen = !menu.classList.contains('hidden');
    if (isOpen) {
        closeGuildDropdown();
    } else {
        menu.classList.remove('hidden');
        selected.classList.add('open');
    }
}

function closeGuildDropdown() {
    document.getElementById('guildDropdownMenu').classList.add('hidden');
    document.getElementById('guildDropdownSelected').classList.remove('open');
}

/* ================= VC AUTO-PROMPT + AUTO-JOIN ================= */
let _autoVcGuildId = null;
let _autoVcChannelName = null;
let _vcPollInterval = null;

async function checkUserVoiceInGuild(guildId, guildName) {
    if (!userProfile || !API_BASE) return;
    const cacheKey = `voiceCheck:${guildId}:${userProfile.id}`;
    const cached = _cache.get(cacheKey);
    if (cached !== null) {
        if (cached.in_voice) autoJoinUserVc(guildId, cached.channel_id, guildName, cached.channel_name, cached.member_count);
        return;
    }
    try {
        const res = await fetch(`${API_BASE}/user/voice/${guildId}/${userProfile.id}`, {
            headers: { 'ngrok-skip-browser-warning': 'true' }
        });
        const data = await res.json();
        _cache.set(cacheKey, data, 90000); // 90s TTL
        if (data.in_voice) {
            autoJoinUserVc(guildId, data.channel_id, guildName, data.channel_name, data.member_count);
        }
    } catch (_) {}
}

async function autoJoinUserVc(guildId, channelId, guildName, channelName, members) {
    // Show the prompt AND immediately tell the bot to join
    document.getElementById('vcAutoPromptMsg').textContent =
        `Joining #${channelName} on ${guildName}${members > 1 ? ` (${members} members)` : ''}…`;
    document.getElementById('vcAutoPromptSub').textContent =
        'Rift is connecting…';
    document.getElementById('vcAutoPrompt').classList.remove('hidden');

    if (!API_BASE || !guildId) return;
    try {
        // Tell the bot to join the channel (self_deaf=True enforced server-side via _connect_player)
        const res = await fetch(`${API_BASE}/music/control`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
            body: JSON.stringify({
                guild_id: guildId,
                user_id:  userProfile?.id,
                action:   'join',
                value:    channelId,
            }),
        });
        const data = await res.json();
        if (data.status === 'joined' || data.status === 'already_connected') {
            document.getElementById('vcAutoPromptMsg').textContent =
                `Connected to #${channelName}${members > 1 ? ` (${members} members)` : ''}`;
            document.getElementById('vcAutoPromptSub').textContent =
                'Search a song or pick from Chosen For You';
            setTimeout(() => dismissAutoVc(), 4000);
        } else {
            dismissAutoVc();
        }
    } catch(_) {
        dismissAutoVc();
    }
}

window.acceptAutoVc = function() {
    if (!_autoVcGuildId) return;
    dismissAutoVc();

    // Select the guild in the dropdown
    const item = document.querySelector(`.guild-dropdown-item[data-id="${_autoVcGuildId}"]`);
    if (item) item.click();
}

window.dismissAutoVc = function() {
    document.getElementById('vcAutoPrompt').classList.add('hidden');
    _autoVcGuildId = null;
}

/* ================= VC STATUS BAR ================= */
function updateVcStatusBar(voiceChannel) {
    const bar = document.getElementById('vcStatusBar');
    const connected = document.getElementById('vcConnected');
    const disconnected = document.getElementById('vcDisconnected');

    bar.classList.remove('hidden');

    if (voiceChannel) {
        connected.classList.remove('hidden');
        disconnected.classList.add('hidden');

        const link = document.getElementById('vcChannelLink');
        link.textContent = `# ${voiceChannel.name}`;
        // Discord deep link to the channel
        link.href = `https://discord.com/channels/${selectedGuildId}/${voiceChannel.id}`;

        const memberEl = document.getElementById('vcMemberCount');
        memberEl.textContent = voiceChannel.member_count > 0
            ? `${voiceChannel.member_count} listener${voiceChannel.member_count !== 1 ? 's' : ''}`
            : 'just Rift';
    } else {
        connected.classList.add('hidden');
        disconnected.classList.remove('hidden');
    }
}

function renderServerGrid(guilds) {
    const grid = document.getElementById('serverList');
    if (!grid) return;
    grid.innerHTML = guilds.map(g => `
        <div class="glass" style="display:flex; flex-direction:column; align-items:center; gap:15px; text-align:center;">
            <img src="${g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png` : 'https://cdn.discordapp.com/embed/avatars/0.png'}" style="width:64px; height:64px; border-radius:50%; box-shadow: 0 4px 10px rgba(0,0,0,0.5);">
            <div style="font-weight:600;">${g.name}</div>
        </div>
    `).join('');
}

/* ================= MUSIC HISTORY & TOP SONGS ================= */
window.loadMusicHistory = async function() {
    if (!API_BASE || !selectedGuildId) return;
    const cacheKey = `musicHistory:${selectedGuildId}`;
    const cached = _cache.get(cacheKey);
    if (cached) { renderRecentlyPlayed(cached.history); renderTopSongs(cached.top); return; }
    try {
        const [histRes, topRes] = await Promise.all([
            fetch(`${API_BASE}/music/history/${selectedGuildId}`, { headers: { 'ngrok-skip-browser-warning': 'true' } }),
            fetch(`${API_BASE}/music/topsongs/${selectedGuildId}`,{ headers: { 'ngrok-skip-browser-warning': 'true' } }),
        ]);
        const histData = await histRes.json();
        const topData  = await topRes.json();
        const payload  = { history: histData.history || [], top: topData.top || [] };
        _cache.set(cacheKey, payload, 120000); // 2 min TTL
        renderRecentlyPlayed(payload.history);
        renderTopSongs(payload.top);
    } catch(e) { console.error('[History]', e); }
};

function renderRecentlyPlayed(tracks) {
    const el = document.getElementById('recentlyPlayedList');
    if (!el) return;
    if (!tracks.length) {
        el.innerHTML = '<div class="music-history-empty">No history yet</div>';
        return;
    }
    el.innerHTML = tracks.map(t => `
        <div class="music-history-item" onclick="musicControl('play','${escQueue(t.url||t.title)}')">
            <div class="mhi-art" style="${t.artwork ? `background-image:url(${t.artwork})` : 'background:rgba(114,137,218,0.2)'}">
                ${t.artwork ? '' : '<i class="fa-solid fa-music"></i>'}
                <div class="mhi-play"><i class="fa-solid fa-play"></i></div>
            </div>
            <div class="mhi-info">
                <span class="mhi-title">${escQueue(t.title)}</span>
                <span class="mhi-artist">${escQueue(t.artist||'')}</span>
            </div>
        </div>`).join('');
}

function renderTopSongs(tracks) {
    const el = document.getElementById('topSongsList');
    if (!el) return;
    if (!tracks.length) {
        el.innerHTML = '<div class="music-history-empty">Play some songs first</div>';
        return;
    }
    el.innerHTML = tracks.map((t, i) => `
        <div class="music-history-item" onclick="musicControl('play','${escQueue(t.url||t.title)}')">
            <div class="mhi-art" style="${t.artwork ? `background-image:url(${t.artwork})` : 'background:rgba(114,137,218,0.2)'}">
                ${t.artwork ? '' : `<span style="font-size:11px;font-weight:700;color:var(--primary)">#${i+1}</span>`}
                <div class="mhi-play"><i class="fa-solid fa-play"></i></div>
            </div>
            <div class="mhi-info">
                <span class="mhi-title">${escQueue(t.title)}</span>
                <span class="mhi-artist">${escQueue(t.artist||'')} · ${t.plays} play${t.plays!==1?'s':''}</span>
            </div>
        </div>`).join('');
}

/* ================= HELPERS ================= */
function formatTime(ms) {
    if (!ms || isNaN(ms)) return '0:00';
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function updateRangeFill(input) {
    const min = parseFloat(input.min) || 0;
    const max = parseFloat(input.max) || 100;
    const val = parseFloat(input.value) || 0;
    const pct = ((val - min) / (max - min)) * 100;
    input.style.background = `linear-gradient(to right, var(--primary) ${pct}%, rgba(255,255,255,0.1) ${pct}%)`;
}

/* ================= SEARCH ENGINE ================= */
async function searchMusic(query) {
    if (!API_BASE) { console.warn('[Search] API_BASE not set — open the bot startup URL first'); return; }
    try {
        console.log(`[Search] Querying: "${query}"`);
        console.log(`[Search] POST → ${API_BASE}/music/search`);
        const res = await fetch(`${API_BASE}/music/search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
            body: JSON.stringify({ query })
        });
        console.log(`[Search] HTTP status: ${res.status} ${res.statusText}`);
        const raw = await res.text();
        console.log(`[Search] Raw response:`, raw);
        const data = JSON.parse(raw);
        const resultsBox = document.getElementById('searchResults');
        
        if (data.results && data.results.length > 0) {
            resultsBox.innerHTML = data.results.map((track, i) => `
                <div class="search-item" onclick="playSearchedTrack('${track.uri}')">
                    <img src="${track.artwork || 'https://via.placeholder.com/40x40/1a1a1a/ffffff?text=♫'}">
                    <div class="search-item-info">
                        <span class="search-item-title">${track.title}</span>
                        <span class="search-item-author">${track.author}</span>
                    </div>
                    <span class="search-item-dur">${formatTime(track.duration)}</span>
                </div>
            `).join('');
            resultsBox.classList.remove('hidden');
        } else {
            resultsBox.innerHTML = '<div style="padding:15px; text-align:center; color:#a0a0a8;">No results found</div>';
            resultsBox.classList.remove('hidden');
        }
    } catch (e) {
        console.error("[Search] FAILED:", e.name, e.message, e);
    }
}

// NOTE: Depending on your backend, 'play' action might need to be added to web_server.py
window.playSearchedTrack = function(uri) {
    document.getElementById('searchResults').classList.add('hidden');
    document.getElementById('songSearchInput').value = '';
    musicControl('play', uri); 
}

// Click outside hides search
document.addEventListener('click', (e) => {
    if (!e.target.closest('.music-search-container')) {
        document.getElementById('searchResults').classList.add('hidden');
    }
    if (!e.target.closest('.guild-dropdown')) {
        closeGuildDropdown();
    }
});

/* ================= MUSIC PLAYER & LYRICS ================= */
let currentTrackUri = null;

// _applyMusicState: shared between HTTP poll and WebSocket push
function _applyMusicState(data) {
    if (data.current) {
        isPlaying = !data.paused;
        // Sync interpolation local clock
        if (Math.abs(localTimeMs - (data.position * 1000)) > 2000) {
        localTimeMs = data.position * 1000;
        }
        lastSyncTimestamp = Date.now();

        document.getElementById('currentTrackTitle').textContent = data.current.title;
        document.getElementById('currentTrackAuthor').textContent = data.current.author;
        document.getElementById('albumArt').style.backgroundImage = `url(${data.current.artwork || ''})`;
        document.getElementById('albumArt').innerHTML = data.current.artwork ? '' : '<i class="fa-solid fa-compact-disc fa-spin-slow"></i>';

        // Update play/pause icon safely without destroying the button
        const ppIcon = document.querySelector('#playPauseBtn i');
        if (ppIcon) ppIcon.className = data.paused ? 'fa-solid fa-play' : 'fa-solid fa-pause';
        const ppTooltip = document.getElementById('playPauseTooltip');
        if (ppTooltip) ppTooltip.textContent = data.paused ? 'Play' : 'Pause';

        document.getElementById('timeTotal').textContent = formatTime(data.current.duration);

        // Reflect loop mode — only touch the icon class, never innerHTML the button
        const loopBtn = document.getElementById('loopBtn');
        if (loopBtn) {
        const loopMode = data.modes?.loop ?? 0;
        _localLoopMode = loopMode;
        const loopIcon = loopBtn.querySelector('i');
        const loopTip = document.getElementById('loopTooltip');
        // 0 = off, 1 = loop_one, 2 = loop_all
        loopBtn.classList.toggle('active', loopMode !== 0);
        loopBtn.classList.toggle('loop-all', loopMode === 2);
        if (loopIcon) {
            loopIcon.className = loopMode === 1 ? 'fa-solid fa-1 fa-xs' : 'fa-solid fa-repeat';
        }
        const labels = ['Loop: Off', 'Loop: One', 'Loop: All'];
        if (loopTip) loopTip.textContent = labels[loopMode] ?? 'Loop: Off';
        loopBtn.title = labels[loopMode] ?? 'Loop: Off';
        }
        
        currentTrackDuration = data.current.duration;
        
        // Check if track changed to fetch new lyrics
        if (currentTrackUri !== data.current.uri) {
        currentTrackUri = data.current.uri;
        fetchLyrics(data.current.title, data.current.author);
        }

        // Browser Media Session API
        // Shows track in OS/browser media controls (taskbar, lock screen,
        // browser tab, Bluetooth buttons, headphones, etc.)
        if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
            title:  data.current.title  || 'Unknown',
            artist: data.current.author || 'Unknown',
            album:  'Rift Music',
            artwork: data.current.artwork
            ? [{ src: data.current.artwork, sizes: '512x512', type: 'image/jpeg' }]
            : [],
        });
        navigator.mediaSession.playbackState = data.paused ? 'paused' : 'playing';

        // Wire OS media buttons to bot controls
        navigator.mediaSession.setActionHandler('play',     () => musicControl('toggle'));
        navigator.mediaSession.setActionHandler('pause',    () => musicControl('toggle'));
        navigator.mediaSession.setActionHandler('nexttrack',    () => musicControl('skip'));
        navigator.mediaSession.setActionHandler('previoustrack',() => musicControl('prev'));
        navigator.mediaSession.setActionHandler('stop',     () => musicControl('stop'));

        // Keep a near-silent audio element looping so the browser
        // maintains the media session even while the bot plays remotely.
        if (!window._riftAudioEl) {
            const _a = new Audio();
            _a.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
            _a.loop   = true;
            _a.volume = 0.001;
            window._riftAudioEl = _a;
        }
        if (data.paused) {
            window._riftAudioEl.pause();
        } else {
            window._riftAudioEl.play().catch(() => {});
        }

        // Update the OS seek bar position
        if (data.current.duration > 0) {
            try {
            navigator.mediaSession.setPositionState({
                duration:     data.current.duration,
                playbackRate: 1,
                position:     Math.min(localTimeMs / 1000, data.current.duration),
            });
            } catch (_) {}
        }
        }
    } else {
        // Clear browser media session when nothing is playing
        if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.playbackState = 'none';
        if (window._riftAudioEl) window._riftAudioEl.pause();
        }
        isPlaying = false;
        resetPlayer();
    }

    updateVcStatusBar(data.voice_channel ?? null);
    renderQueue(data.queue);
}

async function updateMusicState() {
    if (!selectedGuildId || !API_BASE) return;
    try {
        const res = await fetch(`${API_BASE}/music/state/${selectedGuildId}`, {
            headers: { 'ngrok-skip-browser-warning': 'true' }
        });
        const data = await res.json();
        _applyMusicState(data);
    } catch (e) {
        console.error("Music state update failed:", e);
    }
}

// ── Waveform visualizer ────────────────────────────────────────────────────
const _wv = {
    ctx: null, bars: [], animId: null,
    WIDTH: 0, HEIGHT: 0,
    NUM: 28,
    _lastDraw: 0,
    init() {
        const canvas = document.getElementById('waveformCanvas');
        if (!canvas) return;
        this.ctx = canvas.getContext('2d');
        this.WIDTH  = canvas.offsetWidth  || 220;
        this.HEIGHT = canvas.offsetHeight || 36;
        canvas.width  = this.WIDTH  * window.devicePixelRatio;
        canvas.height = this.HEIGHT * window.devicePixelRatio;
        this.ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
        this.bars = Array.from({length: this.NUM}, (_, i) => ({
            h:    Math.random() * 0.4 + 0.1,
            target: Math.random() * 0.4 + 0.1,
            phase: (i / this.NUM) * Math.PI * 2,
            speed: 0.025 + Math.random() * 0.02,
        }));
        if (!this.animId) this._draw();
    },
    _draw(ts) {
        this.animId = requestAnimationFrame(t => this._draw(t));
        if (!this.ctx) return;
        // Throttle to 24fps and skip entirely when paused (bars settle instantly)
        const now = ts || 0;
        if (!isPlaying && now - this._lastDraw < 200) return;
        if (isPlaying  && now - this._lastDraw < 42)  return; // ~24fps
        this._lastDraw = now;

        const { ctx, WIDTH, HEIGHT, bars, NUM } = this;
        ctx.clearRect(0, 0, WIDTH, HEIGHT);
        const barW   = WIDTH / NUM;
        const gap    = barW * 0.35;
        const bw     = barW - gap;
        const active = isPlaying;

        bars.forEach((b, i) => {
            if (active) {
                b.phase += b.speed;
                b.target = 0.15 + Math.abs(Math.sin(b.phase + i * 0.4)) * 0.82;
            } else {
                b.target = 0.08 + Math.sin(i * 0.6) * 0.04;
            }
            b.h += (b.target - b.h) * 0.12;
            const barH = Math.max(3, b.h * HEIGHT);
            const x    = i * barW + gap / 2;
            const y    = (HEIGHT - barH) / 2;
            const alpha = active ? 0.55 + b.h * 0.45 : 0.2;
            ctx.fillStyle = `rgba(114,137,218,${alpha})`;
            ctx.beginPath();
            ctx.roundRect(x, y, bw, barH, bw / 2);
            ctx.fill();
        });
    },
};

// Advanced Queue Management with drag-to-reorder
let _dragSrcIdx = null;

function renderQueue(queue) {
    const list = document.getElementById('queueList');
    if (!queue || queue.length === 0) {
        list.innerHTML = '<li class="empty-msg">Queue is empty</li>';
        return;
    }

    // Preserve scroll position
    const scrollTop = list.scrollTop;

    list.innerHTML = queue.map((t, i) => `
        <li class="queue-item" draggable="true" data-idx="${i}">
            <div class="q-drag-handle" title="Drag to reorder">
                <i class="fa-solid fa-grip-vertical"></i>
            </div>
            <div class="q-thumb" style="${t.artwork ? `background-image:url(${t.artwork})` : 'background:rgba(114,137,218,0.15)'}">
                ${t.artwork ? '' : '<i class="fa-solid fa-music"></i>'}
            </div>
            <div class="q-body">
                <span class="q-title">${escQueue(t.title)}</span>
                <span class="q-author">${escQueue(t.author)} · ${formatTime(t.duration)}</span>
            </div>
            <div class="q-controls">
                <button class="q-btn" onclick="musicControl('play_now',${i})" title="Play now">
                    <i class="fa-solid fa-play"></i>
                </button>
                <button class="q-btn danger" onclick="musicControl('remove',${i})" title="Remove">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
        </li>`).join('');

    list.scrollTop = scrollTop;

    // Attach drag events
    list.querySelectorAll('.queue-item').forEach(item => {
        item.addEventListener('dragstart', e => {
            _dragSrcIdx = parseInt(item.dataset.idx);
            item.classList.add('q-dragging');
            e.dataTransfer.effectAllowed = 'move';
        });
        item.addEventListener('dragend', () => {
            item.classList.remove('q-dragging');
            list.querySelectorAll('.queue-item').forEach(i => i.classList.remove('q-drag-over'));
        });
        item.addEventListener('dragover', e => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            list.querySelectorAll('.queue-item').forEach(i => i.classList.remove('q-drag-over'));
            item.classList.add('q-drag-over');
        });
        item.addEventListener('drop', e => {
            e.preventDefault();
            const toIdx = parseInt(item.dataset.idx);
            if (_dragSrcIdx === null || _dragSrcIdx === toIdx) return;
            // Tell backend to move: remove from src, insert at dest
            musicControl('move_to', { from: _dragSrcIdx, to: toIdx });
            _dragSrcIdx = null;
            item.classList.remove('q-drag-over');
        });
    });
}

function escQueue(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function resetPlayer() {
    document.getElementById('currentTrackTitle').textContent = "Not Playing";
    document.getElementById('currentTrackAuthor').textContent = "Select a server to view status";
    document.getElementById('albumArt').style.backgroundImage = 'none';
    document.getElementById('albumArt').innerHTML = '<i class="fa-solid fa-compact-disc fa-spin-slow"></i>';
    document.getElementById('seekBar').value = 0;
    document.getElementById('lyricsContainer').innerHTML = '<div class="lyric-placeholder">Lyrics will appear here when a song plays...</div>';
    lyricsData = [];
    currentTrackUri = null;
    localTimeMs = 0;
}

// Coalesce rapid control actions (e.g. skip×3) into a single state refresh
let _musicStateRefreshTimer = null;
function _scheduleStateRefresh() {
    clearTimeout(_musicStateRefreshTimer);
    _musicStateRefreshTimer = setTimeout(updateMusicState, 800);
}

// Master API Controller
async function musicControl(action, value = null) {
    if (!selectedGuildId) return;

    const payload = { 
        guild_id: selectedGuildId, 
        user_id: userProfile ? userProfile.id : null, 
        action, 
        value 
    };

    try {
        const response = await fetch(`${API_BASE}/music/control`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errData = await response.json();
            console.error("Control failed:", errData.error);
            return;
        }
    } catch (err) {
        console.error("Network error during music control:", err);
    }

    // Coalesce: rapid button presses share one refresh instead of one each
    _scheduleStateRefresh();
}

/* ================= CONTROL HELPERS ================= */
// Loop cycles client-side immediately for snappy feedback, backend confirms on next poll
let _localLoopMode = 0;
window.handleLoopClick = function() {
    _localLoopMode = (_localLoopMode + 1) % 3;
    const loopBtn = document.getElementById('loopBtn');
    const loopIcon = loopBtn?.querySelector('i');
    const loopTip = document.getElementById('loopTooltip');
    const labels = ['Loop: Off', 'Loop: One', 'Loop: All'];
    if (loopBtn) {
        loopBtn.classList.toggle('active', _localLoopMode !== 0);
        loopBtn.classList.toggle('loop-all', _localLoopMode === 2);
        loopBtn.title = labels[_localLoopMode];
    }
    if (loopIcon) loopIcon.className = _localLoopMode === 1 ? 'fa-solid fa-1 fa-xs' : 'fa-solid fa-repeat';
    if (loopTip) loopTip.textContent = labels[_localLoopMode];
    musicControl('loop');
};

/* ================= MANUAL LYRICS SEARCH ================= */
window.toggleLyricsSearch = function() {
    const box = document.getElementById('lyricsSearchBox');
    const isHidden = box.classList.contains('hidden');
    box.classList.toggle('hidden', !isHidden);
    if (isHidden) {
        document.getElementById('lyricsManualInput').focus();
        document.getElementById('lyricsSearchToggle').classList.add('active');
    } else {
        document.getElementById('lyricsSearchToggle').classList.remove('active');
    }
};

window.manualLyricsSearch = async function() {
    const input = document.getElementById('lyricsManualInput').value.trim();
    if (!input) return;

    // Accept "Artist - Title" or just "Title"
    let title = input, author = '';
    if (input.includes(' - ')) {
        [author, title] = input.split(' - ').map(s => s.trim());
    }
    await fetchLyrics(title, author);
    document.getElementById('lyricsSearchBox').classList.add('hidden');
    document.getElementById('lyricsSearchToggle').classList.remove('active');
};

// Enter key triggers search
document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && document.activeElement?.id === 'lyricsManualInput') {
        window.manualLyricsSearch();
    }
});

/* ================= LIVE SYNCED LYRICS ================= */
async function fetchLyrics(title, author) {
    const container = document.getElementById('lyricsContainer');
    container.innerHTML = '<div class="lyric-placeholder"><i class="fa-solid fa-circle-notch fa-spin"></i> Fetching lyrics...</div>';
    lyricsData = [];
    activeLyricIndex = -1;

    try {
        // Clean strings for better LRCLIB matching
        const cleanTitle  = title.replace(/\s*[\(\[].*?[\)\]]/g, '').trim();
        const cleanAuthor = author.replace(/\s*-\s*(topic|official|music|vevo|records|tv).*$/i, '').trim();
        const url = `https://lrclib.net/api/search?track_name=${encodeURIComponent(cleanTitle)}&artist_name=${encodeURIComponent(cleanAuthor)}`;
        
        const res = await fetch(url);
        const data = await res.json();

        const best = data.find(t => t.syncedLyrics) || data.find(t => t.plainLyrics);
        
        if (best && best.syncedLyrics) {
            parseSyncedLyrics(best.syncedLyrics);
            renderLyrics();
        } else if (best && best.plainLyrics) {
            container.innerHTML = `<div class="lyric-placeholder" style="white-space:pre-wrap; text-align:left; color:#ccc;">${best.plainLyrics}</div>`;
        } else {
            container.innerHTML = '<div class="lyric-placeholder">No lyrics found for this track.</div>';
        }
    } catch (e) {
        container.innerHTML = '<div class="lyric-placeholder">Failed to load lyrics.</div>';
    }
}

function parseSyncedLyrics(lrcStr) {
    const lines = lrcStr.split('\n');
    const regex = /\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/;
    
    lyricsData = [];
    lines.forEach(line => {
        const match = regex.exec(line);
        if (match) {
            const m = parseInt(match[1]);
            const s = parseInt(match[2]);
            const msStr = match[3].length === 2 ? match[3] + "0" : match[3];
            const ms = parseInt(msStr);
            const timeInMs = (m * 60 + s) * 1000 + ms;
            const text = match[4].trim();
            if (text) {
                lyricsData.push({ time: timeInMs, text: text });
            }
        }
    });
}

function renderLyrics() {
    const container = document.getElementById('lyricsContainer');
    container.innerHTML = '';
    lyricsData.forEach((line, i) => {
        const div = document.createElement('div');
        div.className = 'lyric-line';
        div.id = `lyric-${i}`;
        div.textContent = line.text;
        container.appendChild(div);
    });
}

function updateLyricsGlow() {
    if (lyricsData.length === 0) return;

    // 300ms lookahead — compensates for interpolation drift between polls
    const LYRIC_OFFSET_MS = 300;
    const syncTime = localTimeMs + LYRIC_OFFSET_MS;

    let targetIndex = -1;
    for (let i = 0; i < lyricsData.length; i++) {
        if (syncTime >= lyricsData[i].time) {
            targetIndex = i;
        } else {
            break;
        }
    }

    if (targetIndex !== activeLyricIndex && targetIndex !== -1) {
        if (activeLyricIndex !== -1) {
            const oldObj = document.getElementById(`lyric-${activeLyricIndex}`);
            if (oldObj) oldObj.classList.remove('active');
        }
        
        activeLyricIndex = targetIndex;
        const activeObj = document.getElementById(`lyric-${activeLyricIndex}`);
        if (activeObj) {
            activeObj.classList.add('active');
            
            // Smoothly center the lyric line inside the container
            const container = document.getElementById('lyricsContainer');
            const scrollPos = activeObj.offsetTop - (container.clientHeight / 2) + (activeObj.clientHeight / 2);
            container.scrollTo({ top: scrollPos, behavior: 'smooth' });
        }
    }
}

/* ================= 30FPS ANIMATION ENGINE ================= */
// Cache DOM elements once — grabbing them every frame is expensive
let _seekBar     = null;
let _timeCurrent = null;
let _lastFrame   = 0;
const _FRAME_MS  = 1000 / 30; // 30fps is plenty for a progress bar

function animationLoop(timestamp) {
    // Throttle to 30fps
    if (timestamp - _lastFrame >= _FRAME_MS) {
        _lastFrame = timestamp;

        if (isPlaying && currentTrackDuration > 0) {
            const now   = Date.now();
            const delta = now - lastSyncTimestamp;
            localTimeMs += delta;
            lastSyncTimestamp = now;

            if (localTimeMs > currentTrackDuration) localTimeMs = currentTrackDuration;

            if (!isSeeking) {
                if (!_seekBar)     _seekBar     = document.getElementById('seekBar');
                if (!_timeCurrent) _timeCurrent = document.getElementById('timeCurrent');
                const percent = (localTimeMs / currentTrackDuration) * 100;
                if (_seekBar) { _seekBar.value = percent || 0; updateRangeFill(_seekBar); }
                if (_timeCurrent) _timeCurrent.textContent = formatTime(localTimeMs);
            }

            // Keep OS media session position in sync using interpolated time
            if ('mediaSession' in navigator && currentTrackDuration > 0) {
                try {
                    navigator.mediaSession.setPositionState({
                        duration:     currentTrackDuration / 1000,
                        playbackRate: 1,
                        position:     Math.min(localTimeMs / 1000, currentTrackDuration / 1000),
                    });
                } catch (_) {}
            }

            updateLyricsGlow();
        }
    }
    requestAnimationFrame(animationLoop);
}

// Pause the animation clock when the browser tab is hidden
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) lastSyncTimestamp = Date.now();
});

// HTTP poll is now a fallback only -- WebSocket push handles real-time updates.
// 60s is enough to resync if WS is briefly disconnected.
let _musicPollInterval = setInterval(() => {
    if (!document.hidden && document.getElementById('music').classList.contains('active')) {
        updateMusicState();
    }
}, 60000);

// ─── Client-side caches ────────────────────────────────────────────────────
// Keyed by guildId. TTL in ms. Prevents repeat worker hits on guild re-select.
const _cache = {
    _store: {},
    set(key, value, ttlMs = 60000) {
        this._store[key] = { value, expires: Date.now() + ttlMs };
    },
    get(key) {
        const entry = this._store[key];
        if (!entry || Date.now() > entry.expires) return null;
        return entry.value;
    },
    del(key) { delete this._store[key]; }
};

// Debounce guild-select side-effects so rapid clicks don't fire 8 requests each
let _guildSelectTimer = null;
function _onGuildSelectDebounced(guildId, guildName) {
    clearTimeout(_guildSelectTimer);
    _guildSelectTimer = setTimeout(() => {
        updateMusicState();
        loadChosenForYou();
        loadMusicHistory();
        if (userProfile && API_BASE) checkUserVoiceInGuild(guildId, guildName);
    }, 150); // 150ms debounce — imperceptible to user
}

// ──────────────────────────────────────────────────────────────────────────
const CFY_FALLBACK_SEEDS = [
    { q: 'chill lofi beats', label: 'Lofi' },
    { q: 'phonk drift playlist', label: 'Phonk' },
    { q: 'synthwave retrowave mix', label: 'Synthwave' },
    { q: 'hype rap playlist', label: 'Rap' },
    { q: 'bedroom pop indie playlist', label: 'Indie' },
];

async function loadChosenForYou() {
    if (!API_BASE || !selectedGuildId) return;
    const scroll = document.getElementById('cfyScroll');
    if (!scroll) return;

    // Cache CFY per guild for 10 minutes — recommendations don't need to refresh on every guild click
    const cacheKey = `cfy:${selectedGuildId}:${userProfile?.id || 'anon'}`;
    const cached = _cache.get(cacheKey);
    if (cached) { scroll.innerHTML = cached; return; }

    // Try to get personalised seeds from Last.fm top artists
    let seeds = [];
    if (userProfile?.id) {
        const lfmCacheKey = `lfmTopArtists:${userProfile.id}`;
        let artists = _cache.get(lfmCacheKey);
        if (!artists) {
            try {
                const res = await fetch(`${API_BASE}/lastfm/topartists/${userProfile.id}?period=1month`, {
                    headers: { 'ngrok-skip-browser-warning': 'true' }
                });
                const data = await res.json();
                if (data.artists?.length) {
                    artists = data.artists;
                    _cache.set(lfmCacheKey, artists, 600000); // 10 min
                }
            } catch(_) {}
        }
        if (artists?.length) {
            const pool = artists.slice(0, 10);
            const picked = pool.sort(() => Math.random() - 0.5).slice(0, 5);
            seeds = picked.map(a => ({ q: a.name, label: a.name }));
        }
    }

    if (!seeds.length) seeds = [...CFY_FALLBACK_SEEDS].sort(() => Math.random() - 0.5).slice(0, 5);

    const results = [];
    await Promise.all(seeds.map(async (seed) => {
        try {
            const res = await fetch(`${API_BASE}/music/search`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
                body: JSON.stringify({ query: seed.q }),
            });
            const data = await res.json();
            const tracks = data.results || [];
            if (tracks.length) {
                const t = tracks[Math.floor(Math.random() * Math.min(tracks.length, 5))];
                results.push({ ...t, genre: seed.label });
            }
        } catch(_) {}
    }));

    if (!results.length) { scroll.innerHTML = '<div class="cfy-empty">No recommendations right now</div>'; return; }

    const html = results.map(t => `
        <button class="cfy-card" onclick="playCfy('${escAttr(t.uri)}')">
            <div class="cfy-art" style="${t.artwork ? `background-image:url(${t.artwork})` : 'background:rgba(114,137,218,0.2)'}">
                ${t.artwork ? '' : '<i class="fa-solid fa-music"></i>'}
                <div class="cfy-play-overlay"><i class="fa-solid fa-play"></i></div>
            </div>
            <div class="cfy-info">
                <span class="cfy-track">${escQueue(t.title)}</span>
                <span class="cfy-artist">${escQueue(t.author)}</span>
                <span class="cfy-genre">${t.genre}</span>
            </div>
        </button>`).join('');

    _cache.set(cacheKey, html, 600000); // 10 min
    scroll.innerHTML = html;
}

window.playCfy = function(uri) {
    if (!uri) return;
    musicControl('play', uri);
    showMusicToast('Added to queue');
};

function escAttr(s) { return String(s||'').replace(/'/g,"\\'").replace(/"/g,'&quot;'); }

function showMusicToast(msg) {
    let t = document.getElementById('musicToast');
    if (!t) {
        t = document.createElement('div');
        t.id = 'musicToast';
        t.className = 'music-toast';
        document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._t);
    t._t = setTimeout(() => t.classList.remove('show'), 2500);
}

/* ================= FIX AUDIO MODAL ================= */
window.openFixModal = function() {
    document.getElementById('fixResult').classList.add('hidden');
    document.getElementById('fixModalOverlay').classList.remove('hidden');
};

window.closeFixModal = function() {
    document.getElementById('fixModalOverlay').classList.add('hidden');
};

window.runFix = async function(type) {
    if (!selectedGuildId || !API_BASE) return;
    const resultEl = document.getElementById('fixResult');
    resultEl.textContent = 'Running...';
    resultEl.className   = 'fix-result running';
    resultEl.classList.remove('hidden');

    // Disable all buttons while running
    document.querySelectorAll('.fix-option-btn').forEach(b => b.disabled = true);

    try {
        const res = await fetch(`${API_BASE}/music/fix`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
            body: JSON.stringify({ guild_id: selectedGuildId, fix: type }),
        });
        const data = await res.json();
        if (data.error) {
            resultEl.textContent = `✗ ${data.error}`;
            resultEl.className   = 'fix-result error';
        } else {
            resultEl.textContent = `✓ ${data.status}`;
            resultEl.className   = 'fix-result success';
            setTimeout(() => { closeFixModal(); updateMusicState(); }, 1800);
        }
    } catch(e) {
        resultEl.textContent = '✗ Network error — is the bot online?';
        resultEl.className   = 'fix-result error';
    }

    document.querySelectorAll('.fix-option-btn').forEach(b => b.disabled = false);
};
/* ================= PANEL RESIZER ================= */
(function initPanelResizers() {
    function makeResizer(resizerId, leftPanelId, rightPanelId) {
        const resizer   = document.getElementById(resizerId);
        const leftPanel = document.getElementById(leftPanelId);
        const rightPanel = document.getElementById(rightPanelId);
        if (!resizer || !leftPanel || !rightPanel) return;

        let startX, startLeftW, startRightW;

        function onMouseDown(e) {
            startX      = e.clientX;
            startLeftW  = leftPanel.getBoundingClientRect().width;
            startRightW = rightPanel.getBoundingClientRect().width;
            resizer.classList.add('dragging');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup',   onMouseUp);
        }

        function onMouseMove(e) {
            const dx = e.clientX - startX;
            const newLeftW  = Math.max(280, startLeftW  + dx);
            const newRightW = Math.max(200, startRightW - dx);
            leftPanel.style.width  = `${newLeftW}px`;
            rightPanel.style.width = `${newRightW}px`;
            leftPanel.style.flex   = '0 0 auto';
            rightPanel.style.flex  = '0 0 auto';
        }

        function onMouseUp() {
            resizer.classList.remove('dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup',   onMouseUp);
        }

        // Touch support
        resizer.addEventListener('touchstart', e => {
            startX      = e.touches[0].clientX;
            startLeftW  = leftPanel.getBoundingClientRect().width;
            startRightW = rightPanel.getBoundingClientRect().width;
        }, { passive: true });

        resizer.addEventListener('touchmove', e => {
            const dx = e.touches[0].clientX - startX;
            leftPanel.style.width  = `${Math.max(280, startLeftW  + dx)}px`;
            rightPanel.style.width = `${Math.max(200, startRightW - dx)}px`;
            leftPanel.style.flex   = '0 0 auto';
            rightPanel.style.flex  = '0 0 auto';
        }, { passive: true });

        resizer.addEventListener('mousedown', onMouseDown);
    }

    // Wait for DOM
    document.addEventListener('DOMContentLoaded', () => {
        makeResizer('resizerLeft',  'panelPlayer', 'panelLyrics');
        makeResizer('resizerRight', 'panelLyrics', 'panelQueue');
    });
})();