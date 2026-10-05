import { ACCENT, GLOW_OPACITY } from "@/lib/theme";

/**
 * A restrained nod to the hero glow on marketing pages like Giga's -- a soft
 * blurred radial accent behind the page heading. Near-invisible in light mode
 * (GLOW_OPACITY is ~0 there) and only shows in dark mode.
 */
export function PageGlow() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute -top-24 left-0 h-72 w-full max-w-xl -z-10"
      style={{
        background: `radial-gradient(ellipse at top left, ${ACCENT}, transparent 70%)`,
        opacity: GLOW_OPACITY,
        filter: "blur(60px)",
      }}
    />
  );
}
