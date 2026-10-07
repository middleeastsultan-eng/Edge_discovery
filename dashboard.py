from flask import Flask, jsonify
import sqlite3

app = Flask(__name__)

@app.route('/api/signals')
def get_signals():
    conn = sqlite3.connect('trading_lab.db')
    c = conn.cursor()
    c.execute('SELECT * FROM signals ORDER BY timestamp DESC LIMIT 50')
    signals = c.fetchall()
    conn.close()
    return jsonify([{
        'id': s[0],
        'timestamp': s[1],
        'symbol': s[3],
        'direction': s[4],
        'entry_price': s[5],
        'exit_price': s[6],
        'pnl': s[7]
    } for s in signals])

@app.route('/')
def dashboard():
    return "<h1>Trading Lab Dashboard</h1><div id='root'></div><script src='/static/app.js'></script>"

if __name__ == '__main__':
    app.run(port=8080, debug=True)