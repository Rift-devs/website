// Configuration — live ngrok URL fetched from GitHub Gist on every page load.
// Works for ALL users on rift.baby with no setup required on their end.
const CLIENT_ID  = "1329184069426348052";
const GIST_ID    = "73548af0931ee1c58031df6ca5614e13"; // ← paste your Gist ID
let API_BASE = null;
let WS_URL   = null;

async function loadConfig() {
    // 1. Server-injected globals (when visiting the ngrok URL directly)
    if (window.__RIFT_API_BASE__) {
        API_BASE = window.__RIFT_API_BASE__;
        WS_URL   = window.__RIFT_WS_URL__;
        console.log(`[Config] API_BASE=${API_BASE} (server-injected)`);
        return;
    }

    // 2. GitHub Gist — bot pushes live URL here on every startup.
    //    Raw gist URLs are public and have no rate limits.
    try {
        // Use the raw gist URL — no auth needed, no limits
        const res = await fetch(
            `https://gist.githubusercontent.com/raw/${GIST_ID}/rift-api.json`,
            { cache: 'no-store' }
        );
        if (res.ok) {
            const data = await res.json();
            const url  = data?.api;
            if (url) {
                API_BASE = url.replace(/\/$/, '') + '/api';
                WS_URL   = url.replace('https://', 'wss://').replace('http://', 'ws://').replace(/\/$/, '') + '/ws';
                console.log(`[Config] API_BASE=${API_BASE} (Gist)`);
                return;
            }
        }
    } catch(e) {
        console.warn('[Config] Gist fetch failed:', e.message);
    }

    console.warn('[Config] Bot may be offline.');
    API_BASE = null;
    WS_URL   = null;
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
    function draw() {
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
        requestAnimationFrame(draw);
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

            const titles = { music: 'Music Player', stocks: 'Stock Market', lastfm: 'Last.fm' };
            document.getElementById('activeTabTitle').textContent = titles[target] || target;

            if (target === 'stocks' && typeof window.initStocks === 'function') window.initStocks();
            if (target === 'lastfm' && typeof window.initLastfm === 'function') window.initLastfm();
            if (target === 'moderation' && typeof window.initModeration === 'function') window.initModeration();

            if (window.innerWidth <= 768) closeSidebar();
        });
    });
}

/* ================= WEBSOCKET (STATS) ================= */
function initWebSocket() {
    ws = new WebSocket(WS_URL);
    
    ws.onopen = () => {
        document.getElementById('connectionStatus').textContent = "Connected";
        document.querySelector('.status-indicator').className = "status-indicator online";
    };
    
    ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.type === 'stats') {
            updateStats(message.data);
        }
    };
    
    ws.onclose = () => {
        document.getElementById('connectionStatus').textContent = "Reconnecting...";
        document.querySelector('.status-indicator').className = "status-indicator";
        setTimeout(initWebSocket, 3000);
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

        if (userProfile.id) {
            hideLoginWall();
        } else {
            localStorage.removeItem('d_token');
            showLoginWall();
            return;
        }
        
        document.getElementById('userCard').innerHTML = `
            <div class="user-info" style="display:flex; align-items:center; gap:12px;">
                <img src="https://cdn.discordapp.com/avatars/${userProfile.id}/${userProfile.avatar}.png" style="width:32px; height:32px; border-radius:50%; border: 1px solid rgba(255,255,255,0.1)">
                <span style="font-weight:500;">${userProfile.username}</span>
            </div>
        `;
        fetchGuilds(token);
    } catch (e) {
        localStorage.removeItem('d_token');
        showLoginWall();
    }
}

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
            updateMusicState();

            // Only check voice for the selected guild, not all guilds
            if (userProfile && API_BASE) checkUserVoiceInGuild(g.id, g.name);
        });

        menu.appendChild(item);
    });

    renderServerGrid(adminGuilds);
}

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

/* ================= VC AUTO-PROMPT ================= */
let _autoVcGuildId = null;
let _autoVcChannelName = null;

