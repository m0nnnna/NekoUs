import { useEffect, useRef, useState } from 'react';
import { ConnectionQuality, Track, type Participant, type RemoteParticipant } from 'livekit-client';
import {
  isTrackReference,
  useConnectionQualityIndicator,
  useLocalParticipant,
  useParticipants,
  useRoomContext,
  useSpeakingParticipants,
  useTracks,
  VideoTrack,
  type TrackReference,
} from '@livekit/components-react';
import { useSetAtom } from 'jotai';
import type { Room as MatrixRoom } from 'matrix-js-sdk';
import { activeVoiceChannelIdAtom } from '../../app/state/selection';
import { Avatar } from '../../components/Avatar';
import { useSpaceVoiceServer } from '../../matrix/hooks/useSpaceVoiceServer';
import { getParentSpace } from '../../matrix/voice';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import { useVoiceCall } from './voiceCallContext';
import { useParticipantSounds } from './useParticipantSounds';
import { usePushToTalk } from './usePushToTalk';
import { SCREEN_SHARE_AUDIO_OPTIONS, setScreenShareJitterBufferTarget } from './voiceChannelRoomOptions';
import { useScreenSharePopout } from './useScreenSharePopout';
import { useWatchTogether } from './useWatchTogether';
import { WatchTogetherModal } from './WatchTogetherModal';
import { WatchTogetherPlayer } from './WatchTogetherPlayer';
import '@livekit/components-styles';
import './VoiceChannelPanel.css';

/** LiveKit identities are Matrix user IDs (see services/token-server) — resolve back to a room member for avatar/display name. */
function participantDisplayName(room: MatrixRoom, p: Participant): string {
  return room.getMember(p.identity)?.name || p.name || p.identity;
}

function participantAvatarUrl(room: MatrixRoom, p: Participant): string | null {
  return room.getMember(p.identity)?.getMxcAvatarUrl() ?? null;
}

function connectionQualityBars(quality: ConnectionQuality): number {
  if (quality === ConnectionQuality.Excellent) return 3;
  if (quality === ConnectionQuality.Good) return 2;
  if (quality === ConnectionQuality.Poor) return 1;
  return 0; // Lost/Unknown
}

/** One participant tile — its own component (not inlined in a .map()) because
 *  useConnectionQualityIndicator is a hook and hooks can't run inside a loop callback; this is
 *  the per-item component React's rules require for that. Also owns the local-only "volume for
 *  me" slider (LiveKit's RemoteParticipant.setVolume — client-side only, doesn't affect what
 *  anyone else hears) and the connection-quality bars, both README-flagged as deferred. */
function ParticipantRow({
  room,
  participant,
  speaking,
  cameraTrack,
}: {
  room: MatrixRoom;
  participant: Participant;
  speaking: boolean;
  cameraTrack?: TrackReference;
}) {
  const { quality } = useConnectionQualityIndicator({ participant });
  const bars = connectionQualityBars(quality);
  const [volume, setVolume] = useState(1);
  const name = participantDisplayName(room, participant);

  const handleVolumeChange = (value: number) => {
    setVolume(value);
    (participant as RemoteParticipant).setVolume(value);
  };

  if (cameraTrack) {
    return (
      <li
        className={
          speaking
            ? 'nu-voice-participant nu-voice-participant--video nu-voice-participant--speaking'
            : 'nu-voice-participant nu-voice-participant--video'
        }
      >
        <div className="nu-voice-participant__video-tile" data-nu-role="voice-participant-video">
          <VideoTrack trackRef={cameraTrack} />
          <span className="nu-voice-participant__video-name">
            {name}
            {!participant.isMicrophoneEnabled && <span aria-label="Muted" title="Muted">🔇</span>}
          </span>
        </div>
      </li>
    );
  }

  return (
    <li className={speaking ? 'nu-voice-participant nu-voice-participant--speaking' : 'nu-voice-participant'}>
      <span className="nu-voice-participant__avatar">
        {speaking && <span className="nu-voice-participant__ring" aria-hidden="true" />}
        <Avatar name={name} mxcUrl={participantAvatarUrl(room, participant)} size={48} />
      </span>
      <span className="nu-voice-participant__name">{name}</span>
      <span
        className="nu-voice-participant__quality"
        data-nu-role="voice-participant-quality"
        title={`Connection: ${quality}`}
      >
        {[1, 2, 3].map((bar) => (
          <span
            key={bar}
            className={
              bar <= bars ? 'nu-voice-participant__quality-bar nu-voice-participant__quality-bar--filled' : 'nu-voice-participant__quality-bar'
            }
          />
        ))}
      </span>
      {!participant.isMicrophoneEnabled && (
        <span className="nu-voice-participant__muted" aria-label="Muted" title="Muted">
          🔇
        </span>
      )}
      {participant.attributes.deafened === 'true' && (
        <span className="nu-voice-participant__muted" aria-label="Deafened" title="Deafened">
          🔕
        </span>
      )}
      {!participant.isLocal && (
        <input
          type="range"
          className="nu-voice-participant__volume"
          data-nu-role="voice-participant-volume"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          title="Volume for me"
          onChange={(e) => handleVolumeChange(Number(e.target.value))}
        />
      )}
    </li>
  );
}

