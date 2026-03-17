/* ═══════════════════════════════════════════
   RIFT DASHBOARD — STOCKS MODULE
═══════════════════════════════════════════ */

let stocksData = [];
let selectedStockSymbol = null;
let tradeSelectedSymbol = null;
let stockChartInstance = null;
let stocksRefreshInterval = null;

/* ── Init ─────────────────────────────────── */
window.initStocks = async function() {
    await loadMarket();
    await loadLeaderboard();
    if (userProfile) await loadPortfolio();

    // Real-time refresh every 15s
    if (stocksRefreshInterval) clearInterval(stocksRefreshInterval);
    stocksRefreshInterval = setInterval(async () => {
        if (document.getElementById('stocks').classList.contains('active')) {
            await loadMarket();
            if (userProfile) await loadPortfolio();
        }
    }, 15000);
};

/* ── Market data ─────────────────────────── */
async function loadMarket() {
    if (!API_BASE) return;
    try {
        const res = await fetch(`${API_BASE}/stocks/market`, {
            headers: { 'ngrok-skip-browser-warning': 'true' }
        });
        const data = await res.json();
        if (data.error) return;

        stocksData = data.stocks;
        renderMarketTable(data.stocks);
        renderMarketEvents(data.events);
        renderNewsTicker(data.news);
        renderMarketLastUpdate(data.last_update);
        buildTradeDropdown(data.stocks);

        // Auto-select first stock for chart if none selected
        if (!selectedStockSymbol && data.stocks.length > 0) {
            selectStockForChart(data.stocks[0].symbol);
        } else if (selectedStockSymbol) {
            const s = data.stocks.find(x => x.symbol === selectedStockSymbol);
            if (s) updateChart(s);
        }
    } catch(e) { console.error('[Stocks] loadMarket error:', e); }
}

function renderMarketTable(stocks) {
    const body = document.getElementById('marketTableBody');
    if (!stocks.length) { body.innerHTML = '<div class="market-empty">No stocks available</div>'; return; }

    body.innerHTML = stocks.map(s => {
        const up = s.change_pct >= 0;
        const trendIcon = s.trend === 'up' ? '▲' : s.trend === 'down' ? '▼' : '●';
        const trendClass = s.trend === 'up' ? 'trend-up' : s.trend === 'down' ? 'trend-down' : 'trend-neutral';
        return `
        <div class="market-row ${selectedStockSymbol === s.symbol ? 'selected' : ''}" onclick="selectStockForChart('${s.symbol}')">
            <span class="market-symbol">${s.symbol}</span>
            <span class="market-name">${s.name}</span>
            <span class="market-price">$${s.price.toLocaleString('en', {minimumFractionDigits:2, maximumFractionDigits:2})}</span>
            <span class="market-change ${up ? 'positive' : 'negative'}">${up?'+':''}${s.change_pct.toFixed(2)}%</span>
            <span class="market-sector-tag">${s.sector}</span>
            <span class="market-trend ${trendClass}">${trendIcon}</span>
        </div>`;
    }).join('');
}

function renderMarketEvents(events) {
    const badge = document.getElementById('marketEventBadge');
    const name  = document.getElementById('marketEventName');
    if (events && events.length > 0) {
        badge.classList.remove('hidden');
        name.textContent = events.map(e => e.name).join(' • ');
    } else {
        badge.classList.add('hidden');
    }
}

function renderNewsTicker(news) {
    const el = document.getElementById('marketNewsTicker');
    if (el && news) el.textContent = news;
}

function renderMarketLastUpdate(ts) {
    const el = document.getElementById('marketLastUpdate');
    if (el && ts) {
        const d = new Date(ts * 1000);
        el.textContent = `Updated ${d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}`;
    }
}

/* ── Stock chart ──────────────────────────── */
function selectStockForChart(symbol) {
    selectedStockSymbol = symbol;
    const s = stocksData.find(x => x.symbol === symbol);
    if (!s) return;

    // Highlight row
    document.querySelectorAll('.market-row').forEach(r => r.classList.remove('selected'));
    const rows = document.querySelectorAll('.market-row');
    rows.forEach(r => { if (r.querySelector('.market-symbol')?.textContent === symbol) r.classList.add('selected'); });

    updateChart(s);
}

