import { useEffect, useState } from 'react';
import { EventType, RoomStateEvent, type Room } from 'matrix-js-sdk';
import { Icon } from '../../components/Icon';
import './TopicBanner.css';

const DISMISSED_KEY = 'nekous_dismissed_topic_banners';

function readDismissed(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function dismiss(roomId: string, topic: string): void {
  const dismissed = readDismissed();
  dismissed[roomId] = topic;
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(dismissed));
  } catch {
    // storage full/unavailable — dismissal just won't stick across reloads, not worth failing over
  }
}

function currentTopic(room: Room): string | undefined {
  return room.currentState.getStateEvents(EventType.RoomTopic, '')?.getContent<{ topic?: string }>().topic;
}

/**
 * A persistent announcement strip for the channel's topic — dismissible, but reappears if the
 * topic actually changes to something new (tracked per-room by the exact topic text, not just
 * "dismissed forever"), which is the Matrix-native analogue of a "news banner": there's no
 * separate banner-image concept in the spec, but a room's topic already serves this purpose.
 */
export function TopicBanner({ room }: { room: Room }) {
  const [topic, setTopic] = useState(() => currentTopic(room));
  const [dismissedTopic, setDismissedTopic] = useState(() => readDismissed()[room.roomId]);

  useEffect(() => {
    setTopic(currentTopic(room));
    setDismissedTopic(readDismissed()[room.roomId]);

    const onStateEvent = () => setTopic(currentTopic(room));
    room.on(RoomStateEvent.Events, onStateEvent);
    return () => {
      room.removeListener(RoomStateEvent.Events, onStateEvent);
    };
  }, [room]);

  if (!topic || topic === dismissedTopic) return null;

  return (
    <div className="nu-topic-banner" data-nu-role="topic-banner">
      <Icon name="bell" size={14} className="nu-topic-banner__icon" />
      <span className="nu-topic-banner__text">{topic}</span>
      <button
        type="button"
        className="nu-topic-banner__dismiss"
        data-nu-role="topic-banner-dismiss"
        aria-label="Dismiss"
        onClick={() => {
          dismiss(room.roomId, topic);
          setDismissedTopic(topic);
        }}
      >
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}
