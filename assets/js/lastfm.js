/* ═══════════════════════════════════════════
   RIFT DASHBOARD — LAST.FM MODULE
═══════════════════════════════════════════ */

let fmPeriod = '7day';
let fmArtistsChart = null;
let fmTracksChart = null;
let fmRefreshInterval = null;
let fmUserId = null;

/* ── Init ─────────────────────────────────── */
window.initLastfm = async function() {
    if (!userProfile) {
        showFmNotLinked();
        return;
    }
    fmUserId = userProfile.id;

    // Show loading state while waiting for API
    document.getElementById('lastfmProfileInner').classList.add('hidden');

    // Wait up to 3s for API_BASE to be ready (Gist fetch may still be in progress)
    if (!API_BASE) {
        for (let i = 0; i < 6; i++) {
            await new Promise(r => setTimeout(r, 500));
            if (API_BASE) break;
        }
    }

    if (!API_BASE) {
        showFmNotLinked();
        return;
    }

    await loadFmProfile();
    await loadFmNowPlaying();
    await loadFmTopArtists();
    await loadFmTopTracks();
    loadFmGenres();    // non-blocking — slow API, runs in background
    loadFmHeatmap();   // non-blocking

    // Refresh now playing every 20s
    if (fmRefreshInterval) clearInterval(fmRefreshInterval);
    fmRefreshInterval = setInterval(async () => {
        if (document.getElementById('lastfm').classList.contains('active')) {
            await loadFmNowPlaying();
        }
    }, 20000);
};

/* ── Period selector ─────────────────────── */
window.setFmPeriod = async function(period, btn) {
    fmPeriod = period;
    document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    await loadFmTopArtists();
    await loadFmTopTracks();
    loadFmGenres();
};

/* ── Profile ─────────────────────────────── */
async function loadFmProfile() {
    if (!API_BASE || !fmUserId) return;
    try {
        const res = await fetch(`${API_BASE}/lastfm/profile/${fmUserId}`, {
            headers: { 'ngrok-skip-browser-warning': 'true' }
        });
        const data = await res.json();
        if (data.error) { showFmNotLinked(); return; }

        document.getElementById('lastfmProfileInner').classList.remove('hidden');

        const avatarEl = document.getElementById('lastfmAvatar');
        avatarEl.src = data.avatar || 'https://lastfm.freetls.fastly.net/i/u/avatar170s/818148bf682d429dc215c1705eb27b98.png';
        avatarEl.onerror = () => { avatarEl.src = 'https://lastfm.freetls.fastly.net/i/u/avatar170s/818148bf682d429dc215c1705eb27b98.png'; };

        const badge = document.getElementById('lastfmScrobbleBadge');
        badge.textContent = formatBigNum(data.playcount);

        const link = document.getElementById('lastfmUsernameLink');
        link.textContent = data.username;
        link.href = data.url;

        const countryEl = document.getElementById('lastfmCountry');
        countryEl.textContent = data.country || '';

        document.getElementById('lastfmPlaycount').textContent = formatBigNum(data.playcount);
        document.getElementById('lastfmArtists').textContent   = formatBigNum(data.artist_count);
        document.getElementById('lastfmTracks').textContent    = formatBigNum(data.track_count);
        document.getElementById('lastfmAlbums').textContent    = formatBigNum(data.album_count);

        // Member since
        if (data.registered) {
            const yr = new Date(data.registered * 1000).getFullYear();
            countryEl.textContent = `${data.country ? data.country + ' · ' : ''}Since ${yr}`;
        }
    } catch(e) { console.error('[LastFM] profile error:', e); showFmNotLinked(); }
}

function showFmNotLinked() {
    document.getElementById('lastfmProfileInner').classList.add('hidden');
}

/* ── Now Playing ─────────────────────────── */
async function loadFmNowPlaying() {
    if (!API_BASE || !fmUserId) return;
    try {
        const res = await fetch(`${API_BASE}/lastfm/nowplaying/${fmUserId}`, {
            headers: { 'ngrok-skip-browser-warning': 'true' }
        });
        const data = await res.json();
        renderFmNowPlaying(data.now_playing);
        renderFmRecent(data.recent || []);
    } catch(e) { console.error('[LastFM] nowplaying error:', e); }
}

