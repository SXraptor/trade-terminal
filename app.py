from flask import Flask, render_template, request, jsonify, session, redirect, url_for
import sqlite3
import psycopg2 
import psycopg2.extras
from werkzeug.security import generate_password_hash, check_password_hash
import os
import requests
import datetime
from dotenv import load_dotenv

load_dotenv()

# ===============================================
# 1. APP CONFIGURATIE
# ===============================================

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'dev_key_local')
app.config['TEMPLATES_AUTO_RELOAD'] = True

# API KEYS
FINNHUB_API_KEY = os.environ.get('FINNHUB_API_KEY') 
DATABASE_URL = os.environ.get('DATABASE_URL') 

def get_db_connection():
    """Schakelt automatisch tussen SQLite (lokaal) en PostgreSQL (online)."""
    if DATABASE_URL:
        # Productie (Render/Postgres)
        conn = psycopg2.connect(DATABASE_URL, sslmode='require')
    else:
        # Development (Lokaal/SQLite)
        conn = sqlite3.connect('users.db')
        conn.row_factory = sqlite3.Row 
    return conn

def init_db():
    conn = get_db_connection()
    c = conn.cursor()
    
    # Create Users Table
    create_users_query = """
    CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT NOT NULL,
        password TEXT NOT NULL,
        email TEXT,
        is_premium BOOLEAN DEFAULT FALSE
    );
    """ if DATABASE_URL else """
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        password TEXT NOT NULL,
        email TEXT,
        is_premium BOOLEAN DEFAULT 0
    );
    """
    c.execute(create_users_query)

    # Create Watchlist Table
    create_watchlist_query = """
    CREATE TABLE IF NOT EXISTS watchlist (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        ticker TEXT,
        date_added TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """ if DATABASE_URL else """
    CREATE TABLE IF NOT EXISTS watchlist (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        ticker TEXT,
        date_added TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """
    c.execute(create_watchlist_query)
    
    conn.commit()
    conn.close()

# Initialiseer DB bij opstarten
with app.app_context():
    init_db()

# ===============================================
# 2. HELPER FUNCTIES & AI SENTIMENT
# ===============================================

def get_sentiment_analysis(news_items):
    """
    Gratis 'AI' Sentiment Analyse: Scant headlines op keywords.
    """
    if not news_items:
        return "Neutraal (Geen data)"
    
    bullish_keywords = ['profit', 'growth', 'record', 'gain', 'jump', 'surge', 'bull', 'buy', 'positive', 'revenue up', 'beat', 'higher']
    bearish_keywords = ['loss', 'drop', 'fall', 'decline', 'risk', 'bear', 'sell', 'negative', 'warning', 'down', 'miss', 'lower']
    
    score = 0
    analyzed_count = 0
    
    for item in news_items:
        headline = item.get('headline', '').lower()
        summary = item.get('summary', '').lower()
        text = headline + " " + summary
        
        found_bull = any(word in text for word in bullish_keywords)
        found_bear = any(word in text for word in bearish_keywords)
        
        if found_bull: score += 1
        if found_bear: score -= 1
        if found_bull or found_bear: analyzed_count += 1
            
    # Conclusie logica
    if score >= 2: return "Bullish (Sterk Koopsignaal)"
    if score == 1: return "Licht Bullish"
    if score == 0: return "Neutraal / Afwachten"
    if score == -1: return "Licht Bearish"
    return "Bearish (Risico op daling)"

def fetch_company_news(ticker):
    """Haalt live nieuws op via Finnhub API."""
    if FINNHUB_API_KEY:
        try:
            today = datetime.date.today()
            start_date = today - datetime.timedelta(days=3)
            # Finnhub Company News Endpoint
            url = f"https://finnhub.io/api/v1/company-news?symbol={ticker}&from={start_date}&to={today}&token={FINNHUB_API_KEY}"
            r = requests.get(url)
            if r.status_code == 200:
                data = r.json()
                return data[:15] # Max 15 items teruggeven
        except Exception as e:
            print(f"News fetch error: {e}")
    return []

# ===============================================
# 3. ROUTES
# ===============================================

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/legal')
def legal_page():
    return "<h1>Privacy Policy</h1><p>This is a demo policy.</p>"

