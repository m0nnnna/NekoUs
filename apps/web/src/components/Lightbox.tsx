import { useEffect } from 'react';
import './Lightbox.css';

/** Full-screen in-app image viewer — click the backdrop, the close button, or press Escape. */
export function Lightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (evt: KeyboardEvent) => {
      if (evt.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="nu-lightbox" data-nu-role="lightbox" onClick={onClose}>
      <button
        type="button"
        className="nu-lightbox__close"
        data-nu-role="lightbox-close"
        onClick={onClose}
        aria-label="Close"
      >
        ×
      </button>
      <img className="nu-lightbox__image" src={src} alt={alt} onClick={(evt) => evt.stopPropagation()} />
    </div>
  );
}