function updateChart(stock) {
    const up = stock.change_pct >= 0;
    const color = up ? '#43b581' : '#f04747';
    const colorFaint = up ? 'rgba(67,181,129,0.15)' : 'rgba(240,71,71,0.15)';

    document.getElementById('chartSymbol').textContent = stock.symbol;
    document.getElementById('chartName').textContent   = stock.name;
    document.getElementById('chartPrice').textContent  = `$${stock.price.toLocaleString('en', {minimumFractionDigits:2, maximumFractionDigits:2})}`;

    const changeEl = document.getElementById('chartChange');
    changeEl.textContent = `${up?'+':''}${stock.change_pct.toFixed(2)}%`;
    changeEl.className = `stock-chart-change ${up ? 'positive' : 'negative'}`;

    document.getElementById('chartSector').textContent = stock.sector;
    const sentEl = document.getElementById('chartSentiment');
    sentEl.textContent = stock.trend === 'up' ? '▲ Bullish' : stock.trend === 'down' ? '▼ Bearish' : '● Neutral';
    sentEl.className = `stock-sentiment ${stock.trend === 'up' ? 'positive' : stock.trend === 'down' ? 'negative' : ''}`;

    const labels = stock.history.map((_, i) => i === stock.history.length - 1 ? 'Now' : `T-${stock.history.length - 1 - i}`);

    if (stockChartInstance) stockChartInstance.destroy();

    const ctx = document.getElementById('stockChart').getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, 200);
    gradient.addColorStop(0, colorFaint);
    gradient.addColorStop(1, 'rgba(0,0,0,0)');

    stockChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                data: stock.history,
                borderColor: color,
                backgroundColor: gradient,
                borderWidth: 2,
                pointRadius: 0,
                pointHoverRadius: 5,
                pointHoverBackgroundColor: color,
                tension: 0.4,
                fill: true,
            }]
        },
        options: {
            responsive: true,
            animation: { duration: 400 },
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(14,14,18,0.95)',
                    borderColor: 'rgba(255,255,255,0.1)',
                    borderWidth: 1,
                    callbacks: {
                        label: ctx => ` $${ctx.parsed.y.toLocaleString('en', {minimumFractionDigits:2, maximumFractionDigits:2})}`
                    }
                }
            },
            scales: {
                x: { display: false },
                y: {
                    grid: { color: 'rgba(255,255,255,0.04)' },
                    ticks: {
                        color: '#a0a0a8',
                        callback: v => `$${v.toLocaleString('en', {minimumFractionDigits:0, maximumFractionDigits:0})}`
                    }
                }
            }
        }
    });
}

/* ── Portfolio ───────────────────────────── */
window.refreshPortfolio = async function() { await loadPortfolio(); };

async function loadPortfolio() {
    if (!userProfile || !API_BASE) return;
    try {
        const res = await fetch(`${API_BASE}/stocks/portfolio/${userProfile.id}`, {
            headers: { 'ngrok-skip-browser-warning': 'true' }
        });
        const data = await res.json();
        if (data.error) return;

        document.getElementById('portfolioCash').textContent   = `$${data.cash.toLocaleString()}`;
        document.getElementById('portfolioStocks').textContent = `$${data.stock_value.toLocaleString()}`;
        document.getElementById('portfolioNet').textContent    = `$${data.net_worth.toLocaleString()}`;

        const holdingsEl = document.getElementById('portfolioHoldings');
        if (!data.holdings.length) {
            holdingsEl.innerHTML = '<div class="portfolio-empty">No stocks owned</div>';
            return;
        }
        holdingsEl.innerHTML = data.holdings.map(h => {
            const up = h.change_pct >= 0;
            return `
            <div class="portfolio-holding" onclick="selectStockForChart('${h.symbol}')">
                <div class="portfolio-holding-info">
                    <span class="portfolio-holding-sym">${h.symbol}</span>
                    <span class="portfolio-holding-name">${h.name}</span>
                </div>
                <div class="portfolio-holding-right">
                    <span class="portfolio-holding-val">$${h.value.toLocaleString()}</span>
                    <span class="portfolio-holding-qty">${h.qty} shares</span>
                    <span class="portfolio-holding-change ${up?'positive':'negative'}">${up?'+':''}${h.change_pct.toFixed(2)}%</span>
                </div>
            </div>`;
        }).join('');

        // Update trade owned count if stock selected
        if (tradeSelectedSymbol) {
            const h = data.holdings.find(x => x.symbol === tradeSelectedSymbol);
            document.getElementById('tradeOwnedDisplay').textContent = `Owned: ${h ? h.qty : 0}`;
        }
    } catch(e) { console.error('[Stocks] loadPortfolio error:', e); }
}

/* ── Trade panel ─────────────────────────── */
function buildTradeDropdown(stocks) {
    const dd = document.getElementById('tradeDropdown');
    dd.innerHTML = stocks.map(s => `
        <div class="trade-dropdown-item" onclick="selectTradeStock('${s.symbol}','${s.name.replace(/'/g,"\\'")}',${s.price})">
            <span class="trade-dd-sym">${s.symbol}</span>
            <span class="trade-dd-name">${s.name}</span>
            <span class="trade-dd-price">$${s.price.toLocaleString('en',{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
        </div>`).join('');
}

