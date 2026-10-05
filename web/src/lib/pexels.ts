import "server-only";

// Purely a visual nicety for the landing page hero -- never required for the app to
// function. Returns null (never throws) if the key is missing or the call fails, same
// degrade-silently philosophy as trading_lab/explain.py and reddit_scan.py on the
// Python side. The hero section falls back to a plain gradient when this returns null.
export async function getHeroImage(query: string): Promise<string | null> {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=1&orientation=landscape`,
      { headers: { Authorization: apiKey }, next: { revalidate: 86400 } }, // cache a day -- this doesn't need to change often
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data?.photos?.[0]?.src?.large2x ?? null;
  } catch {
    return null;
  }
}
