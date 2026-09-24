import { useState, type FormEvent } from 'react';
import type { Room } from 'matrix-js-sdk';
import { Modal } from '../../components/Modal';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import { addRoomImage, getRoomEmotes, getRoomStickers, removeRoomImage } from '../../matrix/emotes';
import { canSendStateEvent } from '../../matrix/permissions';
import { findParentSpaceId } from '../../matrix/spaceChildren';
import { EmoteImage } from './EmoteImage';
import './EmoteManagerModal.css';

function sanitizeShortcode(raw: string): string {
  return raw
    .trim()
    .replace(/^:|:$/g, '')
    .replace(/[^a-zA-Z0-9_+-]/g, '');
}

/** One list entry tagged with which room it actually lives on — needed once entries can come
 *  from either the channel or its parent Space, so Remove targets the right one. */
type ScopedItem<T> = { item: T; scopeRoom: Room; isServerWide: boolean };

function scopedList<T extends { shortcode: string }>(
  getter: (room: Room) => T[],
  room: Room,
  space: Room | undefined
): ScopedItem<T>[] {
  const channelItems = getter(room);
  const channelCodes = new Set(channelItems.map((i) => i.shortcode));
  const spaceItems = space ? getter(space).filter((i) => !channelCodes.has(i.shortcode)) : [];
  return [
    ...spaceItems.map((item) => ({ item, scopeRoom: space as Room, isServerWide: true })),
    ...channelItems.map((item) => ({ item, scopeRoom: room, isServerWide: false })),
  ];
}

/**
 * Manages both this channel's own image pack and its parent Space's — Discord's mental model is
 * one emoji set for the whole server, not per-channel, so "Whole server" is the default target
 * for anything newly added here (see useRoomEmotes.ts/useRoomStickers.ts for how the two packs
 * get merged for display/autocomplete elsewhere). Per-channel still works and is offered as the
 * narrower alternative, matching whatever a pack set up before this existed already looks like.
 */
export function EmoteManagerModal({ room, onClose }: { room: Room; onClose: () => void }) {
  const mx = useMatrixClient();
  const myUserId = mx.getUserId() ?? '';
  const parentSpaceId = findParentSpaceId(mx, room.roomId);
  const space = parentSpaceId ? mx.getRoom(parentSpaceId) ?? undefined : undefined;
  const canManageSpace = space ? canSendStateEvent(space, myUserId, 'im.ponies.room_emotes') : false;
  const canManageChannel = canSendStateEvent(room, myUserId, 'im.ponies.room_emotes');

  const [scope, setScope] = useState<'space' | 'channel'>(canManageSpace ? 'space' : 'channel');
  const [shortcode, setShortcode] = useState('');
  const [file, setFile] = useState<File>();
  const [asEmote, setAsEmote] = useState(true);
  const [asSticker, setAsSticker] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string>();

  const emotes = scopedList(getRoomEmotes, room, space);
  const stickers = scopedList(getRoomStickers, room, space);
  const allShortcodes = new Set([...emotes.map((e) => e.item.shortcode), ...stickers.map((s) => s.item.shortcode)]);
  const targetRoom = scope === 'space' && space ? space : room;

  const handleSubmit = async (evt: FormEvent) => {
    evt.preventDefault();
    const code = sanitizeShortcode(shortcode);
    if (!code || !file || uploading) return;
    if (!asEmote && !asSticker) {
      setError('Pick at least one of Emote / Sticker.');
      return;
    }
    if (allShortcodes.has(code)) {
      setError(`:${code}: already exists — remove it first to replace it.`);
      return;
    }
    setUploading(true);
    setError(undefined);
    try {
      const { content_uri: mxcUrl } = await mx.uploadContent(file);
      const usage = [...(asEmote ? (['emoticon'] as const) : []), ...(asSticker ? (['sticker'] as const) : [])];
      await addRoomImage(mx, targetRoom, code, mxcUrl, usage);
      setShortcode('');
      setFile(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add image');
    } finally {
      setUploading(false);
    }
  };

  return (
    <Modal title="Manage Emotes & Stickers" onClose={onClose}>
      <div className="nu-emote-manager">
        <form className="nu-modal-form" onSubmit={handleSubmit}>
          {space && (canManageSpace || canManageChannel) && (
            <label className="nu-field">
              Add to
              <select
                className="nu-field__input"
                data-nu-role="emote-manager-scope"
                value={scope}
                onChange={(e) => setScope(e.target.value as 'space' | 'channel')}
              >
                {canManageSpace && <option value="space">Whole server ({space.name})</option>}
                {canManageChannel && <option value="channel">This channel only ({room.name})</option>}
              </select>
            </label>
          )}
          <label className="nu-field">
            Shortcode
            <input
              className="nu-field__input"
              value={shortcode}
              onChange={(e) => setShortcode(e.target.value)}
              placeholder="pogchamp"
              required
            />
          </label>
          <label className="nu-button nu-button--secondary nu-file-picker">
            {file ? file.name : 'Choose image (GIF/WebP animate)'}
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setFile(e.target.files?.[0])}
            />
          </label>
          <div className="nu-field__checkbox-row">
            <label>
              <input type="checkbox" checked={asEmote} onChange={(e) => setAsEmote(e.target.checked)} /> Emote (inline
              :shortcode:)
            </label>
            <label>
              <input type="checkbox" checked={asSticker} onChange={(e) => setAsSticker(e.target.checked)} /> Sticker
              (sent on its own)
            </label>
          </div>
          {error && <p className="nu-field__error">{error}</p>}
          <div className="nu-form-actions">
            <button type="submit" className="nu-button nu-button--primary" disabled={!shortcode.trim() || !file || uploading}>
              {uploading ? 'Adding…' : 'Add'}
            </button>
          </div>
        </form>
        {emotes.length > 0 && (
          <>
            <p className="nu-field__hint">Emotes</p>
            <div className="nu-emote-manager__list" data-nu-role="emote-manager-list">
              {emotes.map(({ item: emote, scopeRoom, isServerWide }) => (
                <div className="nu-emote-manager__item" key={`emote-${emote.shortcode}`}>
                  <EmoteImage shortcode={emote.shortcode} mxcUrl={emote.mxcUrl} />
                  <span className="nu-emote-manager__item-code">
                    :{emote.shortcode}: {isServerWide && <span className="nu-emote-manager__item-scope">server</span>}
                  </span>
                  <button
                    type="button"
                    className="nu-emote-manager__remove"
                    onClick={() => removeRoomImage(mx, scopeRoom, emote.shortcode)}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
        {stickers.length > 0 && (
          <>
            <p className="nu-field__hint">Stickers</p>
            <div className="nu-emote-manager__list" data-nu-role="sticker-manager-list">
              {stickers.map(({ item: sticker, scopeRoom, isServerWide }) => (
                <div className="nu-emote-manager__item" key={`sticker-${sticker.shortcode}`}>
                  <EmoteImage shortcode={sticker.shortcode} mxcUrl={sticker.mxcUrl} />
                  <span className="nu-emote-manager__item-code">
                    :{sticker.shortcode}: {isServerWide && <span className="nu-emote-manager__item-scope">server</span>}
                  </span>
                  <button
                    type="button"
                    className="nu-emote-manager__remove"
                    onClick={() => removeRoomImage(mx, scopeRoom, sticker.shortcode)}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
