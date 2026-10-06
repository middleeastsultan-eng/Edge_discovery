"""Regression test for a real production bug: a GitHub Actions research run 429'd
mid-fetch from Alpaca once every job started also fetching its paired index's data
(for the cross-asset structure-divergence feature), doubling request volume across a
dozen parallel matrix jobs with no shared cache between them. fetch_bars had no
retry/backoff at all before this fix -- a single rate-limit response killed the whole
job instead of just waiting and trying again.
"""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from trading_lab import data_stocks


def _response(status_code: int, json_body: dict | None = None, headers: dict | None = None) -> MagicMock:
    resp = MagicMock()
    resp.status_code = status_code
    resp.headers = headers or {}
    resp.json.return_value = json_body or {}
    if status_code >= 400:
        resp.raise_for_status.side_effect = Exception(f"HTTP {status_code}")
    else:
        resp.raise_for_status.return_value = None
    return resp


def test_retries_on_429_and_succeeds():
    """A 429 followed by a 200 must succeed overall, not raise on the first 429."""
    rate_limited = _response(429, headers={"Retry-After": "0"})
    success = _response(200, json_body={"bars": []})

    with patch("trading_lab.data_stocks.requests.get", side_effect=[rate_limited, success]) as mock_get, \
         patch("trading_lab.data_stocks.time.sleep") as mock_sleep:
        resp = data_stocks._get_with_retry("http://example.com", {}, {})

    assert resp is success
    assert mock_get.call_count == 2
    mock_sleep.assert_called_once()


def test_gives_up_after_max_retries():
    """Persistent 429s must eventually raise, not retry forever."""
    always_limited = [_response(429, headers={"Retry-After": "0"}) for _ in range(data_stocks._MAX_RETRIES)]

    with patch("trading_lab.data_stocks.requests.get", side_effect=always_limited), \
         patch("trading_lab.data_stocks.time.sleep"):
        with pytest.raises(Exception):
            data_stocks._get_with_retry("http://example.com", {}, {})


def test_non_429_error_raises_immediately_without_retry():
    """A real error (e.g. 500) shouldn't be silently retried as if it were a rate limit."""
    server_error = _response(500)

    with patch("trading_lab.data_stocks.requests.get", return_value=server_error) as mock_get, \
         patch("trading_lab.data_stocks.time.sleep") as mock_sleep:
        with pytest.raises(Exception):
            data_stocks._get_with_retry("http://example.com", {}, {})

    assert mock_get.call_count == 1
    mock_sleep.assert_not_called()


def test_success_on_first_try_never_sleeps():
    with patch("trading_lab.data_stocks.requests.get", return_value=_response(200, {"bars": []})), \
         patch("trading_lab.data_stocks.time.sleep") as mock_sleep:
        data_stocks._get_with_retry("http://example.com", {}, {})
    mock_sleep.assert_not_called()
