import { useEffect, useRef } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { RoomEvent, type MatrixEvent, type Room } from 'matrix-js-sdk';
import { selectedRoomIdAtom, selectedSpaceIdAtom } from '../../app/state/selection';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import { isPostActivity } from '../../matrix/postNotifications';
import { findParentSpaceId } from '../../matrix/spaceChildren';
import { useOpenFeedRoom } from '../feed/useOpenFeedRoom';

/**
 * Fires a browser Notification for any live `m.room.message` that the user's own push rules say
 * should notify (`mx.getPushActionsForEvent` — the exact same evaluation the homeserver used to
 * compute the unread/highlight counts behind the badges in useUnreadCounts.ts, so "gets a
 * notification" and "shows a highlight badge" always agree), except when that room is already
 * open in a focused window — no point interrupting for what's already on screen. Likes and
 * comments on your posts come through the same way: they only notify at all because of the rules
 * matrix/postNotifications.ts gives you for your own feeds, and clicking one opens the posts view,
 * since a feed room isn't a channel. Headless:
 * mounted once in AppShell, renders nothing, just runs for the app's lifetime.
 */
export function DesktopNotifications() {
  const mx = useMatrixClient();
  const selectedRoomId = useAtomValue(selectedRoomIdAtom);
  const setSelectedRoomId = useSetAtom(selectedRoomIdAtom);
  const setSelectedSpaceId = useSetAtom(selectedSpaceIdAtom);
  const openFeedRoom = useOpenFeedRoom();
  const openFeedRoomRef = useRef(openFeedRoom);
  openFeedRoomRef.current = openFeedRoom;
  const selectedRoomIdRef = useRef(selectedRoomId);
  selectedRoomIdRef.current = selectedRoomId;

  useEffect(() => {
    const onTimeline = (
      event: MatrixEvent,
      room: Room | undefined,
      toStartOfTimeline: boolean | undefined,
      removed: boolean,
      data: { liveEvent?: boolean }
    ) => {
      if (toStartOfTimeline || removed || !room || !data.liveEvent) return;
      const postActivity = isPostActivity(event.getType());
      if (event.getType() !== 'm.room.message' && !postActivity) return;
      if (event.getSender() === mx.getUserId()) return;
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
      if (selectedRoomIdRef.current === room.roomId && document.hasFocus()) return;

      const actions = mx.getPushActionsForEvent(event);
      if (!actions?.notify) return;

      const senderName = event.sender?.name ?? event.getSender() ?? 'Someone';
      const content = event.getContent();

      if (postActivity) {
        const text = String(content.body ?? '').slice(0, 200);
        // A reply to one of your comments (anywhere — it notifies through m.mentions), versus a
        // comment on your own post (through your feed's own rule).
        const repliedTo = (content['xyz.nekous.reply_to'] as { sender?: string } | undefined)?.sender;
        const verb = repliedTo === mx.getUserId() ? 'Replied to your comment' : 'Commented on your post';
        const notification = new Notification(senderName, {
          body: postActivity === 'like' ? 'Liked your post' : text ? `${verb}: ${text}` : verb,
          tag: `${room.roomId}:${postActivity}`,
        });
        notification.onclick = () => {
          window.focus();
          openFeedRoomRef.current(room);
          notification.close();
        };
        return;
      }

      const title = room.name && room.name !== senderName ? `${senderName} (${room.name})` : senderName;
      const body =
        content.msgtype === 'm.image'
          ? '📷 Image'
          : content.msgtype === 'm.video'
            ? '📹 Video'
            : content.msgtype === 'm.audio'
              ? '🔊 Audio'
              : content.msgtype === 'm.file'
                ? `📄 ${String(content.body ?? 'File')}`
                : String(content.body ?? '').slice(0, 200);

      const notification = new Notification(title, { body, tag: room.roomId });
      notification.onclick = () => {
        window.focus();
        setSelectedSpaceId(findParentSpaceId(mx, room.roomId));
        setSelectedRoomId(room.roomId);
        notification.close();
      };
    };

    mx.on(RoomEvent.Timeline, onTimeline);
    return () => {
      mx.removeListener(RoomEvent.Timeline, onTimeline);
    };
  }, [mx, setSelectedRoomId, setSelectedSpaceId]);

  return null;
}