function renderFmNowPlaying(track) {
    const el = document.getElementById('lastfmNowInner');
    if (!track) {
        el.innerHTML = '<div class="lastfm-nothing"><i class="fa-solid fa-pause"></i> Nothing playing right now</div>';
        return;
    }
    el.innerHTML = `
        <div class="lastfm-now-track">
            <div class="lastfm-now-art">
                <img src="${track.image || ''}" onerror="this.style.display='none'" alt="">
                <div class="lastfm-now-pulse"></div>
            </div>
            <div class="lastfm-now-info">
                <a href="${track.url}" target="_blank" class="lastfm-now-title">${escHtml(track.name)}</a>
                <span class="lastfm-now-artist">${escHtml(track.artist)}</span>
                <span class="lastfm-now-album">${escHtml(track.album)}</span>
            </div>
            <div class="lastfm-bars">
                <div class="lastfm-bar"></div>
                <div class="lastfm-bar"></div>
                <div class="lastfm-bar"></div>
                <div class="lastfm-bar"></div>
            </div>
        </div>`;
}

function renderFmRecent(tracks) {
    const el = document.getElementById('lastfmRecentList');
    if (!tracks.length) { el.innerHTML = '<div class="lastfm-nothing">No recent tracks</div>'; return; }
    el.innerHTML = tracks.map((t, i) => {
        const ago = t.date ? timeAgo(t.date * 1000) : 'Now';
        const nowClass = t.now_playing ? 'fm-recent-now' : '';
        return `
        <div class="fm-recent-row ${nowClass}">
            <span class="fm-recent-num">${i + 1}</span>
            <img class="fm-recent-art" src="${t.image || ''}" onerror="this.style.display='none'" alt="">
            <div class="fm-recent-info">
                <a href="${t.url}" target="_blank" class="fm-recent-title">${escHtml(t.name)}</a>
                <span class="fm-recent-artist">${escHtml(t.artist)}</span>
            </div>
            <span class="fm-recent-time">${t.now_playing ? '<span class="fm-now-badge">▶ NOW</span>' : ago}</span>
        </div>`;
    }).join('');
}

/* ── Top Artists ─────────────────────────── */
async function loadFmTopArtists() {
    if (!API_BASE || !fmUserId) return;
    try {
        const res = await fetch(`${API_BASE}/lastfm/topartists/${fmUserId}?period=${fmPeriod}`, {
            headers: { 'ngrok-skip-browser-warning': 'true' }
        });
        const data = await res.json();
        if (data.error) return;
        renderFmArtistsChart(data.artists);
        renderFmArtistsList(data.artists);
    } catch(e) { console.error('[LastFM] topartists error:', e); }
}

function renderFmArtistsChart(artists) {
    if (!artists.length) return;
    const top = artists.slice(0, 7);
    const labels = top.map(a => a.name);
    const values = top.map(a => a.playcount);
    const max = Math.max(...values);
    const colors = top.map((_, i) => `hsla(${220 + i * 20}, 70%, ${55 + i * 3}%, 0.85)`);

    if (fmArtistsChart) fmArtistsChart.destroy();
    const ctx = document.getElementById('fmArtistsChart').getContext('2d');
    fmArtistsChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                data: values,
                backgroundColor: colors,
                borderRadius: 6,
                borderSkipped: false,
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            animation: { duration: 500 },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(14,14,18,0.95)',
                    borderColor: 'rgba(255,255,255,0.1)',
                    borderWidth: 1,
                    callbacks: { label: ctx => ` ${ctx.parsed.x.toLocaleString()} plays` }
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255,255,255,0.04)' },
                    ticks: { color: '#a0a0a8', callback: v => formatBigNum(v) }
                },
                y: {
                    grid: { display: false },
                    ticks: {
                        color: '#ffffff',
                        font: { weight: '500' },
                        callback: (_, i) => labels[i].length > 14 ? labels[i].slice(0, 13) + '…' : labels[i]
                    }
                }
            }
        }
    });
}

function renderFmArtistsList(artists) {
    const el = document.getElementById('fmArtistsList');
    const max = artists[0]?.playcount || 1;
    el.innerHTML = artists.slice(0, 10).map((a, i) => {
        const pct = Math.round((a.playcount / max) * 100);
        return `
        <div class="lastfm-top-row">
            <span class="lastfm-top-rank">${i + 1}</span>
            <div class="lastfm-top-info">
                <a href="${a.url}" target="_blank" class="lastfm-top-name">${escHtml(a.name)}</a>
                <div class="lastfm-top-bar-wrap">
                    <div class="lastfm-top-bar" style="width:${pct}%"></div>
                </div>
            </div>
            <span class="lastfm-top-plays">${a.playcount.toLocaleString()}</span>
        </div>`;
    }).join('');
}

/* ── Top Tracks ──────────────────────────── */
async function loadFmTopTracks() {
    if (!API_BASE || !fmUserId) return;
    try {
        const res = await fetch(`${API_BASE}/lastfm/toptracks/${fmUserId}?period=${fmPeriod}`, {
            headers: { 'ngrok-skip-browser-warning': 'true' }
        });
        const data = await res.json();
        if (data.error) return;
        renderFmTracksChart(data.tracks);
        renderFmTracksList(data.tracks);
    } catch(e) { console.error('[LastFM] toptracks error:', e); }
}

