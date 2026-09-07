import { useEffect, useState } from 'react';
import type { MatrixEvent } from 'matrix-js-sdk';
import { Modal } from '../../components/Modal';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import { fetchEditHistory, type EditHistoryEntry } from '../../matrix/edits';
import './EditHistoryModal.css';

export function EditHistoryModal({
  roomId,
  event,
  onClose,
}: {
  roomId: string;
  event: MatrixEvent;
  onClose: () => void;
}) {
  const mx = useMatrixClient();
  const [entries, setEntries] = useState<EditHistoryEntry[] | null>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    fetchEditHistory(mx, roomId, event)
      .then((result) => {
        if (!cancelled) setEntries(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load edit history');
      });
    return () => {
      cancelled = true;
    };
  }, [mx, roomId, event]);

  return (
    <Modal title="Edit History" onClose={onClose}>
      {error && (
        <p className="nu-field__error" data-nu-role="edit-history-error">
          {error}
        </p>
      )}
      {!entries && !error && <p className="nu-field__hint">Loading…</p>}
      {entries && (
        <div className="nu-edit-history__list" data-nu-role="edit-history-list">
          {entries.map((entry, index) => (
            <div className="nu-edit-history__item" data-nu-role="edit-history-item" key={index}>
              <div className="nu-edit-history__item-meta">
                <span className="nu-edit-history__item-label">{entry.isOriginal ? 'Original' : `Edit ${index}`}</span>
                <span className="nu-edit-history__item-time">{new Date(entry.ts).toLocaleString()}</span>
              </div>
              <div className="nu-edit-history__item-body">{entry.body}</div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