async function checkUserVoiceInGuild(guildId, guildName) {
    if (!userProfile || !API_BASE) return;
    try {
        const res = await fetch(`${API_BASE}/user/voice/${guildId}/${userProfile.id}`, {
            headers: { 'ngrok-skip-browser-warning': 'true' }
        });
        const data = await res.json();
        if (data.in_voice) {
            _autoVcGuildId = guildId;
            _autoVcChannelName = data.channel_name;
            const members = data.member_count;
            document.getElementById('vcAutoPromptMsg').textContent =
                `You're in #${data.channel_name} on ${guildName}${members > 1 ? ` (${members} members)` : ''}`;
            document.getElementById('vcAutoPromptSub').textContent =
                'Want Rift to use your current channel?';
            document.getElementById('vcAutoPrompt').classList.remove('hidden');
        }
    } catch (_) {}
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

async function updateMusicState() {
    if (!selectedGuildId || !API_BASE) return;
    
    try {
        const res = await fetch(`${API_BASE}/music/state/${selectedGuildId}`, {
            headers: { 'ngrok-skip-browser-warning': 'true' }
        });
        const data = await res.json();
        
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
        } else {
            isPlaying = false;
            resetPlayer();
        }

        updateVcStatusBar(data.voice_channel ?? null);
        renderQueue(data.queue);
    } catch (e) {
        console.error("Music state update failed:", e);
    }
}

// Advanced Queue Management (UI implementation sends signals to API)
function renderQueue(queue) {
    const list = document.getElementById('queueList');
    if (!queue || queue.length === 0) {
        list.innerHTML = '<li class="empty-msg">Queue is empty</li>';
        return;
    }
    list.innerHTML = queue.map((t, i) => `
        <li class="queue-item">
            <div class="q-title">${i+1}. ${t.title}</div>
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <span class="q-author">${t.author} (${formatTime(t.duration)})</span>
                <div class="q-controls">
                    <button class="q-btn" onclick="musicControl('play_now', ${i})" title="Play Now"><i class="fa-solid fa-play"></i></button>
                    <button class="q-btn" onclick="musicControl('move_up', ${i})" title="Move Up"><i class="fa-solid fa-arrow-up"></i></button>
                    <button class="q-btn danger" onclick="musicControl('remove', ${i})" title="Remove"><i class="fa-solid fa-xmark"></i></button>
                </div>
            </div>
        </li>
    `).join('');
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

// Master API Controller
async function musicControl(action, value = null) {
    if (!selectedGuildId) return;

    // We send userProfile.id so the bot knows which VC to join
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

    // Refresh the UI state shortly after the command
    setTimeout(updateMusicState, 600);
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
        const cleanTitle = title.replace(/\s*[\(\[].*?[\)\]]/g, '').trim();
        const url = `https://lrclib.net/api/search?track_name=${encodeURIComponent(cleanTitle)}&artist_name=${encodeURIComponent(author)}`;
        
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

    let targetIndex = -1;
    for (let i = 0; i < lyricsData.length; i++) {
        if (localTimeMs >= lyricsData[i].time) {
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

/* ================= 60FPS ANIMATION ENGINE ================= */
function animationLoop() {
    if (isPlaying && currentTrackDuration > 0) {
        const now = Date.now();
        const delta = now - lastSyncTimestamp;
        localTimeMs += delta;
        lastSyncTimestamp = now;

        // Cap local time
        if (localTimeMs > currentTrackDuration) localTimeMs = currentTrackDuration;

        // Update Progress Bar if user isn't holding it
        if (!isSeeking) {
            const percent = (localTimeMs / currentTrackDuration) * 100;
            const seekBar = document.getElementById('seekBar');
            seekBar.value = percent || 0;
            updateRangeFill(seekBar);
            document.getElementById('timeCurrent').textContent = formatTime(localTimeMs);
        }

        updateLyricsGlow();
    }
    requestAnimationFrame(animationLoop);
}

// Poll backend state safely
setInterval(() => {
    if (document.getElementById('music').classList.contains('active')) {
        updateMusicState();
    }
}, 5000);
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