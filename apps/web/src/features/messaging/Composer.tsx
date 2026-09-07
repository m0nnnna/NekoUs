import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { MsgType, type RoomMember } from 'matrix-js-sdk';
import { useSetAtom } from 'jotai';
import { Avatar } from '../../components/Avatar';
import { selectedRoomIdAtom } from '../../app/state/selection';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import { useRoomEmotes } from '../../matrix/hooks/useRoomEmotes';
import { useRoomMembers } from '../../matrix/hooks/useRoomMembers';
import { buildMessageFormatting } from '../../matrix/messageFormatting';
import { canMentionRoom } from '../../matrix/permissions';
import { buildReplyRelation, type ReplyTarget } from '../../matrix/replies';
import { findSlashCommand, parseSlashInput, SLASH_COMMANDS } from '../../matrix/slashCommands';
import { sendFileMessage } from '../../matrix/upload';
import { EmojiAndEmotePicker } from './EmojiAndEmotePicker';
import './Composer.css';

const TYPING_TIMEOUT_MS = 10000;
const TYPING_REFRESH_MS = 4000;
const MAX_MENTION_SUGGESTIONS = 8;

/** Matches an in-progress "@query" the cursor is currently sitting inside — an "@" preceded by
 *  start-of-string or whitespace, with no whitespace since. Used both to decide whether to show
 *  the autocomplete dropdown and, on selection, to find exactly what substring to replace. */
const MENTION_TRIGGER_PATTERN = /(?:^|\s)@([^\s@]*)$/;

