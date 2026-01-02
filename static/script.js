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
    'AAPL': { symbol: "NASDAQ:AAPL", name: "APPLE INC (US)", exchange: "NASDAQ" } 
};

let activeSuggestionIndex = -1;
let currentFocusTicker = KNOWN_TICKERS['AAPL'].symbol; 
const stripe = Stripe('pk_test_XXX'); 

// ===============================================
// 2. CORE UTILITY & UI FUNCTIONS
// ===============================================

function openModal(modalId) { 
    document.getElementById(modalId).style.display = 'block'; 
}
function closeModal(modalId) { 
    document.getElementById(modalId).style.display = 'none'; 
}

function showAuthMessage(modalId, message, isError = false) {
    const msgElement = document.getElementById(`${modalId.replace('Modal', '')}-message`);
    if (msgElement) {
        msgElement.innerText = message;
        msgElement.className = 'auth-message';
        msgElement.style.display = message ? 'block' : 'none'; 
        if (isError) {
            msgElement.classList.add('error-message');
            msgElement.style.color = 'var(--accent-red)'; 
        } else if (message) {
            msgElement.style.color = 'var(--accent-green)';
        } else {
             msgElement.style.color = 'var(--text-secondary)';
        }
    }
}

function getPremiumLockedHTML(title, description, buttonText = "Upgrade Now") {
    return `
        <div class="panel-state-message premium-cta-bg">
            <i class="fa-solid fa-lock" style="font-size: 1.8rem; color: var(--accent-blue); margin-bottom: 15px;"></i>
            <p style="font-size: 0.95rem; font-weight: bold; margin-bottom: 5px;">${title}</p>
            <p style="font-size: 0.85rem; color: var(--text-secondary); margin: 0 0 15px; max-width: 80%; line-height: 1.4;">${description}</p>
            <button onclick="handleUpgradeClick(event)" class="main-cta-button">${buttonText}</button>
        </div>
    `;
}

function isValidEmail(email) {
    const re = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
    return re.test(String(email).toLowerCase());
}

// ===============================================
// 3. AUTHENTICATION HANDLERS
// ===============================================

async function getAuthStatus() {
    try {
        const response = await fetch('/api/status');
        return await response.json();
    } catch (error) {
        return { loggedIn: false, isPremium: false, username: 'Guest' };
    }
}

async function handleRegister() {
    const username = document.getElementById('reg-username').value;
    const email = document.getElementById('reg-email').value;
    const password = document.getElementById('reg-password').value;
    
    if (!username.trim() || !isValidEmail(email) || password.length < 8) { 
        showAuthMessage('registerModal', 'Invalid input.', true); return; 
    }
    
    showAuthMessage('registerModal', 'Registering...');
    try {
        const response = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }) 
        });
        const data = await response.json();
        if (response.ok && data.success) { 
            showAuthMessage('registerModal', 'Success!', false);
            setTimeout(() => { closeModal('registerModal'); updateUI(); }, 1000);
        } else {
            showAuthMessage('registerModal', data.message, true);
        }
    } catch (error) { showAuthMessage('registerModal', 'Error.', true); }
}

async function handleLogin() {
    const username = document.getElementById('log-username').value;
    const password = document.getElementById('log-password').value;
    
    showAuthMessage('loginModal', 'Logging in...');
    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await response.json();
        if (response.ok && data.success) {
            showAuthMessage('loginModal', 'Success!', false);
            setTimeout(() => { closeModal('loginModal'); updateUI(); }, 1000);
        } else {
            showAuthMessage('loginModal', 'Invalid credentials.', true);
        }
    } catch (error) { showAuthMessage('loginModal', 'Error.', true); }
}

async function logout() {
    await fetch('/api/logout', { method: 'POST' });
    closeModal('accountModal');
    updateUI();
}

async function openProfile() {
    const status = await getAuthStatus();
    if (!status.loggedIn) { openModal('loginModal'); return; }
    
    document.getElementById('display-username').innerText = status.username;
    document.getElementById('status-text').innerText = status.isPremium ? 'Premium' : 'Free Tier';
    
    const manageBtn = document.getElementById('manage-subscription-btn');
    const upgradeAccBtn = document.getElementById('upgrade-from-account-btn');
    
    manageBtn.style.display = status.isPremium ? 'block' : 'none';
    upgradeAccBtn.style.display = status.isPremium ? 'none' : 'block';
    
    openModal('accountModal');
}

async function handleUpgradeClick(event) {
    if (event) event.preventDefault();
    const status = await getAuthStatus();
    if (status.isPremium) { openModal('premiumModal'); return; } 
    // Logic for upgrade modal (simplified for brevity)
    openModal('premiumModal');
}

async function buyPremium() {
    // Calls backend mock
    await fetch('/api/create-checkout-session', { method: 'POST' });
    location.reload();
}

async function openCustomerPortal() {
    const res = await fetch('/api/customer-portal');
    const data = await res.json();
    window.open(data.portal_url, '_blank');
}

