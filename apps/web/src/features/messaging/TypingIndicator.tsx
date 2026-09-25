import { useTypingMembers } from '../../matrix/hooks/useTypingMembers';
import { describeTyping, useTypingVerbs } from '../../matrix/typingVerb';
import './TypingIndicator.css';

/** "Alice is typing…", in each person's own words where they've set one — "Alice is yelling…"
 *  (their profile's typing status, matrix/typingVerb.ts). */
export function TypingIndicator({ roomId }: { roomId: string }) {
  const typing = useTypingMembers(roomId);
  const verbs = useTypingVerbs(typing.map((member) => member.userId));
  if (typing.length === 0) {
    return <div className="nu-typing-indicator" data-nu-role="typing-indicator" />;
  }

  const text = describeTyping(typing.map((member) => ({ name: member.name, verb: verbs[member.userId] })));

  return (
    <div className="nu-typing-indicator" data-nu-role="typing-indicator">
      <span>{text}</span>
      <span className="nu-typing-indicator__dots" aria-hidden="true">
        <span className="nu-typing-indicator__dot" />
        <span className="nu-typing-indicator__dot" />
        <span className="nu-typing-indicator__dot" />
      </span>
    </div>
  );
}
