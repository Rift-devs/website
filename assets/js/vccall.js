/* ═══════════════════════════════════════════════════════
   RIFT DASHBOARD — VC CALL RELAY
   Visualiser + Controller. No audio — controls only.
   WebSocket: wss://api.rift.baby/ws/vc
   API:       https://api.rift.baby/api/vc/*
═══════════════════════════════════════════════════════ */

const VC_WS_URL  = 'wss://api.rift.baby/ws/vc';
const VC_API     = 'https://api.rift.baby/api/vc';

/* ── State ─────────────────────────────────────────────── */
let _vcWs              = null;
let _vcWsRetryDelay    = 3000;
let _vcWsRetryTimer    = null;
let _vcCallState       = null;   // null = no active call
let _vcSpeaking        = {};     // user_id → bool
let _vcRingTimers      = {};     // user_id → setTimeout handle
let _vcVisualizerOn    = true;   // pref: live speaking visualiser
let _vcRingPulseOn     = true;   // pref: ring pulse animation
let _vcJoinCode        = '';
let _vcGuildId         = null;   // guild the dashboard user has selected
let _vcPendingAction   = null;   // 'call' | 'join' | 'hangup'

/* ── Init (called when tab becomes active) ─────────────── */
window.initVcCall = function () {
    _vcVisualizerOn = _getVcPref('vcVisualizer', true);
    _vcRingPulseOn  = _getVcPref('vcRingPulse',  true);
    _syncVcPrefsUI();
    _connectVcWs();
    _renderCallUI();
};

/* ── Pref helpers ──────────────────────────────────────── */
function _getVcPref(key, def) {
    try {
        const stored = localStorage.getItem('rift_prefs');
        if (stored) return JSON.parse(stored)[key] ?? def;
    } catch (_) {}
    return def;
}

function _saveVcPref(key, val) {
    if (typeof window.savePref === 'function') {
        window.savePref(key, val);
    } else {
        try {
            const stored = JSON.parse(localStorage.getItem('rift_prefs') || '{}');
            stored[key] = val;
            localStorage.setItem('rift_prefs', JSON.stringify(stored));
        } catch (_) {}
    }
}

function _syncVcPrefsUI() {
    const vizEl  = document.getElementById('prefVcVisualizer');
    const ringEl = document.getElementById('prefVcRingPulse');
    if (vizEl)  vizEl.checked  = _vcVisualizerOn;
    if (ringEl) ringEl.checked = _vcRingPulseOn;
}

/* ── WebSocket ─────────────────────────────────────────── */
function _connectVcWs() {
    if (_vcWs && (_vcWs.readyState === WebSocket.OPEN || _vcWs.readyState === WebSocket.CONNECTING)) return;
    clearTimeout(_vcWsRetryTimer);

    _vcWs = new WebSocket(VC_WS_URL);

    _vcWs.onopen = () => {
        _vcWsRetryDelay = 3000;
        _updateVcConnectionDot(true);
        // request full state on connect
        _vcWsSend({ type: 'get_state' });
    };

    _vcWs.onmessage = (e) => {
        try { _handleVcMessage(JSON.parse(e.data)); }
        catch (_) {}
    };

    _vcWs.onclose = () => {
        _updateVcConnectionDot(false);
        _vcWsRetryTimer = setTimeout(_connectVcWs, _vcWsRetryDelay);
        _vcWsRetryDelay = Math.min(_vcWsRetryDelay * 2, 30000);
    };

    _vcWs.onerror = () => { _vcWs.close(); };
}

function _vcWsSend(obj) {
    if (_vcWs && _vcWs.readyState === WebSocket.OPEN) {
        _vcWs.send(JSON.stringify(obj));
    }
}

function _updateVcConnectionDot(online) {
    const dot = document.getElementById('vcCallDot');
    const txt = document.getElementById('vcCallConnStatus');
    if (dot) dot.className = 'vc-conn-dot ' + (online ? 'online' : '');
    if (txt) txt.textContent = online ? 'Live' : 'Connecting…';
}

