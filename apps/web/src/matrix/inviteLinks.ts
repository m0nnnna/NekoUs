/**
 * Builds a Purrlor deep link that, when opened, joins the given room/Space and navigates to it —
 * see hooks/useJoinFromInviteLink.ts for the other half of this. Uses a `?invite=` query param,
 * the same convention useOpenRoomFromNotification.ts already uses for `?openRoom=` (background
 * push opening a fresh tab), rather than a dedicated URL path — needs no server-side routing
 * changes, since any path serving this SPA already carries query params through to the same
 * index.html.
 *
 * Also carries a `?via=` server hint, the same thing matrix.to links embed for exactly the same
 * reason: confirmed live that a client with no prior knowledge of the room (a fresh login, no
 * local sync history mentioning it yet) gets `M_UNKNOWN "Can't join remote room because no
 * servers that are in the room have been provided"` from a bare `/join` with no via — the room
 * ID's own `:server` suffix is NOT reliably usable as a join hint on modern (v9+) room versions,
 * where it's opaque rather than authoritative. `viaServer` should be a server the room is
 * actually known to reside on right now — the generating (already-joined) client's own homeserver
 * is always a valid choice.
 *
 * The room ID itself is the only thing this link encodes — there's no separate secret/expiring
 * token. Matrix has no concept of an individually-revocable invite code for a plain public room;
 * "revoking" this link means turning the Space's "Public join link" toggle back off
 * (SpaceInviteLinkSettings.tsx), which invalidates every copy of it at once, not just one.
 */
export function buildInviteLink(roomId: string, viaServer: string): string {
  const params = new URLSearchParams({ invite: roomId, via: viaServer });
  return `${window.location.origin}/?${params.toString()}`;
}
