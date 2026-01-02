// ===============================================
// 1. GLOBAL STATE & SETTINGS
// ===============================================

let currentFocusTicker = 'AAPL'; // Standaard start ticker
let currentFocusName = 'Apple Inc';
let searchTimeout = null; // Voor het vertragen van API calls (debounce)

// Stripe public key (voor latere uitbreiding, nu optioneel)
const stripe = Stripe('pk_test_XXX'); 

// ===============================================
// 2. UI & MODAL HELPERS
// ===============================================

function openModal(modalId) { 
    document.getElementById(modalId).style.display = 'block'; 
}

function closeModal(modalId) { 
    document.getElementById(modalId).style.display = 'none'; 
}

function showAuthMessage(modalId, message, isError = false) {
    // Zoek het <p> element voor berichten in de modal
    const msgId = modalId.replace('Modal', '') + '-message'; 
    const msgElement = document.getElementById(msgId);
    
    if (msgElement) {
        msgElement.innerText = message;
        msgElement.style.display = 'block';
        msgElement.style.color = isError ? 'var(--accent-red)' : 'var(--accent-green)';
    }
}

// Helper voor consistente Premium "Lock" schermen
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

// ===============================================
// 3. AUTHENTICATION LOGIC
// ===============================================

async function getAuthStatus() {
    try {
        const response = await fetch('/api/status');
        return await response.json();
    } catch (error) {
        console.error("Auth check failed:", error);
        return { loggedIn: false, isPremium: false, username: 'Guest' };
    }
}

async function handleRegister() {
    const username = document.getElementById('reg-username').value;
    const email = document.getElementById('reg-email').value; // Wordt niet gebruikt in MVP backend, maar wel in UI
    const password = document.getElementById('reg-password').value;
    
    if (!username || password.length < 8) {
        showAuthMessage('registerModal', 'Vul een naam in en wachtwoord (min 8 tekens).', true);
        return;
    }
    
    showAuthMessage('registerModal', 'Bezig met registreren...');

    try {
        const response = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }) 
        });
        const data = await response.json();

        if (data.success) { 
            showAuthMessage('registerModal', 'Succes! Pagina wordt herladen...', false);
            setTimeout(() => location.reload(), 1000); // Herlaad om in te loggen
        } else {
            showAuthMessage('registerModal', data.message || 'Fout bij registreren.', true);
        }
    } catch (error) {
        showAuthMessage('registerModal', 'Netwerkfout.', true);
    }
}

async function handleLogin() {
    const username = document.getElementById('log-username').value;
    const password = document.getElementById('log-password').value;
    
    showAuthMessage('loginModal', 'Bezig met inloggen...');

    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await response.json();

        if (data.success) {
            showAuthMessage('loginModal', 'Succes! Pagina wordt herladen...', false);
            setTimeout(() => location.reload(), 1000);
        } else {
            showAuthMessage('loginModal', 'Ongeldige inloggegevens.', true);
        }
    } catch (error) {
        showAuthMessage('loginModal', 'Netwerkfout.', true);
    }
}

async function logout() {
    await fetch('/api/logout', { method: 'POST' });
    location.reload();
}

async function openProfile() {
    const status = await getAuthStatus();
    
    if (!status.loggedIn) {
        openModal('loginModal');
        return;
    }
    
    document.getElementById('display-username').innerText = status.username;
    const statusText = document.getElementById('status-text');
    statusText.innerText = status.isPremium ? 'Premium Account' : 'Free Tier';
    statusText.style.color = status.isPremium ? 'gold' : 'var(--text-secondary)';
    
    // Toggle knoppen in profiel
    document.getElementById('manage-subscription-btn').style.display = status.isPremium ? 'block' : 'none';
    document.getElementById('upgrade-from-account-btn').style.display = status.isPremium ? 'none' : 'block';

    openModal('accountModal');
}

// ===============================================
// 4. PREMIUM & UPGRADE LOGIC
// ===============================================

