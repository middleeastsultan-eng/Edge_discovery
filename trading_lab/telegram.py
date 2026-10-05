"""Telegram notifications for the overnight research loop."""

from __future__ import annotations

import requests

from .config import TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID


def send_message(text: str) -> None:
    """Send a message to the configured chat. Prints to stdout instead if not configured,
    so the research loop still works without Telegram set up.
    """
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        print(f"[telegram not configured -- would have sent]:\n{text}")
        return

    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    try:
        resp = requests.post(
            url,
            data={"chat_id": TELEGRAM_CHAT_ID, "text": text, "disable_web_page_preview": True},
            timeout=10,
        )
        if not resp.ok:
            print(f"Telegram send failed: {resp.status_code} {resp.text}")
    except requests.RequestException as e:
        print(f"Telegram send failed: {e}")
