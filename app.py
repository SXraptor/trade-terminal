from flask import Flask, render_template, request, jsonify, session
import sqlite3
import psycopg2 
import psycopg2.extras
from werkzeug.security import generate_password_hash, check_password_hash
import os
import requests
import datetime
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
# BELANGRIJK: Zorg voor een secret key in Render environment variables
app.secret_key = os.environ.get('SECRET_KEY', 'dev_key_local_only')
app.config['TEMPLATES_AUTO_RELOAD'] = True

# API KEYS
FINNHUB_API_KEY = os.environ.get('FINNHUB_API_KEY') 
DATABASE_URL = os.environ.get('DATABASE_URL')

# --- DATABASE VERBINDING ---
def get_db_connection():
    try:
        if DATABASE_URL:
            conn = psycopg2.connect(DATABASE_URL, sslmode='require')
        else:
            conn = sqlite3.connect('users.db')
            conn.row_factory = sqlite3.Row
        return conn
    except Exception as e:
        print(f"Database connection error: {e}")
        return None

def init_db():
    conn = get_db_connection()
    if not conn: return
    c = conn.cursor()
    
    # Bepaal syntax op basis van database type
    pk_type = "SERIAL PRIMARY KEY" if DATABASE_URL else "INTEGER PRIMARY KEY AUTOINCREMENT"
    
    # Users Tabel
    c.execute(f'''
        CREATE TABLE IF NOT EXISTS users (
            id {pk_type},
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            is_premium BOOLEAN NOT NULL DEFAULT FALSE,
            stripe_customer_id TEXT 
        )
    ''')
    
    # Watchlist Tabel
    c.execute(f'''
        CREATE TABLE IF NOT EXISTS watchlist (
            id {pk_type},
            user_id INTEGER NOT NULL,
            ticker TEXT NOT NULL,
            added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, ticker)
        )
    ''')
    
    conn.commit()
    conn.close()

# Initialiseer database bij opstarten
try:
    init_db()
except Exception as e:
    print(f"DB Init Error: {e}")

# --- HELPER FUNCTIES ---

def fetch_finnhub_news(ticker=None):
    """Haalt nieuws op. Als ticker gegeven is, haalt hij specifiek nieuws op."""
    if not FINNHUB_API_KEY:
        return [{'title': 'API Key Missing', 'source': 'System', 'time': 'Now', 'important': True}]

    try:
        if ticker and ticker != 'market':
            today = datetime.date.today()
            last_week = today - datetime.timedelta(days=5)
            # Finnhub verwacht kale symbolen (bijv 'AAPL', niet 'NASDAQ:AAPL')
            symbol = ticker.split(':')[1] if ':' in ticker else ticker 
            url = f"https://finnhub.io/api/v1/company-news?symbol={symbol}&from={last_week}&to={today}&token={FINNHUB_API_KEY}"
        else:
            url = f"https://finnhub.io/api/v1/news?category=general&token={FINNHUB_API_KEY}"
            
        r = requests.get(url)
        if r.status_code == 200:
            data = r.json()
            news_items = []
            for item in data[:15]: # Max 15 items om de UI niet te breken
                ts = item.get('datetime', 0)
                time_str = datetime.datetime.fromtimestamp(ts).strftime('%d %b %H:%M')
                
                news_items.append({
                    'title': item['headline'],
                    'source': item['source'],
                    'time': time_str,
                    'url': item.get('url', '#'),
                    'summary': item.get('summary', '') # Nodig voor AI analyse
                })
            return news_items
    except Exception as e:
        print(f"News Error: {e}")
        
    return [{'title': 'Geen nieuws gevonden.', 'source': 'System', 'time': 'Now', 'url': '#'}]

