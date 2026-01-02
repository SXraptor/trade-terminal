from flask import Flask, render_template, request, jsonify, session, redirect, url_for
import sqlite3
import psycopg2 # Nieuw voor PostgreSQL
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
DATABASE_URL = os.environ.get('DATABASE_URL') # Dit wordt ingevuld door Render

def get_db_connection():
    """Schakelt automatisch tussen SQLite (lokaal) en PostgreSQL (online)."""
    if DATABASE_URL:
        # We zitten op Render (Productie)
        conn = psycopg2.connect(DATABASE_URL, sslmode='require')
    else:
        # We zitten lokaal (Development)
        conn = sqlite3.connect('users.db')
        conn.row_factory = sqlite3.Row # Zorgt dat we kolommen bij naam kunnen noemen
    return conn

def init_db():
    """Maakt tabellen aan (werkt voor zowel SQLite als Postgres)."""
    conn = get_db_connection()
    c = conn.cursor()
    
    # Syntax is iets anders voor Postgres (SERIAL) vs SQLite (AUTOINCREMENT)
    # We gebruiken generieke SQL waar mogelijk
    
    # Users Table
    c.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            is_premium BOOLEAN NOT NULL DEFAULT FALSE,
            stripe_customer_id TEXT 
        )
    '''.replace('SERIAL PRIMARY KEY', 'INTEGER PRIMARY KEY AUTOINCREMENT') if not DATABASE_URL else '''
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            is_premium BOOLEAN NOT NULL DEFAULT FALSE,
            stripe_customer_id TEXT 
        )
    ''')

    # Watchlist Table
    c.execute('''
        CREATE TABLE IF NOT EXISTS watchlist (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            ticker TEXT NOT NULL,
            added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, ticker)
        )
    '''.replace('SERIAL PRIMARY KEY', 'INTEGER PRIMARY KEY AUTOINCREMENT') if not DATABASE_URL else '''
        CREATE TABLE IF NOT EXISTS watchlist (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            ticker TEXT NOT NULL,
            added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, ticker)
        )
    ''')
    
    conn.commit()
    conn.close()

# Initialiseer DB bij start
try:
    init_db()
except Exception as e:
    print(f"DB Init Warning: {e}")

# ===============================================
# 2. HELPER FUNCTIES
# ===============================================

def fetch_finnhub_news():
    if FINNHUB_API_KEY:
        try:
            url = f"https://finnhub.io/api/v1/news?category=general&token={FINNHUB_API_KEY}"
            r = requests.get(url)
            if r.status_code == 200:
                data = r.json()
                news_items = []
                for item in data[:10]:
                    news_items.append({
                        'title': item['headline'],
                        'source': item['source'],
                        'time': datetime.datetime.fromtimestamp(item['datetime']).strftime('%H:%M'),
                        'important': False
                    })
                return news_items
        except Exception:
            pass
    return [
        {'title': 'Market Data currently unavailable (Check API Key)', 'source': 'System', 'time': 'Now', 'important': True}
    ]

def fetch_company_profile(ticker):
    # Mock data, want volledige financials kosten geld bij API's
    symbol = ticker.split(':')[1].split('(')[0].strip() if ':' in ticker else ticker
    return {
        'ratios': { 'price': '€31.45', 'pe': '7.8x', 'div': '4.1%', 'mcap': '210B' },
        'board': [{'name': 'CEO Name', 'role': 'CEO'}],
        'ownership': [{'shareholder': 'BlackRock', 'stake': '8.1%'}],
        'reports': [{'title': f'Annual Report ({symbol})', 'date': '2025', 'link': '#'}]
    }

# ===============================================
# 3. ROUTES
# ===============================================

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/legal')
def legal_page():
    return render_template('legal.html')

@app.route('/api/register', methods=['POST'])
def register():
    data = request.get_json()
    username = data.get('username')
    password = data.get('password')
    
    if not username or not password:
        return jsonify({'success': False, 'message': 'Vul alles in.'}), 400

    hashed_pw = generate_password_hash(password)
    
    conn = get_db_connection()
    c = conn.cursor()
    try:
        c.execute("INSERT INTO users (username, password) VALUES (%s, %s)" if DATABASE_URL else "INSERT INTO users (username, password) VALUES (?, ?)", (username, hashed_pw))
        conn.commit()
        
        # Ophalen ID voor sessie
        c.execute("SELECT id, is_premium FROM users WHERE username = %s" if DATABASE_URL else "SELECT id, is_premium FROM users WHERE username = ?", (username,))
        user = c.fetchone()
        
        # Row factory of tuple handling
        user_id = user['id'] if not DATABASE_URL and isinstance(user, sqlite3.Row) else user[0]
        is_premium = user['is_premium'] if not DATABASE_URL and isinstance(user, sqlite3.Row) else user[1]

        session['user_id'] = user_id
        session['username'] = username
        session['is_premium'] = bool(is_premium)
        
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'message': 'Gebruikersnaam bestaat al of serverfout.'}), 400
    finally:
        conn.close()

@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json()
    username = data.get('username')
    password = data.get('password')
    
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("SELECT id, password, is_premium FROM users WHERE username = %s" if DATABASE_URL else "SELECT id, password, is_premium FROM users WHERE username = ?", (username,))
    user = c.fetchone()
    conn.close()
    
    # Handle tuple (Postgres) vs Row (SQLite)
    stored_pw = user[1] if DATABASE_URL else user['password'] if user else None
    
    if user and check_password_hash(stored_pw, password):
        user_id = user[0] if DATABASE_URL else user['id']
        is_prem = user[2] if DATABASE_URL else user['is_premium']
        
        session['user_id'] = user_id
        session['username'] = username
        session['is_premium'] = bool(is_prem)
        return jsonify({'success': True})
    
    return jsonify({'success': False, 'message': 'Foutieve login.'}), 401

@app.route('/api/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({'success': True})

@app.route('/api/status')
def status():
    if 'user_id' in session:
        return jsonify({'loggedIn': True, 'username': session['username'], 'isPremium': session.get('is_premium', False)})
    return jsonify({'loggedIn': False, 'isPremium': False, 'username': 'Guest'})

@app.route('/api/news')
def get_news():
    return jsonify({'success': True, 'news': fetch_finnhub_news()})

@app.route('/api/financials/<type>')
def get_financials(type):
    ticker = request.args.get('ticker', 'SHELL')
    data = fetch_company_profile(ticker)
    return jsonify({'success': True, 'data': data.get(type, [])})

@app.route('/api/watchlist', methods=['GET', 'POST', 'DELETE'])
def watchlist():
    if 'user_id' not in session: return jsonify({'success': False}), 401
    user_id = session['user_id']
    conn = get_db_connection()
    c = conn.cursor()

    if request.method == 'GET':
        c.execute("SELECT ticker FROM watchlist WHERE user_id = %s" if DATABASE_URL else "SELECT ticker FROM watchlist WHERE user_id = ?", (user_id,))
        rows = c.fetchall()
        tickers = [r[0] for r in rows]
        conn.close()
        return jsonify({'success': True, 'watchlist': tickers})

    if request.method == 'POST':
        ticker = request.get_json().get('ticker')
        try:
            c.execute("INSERT INTO watchlist (user_id, ticker) VALUES (%s, %s)" if DATABASE_URL else "INSERT INTO watchlist (user_id, ticker) VALUES (?, ?)", (user_id, ticker))
            conn.commit()
            return jsonify({'success': True, 'message': f'{ticker} toegevoegd.'})
        except Exception:
            return jsonify({'success': False, 'message': 'Reeds in lijst.'})
        finally:
            conn.close()

    if request.method == 'DELETE':
        ticker = request.get_json().get('ticker')
        c.execute("DELETE FROM watchlist WHERE user_id = %s AND ticker = %s" if DATABASE_URL else "DELETE FROM watchlist WHERE user_id = ? AND ticker = ?", (user_id, ticker))
        conn.commit()
        conn.close()
        return jsonify({'success': True, 'message': 'Verwijderd.'})

# --- MOCKS ---
@app.route('/api/ai_prediction', methods=['POST'])
def ai_prediction():
    if not session.get('is_premium'): return jsonify({'message': 'Premium needed'}), 403
    return jsonify({'prediction': "**AI Analyse:** Bullish trend verwacht op basis van macro-economische indicatoren."})

@app.route('/api/leading_indicators')
def get_leading_indicators():
    if not session.get('is_premium'): return jsonify({'message': 'Premium needed'}), 403
    return jsonify({'success': True, 'indicators': [{'name': 'Koper', 'correlation': '0.78', 'impact': 'Hoog', 'change': '+1.2%'}]})

@app.route('/api/create-checkout-session', methods=['POST'])
def create_checkout():
    session['is_premium'] = True
    return jsonify({'success': True, 'checkout_url': '/'})

@app.route('/api/customer-portal')
def customer_portal():
    return jsonify({'portal_url': '#'})

if __name__ == '__main__':
    app.run(debug=True)