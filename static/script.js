// ===============================================
// 1. GLOBAL SETTINGS & DATA
// ===============================================

const KNOWN_TICKERS = {
    'SHELL': { symbol: "Euronext:SHELL", name: "SHELL PLC (AMS)", exchange: "AMS" },
    'ASML': { symbol: "Euronext:ASML", name: "ASML HOLDING (AMS)", exchange: "AMS" },
    'UNA': { symbol: "Euronext:UNA", name: "UNILEVER PLC (AMS)", exchange: "AMS" },
    'ING': { symbol: "Euronext:INGA", name: "ING GROEP (AMS)", exchange: "AMS" },
    'ADIDAS': { symbol: "XETRA:ADS", name: "ADIDAS AG (GER)", exchange: "XETRA" },
    'TSLA': { symbol: "NASDAQ:TSLA", name: "TESLA INC (US)", exchange: "NASDAQ" },
    'AAPL': { symbol: "NASDAQ:AAPL", name: "APPLE INC (US)", exchange: "NASDAQ" },
    'MSFT': { symbol: "NASDAQ:MSFT", name: "MICROSOFT CORP", exchange: "NASDAQ" },
    'NVDA': { symbol: "NASDAQ:NVDA", name: "NVIDIA CORP", exchange: "NASDAQ" }
};

let activeSuggestionIndex = -1;
let currentFocusTicker = KNOWN_TICKERS['AAPL'].symbol; 
const stripe = Stripe('pk_test_XXX'); // Placeholder

// ===============================================
// 2. STATE MANAGEMENT (NIEUW)
// ===============================================

const StateManager = {
    save: (key, value) => localStorage.setItem(key, value),
    get: (key, def) => localStorage.getItem(key) || def,
    savePanelState: (panelId, viewType) => localStorage.setItem(`panel_state_${panelId}`, viewType),
    getPanelState: (panelId, def) => localStorage.getItem(`panel_state_${panelId}`) || def
};

// ===============================================
// 3. CORE UI FUNCTIONS
// ===============================================

function loadTicker(tickerKey) {
    const tickerData = KNOWN_TICKERS[tickerKey] || { symbol: tickerKey, name: tickerKey, exchange: "UNKNOWN" };
    
    // Save State
    currentFocusTicker = tickerData.symbol;
    StateManager.save('lastTicker', tickerKey);

    // Update Header
    const focusEl = document.getElementById('focus-ticker-display');
    if(focusEl) focusEl.innerHTML = tickerData.name;

    // Refresh Chart
    const chartContainer = document.getElementById('tradingview_chart');
    if(chartContainer) {
        chartContainer.innerHTML = '';
        new TradingView.widget({
            "autosize": true, "symbol": tickerData.symbol, 
            "interval": "D", "timezone": "Europe/Amsterdam", 
            "theme": "dark", "style": "1", "locale": "en", 
            "enable_publishing": false, "container_id": "tradingview_chart"
        });
    }
    
    // Refresh Active Panels (zonder te resetten)
    refreshActivePanels();
}

function refreshActivePanels() {
    // Check wat open staat in Paneel 1
    const p1Select = document.getElementById('panel-right-1-selector');
    if(p1Select) loadPanelContent('panel-right-1', p1Select.value);

    // Check wat open staat in Paneel 2
    const p2Select = document.getElementById('panel-right-2-selector');
    if(p2Select) loadPanelContent('panel-right-2', p2Select.value);
}

// UNIVERSELE PANEEL FUNCTIE
function loadPanelContent(panelId, contentType) {
    const container = document.getElementById(`${panelId}-content`);
    if (!container) return;
    
    // Save state
    StateManager.savePanelState(panelId, contentType);

    // Sync selector if needed (voor reload scenario's)
    const selector = document.getElementById(`${panelId}-selector`);
    if(selector && selector.value !== contentType) selector.value = contentType;

    container.innerHTML = '<div style="padding:20px; color:var(--text-secondary);">Loading data...</div>';

    switch (contentType) {
        case 'news':
            loadNews(container);
            break;
        case 'network':
            loadCorporateNetwork(container);
            break;
        case 'watchlist':
            loadWatchlist(container.id); // Pass SPECIFIC ID to prevent jumping
            break;
        case 'indicators':
            loadLeadingIndicators(container.id);
            break;
        default:
            container.innerHTML = '<p style="padding:20px;">Module not loaded.</p>';
    }
}

// ===============================================
// 4. MODULES (NEWS, WATCHLIST, ETC)
// ===============================================