function renderFmTracksChart(tracks) {
    if (!tracks.length) return;
    const top = tracks.slice(0, 5);
    const labels = top.map(t => t.name);
    const values = top.map(t => t.playcount);
    const colors = ['#7289da','#4ade80','#fb923c','#f472b6','#38bdf8'];

    if (fmTracksChart) fmTracksChart.destroy();
    const ctx = document.getElementById('fmTracksChart').getContext('2d');
    fmTracksChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data: values,
                backgroundColor: colors,
                borderColor: 'rgba(14,14,18,0.8)',
                borderWidth: 3,
                hoverOffset: 8,
            }]
        },
        options: {
            responsive: true,
            animation: { duration: 500 },
            cutout: '62%',
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: '#a0a0a8',
                        font: { size: 11 },
                        padding: 12,
                        boxWidth: 10,
                        boxHeight: 10,
                        usePointStyle: true,
                        pointStyleWidth: 10,
                        generateLabels: chart => chart.data.labels.map((label, i) => ({
                            text: label.length > 18 ? label.slice(0, 17) + '…' : label,
                            fillStyle: colors[i],
                            strokeStyle: colors[i],
                            pointStyle: 'circle',
                            index: i,
                        }))
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(14,14,18,0.95)',
                    borderColor: 'rgba(255,255,255,0.1)',
                    borderWidth: 1,
                    callbacks: { label: ctx => ` ${ctx.parsed.toLocaleString()} plays` }
                }
            }
        }
    });
}

function renderFmTracksList(tracks) {
    const el = document.getElementById('fmTracksList');
    const max = tracks[0]?.playcount || 1;
    el.innerHTML = tracks.slice(0, 10).map((t, i) => {
        const pct = Math.round((t.playcount / max) * 100);
        return `
        <div class="lastfm-top-row">
            <span class="lastfm-top-rank">${i + 1}</span>
            <div class="lastfm-top-info">
                <a href="${t.url}" target="_blank" class="lastfm-top-name">${escHtml(t.name)}</a>
                <span class="lastfm-top-sub">${escHtml(t.artist)}</span>
                <div class="lastfm-top-bar-wrap">
                    <div class="lastfm-top-bar" style="width:${pct}%; background: var(--accent)"></div>
                </div>
            </div>
            <span class="lastfm-top-plays">${t.playcount.toLocaleString()}</span>
        </div>`;
    }).join('');
}

/* ── Utilities ───────────────────────────── */
function formatBigNum(n) {
    n = parseInt(n) || 0;
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return n.toLocaleString();
}

