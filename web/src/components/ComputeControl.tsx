"use client";

import { updateComputeSettings } from "@/app/research/actions";
import type { AgentSettings } from "@/lib/supabase";
import { TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED, SURFACE, BORDER, STATUS_GOOD, STATUS_CRITICAL, CHART_BLUE } from "@/lib/theme";

export function ComputeControl({ settings }: { settings: AgentSettings }) {
  return (
    <div className="rounded-xl p-4 shadow-sm" style={{ backgroundColor: SURFACE, border: `1px solid ${BORDER}` }}>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-medium" style={{ color: TEXT_SECONDARY }}>
          Compute control
        </h2>
        <span
          className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
          style={{
            color: settings.paused ? STATUS_CRITICAL : STATUS_GOOD,
            backgroundColor: settings.paused ? `${STATUS_CRITICAL}1a` : `${STATUS_GOOD}1a`,
          }}
        >
          {settings.paused ? "Paused" : `Running — ${settings.max_workers} worker(s)`}
        </span>
      </div>
      <p className="text-xs mb-4" style={{ color: TEXT_MUTED }}>
        Remote-controls the local research loop running on your machine (<code>python run_overnight.py</code>)
        &mdash; it re-reads this setting at the start of every round, so changes apply on the next round,
        not instantly. Doesn&apos;t affect the GitHub Actions schedule, which runs independently.
      </p>
      <form action={updateComputeSettings} className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs mb-1" style={{ color: TEXT_MUTED }}>
            Worker processes
          </label>
          <input
            type="number"
            name="max_workers"
            min={0}
            max={16}
            defaultValue={settings.max_workers}
            className="w-20 rounded-md px-2 py-1.5 text-sm"
            style={{ border: `1px solid ${BORDER}`, color: TEXT_PRIMARY, backgroundColor: "transparent" }}
          />
        </div>
        <button
          type="submit"
          name="paused"
          value="false"
          className="rounded-md px-3 py-1.5 text-xs font-medium text-white"
          style={{ backgroundColor: CHART_BLUE }}
        >
          Save &amp; resume
        </button>
        <button
          type="submit"
          name="paused"
          value="true"
          className="rounded-md px-3 py-1.5 text-xs font-medium"
          style={{ border: `1px solid ${BORDER}`, color: TEXT_SECONDARY }}
        >
          Pause
        </button>
      </form>
    </div>
  );
}
