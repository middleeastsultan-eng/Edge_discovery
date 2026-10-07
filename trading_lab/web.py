from flask import Flask, jsonify
import sqlite3

app = Flask(__name__)

@app.route('/api/signals')
def get_signals():
    conn = sqlite3.connect('trading_lab.db')
    c = conn.cursor()
    c.execute('SELECT * FROM signals ORDER BY timestamp DESC LIMIT 50')
    return jsonify(c.fetchall())

if __name__ == '__main__':
    app.run(port=8080)