async function handleUpgradeClick(event) {
    if (event) event.preventDefault();
    const status = await getAuthStatus();

    if (status.isPremium) {
        alert("Je hebt al Premium!");
        return;
    }
    
    // Reset modal state
    document.getElementById('premium-message').style.display = 'none';
    
    if (!status.loggedIn) {
        // Als niet ingelogd: toon aangepaste tekst
        document.getElementById('auth-check').innerHTML = `<p style="color:var(--accent-orange)">Je moet eerst inloggen of registreren.</p>`;
    } else {
        document.getElementById('auth-check').innerHTML = ``;
    }

    openModal('premiumModal');
}

async function buyPremium() {
    const status = await getAuthStatus();
    const msg = document.getElementById('premium-message');
    
    // Voor MVP: Check of ingelogd, daarna mock upgrade
    if (!status.loggedIn) {
        msg.innerText = "Log eerst in om te upgraden.";
        msg.style.display = 'block';
        msg.classList.add('error-message');
        return;
    }

    msg.innerText = "Simulatie Stripe Betaling...";
    msg.style.display = 'block';
    msg.classList.remove('error-message');

    // Call backend om status om te zetten
    try {
        const response = await fetch('/api/create-checkout-session', { method: 'POST' });
        const data = await response.json();
        
        if (data.success) {
            msg.innerText = "Betaling geslaagd! Account wordt geüpdatet...";
            setTimeout(() => location.reload(), 1500);
        }
    } catch (e) {
        msg.innerText = "Er ging iets mis.";
    }
}

async function openCustomerPortal() {
    alert("Dit opent het Stripe klantportaal in productie.");
}

// ===============================================
// 5. TICKER & SEARCH LOGIC
// ===============================================

// Dit wordt aangeroepen als de gebruiker typt
function showSuggestions(query) {
    const list = document.getElementById('suggestions-list');
    list.innerHTML = ''; // Leegmaken

    if (query.length < 2) {
        list.style.display = 'none';
        return;
    }

    // Debounce: Wacht 300ms met zoeken zodat we de API niet overbelasten
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(async () => {
        try {
            // Echte API call naar backend
            const response = await fetch(`/api/search?q=${query}`);
            const data = await response.json();

            if (data.results && data.results.length > 0) {
                data.results.forEach(item => {
                    const div = document.createElement('div');
                    div.className = 'suggestion-item';
                    // item.displaySymbol is bijv "NASDAQ:AAPL"
                    div.innerHTML = `<span class="suggestion-ticker">${item.displaySymbol}</span> <span class="suggestion-name">${item.description}</span>`;
                    div.onclick = () => {
                        loadTicker(item.displaySymbol, item.description);
                    };
                    list.appendChild(div);
                });
                list.style.display = 'block';
            } else {
                list.style.display = 'none';
            }
        } catch (error) {
            console.error("Search error", error);
        }
    }, 300);
}

function hideSuggestions() {
    // Korte vertraging zodat click event nog kan vuren
    setTimeout(() => {
        document.getElementById('suggestions-list').style.display = 'none';
    }, 200);
}

// Hoofdfunctie om een nieuw aandeel te laden
function loadTicker(symbol, name) {
    currentFocusTicker = symbol;
    currentFocusName = name || symbol;

    // 1. Update Header
    document.getElementById('focus-ticker').innerText = currentFocusName;
    document.getElementById('search-input').value = ''; // Reset zoekbalk
    hideSuggestions();

    // 2. Update TradingView Chart
    new TradingView.widget({
        "autosize": true,
        "symbol": symbol, // Gebruik het symbool van de API
        "interval": "D",
        "timezone": "Europe/Amsterdam",
        "theme": "dark",
        "style": "1",
        "locale": "en",
        "enable_publishing": false,
        "container_id": "tradingview_chart"
    });

    // 3. Update Panels
    // Herlaad paneel 1
    const p1Type = document.getElementById('panel-right-1-selector').value;
    loadPanelContent('panel-right-1', p1Type);

    // Herlaad paneel 2
    const p2Type = document.getElementById('panel-right-2-selector').value;
    loadPanelContent('panel-right-2', p2Type);

    // 4. Update Financials Tab
    const activeTabBtn = document.querySelector('.financial-tab-button.active');
    let activeTab = 'ratios';
    if (activeTabBtn) {
        // Simpele check welke tab actief is op basis van tekst
        const text = activeTabBtn.innerText.toLowerCase();
        if (text.includes('board')) activeTab = 'board';
        else if (text.includes('ownership')) activeTab = 'ownership';
        else if (text.includes('reports')) activeTab = 'reports';
    }
    showFinancialTab(activeTab, activeTabBtn);

    // 5. Update AI Prediction
    fetchAIPrediction(symbol);
}

