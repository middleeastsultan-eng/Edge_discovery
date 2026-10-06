import { STATUS_GOOD, STATUS_WARNING, TEXT_MUTED, tint } from "@/lib/theme";

export type ForwardStatus = "promoted" | "tracking" | "not checked yet";

export function ForwardStatusBadge({ status }: { status: ForwardStatus }) {
  const style = {
    promoted: { color: STATUS_GOOD, icon: "✓", label: "Promoted -- live alerts active" },
    tracking: { color: STATUS_WARNING, icon: "·", label: "Forward tracking" },
    "not checked yet": { color: TEXT_MUTED, icon: "·", label: "Not checked yet" },
  }[status];

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium whitespace-nowrap"
      style={{ color: style.color, borderColor: tint(style.color, 25), backgroundColor: tint(style.color, 10) }}
    >
      {status === "promoted" ? (
        <span className="relative inline-flex h-2 w-2" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ backgroundColor: style.color }} />
          <span className="relative inline-flex h-2 w-2 rounded-full" style={{ backgroundColor: style.color }} />
        </span>
      ) : (
        <span aria-hidden>{style.icon}</span>
      )}
      {style.label}
    </span>
  );
}