def fetch_company_financials(ticker):
    """Haalt basis financials op."""
    if not FINNHUB_API_KEY: return {}
    symbol = ticker.split(':')[1] if ':' in ticker else ticker
    try:
        url = f"https://finnhub.io/api/v1/stock/metric?symbol={symbol}&metric=all&token={FINNHUB_API_KEY}"
        r = requests.get(url)
        if r.status_code == 200:
            metrics = r.json().get('metric', {})
            return {
                'ratios': {
                    'P/E Ratio': f"{metrics.get('peExclExtraTTM', 'N/A')}",
                    'Div Yield': f"{metrics.get('dividendYieldIndicatedAnnual', 'N/A')}%",
                    'Market Cap': f"{metrics.get('marketCapitalization', 'N/A')}M",
                    'Debt/Equity': f"{metrics.get('totalDebt/totalEquityQuarterly', 'N/A')}",
                    'ROE': f"{metrics.get('roeTTM', 'N/A')}%",
                    '52W High': f"{metrics.get('52WeekHigh', 'N/A')}"
                }
            }
    except Exception:
        pass
    return {}

# --- ROUTES ---

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/legal')
def legal_page():
    return render_template('legal.html')

@app.route('/api/search')
def search_ticker():
    query = request.args.get('q', '')
    if not query or not FINNHUB_API_KEY: return jsonify({'results': []})
    try:
        url = f"https://finnhub.io/api/v1/search?q={query}&token={FINNHUB_API_KEY}"
        r = requests.get(url)
        if r.status_code == 200:
            data = r.json()
            results = []
            for item in data.get('result', [])[:10]:
                if '.' not in item['symbol']: 
                    results.append({
                        'symbol': item['symbol'],
                        'description': item['description'],
                        'displaySymbol': item['displaySymbol']
                    })
            return jsonify({'results': results})
    except Exception: pass
    return jsonify({'results': []})

# --- AUTH ROUTES ---
@app.route('/api/register', methods=['POST'])
def register():
    data = request.get_json()
    username = data.get('username')
    password = data.get('password')
    if not username or not password: return jsonify({'success': False, 'message': 'Vul alles in.'}), 400

    hashed_pw = generate_password_hash(password)
    conn = get_db_connection()
    c = conn.cursor()
    try:
        ph = "%s" if DATABASE_URL else "?"
        c.execute(f"INSERT INTO users (username, password) VALUES ({ph}, {ph})", (username, hashed_pw))
        conn.commit()
        
        c.execute(f"SELECT id, is_premium FROM users WHERE username = {ph}", (username,))
        user = c.fetchone()
        
        uid = user['id'] if not DATABASE_URL else user[0]
        prem = user['is_premium'] if not DATABASE_URL else user[1]
        
        session['user_id'] = uid
        session['username'] = username
        session['is_premium'] = bool(prem)
        session.permanent = True
        return jsonify({'success': True})
    except: return jsonify({'success': False, 'message': 'Naam bezet.'}), 400
    finally: conn.close()

@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json()
    conn = get_db_connection()
    c = conn.cursor()
    ph = "%s" if DATABASE_URL else "?"
    c.execute(f"SELECT id, password, is_premium FROM users WHERE username = {ph}", (data.get('username'),))
    user = c.fetchone()
    conn.close()
    
    if user:
        stored_pw = user[1] if DATABASE_URL else user['password']
        if check_password_hash(stored_pw, data.get('password')):
            session['user_id'] = user[0] if DATABASE_URL else user['id']
            session['username'] = data.get('username')
            session['is_premium'] = bool(user[2] if DATABASE_URL else user['is_premium'])
            session.permanent = True
            return jsonify({'success': True})
    return jsonify({'success': False, 'message': 'Login fout.'}), 401

