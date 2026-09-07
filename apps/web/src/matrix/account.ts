import { MatrixEvent, UserEvent, type MatrixClient } from 'matrix-js-sdk';
import { isAnimatableImageType, setAvatarAnimated, updateExtendedProfile } from './extendedProfile';

export async function updateAccountAvatar(mx: MatrixClient, file: File): Promise<void> {
  const { content_uri: mxcUrl } = await mx.uploadContent(file);
  await mx.setAvatarUrl(mxcUrl);
  // Best-effort: a server without MSC4133 (see extendedProfile.ts) just means avatars from this
  // account never animate for anyone, which is a worse-but-not-broken fallback, not a failure
  // that should stop the avatar itself from being set.
  await setAvatarAnimated(mx, isAnimatableImageType(file.type)).catch(() => {});
}

export async function updateAccountBanner(mx: MatrixClient, file: File): Promise<void> {
  const { content_uri: mxcUrl } = await mx.uploadContent(file);
  await updateExtendedProfile(mx, { bannerUrl: mxcUrl });
}

export async function removeAccountBanner(mx: MatrixClient): Promise<void> {
  await updateExtendedProfile(mx, { bannerUrl: null });
}

export async function updateDisplayName(mx: MatrixClient, name: string): Promise<void> {
  await mx.setDisplayName(name);
}

export type UserPresence = 'online' | 'unavailable' | 'offline';

/**
 * Sets the signed-in user's own presence and/or custom status message (MSC-less, plain
 * `/presence/{userId}/status` — every homeserver that federates presence at all supports this).
 * `statusMsg` follows Matrix's own semantics: omitting it entirely leaves whatever was set
 * before untouched, while passing `''` explicitly clears it — so callers that want to clear a
 * status must pass `''`, not leave the field out.
 */
export async function updateOwnPresence(mx: MatrixClient, presence: UserPresence, statusMsg?: string): Promise<void> {
  await mx.setPresence({ presence, ...(statusMsg !== undefined && { status_msg: statusMsg }) });

  // setPresence() only performs the write — matrix-js-sdk never updates the local `User` cache
  // from its own response, and a homeserver won't reliably echo your own presence change back to
  // you over /sync promptly (if at all), so without this the rest of the UI (UserPanel, the
  // Appearance-adjacent status picker) would keep showing the stale presence until some unrelated
  // sync happened to carry it. Read back what the server actually stored and feed it into the
  // local model the same way a real incoming m.presence event would, so it updates immediately.
  const userId = mx.getUserId();
  if (!userId) return;
  const stored = await mx.getPresence(userId);
  const user = mx.getUser(userId);
  if (!user) return;
  // Deliberately not User.setPresenceEvent(): it only fires UserEvent.Presence when the
  // presence *enum* itself changed, so a status-message-only edit (enum unchanged) would patch
  // presenceStatusMsg locally but never notify useOwnPresence's listener, leaving the UI stale.
  // Setting the fields directly and always emitting covers both cases.
  user.presence = stored.presence;
  user.presenceStatusMsg = stored.status_msg;
  user.emit(UserEvent.Presence, new MatrixEvent({ type: 'm.presence', sender: userId, content: stored }), user);
}