/* ── Message handler ───────────────────────────────────── */
function _handleVcMessage(msg) {
    switch (msg.type) {

        case 'call_state':
            _vcCallState = msg.data;   // null or { code, side_a, side_b, start_ts }
            _vcSpeaking  = {};
            _renderCallUI();
            break;

        case 'speaking':
            if (!_vcVisualizerOn) break;
            _vcSpeaking[msg.user_id] = msg.speaking;
            _applyRingState(msg.user_id, msg.speaking);
            // auto-clear after 400 ms silence guard
            clearTimeout(_vcRingTimers[msg.user_id]);
            if (msg.speaking) {
                _vcRingTimers[msg.user_id] = setTimeout(() => {
                    _vcSpeaking[msg.user_id] = false;
                    _applyRingState(msg.user_id, false);
                }, 400);
            }
            break;

        case 'call_ended':
            _vcCallState = null;
            _vcSpeaking  = {};
            _renderCallUI();
            _showVcToast('Call ended — ' + (msg.duration || ''));
            break;

        case 'call_started':
            _vcCallState = msg.data;
            _vcSpeaking  = {};
            _renderCallUI();
            _showVcToast('Call connected · code ' + msg.data.code);
            break;

        case 'error':
            _showVcToast(msg.message || 'Unknown error', true);
            _setVcBtnLoading(false);
            break;

        case 'ok':
            _setVcBtnLoading(false);
            break;
    }
}

/* ── Ring animation ────────────────────────────────────── */
function _applyRingState(userId, speaking) {
    const card = document.querySelector(`.vc-avatar-card[data-uid="${userId}"]`);
    if (!card) return;
    const ring = card.querySelector('.vc-ring');
    const bar  = card.querySelector('.vc-audio-bar');
    if (ring) ring.classList.toggle('speaking', speaking && _vcRingPulseOn);
    if (bar)  bar.classList.toggle('active',   speaking && _vcVisualizerOn);
}

/* ── Main render ───────────────────────────────────────── */
function _renderCallUI() {
    const wrap = document.getElementById('vcCallContent');
    if (!wrap) return;

    if (!_vcCallState) {
        wrap.innerHTML = _renderIdleUI();
        _attachIdleEvents();
        return;
    }

    wrap.innerHTML = _renderActiveUI(_vcCallState);
    _attachActiveEvents();

    // re-apply any speaking states that arrived before render
    Object.entries(_vcSpeaking).forEach(([uid, speaking]) => {
        if (speaking) _applyRingState(uid, true);
    });
}

/* ── Idle UI (no active call) ──────────────────────────── */
function _renderIdleUI() {
    return `
    <div class="vc-idle-wrap">
        <div class="vc-idle-hero">
            <div class="vc-idle-icon">
                <i class="fa-solid fa-phone"></i>
            </div>
            <h2 class="vc-idle-title">No Active Call</h2>
            <p class="vc-idle-sub">Start a random cross-server voice call, or join one with a code.</p>
        </div>

        <div class="vc-action-cards">

            <!-- Random call -->
            <div class="vc-action-card glass">
                <div class="vc-action-card-icon">
                    <i class="fa-solid fa-shuffle"></i>
                </div>
                <div class="vc-action-card-body">
                    <span class="vc-action-card-title">Random Call</span>
                    <span class="vc-action-card-desc">Match with a random server instantly</span>
                </div>
                <button class="vc-btn vc-btn-primary" id="vcCallBtn" onclick="vcStartCall()">
                    <i class="fa-solid fa-phone"></i> Call
                </button>
            </div>

            <!-- Join by code -->
            <div class="vc-action-card glass">
                <div class="vc-action-card-icon">
                    <i class="fa-solid fa-key"></i>
                </div>
                <div class="vc-action-card-body">
                    <span class="vc-action-card-title">Join by Code</span>
                    <span class="vc-action-card-desc">Enter a 6-character call code</span>
                </div>
                <div class="vc-join-row">
                    <input id="vcCodeInput" class="vc-code-input" type="text"
                           placeholder="A1B2C3" maxlength="6"
                           oninput="this.value=this.value.toUpperCase()"
                           onkeydown="if(event.key==='Enter')vcJoinCall()">
                    <button class="vc-btn vc-btn-primary" id="vcJoinBtn" onclick="vcJoinCall()">
                        <i class="fa-solid fa-arrow-right-to-bracket"></i> Join
                    </button>
                </div>
            </div>

        </div>

        <p class="vc-idle-hint">
            <i class="fa-solid fa-circle-info"></i>
            You must be in a Discord voice channel. The bot joins it and relays audio.
        </p>
    </div>`;
}

