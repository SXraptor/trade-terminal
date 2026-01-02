// ===============================================
// 1. STATE MANAGEMENT (Geheugen)
// ===============================================

function saveAppState() {
    // Slaat de huidige staat op zodat we kunnen herladen zonder gegevensverlies
    const state = {
        ticker: currentFocusTicker,
        name: currentFocusName,
        panel1: document.getElementById('panel-right-1-selector') ? document.getElementById('panel-right-1-selector').value : 'news',
        panel2: document.getElementById('panel-right-2-selector') ? document.getElementById('panel-right-2-selector').value : 'network'
    };
    localStorage.setItem('tradeTerminalState', JSON.stringify(state));
}

function restoreAppState() {
    const saved = localStorage.getItem('tradeTerminalState');
    return saved ? JSON.parse(saved) : null;
}

function reloadWithState() {
    saveAppState();
    location.reload();
}

let currentFocusTicker = 'AAPL'; 
let currentFocusName = 'Apple Inc';
let searchTimeout = null;

// ===============================================
// 2. UI HELPERS
// ===============================================

function openModal(id) { document.getElementById(id).style.display = 'block'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }

function showAuthMessage(modalId, message, isError = false) {
    const msgId = modalId.replace('Modal', '') + '-message'; 
    const el = document.getElementById(msgId);
    if (el) {
        el.innerText = message;
        el.style.display = 'block';
        el.style.color = isError ? 'var(--accent-red)' : 'var(--accent-green)';
    }
}

function getPremiumLockedHTML(title, desc, btnText = "Upgrade Now") {
    return `
        <div class="panel-state-message premium-cta-bg">
            <i class="fa-solid fa-lock" style="font-size: 1.8rem; color: var(--accent-blue); margin-bottom: 15px;"></i>
            <p style="font-weight: bold; margin-bottom: 5px;">${title}</p>
            <p style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 15px;">${desc}</p>
            <button onclick="handleUpgradeClick()" class="main-cta-button">${btnText}</button>
        </div>`;
}

// ===============================================
// 3. AUTHENTICATION
// ===============================================

async function getAuthStatus() {
    try {
        const res = await fetch('/api/status');
        return await res.json();
    } catch (e) { return { loggedIn: false }; }
}

async function updateUI() {
    const status = await getAuthStatus();
    const regBtn = document.getElementById('auth-register-btn');
    const logBtn = document.getElementById('auth-login-btn');
    const profileBtn = document.getElementById('profile-btn');
    const upgradeBtn = document.getElementById('upgrade-button');
    const premLabel = document.getElementById('premium-label');

    // Reset display
    if(regBtn) regBtn.style.display = status.loggedIn ? 'none' : 'inline-block';
    if(logBtn) logBtn.style.display = status.loggedIn ? 'none' : 'inline-block';
    
    if(profileBtn) {
        profileBtn.style.display = status.loggedIn ? 'inline-block' : 'none';
        profileBtn.style.color = status.isPremium ? 'gold' : 'var(--accent-blue)';
    }

    if (status.loggedIn) {
        if(upgradeBtn) upgradeBtn.style.display = status.isPremium ? 'none' : 'inline-block';
        if(premLabel) premLabel.style.display = status.isPremium ? 'inline' : 'none';
    } else {
        if(upgradeBtn) upgradeBtn.style.display = 'inline-block';
        if(premLabel) premLabel.style.display = 'none';
    }
    
    // Refresh AI box op basis van premium status
    fetchAIPrediction(currentFocusTicker);
    
    // Refresh panels om premium content te tonen/verbergen
    const p1 = document.getElementById('panel-right-1-selector');
    if(p1) loadPanelContent('panel-right-1', p1.value);
    const p2 = document.getElementById('panel-right-2-selector');
    if(p2) loadPanelContent('panel-right-2', p2.value);
}

// HANDLERS
async function handleRegister() {
    const u = document.getElementById('reg-username').value;
    const p = document.getElementById('reg-password').value;
    if(!u || p.length < 8) { showAuthMessage('registerModal', 'Vul naam en wachtwoord (min 8) in.', true); return; }
    
    showAuthMessage('registerModal', 'Bezig met registreren...');
    const res = await fetch('/api/register', { 
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({username: u, password: p})
    });
    const data = await res.json();
    if(data.success) reloadWithState(); 
    else showAuthMessage('registerModal', data.message, true);
}

async function handleLogin() {
    const u = document.getElementById('log-username').value;
    const p = document.getElementById('log-password').value;
    showAuthMessage('loginModal', 'Bezig met inloggen...');
    const res = await fetch('/api/login', { 
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({username: u, password: p})
    });
    const data = await res.json();
    if(data.success) reloadWithState();
    else showAuthMessage('loginModal', 'Ongeldige gegevens', true);
}

async function logout() {
    await fetch('/api/logout', {method: 'POST'});
    localStorage.removeItem('tradeTerminalState');
    location.reload();
}