// ===============================================
// 6. PANEL CONTENT LOGIC
// ===============================================

async function loadPanelContent(panelId, type) {
    const contentDiv = document.getElementById(`${panelId}-content`); 
    const titleSpan = document.getElementById(`${panelId}-title`);
    const status = await getAuthStatus();

    // Loading state
    contentDiv.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-secondary);">Loading data...</div>';

    switch (type) {
        case 'news':
            titleSpan.innerHTML = '<i class="fa-solid fa-newspaper"></i> News: ' + currentFocusTicker;
            try {
                // Fetch specifiek nieuws voor dit aandeel
                const res = await fetch(`/api/news?ticker=${currentFocusTicker}`);
                const data = await res.json();
                
                let html = '<ul class="news-list">';
                data.news.forEach(item => {
                    html += `
                        <li class="news-item">
                            <div class="news-content">
                                <a href="${item.url}" target="_blank" class="news-title" style="text-decoration:none; color:var(--text-primary);">${item.title}</a>
                                <div class="news-meta"><span>${item.source}</span><span>${item.time}</span></div>
                            </div>
                        </li>
                    `;
                });
                html += '</ul>';
                contentDiv.innerHTML = html;
            } catch (e) {
                contentDiv.innerHTML = '<p class="error-message">Failed to load news.</p>';
            }
            break;

        case 'watchlist':
            titleSpan.innerHTML = '<i class="fa-solid fa-bell"></i> Watchlist';
            loadWatchlist(panelId); // Roept aparte functie aan
            break;

        case 'network':
            titleSpan.innerHTML = '<i class="fa-solid fa-code-branch"></i> Corporate Network';
            // Placeholder netwerk
            const networkHtml = `
                <div class="network-insight">
                    <p style="font-size: 0.9rem; margin-bottom: 10px;">Network for: <b>${currentFocusTicker}</b></p>
                    <div class="network-lists-grid">
                        <div><p class="network-list-title">Competitors</p><ul class="simple-network-list"><li>Mock Comp A</li><li>Mock Comp B</li></ul></div>
                        <div><p class="network-list-title">Suppliers</p><ul class="simple-network-list"><li>Mock Supp X</li></ul></div>
                        <div><p class="network-list-title">Customers</p><ul class="simple-network-list"><li>Mock Cust Y</li></ul></div>
                    </div>
                </div>`;
            
            if (status.isPremium) {
                contentDiv.innerHTML = networkHtml + `<div style="margin-top:10px; border-top:1px solid var(--border); padding-top:10px; color:var(--accent-green); text-align:center;"><i class="fa-solid fa-diagram-project"></i> Interactive Graph Active</div>`;
            } else {
                contentDiv.innerHTML = networkHtml + getPremiumLockedHTML("Unlock Interactive Graph", "Upgrade to visualize the full supply chain.", "Upgrade Now");
            }
            break;
            
        case 'indicators':
            titleSpan.innerHTML = '<i class="fa-solid fa-fire"></i> Leading Indicators';
            if (!status.isPremium) {
                contentDiv.innerHTML = getPremiumLockedHTML("Unlock Indicators", "See real-time macro correlations.");
                return;
            }
            // Fetch premium data
            try {
                const res = await fetch('/api/leading_indicators');
                const data = await res.json();
                let html = '<ul class="indicator-list">';
                data.indicators.forEach(ind => {
                    html += `<li class="indicator-item"><span>${ind.name}</span><span style="color:var(--accent-green)">${ind.correlation}</span></li>`;
                });
                html += '</ul>';
                contentDiv.innerHTML = html;
            } catch (e) { contentDiv.innerHTML = 'Error loading indicators.'; }
            break;

        case 'sentiment':
            titleSpan.innerHTML = '<i class="fa-solid fa-comment-dots"></i> Sentiment Analysis';
            if (status.isPremium) {
                contentDiv.innerHTML = `<div style="padding:15px;">
                    <p><b>Sentiment Score:</b> <span style="color:var(--accent-green)">+0.65 (Positive)</span></p>
                    <p style="font-size:0.85rem; margin-top:5px;">Based on 500+ sources for ${currentFocusTicker}.</p>
                </div>`;
            } else {
                contentDiv.innerHTML = getPremiumLockedHTML("Unlock Sentiment", "Real-time social sentiment analysis.");
            }
            break;

        case 'volatility':
            titleSpan.innerHTML = '<i class="fa-solid fa-wave-square"></i> Volatility';
            if (status.isPremium) {
                contentDiv.innerHTML = `<div style="padding:15px;">Mock Volatility Data for ${currentFocusTicker}</div>`;
            } else {
                contentDiv.innerHTML = getPremiumLockedHTML("Unlock Volatility", "Advanced risk metrics (VaR, Skew).");
            }
            break;
    }
}