/* ── Active call UI ────────────────────────────────────── */
function _renderActiveUI(state) {
    const { code, side_a, side_b, start_ts } = state;
    const elapsed = start_ts ? _fmtDuration(Math.floor((Date.now() / 1000) - start_ts)) : '—';

    return `
    <div class="vc-active-wrap">

        <!-- Header bar -->
        <div class="vc-active-header glass">
            <div class="vc-active-header-left">
                <span class="vc-live-dot"></span>
                <span class="vc-active-code">Call <kbd>${code}</kbd></span>
                <span class="vc-active-elapsed" id="vcElapsed">${elapsed}</span>
            </div>
            <button class="vc-btn vc-btn-danger" id="vcHangupBtn" onclick="vcHangup()">
                <i class="fa-solid fa-phone-slash"></i> Hang Up
            </button>
        </div>

        <!-- Two-side grid -->
        <div class="vc-sides-grid">
            ${_renderSide(side_a, 'A')}
            <div class="vc-sides-divider">
                <div class="vc-sides-divider-line"></div>
                <span class="vc-sides-divider-icon"><i class="fa-solid fa-right-left"></i></span>
                <div class="vc-sides-divider-line"></div>
            </div>
            ${_renderSide(side_b, 'B')}
        </div>

    </div>`;
}

function _renderSide(side, label) {
    if (!side) {
        return `<div class="vc-side vc-side-empty glass">
            <span class="vc-side-waiting">
                <i class="fa-solid fa-hourglass-half"></i> Waiting for side ${label}…
            </span>
        </div>`;
    }

    const members = side.members || [];
    const avatarHtml = members.length
        ? members.map(m => _renderAvatarCard(m)).join('')
        : `<div class="vc-no-members"><i class="fa-solid fa-microphone-slash"></i> Empty VC</div>`;

    return `
    <div class="vc-side glass">
        <div class="vc-side-header">
            <img class="vc-side-guild-icon" src="${_guildIcon(side.guild_id, side.guild_icon)}"
                 onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'">
            <div class="vc-side-info">
                <span class="vc-side-guild-name">${_esc(side.guild_name)}</span>
                <span class="vc-side-vc-name"><i class="fa-solid fa-volume-high"></i> ${_esc(side.vc_name)}</span>
            </div>
        </div>
        <div class="vc-avatars-grid">
            ${avatarHtml}
        </div>
    </div>`;
}

function _renderAvatarCard(member) {
    const avatar = member.avatar
        ? `https://cdn.discordapp.com/avatars/${member.id}/${member.avatar}.${member.avatar.startsWith('a_') ? 'gif' : 'webp'}?size=80`
        : `https://cdn.discordapp.com/embed/avatars/${Number(member.id) % 5}.png`;

    return `
    <div class="vc-avatar-card" data-uid="${member.id}">
        <div class="vc-avatar-wrap">
            <div class="vc-ring"></div>
            <img class="vc-avatar-img" src="${avatar}"
                 onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'">
        </div>
        <div class="vc-audio-bars">
            <div class="vc-audio-bar"></div>
            <div class="vc-audio-bar"></div>
            <div class="vc-audio-bar"></div>
        </div>
        <span class="vc-avatar-name">${_esc(member.display_name || member.username)}</span>
    </div>`;
}

/* ── Elapsed timer ─────────────────────────────────────── */
let _vcElapsedTimer = null;
function _attachActiveEvents() {
    clearInterval(_vcElapsedTimer);
    if (_vcCallState?.start_ts) {
        _vcElapsedTimer = setInterval(() => {
            const el = document.getElementById('vcElapsed');
            if (!el) { clearInterval(_vcElapsedTimer); return; }
            const secs = Math.floor(Date.now() / 1000 - _vcCallState.start_ts);
            el.textContent = _fmtDuration(secs);
        }, 1000);
    }
}

function _attachIdleEvents() {
    clearInterval(_vcElapsedTimer);
    const inp = document.getElementById('vcCodeInput');
    if (inp) inp.focus();
}

/* ── API actions ───────────────────────────────────────── */
window.vcStartCall = async function () {
    if (!_assertLoggedIn()) return;
    _setVcBtnLoading(true, 'vcCallBtn');
    try {
        const res = await fetch(`${VC_API}/call`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
            body: JSON.stringify({ user_id: userProfile.id, guild_id: _vcGuildId })
        });
        const data = await res.json();
        if (data.error) { _showVcToast(data.error, true); _setVcBtnLoading(false, 'vcCallBtn'); }
    } catch (e) {
        _showVcToast('Request failed', true);
        _setVcBtnLoading(false, 'vcCallBtn');
    }
};

window.vcJoinCall = async function () {
    if (!_assertLoggedIn()) return;
    const code = (document.getElementById('vcCodeInput')?.value || '').trim().toUpperCase();
    if (code.length !== 6) { _showVcToast('Enter a 6-character code', true); return; }
    _setVcBtnLoading(true, 'vcJoinBtn');
    try {
        const res = await fetch(`${VC_API}/join`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
            body: JSON.stringify({ user_id: userProfile.id, guild_id: _vcGuildId, code })
        });
        const data = await res.json();
        if (data.error) { _showVcToast(data.error, true); _setVcBtnLoading(false, 'vcJoinBtn'); }
    } catch (e) {
        _showVcToast('Request failed', true);
        _setVcBtnLoading(false, 'vcJoinBtn');
    }
};