async function loadNews(containerElement) {
    // Haal 'AAPL' uit 'NASDAQ:AAPL'
    const symbol = currentFocusTicker.includes(':') ? currentFocusTicker.split(':')[1] : currentFocusTicker;
    
    try {
        const res = await fetch(`/api/news?ticker=${symbol}`);
        const data = await res.json();
        
        let html = '';
        
        // AI SENTIMENT BOX
        if(data.ai_sentiment) {
            let color = 'var(--text-secondary)';
            if(data.ai_sentiment.includes('Bullish')) color = 'var(--accent-green)';
            if(data.ai_sentiment.includes('Bearish')) color = 'var(--accent-red)';
            
            html += `
            <div style="border-left: 4px solid ${color}; background: rgba(255,255,255,0.05); padding: 10px; margin-bottom: 15px;">
                <strong style="color: ${color}"><i class="fa-solid fa-robot"></i> AI Sentiment:</strong> 
                <span style="color:white;">${data.ai_sentiment}</span>
            </div>`;
        }

        if (data.news && data.news.length > 0) {
            html += '<ul class="news-list">';
            data.news.forEach(item => {
                html += `
                <li class="news-item">
                    <div class="news-title"><a href="${item.url}" target="_blank">${item.headline}</a></div>
                    <div class="news-meta">${new Date(item.datetime * 1000).toLocaleDateString()} - ${item.source}</div>
                </li>`;
            });
            html += '</ul>';
        } else {
            html += '<p style="padding:10px;">Geen recent nieuws voor dit aandeel.</p>';
        }
        
        containerElement.innerHTML = html;
        
    } catch (e) {
        containerElement.innerHTML = '<p style="padding:10px; color:red;">Error loading news.</p>';
    }
}

async function loadWatchlist(targetContainerId) {
    if(!targetContainerId) return; // Safety check
    
    const container = document.getElementById(targetContainerId);
    const auth = await getAuthStatus();
    
    if(!auth.loggedIn) {
        container.innerHTML = '<p style="padding:15px;">Please <a href="#" onclick="openModal(\'loginModal\')">log in</a> to view watchlist.</p>';
        return;
    }

    try {
        const res = await fetch('/api/watchlist');
        const data = await res.json();
        
        let html = '<ul class="watchlist-ul" style="list-style:none; padding:0;">';
        if(data.watchlist) {
            data.watchlist.forEach(t => {
                html += `
                <li style="display:flex; justify-content:space-between; padding:8px 10px; border-bottom:1px solid var(--border);">
                    <span style="cursor:pointer; font-weight:bold;" onclick="loadTicker('${t.ticker}')">${t.ticker}</span>
                    <button onclick="removeFromWatchlist('${t.ticker}', '${targetContainerId}')" style="background:none; border:none; color:var(--accent-red); cursor:pointer;">&times;</button>
                </li>`;
            });
        }
        html += '</ul>';
        
        // Add Form (Scoped to container!)
        html += `
        <div class="add-ticker-form" style="padding:10px; display:flex; gap:5px; border-top:1px solid var(--border);">
            <input type="text" id="new-ticker-${targetContainerId}" placeholder="Symbol" style="flex:1; background:var(--input-bg); border:1px solid var(--border); color:white; padding:5px;">
            <button onclick="addToWatchlist('${targetContainerId}')" style="background:var(--accent-blue); color:white; border:none; padding:5px 10px; cursor:pointer;">+</button>
        </div>`;
        
        container.innerHTML = html;
    } catch(e) {
        container.innerHTML = 'Error loading watchlist.';
    }
}

async function addToWatchlist(containerId) {
    const input = document.getElementById(`new-ticker-${containerId}`);
    if(!input || !input.value) return;
    
    const ticker = input.value.toUpperCase();
    await fetch('/api/watchlist', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ ticker })
    });
    
    // Refresh ONLY the specific panel
    loadWatchlist(containerId);
}

async function removeFromWatchlist(ticker, containerId) {
    await fetch('/api/watchlist', {
        method: 'DELETE',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ ticker })
    });
    loadWatchlist(containerId);
}

// Dummy functie voor Corporate Network (behoudt styling)
function loadCorporateNetwork(container) {
    container.innerHTML = `
        <div class="network-lists-grid">
            <div><div class="network-list-title"><i class="fa-solid fa-users"></i> Competitors</div>
            <div class="network-insight">Data Loading...</div></div>
            <div><div class="network-list-title"><i class="fa-solid fa-truck"></i> Suppliers</div>
            <div class="network-insight">Data Loading...</div></div>
            <div><div class="network-list-title"><i class="fa-solid fa-handshake"></i> Customers</div>
            <div class="network-insight">Data Loading...</div></div>
        </div>
        <div class="premium-box-inline-cta" style="margin-top:20px; text-align:center;">
             <p>Unlock full supply chain data</p>
             <button class="main-cta-button" onclick="createCheckoutSession()">Upgrade Now</button>
        </div>
    `;
}

// Dummy Indicator functie
function loadLeadingIndicators(containerId) {
    document.getElementById(containerId).innerHTML = '<div style="padding:20px;">Premium Leading Indicators... (Mock)</div>';
}

// ===============================================
// 5. AUTH & INITIALIZATION
// ===============================================

async function getAuthStatus() {
    const res = await fetch('/api/status');
    return await res.json();
}

// Initialization Logic (State Persistence)
function initApp() {
    // 1. Herstel Ticker
    const savedTicker = StateManager.get('lastTicker', 'AAPL');
    loadTicker(savedTicker);
    
    // 2. Herstel Panelen
    const p1State = StateManager.getPanelState('panel-right-1', 'news');
    const p2State = StateManager.getPanelState('panel-right-2', 'network');
    
    // Zet de dropdowns goed
    const s1 = document.getElementById('panel-right-1-selector');
    if(s1) s1.value = p1State;
    const s2 = document.getElementById('panel-right-2-selector');
    if(s2) s2.value = p2State;

    // Laad content
    loadPanelContent('panel-right-1', p1State);
    loadPanelContent('panel-right-2', p2State);
}

document.addEventListener('DOMContentLoaded', initApp);