// ===============================================
// 7. WATCHLIST LOGIC
// ===============================================

async function loadWatchlist(panelId) {
    const contentDiv = document.getElementById(`${panelId}-content`);
    const status = await getAuthStatus();

    if (!status.loggedIn) {
        contentDiv.innerHTML = `
            <div class="panel-state-message">
                <p>Log in to view your Watchlist.</p>
                <button onclick="openModal('loginModal')" class="main-cta-button" style="margin-top:10px;">Log In</button>
            </div>`;
        return;
    }

    try {
        const res = await fetch('/api/watchlist');
        const data = await res.json();
        
        if (data.success && data.watchlist.length > 0) {
            let html = '<ul class="watchlist-list">';
            data.watchlist.forEach(ticker => {
                html += `
                    <li class="watchlist-item">
                        <div onclick="loadTicker('${ticker}', '${ticker}')" style="cursor: pointer;">
                            <span class="watchlist-ticker">${ticker}</span>
                        </div>
                        <i class="fa-solid fa-trash-alt remove-icon" onclick="removeFromWatchlist('${ticker}')"></i>
                    </li>`;
            });
            html += '</ul>';
            // Knop om huidige toe te voegen
            html += `<div style="text-align:center; margin-top:10px;">
                <button onclick="addToWatchlist()" class="small-cta-button">Add ${currentFocusTicker}</button>
            </div>`;
            contentDiv.innerHTML = html;
        } else {
            contentDiv.innerHTML = `
                <div class="panel-state-message">
                    <p>Watchlist is empty.</p>
                    <button onclick="addToWatchlist()" class="main-cta-button">Add ${currentFocusTicker}</button>
                </div>`;
        }
    } catch (e) {
        contentDiv.innerHTML = 'Error loading watchlist.';
    }
}

async function addToWatchlist() {
    const res = await fetch('/api/watchlist', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ ticker: currentFocusTicker })
    });
    const data = await res.json();
    alert(data.message);
    refreshWatchlistPanels();
}

async function removeFromWatchlist(ticker) {
    if (!confirm(`Remove ${ticker}?`)) return;
    const res = await fetch('/api/watchlist', {
        method: 'DELETE',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ ticker: ticker })
    });
    const data = await res.json();
    alert(data.message);
    refreshWatchlistPanels();
}

function refreshWatchlistPanels() {
    // Ververs alle panelen die op 'watchlist' staan
    ['panel-right-1', 'panel-right-2'].forEach(pid => {
        const sel = document.getElementById(pid + '-selector');
        if (sel && sel.value === 'watchlist') loadPanelContent(pid, 'watchlist');
    });
}


// ===============================================
// 8. FINANCIALS & AI LOGIC
// ===============================================