window.vcHangup = async function () {
    if (!_assertLoggedIn()) return;
    _setVcBtnLoading(true, 'vcHangupBtn');
    try {
        const res = await fetch(`${VC_API}/hangup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
            body: JSON.stringify({ user_id: userProfile.id, guild_id: _vcGuildId })
        });
        const data = await res.json();
        if (data.error) { _showVcToast(data.error, true); _setVcBtnLoading(false, 'vcHangupBtn'); }
    } catch (e) {
        _showVcToast('Request failed', true);
        _setVcBtnLoading(false, 'vcHangupBtn');
    }
};

/* ── Settings prefs (called from settings.js hooks) ────── */
window.applyVcPrefVisualizer = function (on) {
    _vcVisualizerOn = on;
    if (!on) {
        // clear all rings
        document.querySelectorAll('.vc-ring').forEach(r => r.classList.remove('speaking'));
        document.querySelectorAll('.vc-audio-bar').forEach(b => b.classList.remove('active'));
    }
};

window.applyVcPrefRingPulse = function (on) {
    _vcRingPulseOn = on;
    if (!on) {
        document.querySelectorAll('.vc-ring').forEach(r => r.classList.remove('speaking'));
    }
};

/* ── Helpers ───────────────────────────────────────────── */
function _assertLoggedIn() {
    if (!userProfile?.id) { _showVcToast('Log in first', true); return false; }
    return true;
}

function _setVcBtnLoading(loading, id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.disabled = loading;
    el.style.opacity = loading ? '0.5' : '';
}

function _fmtDuration(secs) {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (h) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    return `${m}:${String(s).padStart(2,'0')}`;
}

function _guildIcon(guildId, iconHash) {
    if (!iconHash) return 'https://cdn.discordapp.com/embed/avatars/0.png';
    return `https://cdn.discordapp.com/icons/${guildId}/${iconHash}.${iconHash.startsWith('a_') ? 'gif' : 'webp'}?size=64`;
}

function _esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

let _vcToastTimer = null;
function _showVcToast(msg, isError = false) {
    let toast = document.getElementById('vcToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'vcToast';
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.className   = 'vc-toast' + (isError ? ' vc-toast-error' : '');
    toast.classList.add('show');
    clearTimeout(_vcToastTimer);
    _vcToastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
}

/* ── Disconnect WS when tab leaves ─────────────────────── */
window._vcCallTabLeave = function () {
    clearInterval(_vcElapsedTimer);
};

/* ── VC Guild dropdown (mirrors music guild logic) ─────── */
window.toggleVcGuildDropdown = function () {
    const menu = document.getElementById('vcGuildDropdownMenu');
    if (!menu) return;
    menu.classList.toggle('hidden');
    if (!menu.classList.contains('hidden') && !menu.innerHTML.trim()) {
        _populateVcGuildMenu();
    }
    document.addEventListener('click', function _close(e) {
        const wrap = document.getElementById('vcGuildDropdown');
        if (wrap && !wrap.contains(e.target)) {
            menu.classList.add('hidden');
            document.removeEventListener('click', _close);
        }
    });
};

function _populateVcGuildMenu() {
    const menu = document.getElementById('vcGuildDropdownMenu');
    if (!menu) return;
    // Reuse the guilds from the music dropdown
    const musicItems = document.querySelectorAll('#guildDropdownMenu .guild-dropdown-item');
    if (!musicItems.length) {
        menu.innerHTML = '<div style="padding:10px 14px;color:var(--text-muted);font-size:13px">No servers found</div>';
        return;
    }
    menu.innerHTML = '';
    musicItems.forEach(item => {
        const clone = item.cloneNode(true);
        const guildId   = item.dataset.guildId;
        const guildName = item.querySelector('.guild-dropdown-name')?.textContent || '';
        const iconEl    = item.querySelector('img');
        clone.onclick = () => {
            _vcGuildId = guildId;
            const sel = document.getElementById('vcGuildDropdownSelected');
            if (sel) {
                const txtEl = document.getElementById('vcGuildDropdownText');
                if (txtEl) txtEl.textContent = guildName;
                if (iconEl) {
                    let img = sel.querySelector('img');
                    if (!img) { img = document.createElement('img'); sel.prepend(img); }
                    img.src = iconEl.src;
                    img.style.cssText = 'width:20px;height:20px;border-radius:50%;margin-right:8px;vertical-align:middle';
                }
            }
            menu.classList.add('hidden');
        };
        menu.appendChild(clone);
    });
}
