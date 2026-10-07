import time
import logging
from trading_lab.data import DataStream
from trading_lab.backtest import run_backtest
from trading_lab.db_fixed import save_signal
from datetime import datetime

# Initialize logging
logging.basicConfig(
    filename='logs/live_trading.log',
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)

def run_live_trading(pattern):
    # [Existing trading logic]
    
    # After trade execution
    print(f"Trade executed: {direction} {symbol} @ {entry_price}, Exit @ {exit_price}, PnL: {pnl:.2f}%")
    
    # Save to database
    save_signal({
        'experiment_id': current_experiment_id,
        'symbol': symbol,
        'direction': direction,
        'entry_price': entry_price,
        'exit_price': exit_price,
        'result': pnl
    })
    logging.info(f"Signal saved: {symbol} {direction} trade")

if __name__ == '__main__':
    run_live_trading('bearish_divergence_30Min')