/* ═══════════════════════════════════════════
   RIFT DASHBOARD — SETTINGS & PLAYLISTS
   Prefs persist server-side via /api/prefs
   keyed to Discord user ID — syncs across devices
═══════════════════════════════════════════ */

/* ── State ───────────────────────────────── */
let _prefs = {};
let _prefsSaveTimeout = null;
let _dynGradientId = null;
let _bgStyle = 'stars';

const DEFAULTS = {
    accent:         '#7289da',
    bg:             'stars',
    sidebarOpacity: 70,
    glassBlur:      10,
    font:           'Outfit',
    fontSize:       14,
    waveform:       true,
    autoScroll:     true,
    compactQueue:   false,
    stars:          true,
};

/* ── Init ─────────────────────────────────── */
window.initSettings = async function() {
    await loadPrefs();
    applyAllPrefs();
    renderSettingsUI();
    loadPlaylists();
};

/* ── Load / Save prefs ───────────────────── */
async function loadPrefs() {
    // Load from server if logged in, fallback to localStorage
    if (API_BASE && userProfile?.id) {
        try {
            const res = await fetch(`${API_BASE}/prefs/${userProfile.id}`, {
                headers: { 'ngrok-skip-browser-warning': 'true' }
            });
            const data = await res.json();
            if (data && !data.error && Object.keys(data).length) {
                _prefs = { ...DEFAULTS, ...data };
                localStorage.setItem('rift_prefs', JSON.stringify(_prefs));
                return;
            }
        } catch(e) {}
    }
    // Fallback: localStorage
    try {
        const stored = localStorage.getItem('rift_prefs');
        _prefs = stored ? { ...DEFAULTS, ...JSON.parse(stored) } : { ...DEFAULTS };
    } catch(e) {
        _prefs = { ...DEFAULTS };
    }
}

function scheduleSave() {
    clearTimeout(_prefsSaveTimeout);
    _prefsSaveTimeout = setTimeout(persistPrefs, 800);
}

