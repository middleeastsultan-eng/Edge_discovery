import { getHeroImage } from "@/lib/pexels";

// Shared background layer for page header banners -- a Pexels photo with a slow
// ken-burns zoom (globals.css) and a page-tinted scrim so text stays readable over
// any image. Renders nothing (parent's plain gradient/PageGlow-less background shows
// through) if no key is configured or the fetch fails -- getHeroImage already
// degrades silently, this just doesn't render the wrapper on top of nothing.
export async function BannerBackground({ query }: { query: string }) {
  const image = await getHeroImage(query);
  if (!image) return null;

  return (
    <>
      <div
        aria-hidden
        className="absolute inset-0 -z-20 animate-ken-burns"
        style={{ backgroundImage: `url(${image})`, backgroundSize: "cover", backgroundPosition: "center" }}
      />
      <div
        aria-hidden
        className="absolute inset-0 -z-10"
        style={{ backgroundColor: "color-mix(in srgb, var(--tl-page) 80%, transparent)" }}
      />
    </>
  );
}
