// Configuration — API_BASE is set via ?api= query param (printed by bot on startup)
// and persisted in localStorage so it survives page refreshes.
const CLIENT_ID = "1329184069426348052";
let API_BASE = null;
let WS_URL = null;

async function loadConfig() {
    // 1. Check for ?api= in the URL (bot prints this link on every startup)
    const params = new URLSearchParams(window.location.search);
    const apiParam = params.get('api');
    if (apiParam) {
        localStorage.setItem('rift_api_base', apiParam);
        // Clean the param from the URL bar without reloading
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    // 2. Use stored value
    const stored = localStorage.getItem('rift_api_base');
    if (stored) {
        API_BASE = stored.replace(/\/$/, '') + '/api';
        WS_URL = stored.replace('https://', 'wss://').replace('http://', 'ws://').replace(/\/$/, '') + '/ws';
        console.log(`[Config] API_BASE=${API_BASE}`);
        return;
    }

    // 3. Nothing configured yet
    console.warn('[Config] No API base set. Open the dashboard URL printed by the bot on startup.');
    API_BASE = null;
    WS_URL = null;
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
    volumeSlider.addEventListener('input', () => updateRangeFill(volumeSlider));
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

            document.getElementById('activeTabTitle').textContent =
                target.charAt(0).toUpperCase() + target.slice(1);
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
    document.getElementById('stat-servers').textContent = data.servers;
    document.getElementById('stat-users').textContent = data.users;
    document.getElementById('stat-ping').textContent = `${data.latency}ms`;
    
    const h = Math.floor(data.uptime / 3600);
    const m = Math.floor((data.uptime % 3600) / 60);
    document.getElementById('stat-uptime').textContent = `${h}h ${m}m`;
    
    document.getElementById('stat-cpu').textContent = `${data.cpu}%`;
    document.getElementById('cpu-progress').style.width = `${data.cpu}%`;
    
    document.getElementById('stat-ram').textContent = `${data.ram_percent}%`;
    document.getElementById('ram-progress').style.width = `${data.ram_percent}%`;
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
        fetchProfile(token);
    }
}

async function fetchProfile(token) {
    try {
        const res = await fetch('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${token}` }
        });
        userProfile = await res.json();
        
        document.getElementById('userCard').innerHTML = `
            <div class="user-info" style="display:flex; align-items:center; gap:12px;">
                <img src="https://cdn.discordapp.com/avatars/${userProfile.id}/${userProfile.avatar}.png" style="width:32px; height:32px; border-radius:50%; border: 1px solid rgba(255,255,255,0.1)">
                <span style="font-weight:500;">${userProfile.username}</span>
            </div>
        `;
        fetchGuilds(token);
    } catch (e) {
        localStorage.removeItem('d_token');
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
        });

        menu.appendChild(item);
    });

    renderServerGrid(adminGuilds);

    // After loading guilds, check if the user is already in a VC somewhere
    // and show the smart auto-select prompt
    if (userProfile && API_BASE) {
        checkUserVoiceAcrossGuilds(adminGuilds);
    }
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

async function checkUserVoiceAcrossGuilds(guilds) {
    if (!userProfile || !API_BASE) return;
    // Check each guild until we find one where the user is in voice
    for (const g of guilds) {
        try {
            const res = await fetch(`${API_BASE}/user/voice/${g.id}/${userProfile.id}`, {
                headers: { 'ngrok-skip-browser-warning': 'true' }
            });
            const data = await res.json();
            if (data.in_voice) {
                _autoVcGuildId = g.id;
                _autoVcChannelName = data.channel_name;
                const members = data.member_count;

                // Find the guild icon
                const item = document.querySelector(`.guild-dropdown-item[data-id="${g.id}"]`);
                const iconUrl = item?.dataset.icon || null;

                document.getElementById('vcAutoPromptMsg').textContent =
                    `You're in #${data.channel_name} on ${g.name}${members > 1 ? ` (${members} members)` : ''}`;
                document.getElementById('vcAutoPromptSub').textContent =
                    'Want Rift to use your current channel?';
                document.getElementById('vcAutoPrompt').classList.remove('hidden');
                break;
            }
        } catch (_) {}
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
    grid.innerHTML = guilds.map(g => `
        <div class="glass" style="display:flex; flex-direction:column; align-items:center; gap:15px; text-align:center;">
            <img src="${g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png` : 'https://cdn.discordapp.com/embed/avatars/0.png'}" style="width:64px; height:64px; border-radius:50%; box-shadow: 0 4px 10px rgba(0,0,0,0.5);">
            <div style="font-weight:600;">${g.name}</div>
            <button class="login-btn" style="padding:8px 16px; font-size:12px;">Manage</button>
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
            document.getElementById('playPauseBtn').innerHTML = data.paused ? '<i class="fa-solid fa-play"></i>' : '<i class="fa-solid fa-pause"></i>';
            document.getElementById('timeTotal').textContent = formatTime(data.current.duration);

            // Reflect loop mode on button
            const loopBtn = document.getElementById('loopBtn');
            if (loopBtn) {
                const loopMode = data.modes?.loop ?? 0;
                loopBtn.classList.toggle('active', loopMode !== 0);
                loopBtn.title = loopMode === 0 ? 'Loop Off' : loopMode === 1 ? 'Loop One' : 'Loop All';
                loopBtn.querySelector('i').className = loopMode === 1
                    ? 'fa-solid fa-repeat-1'
                    : 'fa-solid fa-repeat';
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
}, 2500);