async function persistPrefs() {
    localStorage.setItem('rift_prefs', JSON.stringify(_prefs));
    if (API_BASE && userProfile?.id) {
        try {
            await fetch(`${API_BASE}/prefs/${userProfile.id}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
                body: JSON.stringify(_prefs),
            });
        } catch(e) {}
    }
}

// Call this on every page load (after login) to apply saved prefs immediately
window.applyStoredPrefs = function() {
    try {
        const stored = localStorage.getItem('rift_prefs');
        if (stored) {
            _prefs = { ...DEFAULTS, ...JSON.parse(stored) };
            applyAllPrefs();
        }
    } catch(e) {}
};

/* ── Apply all prefs ─────────────────────── */
function applyAllPrefs() {
    applyAccent(_prefs.accent || DEFAULTS.accent);
    applyBg(_prefs.bg || DEFAULTS.bg);
    applySidebarOpacity(_prefs.sidebarOpacity ?? DEFAULTS.sidebarOpacity);
    applyGlassBlur(_prefs.glassBlur ?? DEFAULTS.glassBlur);
    applyFont(_prefs.font || DEFAULTS.font);
    applyFontSize(_prefs.fontSize ?? DEFAULTS.fontSize);
    applyPrefWaveform(_prefs.waveform ?? DEFAULTS.waveform);
    applyPrefStars(_prefs.stars ?? DEFAULTS.stars);
    applyPrefCompactQueue(_prefs.compactQueue ?? DEFAULTS.compactQueue);
}

/* ── Render settings UI ──────────────────── */
function renderSettingsUI() {
    const p = _prefs;

    // Accent swatches
    document.querySelectorAll('.swatch[data-color]').forEach(s => {
        s.classList.toggle('active', s.dataset.color === p.accent);
    });
    const customInput = document.getElementById('customAccentInput');
    if (customInput) customInput.value = p.accent || '#7289da';

    // BG options
    document.querySelectorAll('.bg-opt[data-bg]').forEach(b => {
        b.classList.toggle('active', b.dataset.bg === p.bg);
    });

    // Sliders
    setSliderUI('sidebarOpacity', p.sidebarOpacity ?? 70, v => `${v}%`);
    setSliderUI('glassBlur',      p.glassBlur      ?? 10, v => `${v}px`);
    setSliderUI('fontSize',       p.fontSize        ?? 14, v => `${v}px`);

    // Font
    document.querySelectorAll('.font-opt[data-font]').forEach(b => {
        b.classList.toggle('active', b.dataset.font === p.font || b.dataset.font === `'${p.font}'`);
    });

    // Toggles
    setToggle('prefWaveform',    p.waveform     ?? true);
    setToggle('prefAutoScroll',  p.autoScroll   ?? true);
    setToggle('prefCompactQueue',p.compactQueue ?? false);
    setToggle('prefStars',       p.stars        ?? true);
}

function setSliderUI(id, val, labelFn) {
    const el = document.getElementById(id);
    const lbl = document.getElementById(id + 'Val');
    if (el) el.value = val;
    if (lbl) lbl.textContent = labelFn(val);
}

function setToggle(id, val) {
    const el = document.getElementById(id);
    if (el) el.checked = val;
}

/* ── Accent color ────────────────────────── */
window.setAccent = function(color, btn, isCustom = false) {
    applyAccent(color);
    _prefs.accent = color;
    scheduleSave();

    // Update swatch active state
    document.querySelectorAll('.swatch[data-color]').forEach(s => s.classList.remove('active'));
    if (btn) btn.classList.add('active');
    else if (!isCustom) {
        const match = document.querySelector(`.swatch[data-color="${color}"]`);
        if (match) match.classList.add('active');
    }
};

function applyAccent(color) {
    const root = document.documentElement;
    root.style.setProperty('--primary', color);

    // Derive glow from color with opacity
    const hex = color.replace('#', '');
    if (hex.length === 6) {
        const r = parseInt(hex.slice(0,2),16);
        const g = parseInt(hex.slice(2,4),16);
        const b = parseInt(hex.slice(4,6),16);
        root.style.setProperty('--primary-glow', `rgba(${r},${g},${b},0.45)`);
    }
}

/* ── Background ──────────────────────────── */
window.setBg = function(style, btn) {
    applyBg(style);
    _prefs.bg = style;
    scheduleSave();
    document.querySelectorAll('.bg-opt').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
};

window.triggerBgUpload = function() {
    document.getElementById('bgImageInput')?.click();
};

window.handleBgUpload = function(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
        const dataUrl = e.target.result;
        localStorage.setItem('rift_bg_image', dataUrl);
        applyBg('custom-img');
        _prefs.bg = 'custom-img';
        scheduleSave();
        document.querySelectorAll('.bg-opt').forEach(b => b.classList.remove('active'));
        const customBtn = document.querySelector('.bg-opt[data-bg="custom-img"]');
        if (customBtn) customBtn.classList.add('active');
    };
    reader.readAsDataURL(file);
};

function applyBg(style) {
    _bgStyle = style;
    stopDynamicGradient();

    const body  = document.body;
    const canvas = document.getElementById('dashboard-stars-canvas');

    // Reset everything
    body.style.backgroundImage = '';
    body.style.backgroundSize  = '';
    body.style.backgroundPosition = '';
    body.style.backgroundColor = '';
    if (canvas) canvas.style.opacity = '0';

    if (style === 'stars') {
        body.style.backgroundColor = 'var(--bg-dark)';
        if (canvas) canvas.style.opacity = '0.4';

    } else if (style === 'gradient') {
        const c = _prefs.accent || '#7289da';
        body.style.backgroundImage = `
            radial-gradient(ellipse at 0% 0%, ${hexToRgba(c, 0.18)} 0%, transparent 55%),
            radial-gradient(ellipse at 100% 100%, ${hexToRgba(c, 0.12)} 0%, transparent 55%),
            linear-gradient(160deg, #0c0c0e 0%, #141420 100%)`;

    } else if (style === 'dynamic') {
        startDynamicGradient();

    } else if (style === 'mesh') {
        body.style.backgroundImage = `
            radial-gradient(at 40% 20%, hsla(240,60%,20%,0.9) 0px, transparent 50%),
            radial-gradient(at 80% 0%,  hsla(270,50%,15%,0.8) 0px, transparent 50%),
            radial-gradient(at 0% 50%,  hsla(220,70%,10%,0.9) 0px, transparent 50%),
            radial-gradient(at 80% 50%, hsla(200,60%,12%,0.8) 0px, transparent 50%),
            radial-gradient(at 0% 100%, hsla(260,50%,15%,0.9) 0px, transparent 50%),
            radial-gradient(at 80% 100%,hsla(240,40%,10%,0.8) 0px, transparent 50%),
            linear-gradient(135deg, #090910 0%, #0f0f1a 100%)`;

    } else if (style === 'dark') {
        body.style.backgroundColor = '#08080c';
        body.style.backgroundImage = 'none';

    } else if (style === 'custom-img') {
        const img = localStorage.getItem('rift_bg_image');
        if (img) {
            body.style.backgroundImage = `url(${img})`;
            body.style.backgroundSize = 'cover';
            body.style.backgroundPosition = 'center';
        }
    }
}

/* ── Dynamic gradient ────────────────────── */
const _dyn = {
    hue: 220, hue2: 280, hue3: 180,
    spd1: 0.3, spd2: 0.2, spd3: 0.25,
};

function startDynamicGradient() {
    let t = 0;
    function frame() {
        if (_bgStyle !== 'dynamic') return;
        t += 0.4;
        const h1 = (_dyn.hue  + t * _dyn.spd1) % 360;
        const h2 = (_dyn.hue2 + t * _dyn.spd2) % 360;
        const h3 = (_dyn.hue3 + t * _dyn.spd3) % 360;
        document.body.style.backgroundImage = `
            radial-gradient(ellipse at ${50 + Math.sin(t*0.01)*30}% ${30 + Math.cos(t*0.008)*20}%,
                hsla(${h1},60%,18%,0.9) 0%, transparent 55%),
            radial-gradient(ellipse at ${70 + Math.cos(t*0.012)*20}% ${70 + Math.sin(t*0.009)*20}%,
                hsla(${h2},55%,14%,0.8) 0%, transparent 55%),
            radial-gradient(ellipse at ${20 + Math.sin(t*0.007)*25}% ${60 + Math.cos(t*0.011)*20}%,
                hsla(${h3},50%,12%,0.7) 0%, transparent 50%),
            linear-gradient(160deg, #090910 0%, #0d0d1c 100%)`;
        _dynGradientId = requestAnimationFrame(frame);
    }
    _dynGradientId = requestAnimationFrame(frame);
}

function stopDynamicGradient() {
    if (_dynGradientId) {
        cancelAnimationFrame(_dynGradientId);
        _dynGradientId = null;
    }
}

/* ── Sidebar opacity ─────────────────────── */
window.setSidebarOpacity = function(val) {
    applySidebarOpacity(val);
    _prefs.sidebarOpacity = parseInt(val);
    const lbl = document.getElementById('sidebarOpacityVal');
    if (lbl) lbl.textContent = `${val}%`;
    scheduleSave();
};

function applySidebarOpacity(val) {
    document.documentElement.style.setProperty(
        '--sidebar-bg',
        `rgba(20,20,25,${val / 100})`
    );
}

/* ── Glass blur ──────────────────────────── */
window.setGlassBlur = function(val) {
    applyGlassBlur(val);
    _prefs.glassBlur = parseInt(val);
    const lbl = document.getElementById('glassBlurVal');
    if (lbl) lbl.textContent = `${val}px`;
    scheduleSave();
};

function applyGlassBlur(val) {
    document.documentElement.style.setProperty('--glass-blur', `${val}px`);
    // Apply to glass-container
    const gc = document.querySelector('.glass-container');
    if (gc) gc.style.backdropFilter = `blur(${val}px)`;
}

/* ── Font ─────────────────────────────────── */
window.setFont = function(font, btn) {
    applyFont(font);
    _prefs.font = font;
    scheduleSave();
    document.querySelectorAll('.font-opt').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
};

function applyFont(font) {
    const clean = font.replace(/'/g, '');
    // Inject a Google Fonts link if not already loaded
    const fontId = `gf-${clean.replace(/\s/g,'-')}`;
    if (!document.getElementById(fontId)) {
        const link = document.createElement('link');
        link.id   = fontId;
        link.rel  = 'stylesheet';
        link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(clean)}:wght@300;400;500;600;700&display=swap`;
        document.head.appendChild(link);
    }
    document.documentElement.style.setProperty('--font-family', font);
    document.body.style.fontFamily = `${font}, sans-serif`;
    // Update all elements via CSS variable
    const style = document.getElementById('rift-font-override') || document.createElement('style');
    style.id = 'rift-font-override';
    style.textContent = `*, button, input, select, textarea { font-family: ${font}, sans-serif !important; }`;
    if (!style.parentNode) document.head.appendChild(style);
}

/* ── Font size ───────────────────────────── */
window.setFontSize = function(val) {
    applyFontSize(val);
    _prefs.fontSize = parseInt(val);
    const lbl = document.getElementById('fontSizeVal');
    if (lbl) lbl.textContent = `${val}px`;
    scheduleSave();
};

function applyFontSize(val) {
    document.documentElement.style.fontSize = `${val}px`;
}

/* ── Toggle prefs ────────────────────────── */
window.savePref = function(key, val) {
    _prefs[key] = val;
    scheduleSave();
    if (key === 'waveform')     applyPrefWaveform(val);
    if (key === 'stars')        applyPrefStars(val);
    if (key === 'compactQueue') applyPrefCompactQueue(val);
};

function applyPrefWaveform(on) {
    const c = document.getElementById('waveformCanvas');
    if (c) c.style.display = on ? 'block' : 'none';
}

function applyPrefStars(on) {
    const c = document.getElementById('dashboard-stars-canvas');
    if (c) c.style.opacity = on && _bgStyle === 'stars' ? '0.4' : '0';
}

function applyPrefCompactQueue(on) {
    document.querySelectorAll('.queue-item').forEach(el => {
        el.classList.toggle('queue-item--compact', on);
    });
    document.getElementById('queueList')?.classList.toggle('queue-list--compact', on);
}

/* ── Reset ───────────────────────────────── */
window.resetAllSettings = function() {
    if (!confirm('Reset all settings to defaults?')) return;
    _prefs = { ...DEFAULTS };
    localStorage.removeItem('rift_prefs');
    localStorage.removeItem('rift_bg_image');
    persistPrefs();
    applyAllPrefs();
    renderSettingsUI();
    showSettingsToast('Settings reset to defaults');
};

/* ── Utility ─────────────────────────────── */
function hexToRgba(hex, alpha) {
    const h = hex.replace('#','');
    const r = parseInt(h.slice(0,2),16);
    const g = parseInt(h.slice(2,4),16);
    const b = parseInt(h.slice(4,6),16);
    return `rgba(${r},${g},${b},${alpha})`;
}

function showSettingsToast(msg, type = 'success') {
    let t = document.getElementById('settingsToast');
    if (!t) {
        t = document.createElement('div');
        t.id = 'settingsToast';
        t.className = 'settings-toast';
        document.body.appendChild(t);
    }
    t.textContent = msg;
    t.className = `settings-toast ${type} show`;
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('show'), 2800);
}

/* ═══════════════════════════════════════════
   PLAYLISTS
═══════════════════════════════════════════ */

let _playlists = [];
let _activePlaylist = null;

window.switchQueueTab = function(tab) {
    document.querySelectorAll('.queue-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.queue-subpanel').forEach(p => p.classList.remove('active'));
    document.getElementById(`tab${tab.charAt(0).toUpperCase()+tab.slice(1)}`)?.classList.add('active');
    document.getElementById(`${tab}Panel`)?.classList.add('active');
    document.getElementById('queueClearBtn').style.display = tab === 'queue' ? '' : 'none';
    if (tab === 'playlists') loadPlaylists();
};

window.loadPlaylists = async function() {
    if (!API_BASE || !userProfile?.id) {
        document.getElementById('playlistList').innerHTML =
            '<div class="pl-empty">Login to view playlists</div>';
        return;
    }
    try {
        const res = await fetch(`${API_BASE}/playlists/${userProfile.id}`, {
            headers: { 'ngrok-skip-browser-warning': 'true' }
        });
        const data = await res.json();
        _playlists = data.playlists || [];
        renderPlaylistList();
    } catch(e) {
        document.getElementById('playlistList').innerHTML =
            '<div class="pl-empty">Failed to load playlists</div>';
    }
};

function renderPlaylistList() {
    const el = document.getElementById('playlistList');
    if (!_playlists.length) {
        el.innerHTML = `
            <div class="pl-empty">
                <i class="fa-solid fa-record-vinyl"></i>
                <span>No playlists yet</span>
                <span class="pl-empty-sub">Create one to get started</span>
            </div>`;
        return;
    }

    el.innerHTML = _playlists.map((pl, i) => `
        <div class="pl-card ${_activePlaylist === pl.name ? 'active' : ''}" onclick="togglePlaylist(${i})">
            <div class="pl-card-main">
                <div class="pl-card-icon">
                    <i class="fa-solid fa-record-vinyl"></i>
                </div>
                <div class="pl-card-info">
                    <span class="pl-card-name">${escPl(pl.name)}</span>
                    <span class="pl-card-meta">${pl.track_count} track${pl.track_count !== 1 ? 's' : ''}${pl.is_public ? ' · Public' : ''}</span>
                </div>
                <div class="pl-card-actions">
                    <button class="pl-btn-play" onclick="event.stopPropagation(); playPlaylist('${escPl(pl.name)}')" title="Play">
                        <i class="fa-solid fa-play"></i>
                    </button>
                    <button class="pl-btn-shuffle" onclick="event.stopPropagation(); playPlaylist('${escPl(pl.name)}', true)" title="Shuffle">
                        <i class="fa-solid fa-shuffle"></i>
                    </button>
                    <button class="pl-btn-delete" onclick="event.stopPropagation(); deletePlaylist('${escPl(pl.name)}')" title="Delete">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </div>
            ${_activePlaylist === pl.name ? renderPlaylistTracks(pl) : ''}
        </div>`).join('');
}

function renderPlaylistTracks(pl) {
    if (!pl.tracks?.length) return '<div class="pl-tracks-empty">No tracks</div>';
    return `
        <div class="pl-tracks">
            ${pl.tracks.map((t, i) => `
                <div class="pl-track-row">
                    <span class="pl-track-num">${i+1}</span>
                    <div class="pl-track-info">
                        <span class="pl-track-title">${escPl(t.title)}</span>
                        <span class="pl-track-artist">${escPl(t.artist || '')}</span>
                    </div>
                    <span class="pl-track-dur">${formatPlDuration(t.duration)}</span>
                    <button class="pl-track-remove" onclick="removeTrackFromPlaylist('${escPl(pl.name)}',${i})" title="Remove">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>`).join('')}
        </div>`;
}

window.togglePlaylist = function(idx) {
    const pl = _playlists[idx];
    _activePlaylist = _activePlaylist === pl.name ? null : pl.name;
    renderPlaylistList();
};

window.playPlaylist = async function(name, shuffle = false) {
    if (!selectedGuildId || !API_BASE) { showSettingsToast('Select a server first', 'error'); return; }
    try {
        const res = await fetch(`${API_BASE}/playlists/${userProfile.id}/play`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
            body: JSON.stringify({ name, guild_id: selectedGuildId, shuffle }),
        });
        const data = await res.json();
        if (data.error) { showSettingsToast(data.error, 'error'); return; }
        showSettingsToast(data.status || '✓ Playing playlist');
        setTimeout(updateMusicState, 800);
    } catch(e) { showSettingsToast('Network error', 'error'); }
};

window.deletePlaylist = async function(name) {
    if (!confirm(`Delete playlist "${name}"?`)) return;
    try {
        const res = await fetch(`${API_BASE}/playlists/${userProfile.id}/delete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
            body: JSON.stringify({ name }),
        });
        const data = await res.json();
        if (data.status === 'deleted') { showSettingsToast('Playlist deleted'); loadPlaylists(); }
        else showSettingsToast(data.error || 'Failed', 'error');
    } catch(e) { showSettingsToast('Network error', 'error'); }
};

window.removeTrackFromPlaylist = async function(name, index) {
    try {
        const res = await fetch(`${API_BASE}/playlists/${userProfile.id}/remove_track`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
            body: JSON.stringify({ name, index }),
        });
        const data = await res.json();
        if (data.playlist) {
            const idx = _playlists.findIndex(p => p.name.toLowerCase() === name.toLowerCase());
            if (idx !== -1) _playlists[idx] = data.playlist;
            renderPlaylistList();
        }
    } catch(e) {}
};

