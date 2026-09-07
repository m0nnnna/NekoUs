import { useMediaUrl } from '../../matrix/hooks/useMediaUrl';
import './EmoteImage.css';

/**
 * Renders one custom emote inline. Deliberately a plain <img> at native size (no thumbnail
 * resizing to a fixed small size the way avatars are) — that's what makes animated GIF/WebP
 * emotes "just work" with zero special handling, the browser animates an <img> natively.
 */
export function EmoteImage({ shortcode, mxcUrl }: { shortcode: string; mxcUrl: string }) {
  const src = useMediaUrl(mxcUrl);

  if (!src) return <>{`:${shortcode}:`}</>;

  return <img className="nu-emote" data-nu-role="emote" src={src} alt={`:${shortcode}:`} title={`:${shortcode}:`} />;
}
