import { useMediaUrl } from '../../matrix/hooks/useMediaUrl';
import { useUrlPreview } from '../../matrix/hooks/useUrlPreview';
import './LinkPreviewCard.css';

/** Renders the "unfurled" card below a message's first link, Discord/Element-style — nothing
 *  when the homeserver has no preview for the url (unsupported site, or one that never
 *  resolved), so a plain link never grows an empty box. */
function hostnameOf(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return rawUrl;
  }
}

export function LinkPreviewCard({ url }: { url: string }) {
  const preview = useUrlPreview(url);
  const imageSrc = useMediaUrl(preview?.['og:image']);
  if (!preview || !preview['og:title']) return null;

  return (
    <a
      className="nu-link-preview"
      data-nu-role="link-preview-card"
      href={preview['og:url'] || url}
      target="_blank"
      rel="noopener noreferrer"
    >
      {imageSrc && <img className="nu-link-preview__image" src={imageSrc} alt="" />}
      <div className="nu-link-preview__body">
        <div className="nu-link-preview__title">{preview['og:title']}</div>
        {preview['og:description'] && (
          <div className="nu-link-preview__description">{preview['og:description']}</div>
        )}
        <div className="nu-link-preview__url">{hostnameOf(preview['og:url'] || url)}</div>
      </div>
    </a>
  );
}
