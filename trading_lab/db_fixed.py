import sqlite3
import os
from datetime import datetime

DB_PATH = 'trading_lab.db'

def initialize_database():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    # Create experiments table
    c.execute('''CREATE TABLE IF NOT EXISTS experiments (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 pattern TEXT NOT NULL,
                 timeframe TEXT NOT NULL,
                 robustness REAL,
                 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                 direction TEXT DEFAULT 'long'
             )''')
             
    # Create signals table
    c.execute('''CREATE TABLE IF NOT EXISTS signals (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 experiment_id INTEGER,
                 timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                 symbol TEXT NOT NULL,
                 direction TEXT NOT NULL,
                 entry_price REAL,
                 exit_price REAL,
                 result REAL,
                 FOREIGN KEY(experiment_id) REFERENCES experiments(id)
             )''')
    conn.commit()
    conn.close()

def save_signal(signal_data):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''INSERT INTO signals 
                (experiment_id, symbol, direction, entry_price, exit_price, result)
                VALUES (?, ?, ?, ?, ?, ?)''',
              (signal_data['experiment_id'], signal_data['symbol'], signal_data['direction'],
               signal_data['entry_price'], signal_data['exit_price'], signal_data['result']))
    conn.commit()
    conn.close()