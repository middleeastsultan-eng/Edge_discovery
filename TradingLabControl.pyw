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
LOGO_PATH = PROJECT_ROOT / "assets" / "app_icon.png"
DASHBOARD_URL = "https://edgediscovery.vercel.app/research"

# Same dark palette as the web dashboard (web/src/app/globals.css .dark block),
# so the desktop app and the website read as the same product.
PAGE = "#171614"
SURFACE = "#1f1e1b"
SURFACE_RAISED = "#262520"
BORDER = "#36342f"
TEXT_PRIMARY = "#f3f2ee"
TEXT_SECONDARY = "#b8b6af"
TEXT_MUTED = "#827f78"
STATUS_GOOD = "#3ecf3e"
STATUS_CRITICAL = "#f0605f"
CHART_BLUE = "#5b9ee8"
CHART_BLUE_HOVER = "#7ab0ed"

STATUS_COLOR = {"Idle": TEXT_MUTED, "Running": STATUS_GOOD, "Stopping...": STATUS_CRITICAL}


def _configure_style() -> ttk.Style:
    style = ttk.Style()
    style.theme_use("clam")

    style.configure(".", background=PAGE, foreground=TEXT_PRIMARY, font=("Segoe UI", 9))
    style.configure("TFrame", background=PAGE)
    style.configure("Card.TFrame", background=SURFACE)
    style.configure("TLabel", background=PAGE, foreground=TEXT_PRIMARY)
    style.configure("Card.TLabel", background=SURFACE, foreground=TEXT_PRIMARY)
    style.configure("Muted.TLabel", background=PAGE, foreground=TEXT_MUTED, font=("Segoe UI", 8))
    style.configure("Title.TLabel", background=PAGE, foreground=TEXT_PRIMARY, font=("Segoe UI", 13, "bold"))
    style.configure("Subtitle.TLabel", background=PAGE, foreground=TEXT_MUTED, font=("Segoe UI", 9))

    style.configure(
        "TButton", background=SURFACE_RAISED, foreground=TEXT_PRIMARY,
        bordercolor=BORDER, lightcolor=SURFACE_RAISED, darkcolor=SURFACE_RAISED,
        focuscolor=SURFACE_RAISED, padding=(12, 6), relief="flat",
    )
    style.map(
        "TButton",
        background=[("active", BORDER), ("disabled", SURFACE)],
        foreground=[("disabled", TEXT_MUTED)],
    )

    style.configure(
        "Accent.TButton", background=CHART_BLUE, foreground="#0b0b0b",
        bordercolor=CHART_BLUE, lightcolor=CHART_BLUE, darkcolor=CHART_BLUE,
        focuscolor=CHART_BLUE, padding=(14, 6), relief="flat", font=("Segoe UI", 9, "bold"),
    )
    style.map(
        "Accent.TButton",
        background=[("active", CHART_BLUE_HOVER), ("disabled", SURFACE)],
        foreground=[("disabled", TEXT_MUTED)],
    )

    for widget in ("TSpinbox", "TEntry"):
        style.configure(
            widget, fieldbackground=SURFACE, foreground=TEXT_PRIMARY, background=SURFACE,
            bordercolor=BORDER, arrowcolor=TEXT_MUTED, insertcolor=TEXT_PRIMARY, padding=4,
        )
        style.map(widget, fieldbackground=[("readonly", SURFACE)])

    style.configure(
        "Vertical.TScrollbar", background=SURFACE_RAISED, troughcolor=PAGE,
        bordercolor=PAGE, arrowcolor=TEXT_MUTED, relief="flat",
    )
    style.map("Vertical.TScrollbar", background=[("active", BORDER)])

    return style