@app.route('/api/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({'success': True})

@app.route('/api/status')
def status():
    return jsonify({
        'loggedIn': 'user_id' in session,
        'username': session.get('username', 'Guest'),
        'isPremium': session.get('is_premium', False)
    })

# --- DATA ROUTES ---

@app.route('/api/news')
def get_news():
    ticker = request.args.get('ticker')
    return jsonify({'success': True, 'news': fetch_finnhub_news(ticker)})

@app.route('/api/financials/<type>')
def get_financials(type):
    ticker = request.args.get('ticker', 'AAPL')
    if type == 'ratios':
        data = fetch_company_financials(ticker)
        if data: return jsonify({'success': True, 'data': data['ratios']})
    return jsonify({'success': True, 'data': []})

@app.route('/api/watchlist', methods=['GET', 'POST', 'DELETE'])
def watchlist():
    if 'user_id' not in session: return jsonify({'success': False}), 401
    uid = session['user_id']
    conn = get_db_connection()
    c = conn.cursor()
    ph = "%s" if DATABASE_URL else "?"
    
    if request.method == 'GET':
        c.execute(f"SELECT ticker FROM watchlist WHERE user_id = {ph}", (uid,))
        rows = c.fetchall()
        tickers = [r[0] for r in rows]
        conn.close()
        return jsonify({'success': True, 'watchlist': tickers})
        
    if request.method == 'POST':
        ticker = request.get_json().get('ticker')
        try:
            c.execute(f"INSERT INTO watchlist (user_id, ticker) VALUES ({ph}, {ph})", (uid, ticker))
            conn.commit()
            return jsonify({'success': True, 'message': 'Added.'})
        except: return jsonify({'success': False, 'message': 'Exists.'})
        finally: conn.close()

    if request.method == 'DELETE':
        ticker = request.get_json().get('ticker')
        c.execute(f"DELETE FROM watchlist WHERE user_id = {ph} AND ticker = {ph}", (uid, ticker))
        conn.commit()
        conn.close()
        return jsonify({'success': True, 'message': 'Removed.'})

# --- PREMIUM & AI LOGICA ---

@app.route('/api/create-checkout-session', methods=['POST'])
def create_checkout():
    session['is_premium'] = True
    session.modified = True
    return jsonify({'success': True})

@app.route('/api/ai_prediction', methods=['POST'])
def ai_prediction():
    if not session.get('is_premium'): 
        return jsonify({'message': 'Premium needed'}), 403
    
    ticker = request.get_json().get('ticker', 'Unknown')
    
    # 1. Haal echt nieuws op
    news_items = fetch_finnhub_news(ticker)
    
    # 2. Gratis Woord-Analyse (Sentiment Scoring)
    # Dit vervangt de dure ChatGPT call
    positive_words = ['up', 'rise', 'profit', 'gain', 'bull', 'growth', 'record', 'buy', 'strong', 'high', 'beat', 'soar']
    negative_words = ['down', 'drop', 'loss', 'bear', 'risk', 'inflation', 'crash', 'sell', 'weak', 'low', 'miss', 'fall']
    
    score = 0
    analyzed_count = 0
    
    for item in news_items:
        text = (item['title'] + " " + item.get('summary', '')).lower()
        for w in positive_words: 
            if w in text: score += 1
        for w in negative_words: 
            if w in text: score -= 1
        analyzed_count += 1
        
    # 3. Conclusie trekken
    if score > 1:
        sentiment = "Bullish (Positief)"
        color = "#26a69a" # Green
        advice = "Het nieuws duidt op groei en positief momentum."
    elif score < -1:
        sentiment = "Bearish (Negatief)"
        color = "#ef5350" # Red
        advice = "Recente berichten bevatten meerdere risicofactoren."
    else:
        sentiment = "Neutraal / Gemengd"
        color = "#787b86" # Grey
        advice = "Geen overduidelijke trend in de laatste nieuwsberichten."
        
    prediction_html = (
        f"**AI Sentiment Scan:** <span style='color:{color}; font-weight:bold;'>{sentiment}</span><br>"
        f"<span style='font-size:0.8rem; color:#787b86;'>Score: {score} | Bronnen: {analyzed_count}</span><br>"
        f"<br>{advice}"
    )
    
    return jsonify({'prediction': prediction_html})

@app.route('/api/leading_indicators')
def get_leading_indicators():
    if not session.get('is_premium'): return jsonify({'message': 'Premium needed'}), 403
    # Mock data voor MVP
    return jsonify({'success': True, 'indicators': [
        {'name': 'Sector Trend', 'correlation': '0.85', 'impact': 'Hoog', 'change': '+2.1%'},
        {'name': 'Rente Impact', 'correlation': '-0.42', 'impact': 'Middel', 'change': 'Stabiel'}
    ]})

if __name__ == '__main__':
    app.run(debug=True)
