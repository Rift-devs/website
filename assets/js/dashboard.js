// Configuration
const CLIENT_ID = "1329184069426348052";
const WS_URL = "wss://resentfully-unmourned-yasmine.ngrok-free.dev/ws";
const API_BASE = "https://resentfully-unmourned-yasmine.ngrok-free.dev/api";

// State
let ws = null;
let userProfile = null;
let selectedGuildId = null;
let currentTrackDuration = 0;
let isSeeking = false;

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initWebSocket();
    checkAuth();
    
    // Music Controls
    document.getElementById('musicGuildSelect').addEventListener('change', (e) => {
        selectedGuildId = e.target.value;
        updateMusicState();
    });

    document.getElementById('seekBar').addEventListener('input', () => isSeeking = true);
    document.getElementById('seekBar').addEventListener('change', (e) => {
        isSeeking = false;
        const newPos = (e.target.value / 100) * currentTrackDuration;
        musicControl('seek', newPos);
    });

    document.getElementById('volumeSlider').addEventListener('change', (e) => {
        musicControl('volume', e.target.value);
    });
});

// Navigation
function initTabs() {
    const links = document.querySelectorAll('.nav-links li');
    links.forEach(link => {
        link.addEventListener('click', () => {
            const target = link.dataset.tab;
            
            // UI Update
            links.forEach(l => l.classList.remove('active'));
            link.classList.add('active');
            
            document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
            document.getElementById(target).classList.add('active');
            
            document.getElementById('activeTabTitle').textContent = target.charAt(0).toUpperCase() + target.slice(1);
        });
    });
}

// Real-time Updates via WebSocket
function initWebSocket() {
    ws = new WebSocket(WS_URL);
    
    ws.onopen = () => {
        console.log("WebSocket Connected");
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
        console.log("WebSocket Disconnected, retrying...");
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

// Authentication
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
                <img src="https://cdn.discordapp.com/avatars/${userProfile.id}/${userProfile.avatar}.png" style="width:32px; height:32px; border-radius:50%;">
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
    
    const select = document.getElementById('musicGuildSelect');
    select.innerHTML = '<option value="">Select a Server</option>';
    
    adminGuilds.forEach(g => {
        const opt = document.createElement('option');
        opt.value = g.id;
        opt.textContent = g.name;
        select.appendChild(opt);
    });

    renderServerGrid(adminGuilds);
}

function renderServerGrid(guilds) {
    const grid = document.getElementById('serverList');
    grid.innerHTML = guilds.map(g => `
        <div class="glass" style="display:flex; flex-direction:column; align-items:center; gap:15px; text-align:center;">
            <img src="${g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png` : 'https://cdn.discordapp.com/embed/avatars/0.png'}" style="width:64px; height:64px; border-radius:50%;">
            <div style="font-weight:600;">${g.name}</div>
            <button class="login-btn" style="padding:8px 16px; font-size:12px;">Manage</button>
        </div>
    `).join('');
}

// Music Management
async function updateMusicState() {
    if (!selectedGuildId) return;
    
    try {
        const res = await fetch(`${API_BASE}/music/state/${selectedGuildId}`);
        const data = await res.json();
        
        if (data.current) {
            document.getElementById('currentTrackTitle').textContent = data.current.title;
            document.getElementById('currentTrackAuthor').textContent = data.current.author;
            document.getElementById('albumArt').style.backgroundImage = `url(${data.current.artwork || ''})`;
            document.getElementById('albumArt').innerHTML = data.current.artwork ? '' : '<i class="fa-solid fa-compact-disc fa-spin-slow"></i>';
            document.getElementById('playPauseBtn').innerHTML = data.paused ? '<i class="fa-solid fa-play"></i>' : '<i class="fa-solid fa-pause"></i>';
            
            currentTrackDuration = data.current.duration;
            if (!isSeeking) {
                const percent = (data.position * 1000 / data.current.duration) * 100;
                document.getElementById('seekBar').value = percent || 0;
                document.getElementById('timeCurrent').textContent = formatTime(data.position * 1000);
                document.getElementById('timeTotal').textContent = formatTime(data.current.duration);
            }
        } else {
            resetPlayer();
        }
        
        renderQueue(data.queue);
    } catch (e) {
        console.error("Music state update failed");
    }
}

function renderQueue(queue) {
    const list = document.getElementById('queueList');
    if (!queue || queue.length === 0) {
        list.innerHTML = '<li class="empty-msg">Queue is empty</li>';
        return;
    }
    list.innerHTML = queue.map((t, i) => `<li>${i+1}. ${t.title}</li>`).join('');
}

function resetPlayer() {
    document.getElementById('currentTrackTitle').textContent = "Not Playing";
    document.getElementById('currentTrackAuthor').textContent = "Select a server to view status";
    document.getElementById('albumArt').style.backgroundImage = 'none';
    document.getElementById('albumArt').innerHTML = '<i class="fa-solid fa-compact-disc fa-spin-slow"></i>';
    document.getElementById('seekBar').value = 0;
}

async function musicControl(action, value = null) {
    if (!selectedGuildId) return;
    await fetch(`${API_BASE}/music/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guild_id: selectedGuildId, action, value })
    });
    setTimeout(updateMusicState, 500);
}

function formatTime(ms) {
    if (!ms) return "0:00";
    const sec = Math.floor(ms / 1000);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

// Auto-update music state if on music tab
setInterval(() => {
    if (document.getElementById('music').classList.contains('active')) {
        updateMusicState();
    }
}, 2000);