/**
 * Voice channel main pane. The call itself is owned by VoiceCallSession (mounted once at the
 * AppShell level, so it survives navigating away to a text channel) — this component only
 * decides what to show for *this particular room*: the live call UI if it's the one you're
 * actually connected to, a join prompt if it's a different (or no) voice channel, or a
 * connecting/error status in between.
 */
export function VoiceChannelPanel({ room }: { room: MatrixRoom }) {
  const mx = useMatrixClient();
  const space = getParentSpace(mx, room);
  const voiceServer = useSpaceVoiceServer(space);
  const setActiveVoiceChannelId = useSetAtom(activeVoiceChannelIdAtom);
  const call = useVoiceCall();
  const activeCall = call && call.roomId === room.roomId ? call : null;

  // A call that failed is still the *active* one, so the way back in is a real retry of the
  // token fetch — not re-selecting a channel that's already selected, which set the atom to the
  // value it already held and so did nothing at all.
  if (activeCall?.state.status === 'error') {
    return (
      <div className="nu-voice-panel nu-voice-panel--join" data-nu-role="voice-panel">
        <p className="nu-voice-panel__error" data-nu-role="voice-error">
          {activeCall.state.message}
        </p>
        <div className="nu-voice-panel__actions">
          <button type="button" className="nu-button nu-button--primary" onClick={activeCall.retry}>
            Try again
          </button>
          <button type="button" className="nu-button nu-button--secondary" onClick={activeCall.leave}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (!activeCall || activeCall.state.status === 'idle') {
    return (
      <div className="nu-voice-panel nu-voice-panel--join" data-nu-role="voice-panel">
        <button
          type="button"
          className="nu-button nu-button--primary"
          onClick={() => setActiveVoiceChannelId(room.roomId)}
          disabled={!voiceServer}
        >
          Join voice
        </button>
        {!voiceServer && (
          <p className="nu-voice-panel__hint">
            No voice server is configured for this server yet — a server admin can set one under
            server settings.
          </p>
        )}
      </div>
    );
  }

  if (activeCall.state.status === 'connecting' || activeCall.state.status === 'preparing') {
    return (
      <div className="nu-voice-panel nu-voice-panel--join" data-nu-role="voice-panel">
        <p className="nu-voice-panel__hint" data-nu-role="voice-status">
          {activeCall.state.status === 'preparing' ? activeCall.state.message : 'Connecting…'}
        </p>
        <button type="button" className="nu-button nu-button--secondary" onClick={activeCall.leave}>
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="nu-voice-panel" data-nu-role="voice-panel">
      <VoiceCallBody room={room} onLeave={activeCall.leave} />
    </div>
  );
}

function VoiceCallBody({ room, onLeave }: { room: MatrixRoom; onLeave: () => void }) {
  useParticipantSounds();
  const participants = useParticipants();
  const speaking = useSpeakingParticipants();
  const speakingIds = new Set(speaking.map((p) => p.identity));
  const { localParticipant, isMicrophoneEnabled, isScreenShareEnabled, isCameraEnabled } = useLocalParticipant();
  const pushToTalk = usePushToTalk(localParticipant);
  const screenShareTracks = useTracks([Track.Source.ScreenShare]);
  const activeScreenShare = screenShareTracks[0];
  const cameraTracks = useTracks([Track.Source.Camera]).filter(isTrackReference);
  const cameraTrackByIdentity = new Map(cameraTracks.map((t) => [t.participant.identity, t]));
  const call = useVoiceCall();
  const deafened = call?.deafened ?? false;
  const setDeafened = call?.setDeafened ?? (() => {});
  const livekitRoom = useRoomContext();
  const keyframeWorkerRef = useRef<Worker>();
  const screenSharePopout = useScreenSharePopout(activeScreenShare?.publication.track?.mediaStreamTrack);
  const watchTogether = useWatchTogether(livekitRoom, localParticipant.identity);
  const [showWatchTogetherModal, setShowWatchTogetherModal] = useState(false);

  // Viewer-side only: ask the remote sharer for keyframes periodically and give the decoder a
  // slightly larger jitter buffer, trading a little latency for fewer dropped/stuttered frames.
  useEffect(() => {
    if (!activeScreenShare || activeScreenShare.participant.isLocal) return;
    const mediaStreamTrack = activeScreenShare.publication.track?.mediaStreamTrack;
    if (!mediaStreamTrack) return;
    if (!keyframeWorkerRef.current) {
      keyframeWorkerRef.current = new Worker(new URL('./screenShareKeyframeRequest.worker.ts', import.meta.url), {
        type: 'module',
      });
    }
    setScreenShareJitterBufferTarget(livekitRoom, mediaStreamTrack, {
      keyframeRequestWorker: keyframeWorkerRef.current,
    });
  }, [activeScreenShare, livekitRoom]);

  const toggleDeafen = () => {
    const next = !deafened;
    setDeafened(next);
    // LiveKit has no built-in "deafened" concept — broadcast it ourselves via participant
    // attributes so other participants (and the channel-list occupancy view) can show it too.
    localParticipant.setAttributes({ deafened: String(next) });
    if (next && isMicrophoneEnabled) {
      localParticipant.setMicrophoneEnabled(false);
    }
  };

  const toggleMic = () => {
    if (deafened) setDeafened(false);
    localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
  };

  return (
    <>
      {activeScreenShare ? (
        <div className="nu-voice-panel__screen-share" data-nu-role="voice-screen-share">
          {screenSharePopout.isOpen ? (
            <p className="nu-voice-panel__screen-share-popped-out">
              Popped out into its own window.
            </p>
          ) : (
            <VideoTrack trackRef={activeScreenShare} />
          )}
          <button
            type="button"
            className="nu-voice-panel__screen-share-popout"
            data-nu-role="voice-screen-share-popout"
            title={screenSharePopout.isOpen ? 'Bring back' : 'Pop out'}
            onClick={screenSharePopout.toggle}
          >
            {screenSharePopout.isOpen ? '⇱' : '⇲'}
          </button>
        </div>
      ) : (
        // Watch Together only ever shows up here when nobody's actually sharing their screen —
        // screen share always wins the slot if both happen to be active at once, but the watch
        // session itself keeps running in the background (see useWatchTogether.ts) and reappears
        // the moment the screen share stops, rather than being force-stopped by it.
        watchTogether.state && <WatchTogetherPlayer state={watchTogether.state} controls={watchTogether} />
      )}
      <ul className="nu-voice-participants" data-nu-role="voice-participants">
        {participants.map((p) => (
          <ParticipantRow
            key={p.identity}
            room={room}
            participant={p}
            speaking={speakingIds.has(p.identity)}
            cameraTrack={cameraTrackByIdentity.get(p.identity)}
          />
        ))}
      </ul>
      <div className="nu-voice-controls" data-nu-role="voice-controls">
        <button
          type="button"
          className={
            isMicrophoneEnabled
              ? 'nu-voice-control-button'
              : 'nu-voice-control-button nu-voice-control-button--active'
          }
          onClick={toggleMic}
          disabled={pushToTalk.enabled}
          title={
            pushToTalk.enabled
              ? `Push-to-talk is on — hold ${pushToTalk.keyLabel} to talk`
              : isMicrophoneEnabled
                ? 'Mute'
                : 'Unmute'
          }
        >
          {isMicrophoneEnabled ? '🎤' : '🔇'}
        </button>
        <button
          type="button"
          className={
            pushToTalk.enabled ? 'nu-voice-control-button nu-voice-control-button--active' : 'nu-voice-control-button'
          }
          data-nu-role="voice-ptt-toggle"
          onClick={() => pushToTalk.setEnabled(!pushToTalk.enabled)}
          title={
            pushToTalk.enabled
              ? `Push-to-talk on (hold ${pushToTalk.keyLabel}) — click to switch to open mic`
              : 'Switch to push-to-talk'
          }
        >
          🎙️
        </button>
        {pushToTalk.enabled && (
          <button
            type="button"
            className={
              pushToTalk.rebinding
                ? 'nu-voice-control-button nu-voice-control-button--key nu-voice-control-button--rebinding'
                : 'nu-voice-control-button nu-voice-control-button--key'
            }
            data-nu-role="voice-ptt-rebind"
            onClick={() => (pushToTalk.rebinding ? pushToTalk.cancelRebind() : pushToTalk.startRebind())}
            title={
              pushToTalk.rebinding
                ? 'Press the key you want to hold to talk (Escape to cancel)'
                : `Push-to-talk key: ${pushToTalk.keyLabel} — click to change`
            }
          >
            {pushToTalk.rebinding ? 'Press a key…' : pushToTalk.keyLabel}
          </button>
        )}
        <button
          type="button"
          className={deafened ? 'nu-voice-control-button nu-voice-control-button--active' : 'nu-voice-control-button'}
          onClick={toggleDeafen}
          title={deafened ? 'Undeafen' : 'Deafen'}
        >
          {deafened ? '🔕' : '🔊'}
        </button>
        <button
          type="button"
          className={
            isCameraEnabled ? 'nu-voice-control-button nu-voice-control-button--active' : 'nu-voice-control-button'
          }
          onClick={() => localParticipant.setCameraEnabled(!isCameraEnabled)}
          title={isCameraEnabled ? 'Turn off camera' : 'Turn on camera'}
        >
          {isCameraEnabled ? '🎥' : '📷'}
        </button>
        <button
          type="button"
          className={
            isScreenShareEnabled
              ? 'nu-voice-control-button nu-voice-control-button--active'
              : 'nu-voice-control-button'
          }
          onClick={() =>
            localParticipant.setScreenShareEnabled(!isScreenShareEnabled, { audio: SCREEN_SHARE_AUDIO_OPTIONS })
          }
          title={isScreenShareEnabled ? 'Stop sharing' : 'Share screen (browser will offer a "Share audio" option)'}
        >
          🖥️
        </button>
        <button
          type="button"
          className={
            watchTogether.state
              ? 'nu-voice-control-button nu-voice-control-button--active'
              : 'nu-voice-control-button'
          }
          data-nu-role="voice-watch-together-toggle"
          onClick={() => setShowWatchTogetherModal(true)}
          title={watchTogether.state ? 'Change what you\'re watching together' : 'Watch a video together'}
        >
          📺
        </button>
        <button
          type="button"
          className="nu-voice-control-button nu-voice-control-button--leave"
          onClick={onLeave}
          title="Leave"
        >
          📞
        </button>
      </div>
      {showWatchTogetherModal && (
        <WatchTogetherModal
          onClose={() => setShowWatchTogetherModal(false)}
          onStart={(url) => watchTogether.start(url)}
        />
      )}
    </>
  );
}