/* ── Create playlist modal ───────────────── */
window.openCreatePlaylist = function() {
    let modal = document.getElementById('createPlaylistModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'createPlaylistModal';
        modal.className = 'mod-modal-overlay';
        modal.innerHTML = `
            <div class="mod-modal glass" onclick="event.stopPropagation()" style="max-width:380px">
                <div class="mod-modal-header">
                    <span><i class="fa-solid fa-record-vinyl"></i> New Playlist</span>
                    <button class="mod-modal-close" onclick="document.getElementById('createPlaylistModal').classList.add('hidden')">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
                <div class="mod-modal-body">
                    <input type="text" id="plNewName" placeholder="Playlist name..." class="mod-modal-reason" style="margin-top:0">
                    <input type="text" id="plNewDesc" placeholder="Description (optional)..." class="mod-modal-reason">
                    <label class="pl-public-row">
                        <input type="checkbox" id="plNewPublic">
                        <span>Make public</span>
                    </label>
                    <div class="mod-modal-buttons" style="margin-top:14px">
                        <button class="mod-modal-cancel" onclick="document.getElementById('createPlaylistModal').classList.add('hidden')">Cancel</button>
                        <button class="mod-modal-confirm" onclick="submitCreatePlaylist()">Create</button>
                    </div>
                    <div id="plCreateResult" class="fix-result hidden"></div>
                </div>
            </div>`;
        modal.addEventListener('click', e => { if (e.target === modal) modal.classList.add('hidden'); });
        document.body.appendChild(modal);
    }
    document.getElementById('plNewName').value = '';
    document.getElementById('plNewDesc').value = '';
    document.getElementById('plNewPublic').checked = false;
    document.getElementById('plCreateResult').classList.add('hidden');
    modal.classList.remove('hidden');
    setTimeout(() => document.getElementById('plNewName').focus(), 50);
};