window.toggleTradeDropdown = function() {
    document.getElementById('tradeDropdown').classList.toggle('hidden');
};

window.selectTradeStock = function(symbol, name, price) {
    tradeSelectedSymbol = symbol;
    document.getElementById('tradeStockLabel').textContent = `${symbol} — ${name}`;
    document.getElementById('tradePriceDisplay').textContent = `Price: $${price.toLocaleString('en',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
    document.getElementById('tradeDropdown').classList.add('hidden');
    updateTradeCost();
    // Show owned
    if (userProfile) {
        fetch(`${API_BASE}/stocks/portfolio/${userProfile.id}`, { headers: { 'ngrok-skip-browser-warning': 'true' } })
            .then(r => r.json()).then(data => {
                const h = (data.holdings || []).find(x => x.symbol === symbol);
                document.getElementById('tradeOwnedDisplay').textContent = `Owned: ${h ? h.qty : 0}`;
            }).catch(() => {});
    }
};

window.adjustQty = function(delta) {
    const input = document.getElementById('tradeQty');
    input.value = Math.max(1, (parseInt(input.value) || 1) + delta);
    updateTradeCost();
};

document.getElementById('tradeQty')?.addEventListener('input', updateTradeCost);

function updateTradeCost() {
    if (!tradeSelectedSymbol) return;
    const s = stocksData.find(x => x.symbol === tradeSelectedSymbol);
    const qty = parseInt(document.getElementById('tradeQty').value) || 0;
    const total = s ? (s.price * qty) : 0;
    document.getElementById('tradeTotalCost').textContent = `$${Math.round(total).toLocaleString()}`;
    // Update live price
    if (s) document.getElementById('tradePriceDisplay').textContent =
        `Price: $${s.price.toLocaleString('en',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
}

window.executeTrade = async function(action) {
    if (!userProfile) { showTradeResult('error', 'Login first'); return; }
    if (!tradeSelectedSymbol) { showTradeResult('error', 'Select a stock first'); return; }
    if (!API_BASE) return;

    const qty = parseInt(document.getElementById('tradeQty').value) || 0;
    if (qty < 1) { showTradeResult('error', 'Invalid quantity'); return; }

    try {
        const res = await fetch(`${API_BASE}/stocks/trade`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
            body: JSON.stringify({ user_id: userProfile.id, symbol: tradeSelectedSymbol, action, quantity: qty })
        });
        const data = await res.json();
        if (data.error) { showTradeResult('error', data.error); return; }

        if (action === 'buy') {
            showTradeResult('success', `✓ Bought ${qty} × ${tradeSelectedSymbol} for $${data.cost.toLocaleString()}`);
        } else {
            showTradeResult('success', `✓ Sold ${qty} × ${tradeSelectedSymbol} for $${data.received.toLocaleString()}`);
        }

        // Refresh market price immediately
        const s = stocksData.find(x => x.symbol === tradeSelectedSymbol);
        if (s) s.price = data.new_price;

        await loadPortfolio();
        renderMarketTable(stocksData);
        if (selectedStockSymbol === tradeSelectedSymbol) updateChart(s);
    } catch(e) { showTradeResult('error', 'Network error'); }
};

function showTradeResult(type, msg) {
    const el = document.getElementById('tradeResult');
    el.textContent = msg;
    el.className = `trade-result ${type}`;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 4000);
}

/* ── Leaderboard ─────────────────────────── */
async function loadLeaderboard() {
    if (!API_BASE) return;
    try {
        const res = await fetch(`${API_BASE}/stocks/leaderboard`, { headers: { 'ngrok-skip-browser-warning': 'true' } });
        const data = await res.json();
        const el = document.getElementById('stocksLeaderboard');
        if (data.error || !data.leaderboard) { el.innerHTML = '<div class="market-empty">Unavailable</div>'; return; }

        el.innerHTML = data.leaderboard.map((u, i) => `
            <div class="leaderboard-row">
                <span class="lb-rank">${['🥇','🥈','🥉'][i] || `#${i+1}`}</span>
                <img class="lb-avatar" src="${u.avatar || 'https://cdn.discordapp.com/embed/avatars/0.png'}" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'">
                <span class="lb-name">${u.name}</span>
                <div class="lb-values">
                    <span class="lb-net">$${u.net_worth.toLocaleString()}</span>
                    <span class="lb-breakdown">$${u.cash.toLocaleString()} cash + $${u.stock_value.toLocaleString()} stocks</span>
                </div>
            </div>`).join('');
    } catch(e) { console.error('[Stocks] leaderboard error:', e); }
}
