"""Trading Lab -- Research Control Panel.

A desktop app, not a terminal command: double-click this file (or a shortcut to it)
to open it. Starts/stops the local research loop (run_overnight.py) as a background
process and streams its output live, so nothing requires typing a command.

Worker count here is just the starting point for a fresh launch -- once running, the
loop can still be throttled or paused remotely from the web dashboard's Compute
Control panel (both read/write the same database setting).
"""

from __future__ import annotations

import os
import queue
import subprocess
import sys
import threading
import tkinter as tk
import webbrowser
from pathlib import Path
from tkinter import ttk

PROJECT_ROOT = Path(__file__).parent
SCRIPT_PATH = PROJECT_ROOT / "run_overnight.py"
ICON_PATH = PROJECT_ROOT / "assets" / "app_icon.ico"
DASHBOARD_URL = "https://edgediscovery.vercel.app/research"


class ControlPanel:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title("Trading Lab -- Research Control")
        self.root.geometry("720x480")
        self.root.minsize(560, 360)
        if ICON_PATH.exists():
            try:
                self.root.iconbitmap(default=str(ICON_PATH))
            except tk.TclError:
                pass

        self.process: subprocess.Popen | None = None
        self.log_queue: queue.Queue[str] = queue.Queue()
        self.reader_thread: threading.Thread | None = None

        self._build_ui()
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)
        self.root.after(100, self._poll_log_queue)

    def _build_ui(self):
        pad = {"padx": 10, "pady": 6}

        top = ttk.Frame(self.root)
        top.pack(fill="x", **pad)

        ttk.Label(top, text="Worker processes:").pack(side="left")
        detected = os.cpu_count() or 2
        self.workers_var = tk.IntVar(value=max(1, detected - 1))
        ttk.Spinbox(top, from_=1, to=max(1, detected), textvariable=self.workers_var, width=5).pack(side="left", padx=(6, 18))

        ttk.Label(top, text="Candidates per combo:").pack(side="left")
        self.candidates_var = tk.IntVar(value=3000)
        ttk.Spinbox(top, from_=200, to=20000, increment=200, textvariable=self.candidates_var, width=8).pack(side="left", padx=(6, 18))

        self.start_btn = ttk.Button(top, text="Start", command=self.start)
        self.start_btn.pack(side="left", padx=(0, 6))
        self.stop_btn = ttk.Button(top, text="Stop", command=self.stop, state="disabled")
        self.stop_btn.pack(side="left")

        ttk.Button(top, text="Open Dashboard", command=self._open_dashboard).pack(side="right")

        status_frame = ttk.Frame(self.root)
        status_frame.pack(fill="x", padx=10)
        self.status_var = tk.StringVar(value="Idle")
        ttk.Label(status_frame, text="Status:").pack(side="left")
        self.status_label = ttk.Label(status_frame, textvariable=self.status_var, font=("Segoe UI", 9, "bold"))
        self.status_label.pack(side="left", padx=(6, 0))

        ttk.Label(
            self.root,
            text="Worker count can also be changed live from the web dashboard's Compute Control panel "
                 "once this is running -- it applies on the next round.",
            wraplength=680, foreground="#666",
        ).pack(fill="x", padx=10, pady=(4, 0))

        log_frame = ttk.Frame(self.root)
        log_frame.pack(fill="both", expand=True, padx=10, pady=10)

        self.log_text = tk.Text(log_frame, wrap="word", state="disabled", bg="#0d0d0d", fg="#d0d0d0", insertbackground="#d0d0d0")
        scrollbar = ttk.Scrollbar(log_frame, command=self.log_text.yview)
        self.log_text.configure(yscrollcommand=scrollbar.set)
        self.log_text.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")

    def _open_dashboard(self):
        webbrowser.open(DASHBOARD_URL)

    def _append_log(self, line: str):
        self.log_text.configure(state="normal")
        self.log_text.insert("end", line)
        self.log_text.see("end")
        self.log_text.configure(state="disabled")

    def start(self):
        if self.process is not None:
            return

        workers = self.workers_var.get()
        candidates = self.candidates_var.get()

        cmd = [
            sys.executable, str(SCRIPT_PATH),
            "--workers", str(workers),
            "--n-candidates", str(candidates),
        ]
        self._append_log(f"Starting: {' '.join(cmd)}\n\n")

        creationflags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        self.process = subprocess.Popen(
            cmd, cwd=str(PROJECT_ROOT),
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, bufsize=1,
            creationflags=creationflags,
        )

        self.reader_thread = threading.Thread(target=self._read_output, daemon=True)
        self.reader_thread.start()

        self.status_var.set("Running")
        self.start_btn.configure(state="disabled")
        self.stop_btn.configure(state="normal")

    def _read_output(self):
        assert self.process is not None and self.process.stdout is not None
        for line in self.process.stdout:
            self.log_queue.put(line)
        self.log_queue.put("\n[process exited]\n")

    def _poll_log_queue(self):
        try:
            while True:
                line = self.log_queue.get_nowait()
                self._append_log(line)
        except queue.Empty:
            pass

        if self.process is not None and self.process.poll() is not None:
            # Process ended on its own (error, or stopped externally).
            self.process = None
            self.status_var.set("Idle")
            self.start_btn.configure(state="normal")
            self.stop_btn.configure(state="disabled")

        self.root.after(200, self._poll_log_queue)

    def stop(self):
        if self.process is None:
            return
        self._append_log("\nStopping...\n")
        self.process.terminate()
        self.status_var.set("Stopping...")
        self.stop_btn.configure(state="disabled")

    def _on_close(self):
        if self.process is not None:
            self.process.terminate()
        self.root.destroy()


def main():
    root = tk.Tk()
    try:
        style = ttk.Style()
        style.theme_use("vista" if os.name == "nt" else style.theme_use())
    except tk.TclError:
        pass
    ControlPanel(root)
    root.mainloop()


if __name__ == "__main__":
    main()