# --- AUTHENTICATION ---
@app.route('/api/register', methods=['POST'])
def register():
    data = request.get_json()
    hashed_pw = generate_password_hash(data['password'], method='pbkdf2:sha256')
    
    conn = get_db_connection()
    c = conn.cursor()
    try:
        if DATABASE_URL:
            c.execute("INSERT INTO users (username, email, password) VALUES (%s, %s, %s)", (data['username'], data['email'], hashed_pw))
        else:
            c.execute("INSERT INTO users (username, email, password) VALUES (?, ?, ?)", (data['username'], data['email'], hashed_pw))
        conn.commit()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})
    finally:
        conn.close()

@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json()
    conn = get_db_connection()
    c = conn.cursor()
    
    query = "SELECT * FROM users WHERE username = %s" if DATABASE_URL else "SELECT * FROM users WHERE username = ?"
    c.execute(query, (data['username'],))
    user = c.fetchone()
    conn.close()

    if user and check_password_hash(user['password'], data['password']):
        session['user_id'] = user['id']
        session['username'] = user['username']
        session['is_premium'] = bool(user['is_premium'])
        return jsonify({'success': True, 'username': user['username'], 'is_premium': user['is_premium']})
    
    return jsonify({'success': False, 'message': 'Invalid credentials'})

@app.route('/api/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({'success': True})

@app.route('/api/status')
def status():
    if 'user_id' in session:
        return jsonify({'loggedIn': True, 'username': session['username'], 'is_premium': session.get('is_premium', False)})
    return jsonify({'loggedIn': False})

# --- DATA ENDPOINTS ---

@app.route('/api/news')
def get_news():
    ticker = request.args.get('ticker')
    if not ticker:
        return jsonify({'news': [], 'ai_sentiment': 'Selecteer een ticker'})
    
    # Haal live nieuws op
    news_data = fetch_company_news(ticker)
    
    # Voer sentiment analyse uit
    sentiment = get_sentiment_analysis(news_data)
    
    return jsonify({
        'news': news_data,
        'ai_sentiment': sentiment
    })

@app.route('/api/watchlist', methods=['GET', 'POST', 'DELETE'])
def watchlist_api():
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
    
    user_id = session['user_id']
    conn = get_db_connection()
    c = conn.cursor()

    if request.method == 'GET':
        query = "SELECT ticker FROM watchlist WHERE user_id = %s" if DATABASE_URL else "SELECT ticker FROM watchlist WHERE user_id = ?"
        c.execute(query, (user_id,))
        rows = c.fetchall()
        conn.close()
        return jsonify({'watchlist': [{'ticker': r[0]} for r in rows]})

    if request.method == 'POST':
        ticker = request.get_json().get('ticker')
        try:
            query = "INSERT INTO watchlist (user_id, ticker) VALUES (%s, %s)" if DATABASE_URL else "INSERT INTO watchlist (user_id, ticker) VALUES (?, ?)"
            c.execute(query, (user_id, ticker))
            conn.commit()
            return jsonify({'success': True, 'message': f'{ticker} added.'})
        except Exception:
            return jsonify({'success': False, 'message': 'Error adding.'})
        finally:
            conn.close()

    if request.method == 'DELETE':
        ticker = request.get_json().get('ticker')
        query = "DELETE FROM watchlist WHERE user_id = %s AND ticker = %s" if DATABASE_URL else "DELETE FROM watchlist WHERE user_id = ? AND ticker = ?"
        c.execute(query, (user_id, ticker))
        conn.commit()
        conn.close()
        return jsonify({'success': True, 'message': 'Removed.'})

# --- PREMIUM MOCKS ---
@app.route('/api/leading_indicators')
def get_leading_indicators():
    if not session.get('is_premium'): return jsonify({'message': 'Premium needed'}), 403
    # Mock data
    return jsonify({'success': True, 'indicators': [
        {'name': 'Koper/Goud Ratio', 'correlation': '0.82', 'impact': 'Hoog', 'signal': 'Risk-On'},
        {'name': 'VIX Index', 'correlation': '-0.75', 'impact': 'Medium', 'signal': 'Stabiel'},
        {'name': 'USD Index (DXY)', 'correlation': '-0.60', 'impact': 'Hoog', 'signal': 'Dollar Zwakte'}
    ]})

if __name__ == '__main__':
    app.run(debug=True, port=5000)
