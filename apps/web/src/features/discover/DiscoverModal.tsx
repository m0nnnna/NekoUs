import { useEffect, useState, type FormEvent } from 'react';
import type { IPublicRoomsChunkRoom } from 'matrix-js-sdk';
import { Modal } from '../../components/Modal';
import { Avatar } from '../../components/Avatar';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import { browsePublicRooms, isSpaceEntry, joinPublicRoom } from '../../matrix/directory';
import './DiscoverModal.css';

function DirectoryRow({
  entry,
  busy,
  onJoin,
}: {
  entry: IPublicRoomsChunkRoom;
  busy: boolean;
  onJoin: () => void;
}) {
  const name = entry.name || entry.canonical_alias || entry.room_id;
  return (
    <div className="nu-discover__row" data-nu-role="discover-row">
      <Avatar name={name} mxcUrl={entry.avatar_url ?? null} size={40} />
      <div className="nu-discover__row-info">
        <div className="nu-discover__row-name">
          {name}
          {isSpaceEntry(entry) && <span className="nu-discover__row-badge">Space</span>}
        </div>
        {entry.topic && <div className="nu-discover__row-topic">{entry.topic}</div>}
        <div className="nu-discover__row-meta">
          {entry.num_joined_members} member{entry.num_joined_members === 1 ? '' : 's'}
          {entry.canonical_alias && ` · ${entry.canonical_alias}`}
        </div>
      </div>
      <button
        type="button"
        className="nu-button nu-button--secondary"
        data-nu-role="discover-join"
        disabled={busy}
        onClick={onJoin}
      >
        {busy ? 'Joining…' : 'Join'}
      </button>
    </div>
  );
}

/**
 * Browses this account's own homeserver's public room directory (`GET /publicRooms`) — public
 * Spaces (Discord "servers") and plain public rooms mixed together, badged by type. The one
 * discovery mechanism this app previously had none of: joining anything required already
 * knowing a room ID/alias or getting invited. Joining navigates there the same way every other
 * "create/join something" flow in this app does (CreateSpaceModal, StartDmModal): a Space
 * selects into the server rail, a plain room lands in the spaceless Direct-Messages-style list
 * (see useSpacelessRooms — membership alone is what puts it there, no special-casing needed here).
 */
export function DiscoverModal({
  onClose,
  onJoinedSpace,
  onJoinedRoom,
}: {
  onClose: () => void;
  onJoinedSpace: (roomId: string) => void;
  onJoinedRoom: (roomId: string) => void;
}) {
  const mx = useMatrixClient();
  const [term, setTerm] = useState('');
  const [entries, setEntries] = useState<IPublicRoomsChunkRoom[]>([]);
  const [nextBatch, setNextBatch] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string>();
  const [joiningRoomId, setJoiningRoomId] = useState<string>();

  const runSearch = async (searchTerm: string) => {
    setLoading(true);
    setError(undefined);
    try {
      const response = await browsePublicRooms(mx, { searchTerm });
      setEntries(response.chunk);
      setNextBatch(response.next_batch);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the room directory');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void runSearch('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearchSubmit = (evt: FormEvent) => {
    evt.preventDefault();
    void runSearch(term);
  };

  const handleLoadMore = async () => {
    if (!nextBatch || loadingMore) return;
    setLoadingMore(true);
    try {
      const response = await browsePublicRooms(mx, { searchTerm: term, since: nextBatch });
      setEntries((prev) => [...prev, ...response.chunk]);
      setNextBatch(response.next_batch);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load more');
    } finally {
      setLoadingMore(false);
    }
  };

  const handleJoin = async (entry: IPublicRoomsChunkRoom) => {
    setJoiningRoomId(entry.room_id);
    setError(undefined);
    try {
      const roomId = await joinPublicRoom(mx, entry.canonical_alias || entry.room_id);
      onClose();
      if (isSpaceEntry(entry)) onJoinedSpace(roomId);
      else onJoinedRoom(roomId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join');
      setJoiningRoomId(undefined);
    }
  };

  return (
    <Modal title="Discover Public Servers & Channels" onClose={onClose} wide>
      <form className="nu-discover__search" onSubmit={handleSearchSubmit}>
        <input
          className="nu-field__input"
          data-nu-role="discover-search-input"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search the public directory…"
          autoFocus
        />
        <button type="submit" className="nu-button nu-button--secondary" disabled={loading}>
          Search
        </button>
      </form>
      {error && (
        <p className="nu-field__error" data-nu-role="discover-error">
          {error}
        </p>
      )}
      {loading ? (
        <p className="nu-discover__status">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="nu-discover__status">Nothing found in this homeserver's public directory.</p>
      ) : (
        <div className="nu-discover__list" data-nu-role="discover-list">
          {entries.map((entry) => (
            <DirectoryRow
              key={entry.room_id}
              entry={entry}
              busy={joiningRoomId === entry.room_id}
              onJoin={() => handleJoin(entry)}
            />
          ))}
        </div>
      )}
      {!loading && nextBatch && (
        <div className="nu-form-actions">
          <button type="button" className="nu-button nu-button--secondary" disabled={loadingMore} onClick={handleLoadMore}>
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </Modal>
  );
}
