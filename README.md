# NekoUs

A from-scratch, Discord-shaped frontend for Matrix — Spaces as servers, rooms as channels,
voice channels backed by per-Space LiveKit servers with Matrix-membership-gated auth. Replaces
`cinny-voice`/NekoChat's frontend entirely while keeping Matrix (Synapse) as the whole backend.
`cinny-voice` stays untouched as reference/fallback until this reaches parity.

See `docs/theming.md` for the CSS theming contract (more docs land as later phases start).

## Status

Phase 1: real Spaces/rooms/messaging. Server rail and channel list are wired to joined Matrix
Spaces and their child rooms; the pinned Direct Messages section (server rail's Home icon)
covers both 1:1 DMs and Matrix's plain multi-person group chats — any room not organized under
a Space; the main pane has its own contained scroll (not the whole page) with a live timeline,
inline images (`m.image`, handling both plain and E2EE-encrypted attachments), and
backward-pagination on scroll-to-top; the member list shows joined room members. Real avatars
render throughout (server rail, channel list, timeline, member list) via
`src/components/Avatar.tsx`, with authenticated-media homeservers (MSC3916/spec v1.11+)
supported transparently (`src/matrix/mediaAuth.ts`). A recovery-key prompt appears when a new
session can't yet decrypt history, using Matrix's Secure Secret Storage/backup mechanism
(`src/matrix/recovery.ts`, supports both the standard recovery key and a custom recovery
passphrase) — the same prompt also offers interactive SAS (emoji) device verification as an
alternative ("Or verify with another device instead"), via `src/matrix/verification.ts` and
`src/features/security/VerificationSasModal.tsx`; an already-trusted device sees the incoming
request through `IncomingVerificationListener.tsx`, mounted app-wide. The same emoji-SAS flow
also covers verifying *another user's* identity, not just your own devices — a "Verify" button
on their profile popover (`UserProfileModal.tsx`, next to Message/Block) starts it over a DM,
showing a ✅ badge once their cross-signing identity is verified. QR-code verification isn't
offered either way — both flows are emoji SAS only. Built against the real `matrix-js-sdk`
Rust-crypto verification API and typechecked, but not exercised end-to-end against two real
devices/accounts in this pass (the available test account had no cross-signing set up, and a
second live session wasn't available) — worth a real two-device/two-account smoke test before
relying on it. Spaces and channels can be created and managed: the server rail's "+" creates a Space, the
channel list header's "+" creates a channel inside the selected Space, and a permission-gated
gear icon opens Space Settings (rename, topic, avatar, and a Members tab for promoting/
demoting Admin/Moderator/Member roles, inviting by Matrix ID, and kicking/banning/unbanning —
all gated by real power-level checks, not just role labels) — see `src/matrix/roomCreation.ts`,
`src/matrix/permissions.ts`, and `src/matrix/moderation.ts`. The channel list header's 🔗 adds an
*existing* room you're already in as a channel (`src/matrix/spaceChildren.ts`), and per-channel
hover controls reorder or remove one from the Space — both gaps this section used to call out as
missing. Deliberately narrow versus what Matrix supports: private/public join rules only (no
restricted/knock rules, no room-version selection), and role management is per-Space only
(Matrix doesn't cascade a Space's permissions down to its channels — each channel has
independent power levels).

Discord-parity features wired onto their Matrix-native equivalents: **pinned messages**
(`m.room.pinned_events` — hover a message to pin/unpin, header button shows the pinned list),
a **topic banner** (Matrix's closest equivalent of a "news banner" — there's no separate
banner-image concept in the spec, so the room/channel topic is shown as a dismissible strip
that reappears if the topic actually changes), **read receipts** (`m.receipt` — small avatar
stack under the last message each person has read), **typing indicators** (`m.typing`, both
sending and displaying), an **online/offline member list** (Matrix presence — note some
homeservers disable presence entirely for privacy/performance, in which case everyone will
just show offline; that's a server setting, not a bug here), **reactions** (`m.reaction`
annotations — hover a message for the "Add reaction" button: a quick-pick row of common ones,
plus a "…" into the full ~1900-emoji picker (`src/components/EmojiPicker.tsx`, data from
`unicode-emoji-json`, grouped and searchable). The composer's own single 😀 button opens the same
picker plus this room's custom emotes as two tabs in one popover
(`src/features/messaging/EmojiAndEmotePicker.tsx`) — they used to be two separate buttons, folded
into one the way Discord's own picker mixes server emoji in alongside the Unicode set. Click an
existing reaction pill to toggle your own, aggregation is matrix-js-sdk's own `room.relations`,
the same mechanism Element uses — see
`src/matrix/hooks/useReactions.ts`), and **threads** (`m.thread` relations — a 🧵 hover-action
opens a thread's replies in a modal with its own composer; the main timeline shows a "💬 N
replies · Last reply from X" summary instead of the replies themselves, matching Element's
convention. Aggregation is matrix-js-sdk's own `Thread` model, `room.getThreads()` — but note
this requires passing `threadSupport: true` to `startClient()` (`src/matrix/client.ts`):
without it, threaded messages send and store fine but the SDK never aggregates them into a
`Thread` object at all, silently. See `src/matrix/hooks/useThreads.ts` and
`src/features/messaging/ThreadPanel.tsx`), and **in-place message editing** (`m.replace` —
own messages get an inline "Edit" action; matrix-js-sdk aggregates the edit onto the original
event automatically, the same relations mechanism as reactions/threads, so
`event.getContent()` already returns the latest text — the app only needs to know an edit
happened at all, via `event.replacingEvent()`, to show the "(edited)" tag. See
`src/matrix/edits.ts`). This closes out the cinny-voice-parity items this project originally
scoped for Phase 1's messaging surface.

**Custom animated emotes** — genuinely interoperable, not a NekoUs-only trick: built on
MSC2545 "image packs" (`im.ponies.room_emotes`), the same mechanism Element/cinny/FluffyChat
already use. One pack per room for now (no space-wide sharing, no personal cross-room packs —
see `src/matrix/emotes.ts` for the scope cuts). Type `:shortcode:` or use the composer's emote
picker; on send, a `formatted_body` embeds the real `<img data-mx-emoticon>` so other
emote-aware clients render it too, while the plain body still carries the literal shortcode as
a fallback for clients that don't. Animated GIF/WebP just work — it's a plain `<img>`, the
browser animates it natively, no special handling needed. Management (upload/remove) is
permission-gated and reachable from the picker's "Manage Emotes" link.

**Registration** — "Need an account? Register" on the login screen drives Matrix's real
User-Interactive Auth registration flow (`src/matrix/registration.ts`), handling the stages
most likely on a self-hosted homeserver: `m.login.dummy` (nothing further needed),
`m.login.terms` (shows the server's actual ToS links and requires acceptance), and
`m.login.email.identity` (real homeserver-native email verification — requests a token, then
handles either a "check your email and click the link" server response or an "enter the code"
one, since Synapse can be configured either way — see `EmailVerificationModal.tsx`). Doesn't
handle msisdn verification, recaptcha, registration tokens, or SSO — a server requiring one of
those needs reconfiguring to drop it for registration to work here. Right after a successful
registration, before entering the app, a full-screen, non-skippable
step (`src/app/RecoveryKeySetupScreen.tsx`) generates a brand-new recovery key
(`src/matrix/e2eeSetup.ts` — cross-signing + secret storage + key backup, distinct from
`recovery.ts`'s *restore* flow used on existing accounts) and displays it once, with a clear
warning about what happens if it's lost and concrete advice on where to store it; continuing
requires explicitly confirming it's been saved.

**Voice channels + screen sharing** — Discord's model, not cinny-voice's: voice is a distinct
channel type (`src/matrix/channelType.ts`, a `xyz.nekous.channel_type` state event set at
creation), not a toggle bolted onto every room. `CreateChannelModal` has a Text/Voice choice;
clicking a voice channel joins it immediately (no separate "Join voice" step from the channel
list), showing a 🔊 icon and a live occupant list (avatar, name, mic-muted/deafened icons) right
in the channel list. The call itself is owned independently of whatever's selected in the main
pane (`src/features/voice/VoiceCallSession.tsx`), so switching to a text channel to keep
chatting doesn't hang up — a persistent connected-call bar at the bottom of the channel list
lets you get back to it (or leave) from anywhere. One LiveKit deployment is configured per Space
(`xyz.nekous.voice_server` state event, set in Space settings — both a LiveKit URL and a token
endpoint), shared by every voice channel inside it; each voice channel gets its own LiveKit
room. Joining goes through a from-scratch, Matrix-membership-gated token server
(`services/token-server/`) modeled on `element-hq/lk-jwt-service`'s approach — a Matrix OpenID
token proves who you are, a persistent service-bot account confirms you're actually a member of
that specific room, and only then is a scoped LiveKit token minted. The call panel itself is an
audio-first participant grid (speaking-ring outline, mic-muted/deafened badges, a per-participant
"volume for me" slider via LiveKit's `RemoteParticipant.setVolume` — local-only, doesn't affect
what anyone else hears — and a 3-bar connection-quality indicator) with mute/deafen/screen share/
leave controls, ported sounds from cinny-voice, H.264-preferred screen sharing with a
viewer-side jitter-buffer/keyframe-pacing enhancement, and a screen-share pop-out window. See
`docs/voice-architecture.md` for the full state-event shapes, token flow, and grant mapping —
and its "Deferred" section for what's still deliberately not in this pass (adaptive bitrate
tiering, WebRTC-policy-specific error messaging).

**Account, moderation, and everything around messaging that Phase 1 originally left out** has
since been filled in: a bottom-of-sidebar account panel (`src/features/account/UserPanel.tsx`)
with logout and display-name/avatar editing — there was previously no way to sign out at all;
composer file/attachment upload (`src/matrix/upload.ts`) with inline images, native video/audio
players, and download cards for anything else, transparently encrypted in E2EE rooms; quote-reply
(`src/matrix/replies.ts`) and message deletion, both permission-checked; `@mention` autocomplete
with real push-rule-triggering `m.mentions` and plain-text pill highlighting on receive
(`src/matrix/messageFormatting.ts`, `src/features/messaging/renderMessageText.tsx`); inline
Markdown (bold/italic/code/strikethrough) and Discord-style `||spoilers||`, sent as real
`formatted_body` HTML for other clients too; a user profile popover (click any avatar or name)
with a "Message" button that reuses or starts a DM, plus block/ignore
(`src/matrix/ignoredUsers.ts`); starting a new DM by Matrix ID
(`src/features/channels/StartDmModal.tsx`); unread/mention badges on the server rail and channel
list plus the outgoing `m.read` receipts that actually clear them server-side (this app previously
only ever *displayed* other members' receipts, never sent its own —
`src/matrix/hooks/useUnreadCounts.ts`); desktop notifications gated by the same push-rule
evaluation the server used to compute those badges (`src/features/notifications/`); and
server-side message search, per-room or across everything (`src/matrix/search.ts`) — a result
takes you to the room, not a scrolled-to-and-highlighted message, since that needs its own
fetched-timeline-window feature (what Element calls permalinks) not built here.

**Custom themes** — `docs/theming.md`'s "planned, Phase 4" mechanism is now built: Account
Settings → Appearance is a raw-CSS `:root`-override editor (paste, or load a `.css` file),
applied instantly and persisted to `localStorage` (`src/app/theme.ts`,
`src/app/AppearanceSettings.tsx`). Getting here also meant a real audit of the base theme itself
— every color, and several spacing/radius/font-size values that had drifted into one-off magic
numbers, now goes through a `--nu-*` token (`src/styles/tokens.css`) specifically so a theme
only has to override a token, not hunt down every component that happened to hardcode a color.
**"Y2K Chatroom" default look** — the shipped default reskins the same Discord-shaped layout
(server rail, channel list, timeline, member list) into a glossy, candy-gradient, early-2000s
internet-culture aesthetic: two-tone pink/cyan gradients, a bubbly display face (Baloo 2) for
headings/usernames/buttons, per-user gradient fallback avatars, a rotating rainbow ring on
whoever's speaking in a voice call, and springy pop-in/shine-sweep motion throughout
(`src/styles/tokens.css`'s color/gradient/font tokens and keyframes, applied across the
component CSS). It was planned first as a Claude Design canvas, then carried over into the real
token/CSS layer as the actual default rather than staying a mockup. Nothing about the theme
*mechanism* changed — this is still just tokens and `nu-` selectors, so anyone who wants a
different look (including something flatter/more literally Discord) reskins it the same way any
custom theme would, via Account Settings → Appearance, not by patching the shipped CSS.

**Second built-in theme ("Lola")** — a black-and-hot-pink preset, offered as a swatch chip above
the Appearance CSS editor (`AppearanceSettings.tsx`'s `THEME_PRESETS`). Only overrides color
tokens — same gradients/fonts/motion as the default, just repainted — proving the token
architecture actually supports a second real look, not just the one it shipped with.

**Responsive mobile layout** — below 900px width the four-column shell (server rail, channel
list, main pane, member list) becomes a one-screen-at-a-time flow the way Discord's own mobile
web client works: [rail + channel list] or [chat], switched by whether a room is selected (no
separate navigation state to fall out of sync with), with a back button in the chat header and
the member list becoming a slide-in drawer opened by a header button (`styles/base/shell.css`,
`app/state/mobile.ts`). Previously the app was desktop-only — a phone-width viewport just clipped
the fixed four-column grid.

**Drag-and-drop and paste-to-upload** for the composer's existing single-attachment flow — drop a
file anywhere on the composer (a "Drop to attach" overlay confirms the target) or paste a copied
image/file, no change to the upload path itself (`Composer.tsx`). Previously the paperclip picker
was the only way in.

**Fenced code blocks with syntax highlighting** — a `` ```lang\ncode\n``` `` block in a message
now renders as a highlighted `<pre><code>` (Prism.js, a curated set of common languages bundled
locally — no CDN/autoloader fetch for an unfamiliar language tag) with colors drawn from the same
`--nu-*` tokens as everything else, so a custom theme recolors code too
(`features/messaging/CodeBlock.tsx`, `codeHighlight.ts`). The composer's own `formatted_body`
gained the matching plain `<pre><code class="language-x">` markup for cross-client interop
(`matrix/messageFormatting.ts`) — previously only single-line `` `inline code` `` existed.

**Custom status (presence + status message)** — Account Settings → Account now has a Status
picker (Online/Away/Invisible, mapping onto Matrix's real `online`/`unavailable`/`offline`
presence enum — there's no server-level "Do Not Disturb" to plug a fourth option into
honestly) and a free-text status message, both round-tripping through the real
`/presence/{userId}/status` endpoint (`matrix/account.ts`'s `updateOwnPresence`, `useOwnPresence`
hook). Shown under your own name in the sidebar's user panel, and under a member's name (plus
their avatar's status dot) in the member list, so it's not a setting nobody can actually see.
Building this surfaced a real matrix-js-sdk gap worth knowing about: a user's own `User` object
isn't always wired for the client to re-emit its events (that wiring only happens for `User`
instances created via the SDK's normal room-state path — your own can predate that, from crypto/
account bootstrap), and even when it is, presence-unchanged-but-status-changed updates don't fire
`UserEvent.Presence` at all from the stock `setPresenceEvent`. Worked around by writing the
fields directly and always emitting on the `User` object itself rather than relying on either.

**Edit history and a Space-wide audit log** — clicking a message's "(edited)" tag now opens its
full edit history (every past version, oldest first, via a direct `/relations` fetch rather than
the locally-aggregated latest-only `event.replacingEvent()` — `matrix/edits.ts`'s
`fetchEditHistory`, `EditHistoryModal.tsx`). Space Settings gained an "Audit Log" tab
(`SpaceAuditLogSettings.tsx`, `matrix/auditLog.ts`) listing recent moderation-relevant activity
across the Space and its channels — invites/joins/kicks/bans/unbans, power-level changes, name/
topic/icon changes, join-rule and history-visibility changes, and message deletions — each
described in plain language. Matrix has no dedicated audit-log endpoint, so this is derived from
state/redaction events already loaded into each room's timeline: a rolling recent log, not a
complete historical archive (an event from before the client paginated back that far isn't in
memory to read) — the same honest scope cut as everything else here that depends on what's
locally loaded rather than a purpose-built server API.

**Video calls (webcam)** — a camera toggle (📷/🎥) alongside the existing mic/deafen/screen-share
controls in `VoiceChannelPanel.tsx`, same `localParticipant.setCameraEnabled()` LiveKit call as
screen-share's `setScreenShareEnabled()`. Whoever has their camera on renders as a wider video
tile (name overlaid, speaking still shown via the border) instead of the compact avatar column;
everyone else is unaffected. Verified against a real local LiveKit + token-server stack (brought
up via `docker compose -f deploy/docker-compose.yml`, run from the `C:\dev\nekous` mirror — the
`N:\` network share still doesn't bind-mount cleanly under Docker Desktop, same issue noted
below) and joined a real voice channel successfully. **Not fully verified end-to-end**: this
automated session's browser has no real camera and its native getUserMedia permission prompt
can't be driven programmatically (the call just hangs waiting on a dialog nothing can click) — so
the actual "does a video frame render" path needs a human with a webcam to confirm. The LiveKit
stack was left running (`deploy-livekit-1`, `deploy-token-server-1`) and the Voice Test space's
voice server already points at it (`ws://localhost:7880` / `http://localhost:3001/api/livekit/
token`) for exactly that manual check.

**Background push notifications** — a new service, `services/push-gateway`, bridges Matrix's
Push Gateway API to real Web Push (VAPID), since the two aren't the same protocol and nothing
else in this stack spoke Web Push. Account Settings gained a "Background push notifications"
section (separate from the existing foreground-only "Desktop notifications") to point a device
at a gateway and subscribe. Full design, the account-data event, and exactly what's verified
versus not: `docs/push-notifications.md`. Short version — the gateway's own logic (subscribe,
notify, dead-pushkey detection) is verified against a real local instance; the actual browser
subscribe/receive path isn't, because this automated session's browser can't click through the
native notification-permission prompt (same hard limitation as the video call feature above), and
because a real end-to-end notification needs the homeserver to reach the gateway over the public
internet, which a `localhost` gateway never will be. Left running for a human to finish checking
(`deploy-push-gateway-1`, alongside the LiveKit stack).

**Slash commands** — `/me`, `/shrug`, `/nick`, `/topic`, `/invite`, `/kick`, `/ban`, `/unban`,
`/leave` (`matrix/slashCommands.ts`), with a command-name autocomplete dropdown in the composer
(same UX as the existing @mention one) and `//` escaping to a literal message starting with `/`.
`/me` gets real emote styling now too (no bubble, italic, inline with the sender's name) —
previously an `m.emote` message rendered identically to a normal one. Fixed a real bug found
while building `/shrug`: this app's own italic markdown (`_text_`) was silently eating the
underscores in `¯\_(ツ)_/¯`; the fullwidth lookalike character sidesteps it without looking any
different.

**Push-to-talk** — a per-device toggle in the voice call controls (🎙️); while on, the mic stays
muted except while Right Ctrl is physically held (`features/voice/usePushToTalk.ts`). Voice was
open-mic/toggle-mute only before.

**Message forwarding and saved messages** — a message's hover actions gained ↗️ Forward (picks a
destination channel from a grouped, filterable list and re-sends the content there,
`matrix/forward.ts`, `ForwardMessageModal.tsx`) and 📑 Save (private, cross-room bookmarks via
account data — separate from room-wide Pinned Messages — `matrix/savedMessages.ts`, opened via a
new 🔖 button in the sidebar's user panel, `SavedMessagesModal.tsx`).

**Session/device management** — Account Settings gained a "Sessions" tab listing every device
logged into the account, with Sign Out per device (`matrix/sessions.ts`, `SessionsSettings.tsx`).
Most homeservers require re-confirming your password for this (User-Interactive Auth) — handled
for the one flow every real deployment actually uses (`m.login.password`), not a full generic UIA
implementation. Verified end-to-end against the real dev homeserver, including the password
re-auth round-trip.

**Stickers** — the existing MSC2545 custom-emote pack mechanism now also carries stickers: an
image can be marked Emote, Sticker, or both when added (`matrix/emotes.ts`'s `usage` field,
`EmoteManagerModal.tsx`, now "Manage Emotes & Stickers"). A sticker is sent as its own `m.sticker`
event (a new "Stickers" tab in the composer's picker) rather than inserted as `:shortcode:` text,
and the timeline renders `m.sticker` events (previously filtered out entirely). Building this
surfaced a real, previously-latent bug: `Modal.tsx` rendered inline rather than through a React
portal, so any modal containing its own `<form>` opened from inside the composer's emoji/emote
picker was physically nested inside the composer's own `<form>` — invalid HTML that made Chrome
silently bypass React's `onSubmit` entirely and fall through to a real (broken) native page
reload on submit. Fixed by portaling `Modal` into `index.html`'s long-unused `#portalContainer`;
every other modal keeps working unchanged since React dispatches events through the logical tree
regardless of the portal.

**`@room` mass-mention** — Discord's `@everyone`. Typing it literally is always enough (no
autocomplete-selection gate the way a `@DisplayName` mention needs one — nobody types "@room" by
accident the way they might type a name that happens to match a member); whether it actually sets
`m.mentions.room` is gated on the same power-level check kick/ban already use
(`permissions.ts`'s `canMentionRoom`, spec default level 50 via `notifications.room`). Renders as
a solid highlighted pill distinct from a regular mention's gradient text, on the receiving side,
independent of whether the sender actually had permission — same "derive from the plain text,
never trust the sender's formatted_body" posture as every other receive-side render in this app.

**Session rename** — `matrix/sessions.ts` had a working `renameSession()` from the session-
management work above that nothing actually called; `SessionsSettings.tsx` now exposes it (✏️ per
device).

**Channel-wide thread browser** — previously a thread was only reachable one at a time, via a
specific message's own 🧵 action; a new 🧵 button in the channel header
(`ThreadsOverviewModal.tsx`) lists every active thread (root preview, reply count, who replied
last) and opens any of them in the same `ThreadPanel` as before.

**Search result jump/highlight** — clicking a search result used to only take you to the right
room, leaving you to scroll and find the match yourself. It now scrolls straight to the exact
message and flashes it briefly (`pendingJumpTargetAtom` in `app/state/selection.ts`, consumed by
`MessageTimeline.tsx`), backfilling further history first if the match is older than what the
room view has loaded, and opening the reply's thread panel instead when the match is a thread
reply (which never renders in the main list). One real bug caught in the process: jumping within
a room that's already open doesn't go through the normal "just opened this room" reset, so the
existing "snap to bottom" tracking ref was left `true` from before — the very next resize-driven
re-render (an avatar image finishing its fetch, say) would undo the jump and snap back to the
bottom. Fixed by explicitly marking the view as no-longer-pinned-to-bottom at the moment of the
jump.

**Discord-style channel categories** — Matrix has no native equivalent (a Space can nest, but a
sub-space is a whole separate room with its own membership, far heavier than "a labeled divider
in the channel list"), so this is a single custom state event on the Space
(`xyz.nekous.channel_categories`, `matrix/channelCategories.ts`) holding the full ordered
category list, each with its own ordered `channelIds` — the same "rewrite the whole thing, it's
cheap at this scale" approach `spaceChildren.ts`'s channel reordering already uses. A channel not
listed in any category renders flat, above the categories, exactly like every Space looked before
this existed — a fresh Space needs no migration. Managed from a new Categories tab in Space
Settings (`SpaceCategoriesSettings.tsx`: create/rename/delete/reorder categories, move channels
in and out one at a time — no drag-and-drop, matching the up/down-button precedent plain channel
reordering already set); rendered as collapsible headers in `ChannelList.tsx`, with which
categories are collapsed kept in `localStorage` per-Space, per-browser — purely local display
state, deliberately not synced like the categories themselves. Verified live against the real dev
homeserver: created a category, moved a channel into it, watched the channel list update live
behind the still-open settings modal, collapsed it, and confirmed the collapse survived a reload.

**UI scale pass** — the whole app read as noticeably larger than it needed to be. Since every
authored stylesheet already goes through `styles/tokens.css`'s scale variables (the theming
contract's whole point — see `docs/theming.md`), trimming the actual token values is what shrinks
it, not a per-component pass: the font-size scale (11/13/15/18px → 10/12/13/16px), the spacing
scale (2/4/8/12/16/24/32px → 2/4/6/9/12/18/24px), corner radii, and the three shell column widths
(server rail/channel list/member list) all came down together. The one thing NOT covered by
tokens: `Avatar`'s `size` prop is a literal number per call site (needed for both the inline
`width`/`height` style and the `useMediaUrl` thumbnail-size request), not a CSS variable — every
call site got scaled down by roughly the same ratio by hand (e.g. the default 32px → 28px, a
message row's 36px → 32px), since this is otherwise the one visibly "big" element the token
change alone wouldn't touch. Verified live: noticeably tighter server rail, channel list, and
message timeline, with no layout breakage.

**Message grouping** — a follow-up to the scale pass above, after a real Discord screenshot made
clear the remaining gap wasn't really about pixel sizes: Discord's timeline reads far more
compact primarily because consecutive messages from the same sender share one avatar/name/
timestamp instead of repeating it per message. `MessageTimeline.tsx` now does the same —
consecutive messages from the same sender within `GROUP_WINDOW_MS` (5 minutes) collapse into one
visual group, with continuation lines skipping the avatar/name row entirely in favor of a
hover-reveal timestamp in the same column the avatar would occupy (`nu-timeline__message-gutter`).
A reply always starts a fresh group regardless of timing, matching Discord. Spacing between rows
moved from the timeline content container's `gap` to each row's own `margin-top`, since flex
items never collapse margins with each other — that's what lets a grouped continuation sit nearly
flush under the message it continues while a fresh group still gets normal breathing room, without
`gap` forcing every row to the same spacing regardless of grouping. Verified live: a 15-message
burst from one sender now renders as a single avatar/name header with tightly-packed lines below
it, matching the density of the reference Discord screenshot.

**Screen share could never include audio** — `setScreenShareEnabled` was called with no options
at all, so the browser's own `getDisplayMedia` request never asked for audio in the first place.
Concretely: Chrome's native screen/tab picker only shows its own "Share audio" checkbox when the
calling code requests `{ audio: true }` — with no `audio` key, that checkbox never appeared, so
there was no way to share audio no matter what the user wanted, and no in-app toggle could have
fixed it either since the browser's own picker UI is what's missing the option, not anything
NekoUs renders itself. Fixed by requesting `{ audio: SCREEN_SHARE_AUDIO_OPTIONS }`
(`voiceChannelRoomOptions.ts` — echo cancellation/noise suppression/auto-gain explicitly off,
since those are mic-input processing that has no business running on shared system/game audio).
No playback-side change needed: `RoomAudioRenderer` (`VoiceCallSession.tsx`) already renders every
subscribed audio track generically, screen-share audio included, once LiveKit actually publishes
one. Not live-verified end-to-end in this pass — `getDisplayMedia`'s native picker is a real
browser permission dialog, the same category of prompt this project's automation has consistently
been unable to click through (see the camera/notification-permission notes elsewhere in this
README); typechecked and read against LiveKit's own source for what a present-vs-absent `audio`
key actually changes, but treat as unverified until exercised by an actual screen share.

**Expanded profiles** — Discord-style bio, banner, and animated avatars, on top of Matrix's own
bare-bones global profile (just `displayname` + `avatar_url`). Built on MSC4133 "extended
profiles" (`matrix/extendedProfile.ts`), which matrix-js-sdk already has full native support for
(`getExtendedProfile`, `setExtendedProfileProperty`, etc.) — confirmed the dev homeserver actually
advertises it (`uk.tcpip.msc4133.stable: true`) before building on it. Bio and banner are
NekoUs-namespaced keys (`xyz.nekous.bio`, `xyz.nekous.banner_url`); custom status text already
existed as a *real* Matrix feature (presence's `status_msg`, `matrix/account.ts`) and wasn't
duplicated — it just wasn't shown on `UserProfileModal.tsx` before, and now is. Animated avatars
(GIF/animated WEBP) work by skipping thumbnail cropping for them entirely: a `/thumbnail` request
freezes a GIF to one frame, so `Avatar.tsx`'s new `animated` prop requests the raw `/download`
original instead when the uploader's file was `image/gif` or `image/webp` — detected and recorded
as `xyz.nekous.avatar_animated` at upload time (`updateAccountAvatar`), not by parsing the file
for an actual multi-frame check. Deliberately scoped to *viewing a profile closely* (the profile
modal, your own settings preview) rather than every tiny avatar app-wide — a 16px channel-list
icon doesn't need the bandwidth cost of an un-thumbnailed GIF, and MSC4133 has no live-sync
delivery the way `displayname`/`avatar_url` do (no `m.room.member` piggyback), so bio/banner only
ever refresh on-demand (opening a profile), never push live to everyone watching.

Real bug caught live, not from reading the spec: `patchExtendedProfile()` (the bulk merge PATCH)
throws `TypeError: Failed to fetch` against the actual dev homeserver despite it advertising
stable MSC4133 support — confirmed via a raw `curl PATCH` that the server itself returns `405
M_UNRECOGNIZED`, a partial server-side implementation, not a NekoUs or matrix-js-sdk bug. The
per-key `PUT .../profile/{userId}/{key}` endpoint (`setExtendedProfileProperty`) works fine on
the same server, confirmed the same way — `updateExtendedProfile` now writes each changed key
individually instead of one bulk patch. Worth remembering if a *different* homeserver's own
extended-profile support ever seems broken: check whether it's the bulk or per-key endpoints
specifically before assuming the whole feature is unsupported.

**Space-wide emotes/stickers** — custom emote/sticker packs (`im.ponies.room_emotes`, MSC2545)
previously worked per-*channel* only, narrower than Discord's "one emoji set for the whole
server." `useRoomEmotes`/`useRoomStickers` now merge a channel's own pack with its parent Space's
pack (`matrix/spaceChildren.ts`'s `findParentSpaceId`), channel-specific entries winning on a
shortcode collision. `EmoteManagerModal.tsx` gained a scope picker ("Whole server" vs "This
channel only", defaulting to the Space when you have permission to manage it) and a "server" badge
on Space-wide entries in the list; `EmojiAndEmotePicker.tsx`'s "can manage" check now also passes
if you can manage the parent Space. No migration needed — every pre-existing per-room-only pack
keeps working exactly as before, just also visible from anywhere else in the same channel.

**Per-server nicknames** — a display-name override scoped to one Space, distinct from your global
name, the single mechanism-gap the earlier gap-scan flagged as "totally missing, no code for
this at all." Matrix has no native per-Space nickname concept — only a per-*room* `m.room.member`
displayname override, the same thing every Matrix client already uses for "change my name in just
this room." `matrix/nicknames.ts` layers Discord's mental model on top: setting a Space nickname
writes that override to every currently-joined channel in the Space at once; the preference itself
is remembered as private account data (`xyz.nekous.space_nicknames`) purely so it can be
reapplied to a channel joined *after* the nickname was set (`reconcileSpaceNickname`, run when the
new Nickname tab in Space Settings mounts — Matrix has no "you gained a channel in a space you
have a nickname for" push event to react to live). Reaching that tab meant redesigning
`SpaceSettingsModal.tsx`'s permission model: every other tab (General/Members/Categories/Audit
Log) is an admin action gated on `canSendStateEvent`, but a nickname is a personal preference any
member should be able to set regardless of power level, so non-admins now land on — and only ever
see — the Nickname tab, and the ⚙ button that opens the modal is no longer admin-gated either.

Real bug caught live, not from reading the spec: clearing a nickname (resetting to your "regular"
name) used `mx.getUser(myUserId)?.displayName` as "the global name" — but that field isn't
reliable. Every store implementation in matrix-js-sdk (`MemoryStore`, and `IndexedDBStore` which
extends it unchanged) shares one `User` object per user ID and silently overwrites its
`displayName`/`avatarUrl` from *any* room's `m.room.member` event for that user
(`MemoryStore.onRoomMember`), with no event emitted (`User.setDisplayName`'s own doc comment says
so). Once this feature writes even one per-room nickname override, that field permanently reflects
whichever room's override was applied most recently, not the account's real profile — so "clear"
was silently reapplying the last nickname instead of resetting anything, confirmed live via a
direct `GET .../state/m.room.member/{userId}` against the dev homeserver showing the override
never actually changed. This also meant `useOwnProfile.ts` (the account panel/settings' "who am
I") had the exact same latent bug, dormant only because nothing had ever written a per-room
override before this feature existed. Fixed both by sourcing the real global name/avatar from
`mx.getProfileInfo(userId)` (the actual `/profile/{userId}` endpoint) instead of the `User` cache.
Verified live end-to-end: set a nickname, confirmed it round-tripped across two channels in the
same Space via new messages showing the overridden sender name, cleared it, and confirmed via
direct API reads on both channels that the server-side override actually reset to the real global
name (not just that the UI looked right).

**Rich link/URL previews** — messages previously had no URL handling at all: a bare link just sat
there as plain text. `renderMessageText.tsx` gained a `URL_PATTERN` (linkifying bare `http(s)://`
URLs into real `<a target="_blank">` tags, same overlap-resolution pass as every other pattern
there) and `extractFirstUrl`, used by `MessageTimeline.tsx` to show a below-message preview card
(`LinkPreviewCard.tsx`) for a text message's first link — Discord/Element's "unfurl the first
link" convention. The preview itself is server-side OpenGraph unfurling via matrix-js-sdk's
`getUrlPreview` (`GET /media/preview_url`, no client-side scraping/CORS concerns), wrapped in a
new `useUrlPreview` hook with the same 60-second-bucketed cache key the SDK itself uses
internally. Confirmed the dev homeserver actually supports the endpoint via a raw `curl` before
building on it.

Real bug caught live: `extractFirstUrl` originally called `.exec()` on the same shared,
`g`-flagged `URL_PATTERN` that `renderMessageText`'s linkify pass later `matchAll`s — and
`String.prototype.matchAll` clones a global regex's *current* `lastIndex` rather than resetting
it, so once `extractFirstUrl` ran (leaving `lastIndex` pointing past the match it found), the
linkify pass silently started scanning from mid-string and found nothing. Every message with a
link would get a working preview card but a plain, non-clickable URL in the text above it — caught
by posting a real message with a link in the browser and inspecting the rendered DOM, not by the
test suite (the existing tests happened to run in an order that never exercised both functions on
the same string). Fixed by giving `extractFirstUrl` its own fresh `RegExp` instance instead of
touching the shared one's state; added a regression test that calls both functions on the same
string in the real call order to make sure this stays fixed.

**Public Space/room directory browsing** — previously the only way into a Space or room was
already knowing its ID/alias or getting invited; there was no discovery mechanism at all. A new
🧭 "Discover" icon in the server rail (`DiscoverModal.tsx`) browses this account's own homeserver's
public directory (`mx.publicRooms()`, `matrix/directory.ts`) — public Spaces and plain public
rooms mixed together, badged by type — with search and one-click join. Joining a Space selects it
into the server rail same as creating one; joining a plain room lands it in the spaceless
Direct-Messages-style list, since `useSpacelessRooms` already surfaces any joined room not
organized under a Space with no changes needed.

Real bug caught live, connected to this feature rather than pre-existing: `CreateSpaceModal`'s
"Public — anyone can find and join" checkbox only ever set the room's join rule (who's *allowed*
to join if they already have the ID) — it never actually published the room to the directory
`DiscoverModal` now browses, so nothing created as "public" in this app would ever be
discoverable, despite what the checkbox's own label promises. Fixed by also passing
`visibility: Visibility.Public` to `createRoom` (`matrix/roomCreation.ts`) — a separate Matrix
knob from the join rule that both happen to be exposed through one checkbox. Confirmed live that
the fix sends the right request, but full end-to-end directory verification (seeing a real entry
and joining it) was blocked by this specific dev homeserver's own publish policy — a direct `PUT
.../directory/list/room/{roomId}` test returned `403 "Not allowed to publish room"` even for a
freshly created room under this account, a server-side policy gate (likely restricting who can
publish to the directory), not a NekoUs or matrix-js-sdk bug. Worth a human checking this account's
publish permissions (or trying against the production homeserver, which may have a more permissive
policy) to see a real entry end-to-end.

**Seeing and joining channels you're not in yet** — the channel list previously only ever showed
children of a Space this client already had a local `Room` object for (i.e. rooms you're already
joined or invited to, via `useSpaceRooms`), so a public/restricted channel that existed in a Space
you're a member of was completely invisible until someone specifically invited you into it. A new
`useSpaceHierarchy` hook (`matrix/hooks/useSpaceHierarchy.ts`) calls the real room-hierarchy
endpoint (`GET /rooms/{spaceId}/hierarchy`, `mx.getRoomHierarchy`) to discover every channel in
the Space regardless of membership; `ChannelList.tsx` cross-references that against the channels
you already have to render a "More Channels" section for the rest, each with a one-click Join
button (reusing `joinPublicRoom` from the directory-browsing feature above). Scoped the same way
`useSpaceRooms` already is — no nested sub-space traversal (`maxDepth: 1`, sub-space entries
filtered out). One real limitation, not a bug: the hierarchy API's per-room summary doesn't carry
this app's custom `xyz.nekous.channel_type` state event, so an unjoined channel can't be shown as
🔊 voice vs `#` text before joining — every unjoined row gets a plain `#`, resolving to the
correct icon automatically once joined and rendered as a normal row. Verified live against the
real dev homeserver with a genuinely pre-existing unjoined channel (not a manufactured test
fixture): it appeared under "More Channels," Join worked, the room became fully functional
(composer, member list, send/receive all confirmed) immediately after.

**Registration could permanently break both registration and login on the same browser** — a
user reported registration erroring right after email verification, then a subsequent sign-in
throwing an uncaught `the account in the store doesn't match the account in the constructor:
expected @user:server:DEVICEA, got @user:server:DEVICEB`. Root cause: `client.ts`'s two IndexedDB
databases (`nekous-sync-store`, `nekous-crypto-store`) are shared/global per browser, not scoped
per account or device (ported as-is from cinny-voice, which assumed one account per browser). The
Rust crypto engine hard-fails `initRustCrypto()` if its store already holds an Olm/Megolm account
bound to a *different* device than the one the current session declares — which happens the
moment more than one account/device's crypto material ever touches the same browser (an earlier
registration attempt that got far enough to bind a device before failing later in the flow, or
any login/registration that doesn't fully clean up after itself). Four connected fixes, the
second one a genuine mistake in the first draft caught only by actually reproducing the bug live
rather than trusting the fix on inspection:
- `initClient` (`client.ts`) now catches this specific failure and self-heals: it marks a
  "wipe owed" flag and forces a real `location.reload()`, then deletes the stuck databases at the
  very start of the next boot, before anything has had a chance to reopen them. Confirmed live
  (via a controlled reproduction — corrupting the stored device ID to force the exact mismatch)
  that an in-place same-tab delete-and-retry reliably does *not* work: none of the store classes
  involved expose a way to close their own connection, and `deleteDatabase()` on a database with
  any open connection just stalls on `onblocked` until every connection closes, which never
  happens on its own within one page — only tearing down the whole page (a real reload, not just
  a fresh navigation, which Chrome's back/forward cache can serve without actually dropping old
  connections) reliably clears it.
- **The first draft of this fix only deleted `nekous-sync-store` and `nekous-crypto-store` — and
  didn't work at all**, confirmed by reproducing the original bug end-to-end with a real login:
  the exact same mismatch recurred on every single reload, forever, no matter how many wipe
  cycles ran. Root cause of *that*: `initRustCrypto()` doesn't actually use the `cryptoStore`
  passed into `createClient()` for its own account data — reading matrix-js-sdk's source
  confirmed that option only matters for a one-time legacy-to-Rust migration check. The Rust
  engine manages two of its *own* IndexedDB databases (`matrix-js-sdk::matrix-sdk-crypto` and
  `matrix-js-sdk::matrix-sdk-crypto-meta`), which is where the actually-stuck account lived the
  whole time — confirmed directly from matrix-js-sdk's own `clearStores()` implementation, which
  deletes exactly these two names alongside the two above. `initClient` now wipes all four, and a
  real login (not a synthetic corruption) confirmed live that this self-heals correctly: one
  reload, then a fully working app, no loop.
- That same live reproduction also surfaced a *third* real bug: React 18 StrictMode's dev-only
  double-invocation of `App.tsx`'s boot effect fired two concurrent `initClient()` calls for the
  same session, which raced each other's wipe-then-rebuild into a reload loop independent of the
  wrong-database issue above. `initClient` now de-dupes concurrent calls within one page via a
  shared in-flight promise. Confirmed this specific race is dev-only (StrictMode never
  double-invokes in a production build) — but two separate browser *tabs* booting the same
  account at the same moment against these still browser-global databases could race the same
  way, which this equally guards against as long as at least one of the racing calls is in this
  tab; genuinely cross-tab coordination (a Web Lock) is a known, accepted gap shared by
  matrix-js-sdk's Rust crypto generally, not attempted here.
- `RegisterScreen.tsx` persists the new session to localStorage the moment the server creates the
  account (`registerAccount`), before the post-registration bootstrap
  (`bootAndSync`/`bootstrapNewAccountEncryption`) is known to succeed — so a failure in either of
  those left a real, valid-but-half-set-up session quietly sitting in localStorage while the UI
  showed "registration failed, try again." Now rolled back (`clearSession()`) on any failure past
  that point. Separately, `App.tsx`'s boot effect previously had zero error handling around
  `initClient()` at all — any failure it couldn't self-heal was an uncaught promise rejection and
  a permanent "Loading…" spinner with no indication anything had gone wrong; it now shows a clear
  error with a "Sign out and start over" action.

**Verification, in full**: every piece above is now confirmed live end-to-end with a real
account and a real login — reproduced the original mismatch (by corrupting a stored device ID),
watched the first draft's wipe silently fail to fix it on every retry, found and fixed the actual
wrong-database bug, then reproduced the mismatch again from a clean slate and watched it correctly
self-heal in one reload with no loop. The StrictMode de-dupe fix is confirmed dev-only-relevant
(this whole loop only happened in `npm run start`'s dev server, never possible in a production
build) and is a standard, well-established pattern (memoizing an in-flight async call), but
wasn't separately re-isolated from the database fix above — both shipped together and were
verified together, which is the scenario that actually matters.

**Invite accept/decline** — previously there was no way to join a private Space, channel, or DM
you'd been invited to at all: an invited room got a local `Room` object the moment it arrived over
`/sync` (matrix-js-sdk does this for `invite` membership same as `join`), so it silently appeared
in the normal server rail/channel list/DM list as if already joined — clickable, but useless,
since its timeline can't be read before actually joining. `useSpaces`/`useSpaceRooms`/
`useSpacelessRooms` now all exclude anything you're only invited to (`getMyMembership() !==
'join'`); a new ✉️ Invites icon in the server rail (badged with a live count,
`matrix/hooks/useInvites.ts`) opens a modal listing every pending invite — Space, channel, or DM
alike, since Matrix draws no protocol distinction between them — each with real Accept/Decline
(`matrix/invites.ts`: `mx.joinRoom`/`mx.leave`, the latter being Matrix's one endpoint for both
"leave" and "reject an invite you never joined"). A channel invite is classified by walking
`m.space.parent` in its invite-stripped state (`classifyInvite`, reusing `getParentSpace` from the
voice-server-discovery code) to show which Space it belongs to and route Accept to the right
place; falls back to "Direct Message" for anything with no discoverable parent, matching the same
three-way sort the rest of the app already uses. The channel-hierarchy "More Channels" list (see
public-directory-join above) now excludes anything you're already invited to as well, so an
invited channel shows up with its Accept/Decline (and inviter's name) exactly once, not a second
time with a bare Join button that skips past that context.

Verified live against the real dev homeserver: confirmed the new exclusion filters don't regress
any of the bot account's existing joined Spaces/channels/DMs, confirmed the empty "No pending
invites" state renders correctly, and confirmed a channel that's merely publicly discoverable
(not one you're invited to) still correctly appears under "More Channels" instead of Invites.
**Not verified live**: actually receiving and accepting/declining a real invite — Matrix invites
are sent by a *different* account, and no second real account was available in this session (this
dev homeserver requires email verification to register, and the bot account isn't a server admin,
so there was no way to create one to send a real invite from). `acceptInvite`/`declineInvite`/
`classifyInvite`'s logic is unit-tested and was reviewed carefully instead. Worth a human doing
one real invite-and-accept round-trip to confirm end-to-end.

**Registration broke on a second, separate bug right after the crypto-store one above**: a fresh
account got past email verification and then failed with an opaque `getSecretStorageKey callback
returned falsey`. Root cause, found by reading matrix-js-sdk's own source rather than guessing:
`bootstrapSecretStorage()` (the new-account E2EE setup call in `e2eeSetup.ts`) doesn't just create
a new secret storage key — it immediately turns around and *encrypts* the freshly-generated
cross-signing keys and backup key with it, via the same generic `secretStorage.store()` path used
everywhere, which asks the app for the encryption key through the exact same
`getSecretStorageKey` callback used for *decrypting* an existing secret. `secretStorageCallbacks.ts`
only ever populated that callback for the one call site it was originally built for (recovery.ts's
explicit, user-initiated restore, which already has a decoded key in hand via
`withSecretStorageKeyAttempt`) — registration's call never wrapped anything that way, because it
can't: the keyId doesn't exist until *inside* `bootstrapSecretStorage()` generates it. matrix-js-sdk
has a purpose-built hook for exactly this ordering problem, `cacheSecretStorageKey` — its own docs
say it's "called when a new key is created," synchronously, before any of the encrypting
`getSecretStorageKey` calls that follow — which simply wasn't implemented here. Added it: it
populates the same small in-memory cache `getSecretStorageKey` already reads from, so both
directions (decrypt an existing secret, encrypt a brand-new one) share one mechanism instead of
needing two. `bootstrapNewAccountEncryption` clears that cache in a `finally` once its own call
completes, rather than leaving private key material sitting in memory for the rest of the session.
Unit-tested against the exact call sequence confirmed from the SDK's source (`cacheSecretStorageKey`
firing once, then multiple `getSecretStorageKey` calls expected to find what it cached) — **not
re-verified against a real end-to-end registration**, since that needs the same real email
inbox the crypto-store fix above couldn't get either; worth confirming with an actual new-account
signup.

**Mention Inbox** — a new `@` icon in the server rail, right above Invites, badged with a live
count. Someone @-mentioning you (a real `m.mentions.user_ids` mention — the same signal
`MessageTimeline.tsx` already uses for its own highlight styling, not `@room` and not just any
message in a room with notifications on) now gets logged automatically to a private, cross-room
list you can open and jump straight to, instead of having to scroll back through a busy channel
to find it again. `MentionInboxCollector.tsx` (headless, mounted once in `AppShell` alongside
`DesktopNotifications`, whose exact `RoomEvent.Timeline` + `data.liveEvent` pattern it reuses) is
what does the catching — `liveEvent` is what keeps a room's entire recent backlog from getting
replayed into the inbox on every single reload, only genuinely new messages count. The list itself
is plain account data (`matrix/mentionInbox.ts`, same shape/precedent as Saved Messages), capped
at the 50 most recent so it can't grow unbounded, with an explicit per-item dismiss and a
"Clear all" — opening one does not auto-dismiss it, so you can jump to it, read it, and still find
it again later if you want. Opening an entry uses the same jump-to-and-highlight mechanism search
results already use (`pendingJumpTargetAtom`), landing you directly on the exact message rather
than just the room.

Real bug caught live while testing this with only one real account available: mentioning
*yourself* (the only way to trigger the collector without a second account) briefly gets logged
under a local echo's temporary `~`-prefixed event ID, which the room re-keys to the real one once
`/sync` confirms the send — no second `RoomEvent.Timeline` fires for that swap, so the logged
entry would permanently point at an ID the room can never resolve again ("message no longer
available" forever). Confirmed this doesn't affect a real mention from someone else at all: an
incoming event from another account is never in a local-echo state from this client's
perspective, it's always already real — and the collector already skips self-sent messages for
the (separate, obvious) reason that mentioning yourself shouldn't fill your own inbox, which
turns out to sidestep this local-echo bug as a free side effect rather than needing its own fix.

Verified live against the real dev homeserver: confirmed the empty state, confirmed a seeded
mention (written directly via the account-data API against a real existing message, since a
genuine live mention needs a second account this session didn't have) renders with the right
room/sender/preview, confirmed the badge count updates live, confirmed opening it jumps to and
highlights the exact message, confirmed per-item dismiss and the badge clearing. The *collector*
itself (the automatic catch-a-live-mention path) was verified by temporarily disabling the
self-mention guard for one test message, confirmed it fires correctly end-to-end, then restored
the guard (with the local-echo finding above added as a comment) before shipping — not verified
with a real mention from a second, different account, for the same "no second account available"
reason as the two features above.

**Watch Together** — a 📺 control in the voice call bar lets anyone start a shared YouTube video
or direct media link for the whole call, playing in the same visual slot screen share uses
whenever nobody's actually sharing their screen. No media is routed through LiveKit at all — only
small JSON control messages (what's playing, play/pause, seek, stop) cross the call over LiveKit's
existing data channel (`useWatchTogether.ts`), and each participant's own browser independently
loads and plays the source: a YouTube IFrame embed for a recognized YouTube URL
(`watchTogether.ts`'s `parseWatchUrl` — `watch?v=`, `youtu.be/`, and `/shorts/` links), a plain
`<video>` element for anything else that's a well-formed `http(s)://` URL (not validated ahead of
time as an actual playable file — trusted and left to fail visibly, same posture as other
user-supplied URLs in this app). A synced state is always a little stale by the time it's read
(network delay, time passing) — `currentPositionSeconds` extrapolates the real current position
from the last known one plus elapsed time, rather than trusting a raw position number that's
already out of date. A late joiner (or anyone reopening the voice channel's own pane, since this
is only mounted while you're actually looking at it — see `useWatchTogether.ts`'s own comment for
why that's fine) broadcasts a `request-sync` on mount; whichever other participant already knows
the current state answers it, with no "elect a host" step needed. Anyone can play/pause/seek/stop/
change the video — same no-owner-permission model screen share already has. Starting a session
doesn't force-stop an active screen share or vice versa: whichever one the slot doesn't currently
show keeps its own state ticking in the background and reappears the moment the other stops,
rather than either one clobbering the other.

Two real, connected bugs caught by testing this live (not just reading the code) rather than
trusting it on inspection:
- **The YouTube IFrame API is documented to *replace* the DOM element you hand it with its own
  `<iframe>`**, not render inside it — confirmed while re-reading that behavior against this
  component's structure, before it ever shipped: handing it the same React-managed ref every time
  would leave that ref pointing at a node no longer attached to anything the moment a *second*
  video loads into the same still-mounted player (changing videos re-runs the setup effect without
  unmounting the component). Fixed by routing through a disposable inner `<div>` created
  imperatively for the API to consume, created fresh inside a stable wrapper React actually owns,
  with the wrapper's contents forced clean on cleanup regardless of what state the API left behind.
- **Blocked autoplay had no recovery path for the YouTube player specifically** — confirmed live,
  first try, with a real embed: `player.playVideo()` on a fresh profile with no prior youtube.com
  engagement gets silently ignored by Chrome's autoplay policy (no promise rejection the way
  `<video>.play()` gives you — YouTube's IFrame API has no equivalent signal). The direct-media
  `<video>` path already had a "Click to play" fallback for exactly this browser constraint; the
  YouTube path had nothing, so a blocked session would just sit on the paywall-style YouTube splash
  forever with our own controls insisting it was already playing. Fixed by watching
  `onStateChange` plus a short grace-period poll of `getPlayerState()` after every play attempt,
  surfacing the same "Click to play" overlay (a real click there reliably satisfies the browser's
  gesture requirement) the media path already had.

Verified live end-to-end against a real local LiveKit deployment (`deploy-livekit-1`, already
running from earlier video-call work) in an actual voice channel: started a YouTube session, hit
the autoplay block on the first attempt, confirmed the new overlay fixed it and the video genuinely
played (not just the paused splash) with progressing playback time; confirmed play/pause freezes
and resumes from the correct position; confirmed dragging the seek bar jumps to the right spot;
confirmed Stop clears it; separately started a direct `.mp4` URL and confirmed it played
correctly too, no autoplay block that time.

**Cross-participant sync — now verified live.** No second real Matrix account was available (the
dev homeserver requires email verification to register), so the SDK-level flow couldn't be driven
by two real client sessions. Instead, tested the actual mechanism Watch Together relies on
directly: LiveKit's data channel, which doesn't know or care how a participant authenticated.
Minted a short-lived, narrowly-scoped raw LiveKit token (`roomJoin`/`canPublish`/`canSubscribe`/
`canPublishData` only, no room-admin grant, ~6h expiry) server-side via `livekit-server-sdk`,
already a dependency inside the running `deploy-token-server-1` container, for a synthetic identity
(`watch-together-test-observer`) scoped to the exact LiveKit room name the real Matrix voice
channel maps to (`services/token-server/src/livekitRoomName.ts`'s `"matrix-" + base64url(roomId)`).
Connected that raw identity into the room from a second browser tab using `livekit-client` loaded
directly from a CDN (bypassing this app's UI entirely in that tab) and listened for
`RoomEvent.DataReceived` on the `xyz.nekous.watch_together` topic. Then, from the real account in
the first tab, actually joined the voice call and drove every control while watching the raw
observer's captured messages:
- Starting a YouTube session → observer received `{type: 'state', playing: true, positionSeconds: 0}`.
- Clicking pause → observer received `{playing: false, positionSeconds: ~11}` (the real elapsed position, not 0).
- Dragging the seek bar to 2:00 → observer received `{playing: false, positionSeconds: 120}`.
- Resuming play → observer received `{playing: true, positionSeconds: 120}` (correct resume point).
- Clicking Stop → observer received `{type: 'stop'}`.

Every state change broadcast correctly and immediately to the independent participant, confirming
sync is genuinely bidirectional/reflected-to-all (not per-user local state) exactly as intended:
whoever controls the player — play, pause, or seek — has that change reflected for everyone else
in the call, which is what keeps a shared video from drifting out of sync between participants.

**Misaligned header divider between the main pane and member list** — a user-reported visual bug:
the thin border-bottom line under the channel name/pin/search/thread icons visibly "stepped" a
few pixels where it met the member list column, instead of running as one continuous line across
the top of the shell. Root cause: `.nu-channel-list__header` and `.nu-main-pane__header` both set
`font-size: var(--nu-font-size-lg)` with `font-weight: 800` on their title text, but
`.nu-member-list__header-title` had no matching rule at all and rendered at the base font-size —
smaller text meant a shorter line-height, which (with identical padding on all three headers)
made that one header a few pixels shorter than its neighbors, throwing its bottom border out of
line with theirs. Fixed by giving `.nu-member-list__header-title` the same
font-family/weight/size as the other two. Confirmed live: all three headers now measure exactly
the same height (`getBoundingClientRect()` on each), which is what actually guarantees the
borders align — a screenshot comparison wasn't reliable here (this automation session's
screenshot tool renders at a fixed, smaller viewport than the page's real CSS layout width, so
the member list column was sometimes clipped out of captures entirely; the numeric height check
doesn't have that problem).

**Couldn't invite anyone (a service bot included) into a voice channel** — `InviteToChannelModal.tsx`
was already fully generic (its own doc comment even calls out "this is also how to get a service
bot — e.g. the voice token-server's bot account — into a specific voice channel," since Space
membership doesn't cascade to child rooms and the token-server's own bot only works once it's a
member of each voice-gated room, per `docs/voice-architecture.md`) — but `MainPane.tsx` renders a
voice channel through a completely separate, simpler header branch than a text channel's, and
that branch never got the ➕ Invite button (or the modal itself) added to it at all. Fixed by
bringing both into the voice branch, gated by the same `canInviteToRoom` permission check the
text-channel version already uses. Verified live: the button now appears in a voice channel's
header and opens the same modal, correctly scoped to that channel (`Invite to #general-voice`) —
not verified with a real invite actually sent, to avoid creating an unwanted pending invite for a
real account just to test a button wired to already-proven, unchanged invite logic.

**Bundled-homeserver ("Option B") mode for the guided deploy script** — `deploy/setup.sh` /
`docs/deployment.md` previously only supported "bring your own Matrix homeserver." Added a second
path: the script can now provision [Continuwuity](https://continuwuity.org/) (a lightweight,
spec-compliant, federation-capable Rust homeserver — no separate database service) itself, on a
new `matrix.YOUR_DOMAIN`, with accounts reading as clean `@user:YOUR_DOMAIN` via `.well-known`
federation delegation from the bare apex domain. Both the token server's bot account and the
user's own (auto-admin) account get created automatically via the registration API — no manual
Matrix account creation, no copying access tokens by hand, matching the "brain-dead simple VPS
installer" goal this was built for. The `matrix` service lives in `deploy/docker-compose.yml`
behind a Compose `profile`, so it's completely inert (doesn't even parse into the running set of
services) unless the script passes `--profile matrix` — Option A users see zero change. The
token-server side needed **no code changes at all**: it already just takes a homeserver URL + bot
credentials and doesn't care what's behind that URL.

One real, load-bearing finding only caught by testing this live against a real Continuwuity
container (not by reading its docs): the server does **not** honor the `registration_token` you
configure for the very first account — it generates and logs its own one-time bootstrap token
for that first registration specifically, and only activates the configured token afterward. A
script that just used the configured token for both the admin and bot registrations would have
failed outright on a completely fresh homeserver. `setup.sh` now extracts that bootstrap token out
of the container's own startup logs for the admin account, then uses the configured token for the
bot account after that.

A second real bug caught the same way: the first version of the log-scraping regex picked
whichever "registration token" occurrence came *last* in the logs — but Continuwuity also prints
an unrelated later warning line containing the literal words "registration token you set in your
configuration will not function...", which a naive `tail -n1` matched instead of the real token
line, extracting the word "you" as the "token." Fixed by anchoring on the one line that actually
names the token (it also contains "Pick your own username"). Both the UIAA registration flow
(including a password containing `"` and `\` to exercise the JSON-escaping helper) and the fixed
log-scraping regex were verified against real, disposable Continuwuity containers — run via both
plain `docker run` and `docker compose ... logs` (to match the exact command the script actually
uses) — before shipping, along with a `/sync` check confirming `matrix-js-sdk` (what the
unmodified token-server and web client both already use) talks to Continuwuity exactly like any
other spec-compliant homeserver. The generated nginx config (all six server blocks, including the
new federation/well-known ones) was also rendered with fake domains and validated with a real
`nginx -t` — but the federation/`.well-known`/certbot pieces themselves couldn't be exercised
end-to-end without a real public domain and DNS, the same limitation every nginx-generation change
in this script has always had, so that part is reviewed-carefully-but-not-live-tested, same as
prior infra-only work.

**Self-generating TURN relay config for the guided deploy script** — `deploy/livekit.yaml`
previously had a `turn:` block, but only as a commented-out template requiring manual editing,
its own DNS record, and manually copying cert files around. `deploy/setup.sh` now asks (right
after the LiveKit subdomain prompt, default no) whether to enable it, and if so handles
everything: adds the TURN domain to the DNS check and the certbot SAN list, copies the resulting
cert into the new `deploy/livekit-certs/` directory (gitignored, mounted read-only into the
`livekit` service in `deploy/docker-compose.yml`), installs a certbot renewal hook that refreshes
that copy and restarts `livekit` automatically, and rewrites `deploy/livekit.yaml` with the
`turn:` block filled in (`tls_port: 5349`, not the `443` the file's own old comment suggested —
this same host's nginx already owns 443, so true "disguised as HTTPS" TURN would need a dedicated
host; 5349 still hides the origin IP, just not the fact that it's TURN traffic by port number).

Verified live end-to-end with a real disposable LiveKit container: generated the config exactly as
`setup.sh` would (dry-ran the actual heredoc with fake values), validated the YAML parses, mounted
a self-signed test cert the same way `deploy/livekit-certs/` would hold a real one, and confirmed
LiveKit both accepted the `turn:` block (logged `Starting TURN server` with the expected
`tls_port`/`udp_port`) and actually served that exact certificate over TLS on port 5349 (checked
via a real TLS handshake, `openssl s_client`, confirming the `CN` matched). The
federation/DNS/certbot side of getting a *real* cert onto a real TURN domain still can't be
exercised without a real public domain, same caveat as the rest of this script.

## Development

**If the repo is on a normal local disk**, plain npm works fine:

```
cd apps/web
npm install
npm run start
```

**If this repo lives on a network drive whose ACLs deny Execute** (as it does in this project's
default setup — `N:\` here denies Execute for everyone, which breaks npm's native binaries like
esbuild, e.g. "Access is denied" when npm tries to run `esbuild.exe` in place): `node_modules`
has to live somewhere npm binaries can actually execute.

- Confirmed working: keep `N:\projects\nekous` as the canonical/edited copy, but run
  `npm install`/`npm run build`/`npm run start` from a local mirror (e.g. `C:\dev\nekous`),
  re-synced from `N:\` before each run:
  ```powershell
  robocopy N:\projects\nekous\apps\web C:\dev\nekous\apps\web /MIR /XD node_modules dist
  cd C:\dev\nekous\apps\web
  npm install
  npm run start
  ```
- `deploy/docker-compose.dev.yml` bind-mounts `apps/web` into a container and keeps
  `node_modules` in a Docker volume, which avoids the network-share exec problem in principle —
  **but on this project's actual dev machine, Docker Desktop's bind mount of the `N:\` share
  itself was unreliable** (returned stale/partial or empty directory listings rather than the
  real source tree), so this path is untested end-to-end here. Worth retrying if Docker Desktop's
  file sharing / WSL2 network-drive support improves, or if this repo ever moves to a local disk
  or a share Docker can mount cleanly.

Either way, point the app at any Matrix homeserver you have an account on (defaults to
`matrix.org` in the login form) to verify sync reaches `PREPARED` and the shell renders.

## Testing

`npm test` (Vitest, `apps/web/vitest.config.ts`) runs the unit suite — the first one this repo
has had. Deliberately narrow in scope so far: pure logic that doesn't need a live Matrix client
or homeserver — `matrix/messageFormatting.ts` (emote/mention/Markdown parsing, including a
regression test for a real bug this session found: a bold span immediately followed by an
italic one used to have the bold's leftover delimiter bridge across the space between them and
swallow the italic's opening `*`), `matrix/permissions.ts` (every power-level check, via a
minimal fake `Room`), `matrix/directMessages.ts`, `matrix/replies.ts`, and
`renderMessageText.tsx`'s mention/Markdown rendering (not its emote rendering — that pulls in
`useMediaUrl`/`useMatrixClient`, which would need a real or heavily faked `MatrixClient` just to
render a plain `<img>`; the matching logic it shares with everything else here is already
covered by the `messageFormatting.ts` tests, which exercise the identical regex/overlap
algorithm without that dependency). Nothing that needs a live homeserver, a rendered three-pane
shell, or LiveKit is covered yet — components wired directly to `useMatrixClient()`/`mx.getRoom()`
etc. would need a proper `MatrixClient` mock/fixture to test in isolation, which is a bigger
undertaking than this pass covered. `vitest.config.ts` deliberately doesn't reuse
`vite.config.ts`'s plugins (WASM crypto serving, Node globals polyfill) — those are for running
the real app in a browser, not for unit tests in Node/jsdom.

## Production deployment

`deploy/docker-compose.yml` builds and runs all four of NekoUs's own services together: LiveKit,
the token server (`services/token-server/`), the push gateway (`services/push-gateway/`), and the
built web client served by nginx (`apps/web/Dockerfile`). Matrix/Synapse itself is **not** part
of this stack — NekoUs is a client; point it at whatever homeserver you already run.

**[`docs/deployment.md`](docs/deployment.md) is a full guided walkthrough** — VPS, DNS, getting
the token server's bot account, TLS via certbot, the nginx reverse proxy, and which settings
live in-app rather than in `.env` — written for someone doing this for the first time.
`deploy/setup.sh` automates most of its mechanical steps (installing Docker/certbot/nginx,
generating secrets, requesting the certificate, writing the nginx config, bringing the stack up)
if you'd rather not run each command by hand; the guide explains what it's doing either way. The
short version, if you already know your way around this:

```
cp .env.example .env   # fill in LIVEKIT_API_KEY/SECRET, HOST_IP, the token server's Matrix bot credentials, VAPID keys
docker compose -f deploy/docker-compose.yml --env-file .env up --build
```

Both Dockerfiles use a repo-root build context (`context: ..` in the compose file) so they can
`COPY` a single package into an otherwise-empty image without pulling in the other package's
`node_modules` — see `.dockerignore`. Unlike `docker-compose.dev.yml`'s live bind-mount (see
above, unreliable on this project's `N:\` network share), a plain `docker build`'s one-shot
context upload works fine straight from `N:\` — no local-mirror step needed for production
builds, only for the day-to-day `npm run start` dev loop.

Every service's published port is bound to `127.0.0.1` except LiveKit's two real-time-media
ports (`7881/tcp`, `7882/udp`, which can't be proxied through nginx like ordinary HTTP) — nginx
is meant to be the only thing actually facing the internet, terminating TLS and proxying to
`127.0.0.1:<port>` for everything else. See `deploy/nginx/` for reverse-proxy examples (an
all-in-one file and one-vhost-per-service alternatives, one per service including the
previously-undocumented push gateway).

After the stack is up, each Space still needs its LiveKit URL and token endpoint set once,
in-app, under Space Settings, and each account needs its push gateway URL set once under Account
Settings — see `docs/voice-architecture.md`'s "State events" section for why the voice config in
particular is per-Space rather than something baked into the image or `.env`.

Verified this session (structural/negative-path only, not a live two-account call): both images
build cleanly from either `N:\` or the local mirror; `docker compose up` brings up all four
containers; LiveKit's HTTP endpoint responds; the token server's `/health` responds and its
`/api/livekit/token` endpoint correctly rejects a malformed request (`400`) and a bogus OpenID
token (`401`) without crashing; the web container serves the built SPA with working
client-side-route fallback. Not yet verified: a real join-call test through the compose stack
end-to-end (needs a real homeserver, a registered bot account invited into a voice-channel room,
and two real user sessions) — see `docs/voice-architecture.md` for what that requires. The guided
deploy script (`deploy/setup.sh`) is untested against a real VPS in this pass — it was written
and shellcheck-clean but this dev environment has no disposable Ubuntu box to actually run it
against; treat it as a documented, readable starting point rather than something verified
end-to-end, and please report back if a step doesn't match a real system.