export function Composer({
  roomId,
  threadId = null,
  replyingTo = null,
  onCancelReply,
}: {
  roomId: string;
  threadId?: string | null;
  /** A message the next send should quote-reply to (see MessageTimeline's "Reply" action) —
   *  owned by MainPane since it's cleared by a successful send here but set from a sibling. */
  replyingTo?: ReplyTarget | null;
  onCancelReply?: () => void;
}) {
  const mx = useMatrixClient();
  const setSelectedRoomId = useSetAtom(selectedRoomIdAtom);
  const room = mx.getRoom(roomId);
  const emotes = useRoomEmotes(room ?? undefined);
  const members = useRoomMembers(roomId);
  const [text, setText] = useState('');
  const [attachment, setAttachment] = useState<File>();
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [commandError, setCommandError] = useState<string>();
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [commandIndex, setCommandIndex] = useState(0);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragDepthRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastTypingSentAtRef = useRef(0);
  // Display name -> user ID for every mention actually inserted via the dropdown this draft —
  // buildMessageFormatting only pills/notifies these, not just any "@word" typed by hand. See
  // matrix/messageFormatting.ts.
  const mentionedRef = useRef<Map<string, string>>(new Map());

  const mentionMatches =
    mentionQuery === null
      ? []
      : members.filter((m) => m.name.toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, MAX_MENTION_SUGGESTIONS);

  // Only while still typing the command name itself (no space yet) — once a space appears the
  // user's typing arguments, not choosing a command, so the dropdown gets out of the way.
  const commandMatches =
    text.startsWith('/') && !text.startsWith('//') && !text.includes(' ')
      ? SLASH_COMMANDS.filter((c) => c.name.startsWith(text.slice(1).toLowerCase()))
      : [];

  const stopTyping = () => {
    lastTypingSentAtRef.current = 0;
    mx.sendTyping(roomId, false, 0).catch(() => {});
  };

  // Stop showing as typing when leaving the room (switching away, or unmounting) — otherwise a
  // half-typed draft in one room would leave a stale "is typing…" there until it times out.
  useEffect(() => {
    return () => {
      mx.sendTyping(roomId, false, 0).catch(() => {});
    };
  }, [mx, roomId]);

  const updateMentionQuery = (value: string, cursor: number) => {
    const match = MENTION_TRIGGER_PATTERN.exec(value.slice(0, cursor));
    setMentionQuery(match ? match[1] : null);
    setMentionIndex(0);
  };

  const handleChange = (evt: ChangeEvent<HTMLTextAreaElement>) => {
    const value = evt.target.value;
    setText(value);
    setCommandIndex(0);
    setCommandError(undefined);
    updateMentionQuery(value, evt.target.selectionStart ?? value.length);
    if (!value.trim()) {
      stopTyping();
      return;
    }
    const now = Date.now();
    if (now - lastTypingSentAtRef.current > TYPING_REFRESH_MS) {
      lastTypingSentAtRef.current = now;
      mx.sendTyping(roomId, true, TYPING_TIMEOUT_MS).catch(() => {});
    }
  };

  const selectMention = (member: RoomMember) => {
    const textarea = textareaRef.current;
    const cursor = textarea?.selectionStart ?? text.length;
    const match = MENTION_TRIGGER_PATTERN.exec(text.slice(0, cursor));
    if (!match) return;
    // match[0] is "<ws-or-start>@query" — the '@' itself starts right before the query capture.
    const atIndex = cursor - match[1].length - 1;
    const before = text.slice(0, atIndex);
    const after = text.slice(cursor);
    const inserted = `@${member.name} `;
    mentionedRef.current.set(member.name, member.userId);
    setText(`${before}${inserted}${after}`);
    setMentionQuery(null);
    requestAnimationFrame(() => {
      const pos = before.length + inserted.length;
      textarea?.focus();
      textarea?.setSelectionRange(pos, pos);
    });
  };

  const selectCommand = (command: (typeof SLASH_COMMANDS)[number]) => {
    const inserted = `/${command.name} `;
    setText(inserted);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(inserted.length, inserted.length);
    });
  };

  const send = async () => {
    const body = text.trim();
    if ((!body && !attachment) || sending) return;
    setSending(true);
    setText('');
    setMentionQuery(null);
    const fileToSend = attachment;
    setAttachment(undefined);
    stopTyping();
    try {
      // Matrix has no combined attachment+caption event shape — Element's own convention (and
      // the one followed here) is to send the file as its own event, then any typed text as a
      // separate, ordinary follow-up message.
      if (fileToSend) {
        setUploading(true);
        try {
          await sendFileMessage(mx, roomId, threadId, fileToSend);
        } finally {
          setUploading(false);
        }
      }
      if (body) {
        const parsed = parseSlashInput(body);
        if (parsed?.type === 'command') {
          const command = findSlashCommand(parsed.name);
          if (!command) throw new Error(`Unknown command: /${parsed.name}`);
          await command.execute({ mx, roomId, threadId, onLeft: () => setSelectedRoomId(null) }, parsed.args);
        } else {
          const effectiveBody = parsed?.type === 'escaped' ? parsed.text : body;
          const mentionCandidates = [...mentionedRef.current.entries()].map(([displayName, userId]) => ({
            displayName,
            userId,
          }));
          const roomMentionAllowed = room ? canMentionRoom(room, mx.getUserId() ?? '') : false;
          const { formattedBody, mentionedUserIds, mentionsRoom } = buildMessageFormatting(
            effectiveBody,
            emotes,
            mentionCandidates,
            roomMentionAllowed
          );
          const relatesTo = replyingTo ? buildReplyRelation(replyingTo.eventId) : undefined;
          if (formattedBody || relatesTo || mentionedUserIds.length > 0 || mentionsRoom) {
            await mx.sendMessage(roomId, threadId, {
              msgtype: MsgType.Text,
              body: effectiveBody,
              ...(formattedBody && { format: 'org.matrix.custom.html', formatted_body: formattedBody }),
              ...((mentionedUserIds.length > 0 || mentionsRoom) && {
                'm.mentions': { ...(mentionedUserIds.length > 0 && { user_ids: mentionedUserIds }), ...(mentionsRoom && { room: true }) },
              }),
              ...(relatesTo && { 'm.relates_to': relatesTo }),
            });
          } else {
            await mx.sendTextMessage(roomId, threadId, effectiveBody);
          }
        }
      }
      mentionedRef.current.clear();
      onCancelReply?.();
    } catch (err) {
      setText(body); // restore the draft so a failed send doesn't lose it
      if (fileToSend) setAttachment(fileToSend);
      if (body.startsWith('/') && !body.startsWith('//')) {
        setCommandError(err instanceof Error ? err.message : 'Command failed');
      }
      console.error('Failed to send message', err);
    } finally {
      setSending(false);
    }
  };

  const handleSubmit = (evt: FormEvent) => {
    evt.preventDefault();
    void send();
  };

  const handleKeyDown = (evt: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionQuery !== null && mentionMatches.length > 0) {
      if (evt.key === 'ArrowDown') {
        evt.preventDefault();
        setMentionIndex((i) => (i + 1) % mentionMatches.length);
        return;
      }
      if (evt.key === 'ArrowUp') {
        evt.preventDefault();
        setMentionIndex((i) => (i - 1 + mentionMatches.length) % mentionMatches.length);
        return;
      }
      if (evt.key === 'Enter' || evt.key === 'Tab') {
        evt.preventDefault();
        selectMention(mentionMatches[mentionIndex]);
        return;
      }
      if (evt.key === 'Escape') {
        evt.preventDefault();
        setMentionQuery(null);
        return;
      }
    }
    if (commandMatches.length > 0) {
      if (evt.key === 'ArrowDown') {
        evt.preventDefault();
        setCommandIndex((i) => (i + 1) % commandMatches.length);
        return;
      }
      if (evt.key === 'ArrowUp') {
        evt.preventDefault();
        setCommandIndex((i) => (i - 1 + commandMatches.length) % commandMatches.length);
        return;
      }
      if (evt.key === 'Enter' || evt.key === 'Tab') {
        evt.preventDefault();
        selectCommand(commandMatches[Math.min(commandIndex, commandMatches.length - 1)]);
        return;
      }
    }
    if (evt.key === 'Enter' && !evt.shiftKey) {
      evt.preventDefault();
      void send();
    }
  };

  const handleFileChange = (evt: ChangeEvent<HTMLInputElement>) => {
    const file = evt.target.files?.[0];
    evt.target.value = ''; // allow re-picking the same file after removing it
    if (file) setAttachment(file);
  };

  const handlePaste = (evt: ClipboardEvent<HTMLTextAreaElement>) => {
    const pastedFile = Array.from(evt.clipboardData.items)
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .find((file): file is File => file !== null);
    // A plain text paste has no file items at all — only intercept when the clipboard actually
    // carries a file (e.g. a copied screenshot), so normal text pasting is untouched.
    if (pastedFile) {
      evt.preventDefault();
      setAttachment(pastedFile);
    }
  };

  // dragenter/dragleave fire for every child element too, not just this wrapper's own boundary —
  // a depth counter is the standard way to know when the pointer has actually left the whole
  // drop zone rather than just moved from one child to a sibling.
  const handleDragEnter = (evt: DragEvent<HTMLDivElement>) => {
    if (!evt.dataTransfer.types.includes('Files')) return;
    evt.preventDefault();
    dragDepthRef.current += 1;
    setIsDragOver(true);
  };

  const handleDragOver = (evt: DragEvent<HTMLDivElement>) => {
    if (evt.dataTransfer.types.includes('Files')) evt.preventDefault();
  };

  const handleDragLeave = (evt: DragEvent<HTMLDivElement>) => {
    if (!evt.dataTransfer.types.includes('Files')) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDragOver(false);
  };

  const handleDrop = (evt: DragEvent<HTMLDivElement>) => {
    if (!evt.dataTransfer.types.includes('Files')) return;
    evt.preventDefault();
    dragDepthRef.current = 0;
    setIsDragOver(false);
    const file = evt.dataTransfer.files?.[0];
    if (file) setAttachment(file);
  };

  return (
    <div
      className={isDragOver ? 'nu-composer-wrapper nu-composer-wrapper--drag-over' : 'nu-composer-wrapper'}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragOver && (
        <div className="nu-composer__drop-overlay" data-nu-role="composer-drop-overlay" aria-hidden="true">
          Drop to attach
        </div>
      )}
      {replyingTo && (
        <div className="nu-composer__reply" data-nu-role="composer-reply">
          <span className="nu-composer__reply-text">
            ↩ Replying to <strong>{replyingTo.senderName}</strong>: {replyingTo.preview}
          </span>
          <button
            type="button"
            className="nu-composer__reply-cancel"
            data-nu-role="composer-reply-cancel"
            title="Cancel reply"
            onClick={onCancelReply}
          >
            ×
          </button>
        </div>
      )}
      {attachment && (
        <div className="nu-composer__attachment" data-nu-role="composer-attachment">
          <span className="nu-composer__attachment-name">📎 {attachment.name}</span>
          <button
            type="button"
            className="nu-composer__attachment-remove"
            data-nu-role="composer-attachment-remove"
            title="Remove attachment"
            onClick={() => setAttachment(undefined)}
          >
            ×
          </button>
        </div>
      )}
      {commandMatches.length > 0 && (
        <div className="nu-composer__commands" data-nu-role="composer-commands">
          {commandMatches.map((command, index) => (
            <button
              key={command.name}
              type="button"
              className={
                index === commandIndex ? 'nu-composer__command-item nu-composer__command-item--active' : 'nu-composer__command-item'
              }
              data-nu-role="composer-command-item"
              onMouseDown={(evt) => {
                evt.preventDefault();
                selectCommand(command);
              }}
            >
              <span className="nu-composer__command-usage">{command.usage}</span>
              <span className="nu-composer__command-desc">{command.description}</span>
            </button>
          ))}
        </div>
      )}
      {commandError && (
        <p className="nu-composer__command-error" data-nu-role="composer-command-error">
          {commandError}
        </p>
      )}
      {mentionQuery !== null && mentionMatches.length > 0 && (
        <div className="nu-composer__mentions" data-nu-role="composer-mentions">
          {mentionMatches.map((member, index) => (
            <button
              key={member.userId}
              type="button"
              className={
                index === mentionIndex ? 'nu-composer__mention-item nu-composer__mention-item--active' : 'nu-composer__mention-item'
              }
              data-nu-role="composer-mention-item"
              onMouseDown={(evt) => {
                evt.preventDefault(); // keep textarea focus so selectMention can read its selection
                selectMention(member);
              }}
            >
              <Avatar name={member.name} mxcUrl={member.getMxcAvatarUrl()} size={18} />
              <span>{member.name}</span>
            </button>
          ))}
        </div>
      )}
      <form className="nu-composer" data-nu-role="composer" onSubmit={handleSubmit}>
        <button
          type="button"
          className="nu-composer__attach"
          data-nu-role="composer-attach"
          title="Upload a file"
          onClick={() => fileInputRef.current?.click()}
        >
          📎
        </button>
        <input
          ref={fileInputRef}
          type="file"
          className="nu-composer__file-input"
          data-nu-role="composer-file-input"
          onChange={handleFileChange}
        />
        <textarea
          ref={textareaRef}
          className="nu-composer__input"
          data-nu-role="composer-input"
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="Message…"
          rows={1}
        />
        <EmojiAndEmotePicker
          room={room ?? undefined}
          onPickEmoji={(emoji) => setText((t) => `${t}${emoji}`)}
          onPickEmote={(shortcode) => setText((t) => `${t}${t && !t.endsWith(' ') ? ' ' : ''}:${shortcode}: `)}
          onPickSticker={(sticker) => {
            // Sent immediately as its own m.sticker event — a sticker isn't text to compose
            // further, unlike an emote (which inserts a :shortcode: for the rest of the message
            // to build around).
            void mx.sendStickerMessage(roomId, threadId, sticker.mxcUrl, undefined, sticker.body);
          }}
        />
        <button
          className="nu-composer__send"
          type="submit"
          disabled={(!text.trim() && !attachment) || sending}
        >
          {uploading ? 'Uploading…' : 'Send'}
        </button>
      </form>
    </div>
  );
}
