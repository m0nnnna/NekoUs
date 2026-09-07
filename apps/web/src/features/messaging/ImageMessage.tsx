import { useState, type CSSProperties } from 'react';
import type { EncryptedAttachmentInfo } from 'browser-encrypt-attachment';
import { Lightbox } from '../../components/Lightbox';
import { useAttachmentUrl } from '../../matrix/hooks/useAttachmentUrl';
import './ImageMessage.css';

type ImageMessageProps = {
  body: string;
  url?: string;
  file?: (EncryptedAttachmentInfo & { url: string }) | undefined;
  mimetype?: string;
  /** The original image's pixel dimensions, from the event's own `info.w`/`info.h`. */
  width?: number;
  height?: number;
};

export function ImageMessage({ body, url, file, mimetype, width, height }: ImageMessageProps) {
  const src = useAttachmentUrl({ url, file, mimetype });
  const [open, setOpen] = useState(false);

  // Reserve the image's proportional space up front from its known dimensions, so the box is
  // already the right shape before the bytes (fetch + decrypt) finish — that's what actually
  // fixes images "pushing the scroll position off": there's nothing left to expand into once
  // the layout doesn't change when the real image lands.
  const style: CSSProperties | undefined =
    width && height ? { aspectRatio: `${width} / ${height}` } : undefined;

  if (!src) {
    return (
      <div className="nu-image-message nu-image-message--loading" data-nu-role="timeline-image" style={style}>
        {!style && (body || 'image')}
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        className="nu-image-message"
        data-nu-role="timeline-image"
        onClick={() => setOpen(true)}
        style={style}
      >
        <img className="nu-image-message__img" src={src} alt={body} />
      </button>
      {open && <Lightbox src={src} alt={body} onClose={() => setOpen(false)} />}
    </>
  );
}