function timeAgo(ms) {
    const diff = (Date.now() - ms) / 1000;
    if (diff < 60)   return `${Math.floor(diff)}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
}

function escHtml(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ── Genre Breakdown ─────────────────────── */
let fmGenreChart = null;

async function loadFmGenres() {
    if (!API_BASE || !fmUserId) return;
    const loadingEl = document.getElementById('fmGenreLoading');
    const canvasEl  = document.getElementById('fmGenreChart');
    const listEl    = document.getElementById('fmGenreList');
    if (!loadingEl || !canvasEl || !listEl) return;

    loadingEl.style.display = 'flex';
    canvasEl.style.display  = 'none';
    listEl.innerHTML        = '';

    try {
        const res = await fetch(
            `${API_BASE}/lastfm/genres/${fmUserId}?period=${fmPeriod}`,
            { headers: { 'ngrok-skip-browser-warning': 'true' } }
        );
        const data = await res.json();
        if (data.error || !data.genres?.length) {
            loadingEl.innerHTML = '<span style="color:var(--text-muted);font-size:12px">Not enough data</span>';
            return;
        }

        loadingEl.style.display = 'none';
        canvasEl.style.display  = 'block';
        renderFmGenreChart(data.genres);
        renderFmGenreList(data.genres);
    } catch(e) {
        if (loadingEl) loadingEl.innerHTML = '<span style="color:var(--text-muted);font-size:12px">Unavailable</span>';
        console.error('[LastFM] genres error:', e);
    }
}

function renderFmGenreChart(genres) {
    const ctx = document.getElementById('fmGenreChart')?.getContext('2d');
    if (!ctx) return;

    const COLORS = [
        '#7289da','#4ade80','#fb923c','#f472b6','#38bdf8',
        '#a78bfa','#fbbf24','#34d399'
    ];

    if (fmGenreChart) fmGenreChart.destroy();
    fmGenreChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: genres.map(g => g.name),
            datasets: [{
                data: genres.map(g => g.score),
                backgroundColor: COLORS.slice(0, genres.length),
                borderColor: 'rgba(14,14,18,0.8)',
                borderWidth: 3,
                hoverOffset: 10,
            }]
        },
        options: {
            responsive: true,
            animation: { duration: 700, easing: 'easeOutQuart' },
            cutout: '58%',
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(10,10,14,0.97)',
                    borderColor: 'rgba(255,255,255,0.08)',
                    borderWidth: 1,
                    padding: 10,
                    callbacks: {
                        label: ctx => `  ${ctx.label}  ·  ${ctx.parsed.toFixed(1)}%`
                    }
                }
            }
        }
    });
}

function renderFmGenreList(genres) {
    const el = document.getElementById('fmGenreList');
    if (!el) return;
    const COLORS = [
        '#7289da','#4ade80','#fb923c','#f472b6','#38bdf8',
        '#a78bfa','#fbbf24','#34d399'
    ];
    el.innerHTML = genres.map((g, i) => `
        <div class="fm-genre-row">
            <span class="fm-genre-dot" style="background:${COLORS[i] || '#7289da'}"></span>
            <span class="fm-genre-name">${escHtml(g.name)}</span>
            <div class="fm-genre-bar-wrap">
                <div class="fm-genre-bar" style="width:${g.score}%;background:${COLORS[i] || '#7289da'}"></div>
            </div>
            <span class="fm-genre-pct">${g.score.toFixed(0)}%</span>
        </div>`).join('');
}

/* ── Listening Heatmap ───────────────────── */
async function loadFmHeatmap() {
    if (!API_BASE || !fmUserId) return;
    const wrap = document.getElementById('fmHeatmapWrap');
    if (!wrap) return;

    wrap.innerHTML = '<div class="lastfm-nothing"><i class="fa-solid fa-circle-notch fa-spin"></i></div>';

    try {
        const res = await fetch(
            `${API_BASE}/lastfm/heatmap/${fmUserId}`,
            { headers: { 'ngrok-skip-browser-warning': 'true' } }
        );
        const data = await res.json();
        if (data.error || !data.weeks?.length) {
            wrap.innerHTML = '<div class="lastfm-nothing" style="font-size:12px">Not enough history data</div>';
            return;
        }
        renderFmHeatmap(data.weeks, wrap);
    } catch(e) {
        wrap.innerHTML = '<div class="lastfm-nothing" style="font-size:12px">Unavailable</div>';
        console.error('[LastFM] heatmap error:', e);
    }
}

function renderFmHeatmap(weeks, wrap) {
    // weeks = [{from: ts, count: n}, ...]  — up to 52
    const counts = weeks.map(w => w.count);
    const max    = Math.max(...counts, 1);

    // Build month labels from timestamps
    const months  = [];
    let lastMonth = -1;
    weeks.forEach((w, i) => {
        const d = new Date(w.from * 1000);
        const m = d.getMonth();
        if (m !== lastMonth) {
            months.push({ idx: i, label: d.toLocaleDateString('en', { month: 'short' }) });
            lastMonth = m;
        }
    });

    // Build SVG — each week is one column of 1 cell (weekly data)
    const CELL  = 14;
    const GAP   = 3;
    const W     = weeks.length * (CELL + GAP);
    const H     = CELL + 28; // 1 row + label area

    let cells = '';
    weeks.forEach((w, i) => {
        const intensity = w.count / max;
        const alpha     = w.count === 0 ? 0.07 : 0.2 + intensity * 0.8;
        const x         = i * (CELL + GAP);
        const title     = `${new Date(w.from * 1000).toLocaleDateString('en', {month:'short', day:'numeric'})} · ${w.count} scrobbles`;
        cells += `<rect x="${x}" y="0" width="${CELL}" height="${CELL}" rx="3"
            fill="rgba(114,137,218,${alpha.toFixed(2)})"
            stroke="rgba(255,255,255,0.04)" stroke-width="0.5">
            <title>${title}</title>
        </rect>`;
    });

    let labels = '';
    months.forEach(m => {
        const x = m.idx * (CELL + GAP);
        labels += `<text x="${x}" y="${CELL + 16}" font-size="10" fill="rgba(160,160,168,0.7)"
            font-family="Outfit,sans-serif">${m.label}</text>`;
    });

    wrap.innerHTML = `
        <div class="fm-heatmap-scroll">
            <svg width="${W}" height="${H}" style="display:block">
                ${cells}
                ${labels}
            </svg>
        </div>
        <div class="fm-heatmap-legend">
            <span>Less</span>
            ${[0.07, 0.25, 0.45, 0.65, 0.9].map(a =>
                `<span class="fm-heatmap-swatch" style="background:rgba(114,137,218,${a})"></span>`
            ).join('')}
            <span>More</span>
        </div>`;
}