window.submitCreatePlaylist = async function() {
    const name   = document.getElementById('plNewName').value.trim();
    const desc   = document.getElementById('plNewDesc').value.trim();
    const pub    = document.getElementById('plNewPublic').checked;
    const result = document.getElementById('plCreateResult');

    if (!name) { result.textContent = 'Name is required'; result.className = 'fix-result error'; result.classList.remove('hidden'); return; }

    try {
        const res = await fetch(`${API_BASE}/playlists/${userProfile.id}/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
            body: JSON.stringify({ name, description: desc, public: pub }),
        });
        const data = await res.json();
        if (data.error) { result.textContent = data.error; result.className = 'fix-result error'; result.classList.remove('hidden'); return; }
        document.getElementById('createPlaylistModal').classList.add('hidden');
        showSettingsToast(`✓ "${name}" created`);
        loadPlaylists();
    } catch(e) { result.textContent = 'Network error'; result.className = 'fix-result error'; result.classList.remove('hidden'); }
};

/* ── Helpers ─────────────────────────────── */
function escPl(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function formatPlDuration(ms) {
    if (!ms) return '';
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    return `${m}:${(s % 60).toString().padStart(2,'0')}`;
}

// Apply prefs as soon as this script loads (before initSettings is called)
document.addEventListener('DOMContentLoaded', () => {
    window.applyStoredPrefs?.();
});