// ===============================================
// 4. WATCHLIST FUNCTIONS
// ===============================================

function getFocusTickerKey() {
    const focusText = document.getElementById('focus-ticker').innerText;
    for (const key in KNOWN_TICKERS) {
        if (focusText.includes(KNOWN_TICKERS[key].name.split('(')[0].trim())) return key;
    }
    return 'AAPL'; 
}

function refreshWatchlistPanels() {
    const p1 = document.getElementById('panel-right-1-selector');
    const p2 = document.getElementById('panel-right-2-selector');
    if (p1 && p1.value === 'watchlist') loadWatchlist('panel-right-1');
    if (p2 && p2.value === 'watchlist') loadWatchlist('panel-right-2');
}

async function addToWatchlist() {
    const tickerKey = getFocusTickerKey();
    const response = await fetch('/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: tickerKey })
    });
    const data = await response.json();
    alert(data.message);
    refreshWatchlistPanels();
}

async function removeFromWatchlist(tickerKey) {
    if (!confirm('Remove?')) return;
    const response = await fetch('/api/watchlist', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: tickerKey })
    });
    const data = await response.json();
    alert(data.message);
    refreshWatchlistPanels();
}

// WATCHLIST UI LOADING
async function loadWatchlist(panelId) {
    const watchlistContent = document.getElementById(`${panelId}-content`); 
    const status = await getAuthStatus();
    
    if (!status.loggedIn) {
        watchlistContent.innerHTML = `<div class="panel-state-message"><p>Please Log In to view Watchlist.</p><button onclick="openModal('loginModal')" class="main-cta-button">Log In</button></div>`;
        return;
    }

    try {
        const response = await fetch('/api/watchlist');
        const data = await response.json();
        
        if (data.success && data.watchlist.length > 0) {
            let html = '<ul class="watchlist-list">';
            data.watchlist.forEach(ticker => {
                const name = KNOWN_TICKERS[ticker] ? KNOWN_TICKERS[ticker].name.split('(')[0] : ticker;
                html += `<li class="watchlist-item">
                    <div onclick="loadTicker('${ticker}')" style="cursor: pointer;">
                        <span class="watchlist-ticker">${ticker}</span>
                        <span class="watchlist-name">${name}</span>
                    </div>
                    <i class="fa-solid fa-trash-alt remove-icon" onclick="removeFromWatchlist('${ticker}')"></i>
                </li>`;
            });
            html += '</ul>';
            html += `<div style="text-align: center; margin-top: 10px;"><button onclick="addToWatchlist()" class="small-cta-button">Add Current Focus</button></div>`;
            watchlistContent.innerHTML = html;
        } else {
            watchlistContent.innerHTML = `<div class="panel-state-message"><p>Watchlist is empty.</p><button onclick="addToWatchlist()" class="main-cta-button">Add Current</button></div>`;
        }
    } catch (e) { watchlistContent.innerHTML = 'Error loading watchlist.'; }
}


// ===============================================
// 5. MODULAR PANEL FUNCTIONS
// ===============================================

async function loadPanelContent(panelId, type) {
    const contentDiv = document.getElementById(`${panelId}-content`); 
    const titleSpan = document.getElementById(`${panelId}-title`);
    const status = await getAuthStatus();
    
    contentDiv.innerHTML = '<div style="padding: 20px; text-align: center;">Loading...</div>';

    switch (type) {
        case 'watchlist':
            titleSpan.innerHTML = '<i class="fa-solid fa-bell"></i> Watchlist';
            loadWatchlist(panelId);
            break;

        case 'news':
            titleSpan.innerHTML = '<i class="fa-solid fa-newspaper"></i> Realtime News';
            try {
                // FETCH DATA FROM PYTHON API
                const res = await fetch('/api/news');
                const data = await res.json();
                
                let html = '<ul class="news-list">';
                data.news.forEach(item => {
                    const dotClass = item.important ? 'style="background: var(--accent-red);"' : '';
                    html += `
                        <li class="news-item">
                            <span class="news-item-dot" ${dotClass}></span>
                            <div class="news-content">
                                <div class="news-title">${item.title}</div>
                                <div class="news-meta"><span>${item.source}</span><span>${item.time}</span></div>
                            </div>
                        </li>`;
                });
                html += '</ul>';
                contentDiv.innerHTML = html;
            } catch (e) { contentDiv.innerHTML = 'Error loading news.'; }
            break;

        case 'network':
            titleSpan.innerHTML = '<i class="fa-solid fa-code-branch"></i> Corporate Network';
             // (Simplified network view for brevity, reusing previous logic structure)
            contentDiv.innerHTML = `<div class="panel-state-message"><p>Network Graph</p>${status.isPremium ? '<p class="green">Active</p>' : '<button onclick="handleUpgradeClick()" class="main-cta-button">Upgrade</button>'}</div>`;
            break;
            
        case 'indicators':
            titleSpan.innerHTML = '<i class="fa-solid fa-fire"></i> Leading Indicators';
            if(!status.isPremium) {
                contentDiv.innerHTML = getPremiumLockedHTML("Unlock Indicators", "Upgrade to see correlation data.");
                return;
            }
            try {
                const res = await fetch('/api/leading_indicators');
                const data = await res.json();
                let html = '<ul class="indicator-list">';
                data.indicators.forEach(i => html += `<li class="indicator-item"><span>${i.name}</span><span>${i.correlation}</span></li>`);
                html += '</ul>';
                contentDiv.innerHTML = html;
            } catch(e) { contentDiv.innerHTML = 'Error.'; }
            break;
            
        case 'volatility':
            titleSpan.innerHTML = '<i class="fa-solid fa-wave-square"></i> Volatility';
            contentDiv.innerHTML = status.isPremium ? '<div>Volatility Data Here</div>' : getPremiumLockedHTML("Unlock Volatility", "Upgrade needed.");
            break;

        case 'sentiment':
             titleSpan.innerHTML = '<i class=\"fa-solid fa-comment-dots\"></i> Sentiment';
             contentDiv.innerHTML = status.isPremium ? '<div>Sentiment Data Here</div>' : getPremiumLockedHTML("Unlock Sentiment", "Upgrade needed.");
             break;
    }
}