async function showFinancialTab(type, btn) {
    if (btn) {
        document.querySelectorAll('.financial-tab-button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    }
    
    const content = document.getElementById('financial-tab-content');
    content.innerHTML = 'Loading financials...';
    
    try {
        const res = await fetch(`/api/financials/${type}?ticker=${currentFocusTicker}`);
        const json = await res.json();
        
        if (type === 'ratios' && json.success) {
            let html = '<div class="financial-grid">';
            for (const [key, value] of Object.entries(json.data)) {
                html += `<div class="metric-card"><div class="metric-label">${key}</div><div class="metric-value">${value}</div></div>`;
            }
            html += '</div>';
            content.innerHTML = html;
        } else {
            content.innerHTML = '<div style="padding:10px;">Data only available via paid API (Mock for MVP).</div>';
        }
    } catch (e) {
        content.innerHTML = 'Error fetching data.';
    }
}

async function fetchAIPrediction(ticker) {
    const status = await getAuthStatus();
    
    // Toggle zichtbaarheid
    const freeDiv = document.getElementById('free-ai-content');
    const premDiv = document.getElementById('premium-ai-content');
    const aiText = document.getElementById('ai-prediction-text');
    
    if (status.isPremium) {
        if(freeDiv) freeDiv.style.display = 'none';
        if(premDiv) premDiv.style.display = 'block';
        
        if (aiText) {
            aiText.innerHTML = 'AI Analyzing ' + ticker + '...';
            try {
                const res = await fetch('/api/ai_prediction', {
                    method: 'POST',
                    headers: {'Content-Type':'application/json'},
                    body: JSON.stringify({ ticker: ticker })
                });
                const data = await res.json();
                aiText.innerHTML = data.prediction;
            } catch (e) { aiText.innerHTML = 'AI Service Unavailable.'; }
        }
    } else {
        if(freeDiv) freeDiv.style.display = 'block';
        if(premDiv) premDiv.style.display = 'none';
    }
}

// ===============================================
// 9. INIT & UI UPDATES
// ===============================================

async function updateUI() {
    const status = await getAuthStatus();
    
    // Auth buttons zichtbaarheid
    const regBtn = document.getElementById('auth-register-btn');
    const logBtn = document.getElementById('auth-login-btn');
    const profileBtn = document.getElementById('profile-btn');
    const upgradeBtn = document.getElementById('upgrade-button');
    const premLabel = document.getElementById('premium-label');

    if (status.loggedIn) {
        if(regBtn) regBtn.style.display = 'none';
        if(logBtn) logBtn.style.display = 'none';
        if(profileBtn) profileBtn.style.display = 'inline-block';
        
        if (status.isPremium) {
            if(upgradeBtn) upgradeBtn.style.display = 'none';
            if(premLabel) premLabel.style.display = 'inline';
            if(profileBtn) profileBtn.style.color = 'gold';
        } else {
            if(upgradeBtn) upgradeBtn.style.display = 'inline-block';
            if(premLabel) premLabel.style.display = 'none';
            if(profileBtn) profileBtn.style.color = 'var(--accent-blue)';
        }
    } else {
        // Uitgelogd
        if(regBtn) regBtn.style.display = 'inline-block';
        if(logBtn) logBtn.style.display = 'inline-block';
        if(profileBtn) profileBtn.style.display = 'none';
        if(upgradeBtn) upgradeBtn.style.display = 'inline-block';
        if(premLabel) premLabel.style.display = 'none';
    }
    
    // Ververs AI paneel op basis van premium status
    fetchAIPrediction(currentFocusTicker);
    
    // Ververs panelen (om premium content te tonen/verbergen)
    ['panel-right-1', 'panel-right-2'].forEach(pid => {
        const sel = document.getElementById(pid + '-selector');
        if (sel) loadPanelContent(pid, sel.value);
    });
}

// Start Applicatie
document.addEventListener('DOMContentLoaded', () => {
    // 1. Initialiseer UI (Auth check)
    updateUI();
    
    // 2. Laad standaard ticker (Apple)
    loadTicker('AAPL', 'Apple Inc');
    
    // 3. Zet standaard panelen (indien niet in HTML hardcoded)
    const p1 = document.getElementById('panel-right-1-selector');
    if(p1 && p1.value === 'news') loadPanelContent('panel-right-1', 'news');
    
    const p2 = document.getElementById('panel-right-2-selector');
    if(p2 && p2.value === 'network') loadPanelContent('panel-right-2', 'network');
});