class ControlPanel:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title("Trading Lab -- Research Control")
        self.root.geometry("760x520")
        self.root.minsize(600, 400)
        self.root.configure(background=PAGE)
        if ICON_PATH.exists():
            try:
                self.root.iconbitmap(default=str(ICON_PATH))
            except tk.TclError:
                pass

        self.process: subprocess.Popen | None = None
        self.log_queue: queue.Queue[str] = queue.Queue()
        self.reader_thread: threading.Thread | None = None
        self._logo_image: tk.PhotoImage | None = None

        self._build_ui()
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)
        self.root.after(100, self._poll_log_queue)

    def _build_ui(self):
        header = ttk.Frame(self.root)
        header.pack(fill="x", padx=16, pady=(16, 8))

        if LOGO_PATH.exists():
            try:
                img = tk.PhotoImage(file=str(LOGO_PATH))
                factor = max(1, img.width() // 36)
                self._logo_image = img.subsample(factor, factor)
                ttk.Label(header, image=self._logo_image, background=PAGE).pack(side="left", padx=(0, 10))
            except tk.TclError:
                pass

        title_box = ttk.Frame(header)
        title_box.pack(side="left")
        ttk.Label(title_box, text="TRADING LAB", style="Title.TLabel").pack(anchor="w")
        ttk.Label(title_box, text="Research Control", style="Subtitle.TLabel").pack(anchor="w")

        ttk.Button(header, text="Open Dashboard", command=self._open_dashboard).pack(side="right")

        controls = ttk.Frame(self.root, style="Card.TFrame")
        controls.pack(fill="x", padx=16, pady=8)
        inner = ttk.Frame(controls, style="Card.TFrame")
        inner.pack(fill="x", padx=14, pady=12)

        ttk.Label(inner, text="Worker processes", style="Card.TLabel").grid(row=0, column=0, sticky="w")
        detected = os.cpu_count() or 2
        self.workers_var = tk.IntVar(value=max(1, detected - 1))
        ttk.Spinbox(inner, from_=1, to=max(1, detected), textvariable=self.workers_var, width=5).grid(
            row=1, column=0, sticky="w", pady=(2, 0)
        )

        ttk.Label(inner, text="Candidates per combo", style="Card.TLabel").grid(row=0, column=1, sticky="w", padx=(24, 0))
        self.candidates_var = tk.IntVar(value=3000)
        ttk.Spinbox(inner, from_=200, to=20000, increment=200, textvariable=self.candidates_var, width=8).grid(
            row=1, column=1, sticky="w", padx=(24, 0), pady=(2, 0)
        )

        btn_box = ttk.Frame(inner, style="Card.TFrame")
        btn_box.grid(row=0, column=2, rowspan=2, sticky="e", padx=(24, 0))
        inner.columnconfigure(2, weight=1)
        self.start_btn = ttk.Button(btn_box, text="Start", style="Accent.TButton", command=self.start)
        self.start_btn.pack(side="left", padx=(0, 6))
        self.stop_btn = ttk.Button(btn_box, text="Stop", command=self.stop, state="disabled")
        self.stop_btn.pack(side="left")

        status_frame = ttk.Frame(self.root)
        status_frame.pack(fill="x", padx=16, pady=(4, 0))
        self.status_dot = tk.Canvas(status_frame, width=9, height=9, bg=PAGE, highlightthickness=0)
        self._dot_id = self.status_dot.create_oval(1, 1, 8, 8, fill=TEXT_MUTED, outline="")
        self.status_dot.pack(side="left", padx=(0, 6))
        self.status_var = tk.StringVar(value="Idle")
        self.status_label = ttk.Label(status_frame, textvariable=self.status_var, font=("Segoe UI", 9, "bold"))
        self.status_label.pack(side="left")

        ttk.Label(
            self.root,
            text="Worker count can also be changed live from the web dashboard's Compute Control panel "
                 "once this is running -- it applies on the next round.",
            wraplength=720, style="Muted.TLabel",
        ).pack(fill="x", padx=16, pady=(4, 0))

        log_frame = ttk.Frame(self.root, style="Card.TFrame")
        log_frame.pack(fill="both", expand=True, padx=16, pady=16)
        log_inner = ttk.Frame(log_frame, style="Card.TFrame")
        log_inner.pack(fill="both", expand=True, padx=1, pady=1)

        self.log_text = tk.Text(
            log_inner, wrap="word", state="disabled", bg=SURFACE, fg=TEXT_SECONDARY,
            insertbackground=TEXT_PRIMARY, relief="flat", borderwidth=0,
            font=("Consolas", 9), padx=12, pady=10, highlightthickness=0,
        )
        scrollbar = ttk.Scrollbar(log_inner, command=self.log_text.yview)
        self.log_text.configure(yscrollcommand=scrollbar.set)
        self.log_text.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")

        self.log_text.tag_configure("muted", foreground=TEXT_MUTED)

    def _set_status(self, label: str):
        self.status_var.set(label)
        color = STATUS_COLOR.get(label, TEXT_MUTED)
        self.status_label.configure(foreground=color)
        self.status_dot.itemconfigure(self._dot_id, fill=color)

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
            sys.executable, "-u", str(SCRIPT_PATH),
            "--workers", str(workers),
            "--n-candidates", str(candidates),
        ]
        self._append_log(f"Starting: {' '.join(cmd)}\n\n")

        # -u plus PYTHONUNBUFFERED covers both this process and the multiprocessing
        # workers run_overnight.py spawns -- without it, prints sit in a buffer and
        # never reach this log panel until the whole run exits.
        env = {**os.environ, "PYTHONUNBUFFERED": "1"}
        creationflags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        self.process = subprocess.Popen(
            cmd, cwd=str(PROJECT_ROOT), env=env,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, bufsize=1,
            creationflags=creationflags,
        )

        self.reader_thread = threading.Thread(target=self._read_output, daemon=True)
        self.reader_thread.start()

        self._set_status("Running")
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
            self._set_status("Idle")
            self.start_btn.configure(state="normal")
            self.stop_btn.configure(state="disabled")

        self.root.after(200, self._poll_log_queue)

    def stop(self):
        if self.process is None:
            return
        self._append_log("\nStopping...\n")
        self.process.terminate()
        self._set_status("Stopping...")
        self.stop_btn.configure(state="disabled")

    def _on_close(self):
        if self.process is not None:
            self.process.terminate()
        self.root.destroy()


def main():
    root = tk.Tk()
    _configure_style()
    ControlPanel(root)
    root.mainloop()


if __name__ == "__main__":
    main()