async function handleUpgradeClick() {
    const status = await getAuthStatus();
    if(status.isPremium) { alert("Je hebt al Premium!"); return; }
    openModal('premiumModal');
}

async function buyPremium() {
    document.getElementById('premium-message').innerText = "Betaling simuleren...";
    document.getElementById('premium-message').style.display = 'block';
    // Backend call om status om te zetten
    await fetch('/api/create-checkout-session', {method: 'POST'});
    setTimeout(() => reloadWithState(), 1000);
}

async function openProfile() {
    const status = await getAuthStatus();
    if (!status.loggedIn) { openModal('loginModal'); return; }
    document.getElementById('display-username').innerText = status.username;
    document.getElementById('status-text').innerText = status.isPremium ? 'Premium Account' : 'Free Tier';
    document.getElementById('manage-subscription-btn').style.display = status.isPremium ? 'block' : 'none';
    document.getElementById('upgrade-from-account-btn').style.display = status.isPremium ? 'none' : 'block';
    openModal('accountModal');
}

async function openCustomerPortal() { alert("Opent Stripe Portaal (Alleen in Productie)"); }

// ===============================================
// 4. SEARCH & TICKER
// ===============================================

function showSuggestions(query) {
    const list = document.getElementById('suggestions-list');
    list.innerHTML = '';
    if (query.length < 2) { list.style.display = 'none'; return; }

    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(async () => {
        try {
            const res = await fetch(`/api/search?q=${query}`);
            const data = await res.json();
            if(data.results && data.results.length > 0) {
                data.results.forEach(item => {
                    const div = document.createElement('div');
                    div.className = 'suggestion-item';
                    div.innerHTML = `<span class="suggestion-ticker">${item.displaySymbol}</span> ${item.description}`;
                    div.onclick = () => loadTicker(item.displaySymbol, item.description);
                    list.appendChild(div);
                });
                list.style.display = 'block';
            }
        } catch(e) {}
    }, 300);
}

function hideSuggestions() { setTimeout(() => document.getElementById('suggestions-list').style.display = 'none', 200); }

function loadTicker(symbol, name) {
    currentFocusTicker = symbol;
    currentFocusName = name || symbol;
    
    // UI Update
    document.getElementById('focus-ticker').innerText = currentFocusName;
    document.getElementById('search-input').value = '';
    hideSuggestions();

    // Chart Update
    new TradingView.widget({
        "autosize": true, "symbol": symbol, "interval": "D", "timezone": "Europe/Amsterdam", "theme": "dark", "style": "1", "locale": "en", "enable_publishing": false, "container_id": "tradingview_chart"
    });

    // Panels Update
    const p1 = document.getElementById('panel-right-1-selector');
    if(p1) loadPanelContent('panel-right-1', p1.value);
    
    const p2 = document.getElementById('panel-right-2-selector');
    if(p2) loadPanelContent('panel-right-2', p2.value);

    // AI & Financials
    fetchAIPrediction(symbol);
    showFinancialTab('ratios', document.querySelector('.financial-tab-button.active'));
}


// ===============================================
// 5. PANELS & CONTENT
// ===============================================

async function loadPanelContent(panelId, type) {
    const content = document.getElementById(`${panelId}-content`);
    const title = document.getElementById(`${panelId}-title`);
    const status = await getAuthStatus();
    
    content.innerHTML = '<div style="padding:20px; text-align:center; color:#787b86;">Data laden...</div>';

    if (type === 'news') {
        title.innerHTML = '<i class="fa-solid fa-newspaper"></i> News';
        try {
            const res = await fetch(`/api/news?ticker=${currentFocusTicker}`);
            const data = await res.json();
            let html = '<ul class="news-list">';
            if(data.news.length > 0) {
                data.news.forEach(n => {
                    html += `<li class="news-item"><div class="news-content"><a href="${n.url}" target="_blank" class="news-title">${n.title}</a><div class="news-meta"><span>${n.source}</span><span>${n.time}</span></div></div></li>`;
                });
            } else {
                html += '<li class="news-item">Geen recent nieuws gevonden.</li>';
            }
            content.innerHTML = html + '</ul>';
        } catch(e) { content.innerHTML = 'Fout bij laden nieuws.'; }

    } else if (type === 'watchlist') {
        title.innerHTML = '<i class="fa-solid fa-bell"></i> Watchlist';
        if(!status.loggedIn) { 
            content.innerHTML = `<div class="panel-state-message"><p>Log in voor Watchlist</p><button class="main-cta-button" onclick="openModal('loginModal')">Inloggen</button></div>`; 
            return; 
        }
        
        const res = await fetch('/api/watchlist');
        const data = await res.json();
        let html = '<ul class="watchlist-list">';
        if(data.watchlist && data.watchlist.length > 0) {
            data.watchlist.forEach(t => {
                html += `<li class="watchlist-item" onclick="loadTicker('${t}','${t}')"><span>${t}</span><i class="fa-solid fa-trash" onclick="event.stopPropagation(); removeFromWatchlist('${t}')"></i></li>`;
            });
        }
        html += `</ul><div style="text-align:center; margin-top:10px;"><button class="small-cta-button" onclick="addToWatchlist()">+ Voeg ${currentFocusTicker} toe</button></div>`;
        content.innerHTML = html;
        
    } else {
        // Premium Panels
        title.innerText = type.charAt(0).toUpperCase() + type.slice(1);
        if(!status.isPremium) {
            content.innerHTML = getPremiumLockedHTML(`Unlock ${type}`, "Geavanceerde data vereist Premium.", "Upgrade Nu");
        } else {
            // Mock Premium Content (behalve Indicators)
            if(type === 'indicators') {
                const res = await fetch('/api/leading_indicators');
                const data = await res.json();
                let html = '<ul class="indicator-list">';
                data.indicators.forEach(i => html += `<li class="indicator-item"><span>${i.name}</span><span style="color:var(--accent-green)">${i.correlation}</span></li>`);
                content.innerHTML = html + '</ul>';
            } else {
                content.innerHTML = `<div style="padding:20px;">Premium ${type} data voor ${currentFocusTicker} actief.</div>`;
            }
        }
    }
}