// ===============================================
// 6. FINANCIAL DATA (RATIOS, BOARD)
// ===============================================

async function showFinancialTab(tabName, clickedButton) {
    if (clickedButton) {
        document.querySelectorAll('.financial-tab-button').forEach(btn => btn.classList.remove('active'));
        clickedButton.classList.add('active');
    }

    const contentDiv = document.getElementById('financial-tab-content');
    contentDiv.innerHTML = 'Loading...';

    const currentTicker = getFocusTickerKey();
    
    try {
        // Fetch data from new Python endpoint
        const res = await fetch(`/api/financials/${tabName}?ticker=${currentTicker}`);
        const json = await res.json();
        
        if (!json.success) { contentDiv.innerHTML = 'Data not available.'; return; }
        
        const data = json.data;
        let html = '';

        if (tabName === 'ratios') {
            html = '<div class="financial-grid">';
            for (const [key, val] of Object.entries(data)) {
                html += `<div class="metric-card"><div class="metric-label">${key.toUpperCase()}</div><div class="metric-value">${val}</div></div>`;
            }
            html += '</div>';
        } else if (tabName === 'board') {
            html = '<ul class="board-list">';
            data.forEach(m => html += `<li class="board-item"><div class="member-details"><span>${m.name}</span><span style="font-size:0.75rem; color:#787b86;">${m.role}</span></div></li>`);
            html += '</ul>';
        } else if (tabName === 'ownership') {
            html = '<ul class="ownership-list">';
            data.forEach(o => html += `<li class="ownership-item"><span>${o.shareholder}</span><span>${o.stake}</span></li>`);
            html += '</ul>';
        } else if (tabName === 'reports') {
            html = '<ul class="reports-list">';
            data.forEach(r => html += `<li><a href="${r.link}">${r.title}</a><span>${r.date}</span></li>`);
            html += '</ul>';
        }
        contentDiv.innerHTML = html;

    } catch (e) {
        contentDiv.innerHTML = 'Error loading financial data.';
    }
}

// ===============================================
// 7. INITIALIZATION
// ===============================================

function loadTicker(tickerKey) {
    const focusTickerElement = document.getElementById('focus-ticker');
    const chartContainer = document.getElementById('tradingview_chart');
    const tickerData = KNOWN_TICKERS[tickerKey];
    
    if (!tickerData) return;

    focusTickerElement.innerHTML = tickerData.name;
    currentFocusTicker = tickerData.symbol;
    
    // Refresh Financials for new ticker
    const activeTab = document.querySelector('.financial-tab-button.active');
    const tabName = activeTab ? activeTab.innerText.toLowerCase().includes('ratios') ? 'ratios' : 'board' : 'ratios'; // simple detection
    showFinancialTab(tabName, activeTab);

    chartContainer.innerHTML = '';
    new TradingView.widget({
        "autosize": true, "symbol": tickerData.symbol, "interval": "D", "timezone": "Europe/Amsterdam", "theme": "dark", "style": "1", "locale": "en", "enable_publishing": false, "container_id": "tradingview_chart"
    });
}

function initApp() {
    loadTicker('AAPL');
    loadPanelContent('panel-right-1', 'news');
    loadPanelContent('panel-right-2', 'network');
    
    const p1 = document.getElementById('panel-right-1-selector');
    if(p1) p1.value = 'news';
    const p2 = document.getElementById('panel-right-2-selector');
    if(p2) p2.value = 'network';
}

document.addEventListener('DOMContentLoaded', initApp);

// (Utility search functions hidden for brevity, keep existing ones)
function showSuggestions(val) {} // Keep existing logic
function hideSuggestions() {}    // Keep existing logic
function handleSearch(e) {}      // Keep existing logic