// WATCHLIST HELPERS
async function addToWatchlist() {
    await fetch('/api/watchlist', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ticker: currentFocusTicker})});
    refreshWatchlists();
}
async function removeFromWatchlist(t) {
    if(!confirm('Verwijderen?')) return;
    await fetch('/api/watchlist', {method:'DELETE', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ticker: t})});
    refreshWatchlists();
}
function refreshWatchlists() {
    ['panel-right-1', 'panel-right-2'].forEach(pid => {
        const sel = document.getElementById(pid + '-selector');
        if (sel && sel.value === 'watchlist') loadPanelContent(pid, 'watchlist');
    });
}

// FINANCIALS
async function showFinancialTab(type, btn) {
    if(btn) { document.querySelectorAll('.financial-tab-button').forEach(b => b.classList.remove('active')); btn.classList.add('active'); }
    const content = document.getElementById('financial-tab-content');
    content.innerHTML = 'Loading...';
    try {
        const res = await fetch(`/api/financials/${type}?ticker=${currentFocusTicker}`);
        const json = await res.json();
        if(json.data && type === 'ratios') {
            let html = '<div class="financial-grid">';
            for(const [k, v] of Object.entries(json.data)) html += `<div class="metric-card"><div class="metric-label">${k}</div><div class="metric-value">${v}</div></div>`;
            content.innerHTML = html + '</div>';
        } else if (type !== 'ratios' && json.data.length > 0) {
             let html = '<ul class="news-list">';
             json.data.forEach(item => html += `<li class="news-item">${item.title || item.name}</li>`);
             content.innerHTML = html + '</ul>';
        } else { 
            content.innerHTML = '<div style="padding:10px;">Data niet beschikbaar in gratis API.</div>'; 
        }
    } catch(e) { content.innerHTML = 'Error'; }
}

// AI
async function fetchAIPrediction(ticker) {
    const status = await getAuthStatus();
    const aiText = document.getElementById('ai-prediction-text');
    const freeDiv = document.getElementById('free-ai-content');
    const premDiv = document.getElementById('premium-ai-content');

    if(status.isPremium) {
        if(freeDiv) freeDiv.style.display = 'none';
        if(premDiv) premDiv.style.display = 'block';
        if(aiText) {
            aiText.innerHTML = 'AI scant nieuwsbronnen...';
            try {
                const res = await fetch('/api/ai_prediction', {
                    method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ticker: ticker})
                });
                const data = await res.json();
                aiText.innerHTML = data.prediction;
            } catch(e) { aiText.innerHTML = 'AI Service Unavailable'; }
        }
    } else {
        if(freeDiv) freeDiv.style.display = 'block';
        if(premDiv) premDiv.style.display = 'none';
    }
}

// START
document.addEventListener('DOMContentLoaded', () => {
    // Check local storage voor opgeslagen staat
    const saved = restoreAppState();
    
    // Herstel selectors
    if (saved) {
        if(document.getElementById('panel-right-1-selector')) document.getElementById('panel-right-1-selector').value = saved.panel1;
        if(document.getElementById('panel-right-2-selector')) document.getElementById('panel-right-2-selector').value = saved.panel2;
        updateUI(); // Zet knoppen goed
        loadTicker(saved.ticker, saved.name);
    } else {
        updateUI();
        loadTicker('AAPL', 'Apple Inc');
        // Defaults
        loadPanelContent('panel-right-1', 'news');
        loadPanelContent('panel-right-2', 'network');
        if(document.getElementById('panel-right-1-selector')) document.getElementById('panel-right-1-selector').value = 'news';
        if(document.getElementById('panel-right-2-selector')) document.getElementById('panel-right-2-selector').value = 'network';
    }
});
