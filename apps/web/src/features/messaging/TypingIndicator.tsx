import { useTypingMembers } from '../../matrix/hooks/useTypingMembers';
import './TypingIndicator.css';

export function TypingIndicator({ roomId }: { roomId: string }) {
  const typing = useTypingMembers(roomId);
  if (typing.length === 0) {
    return <div className="nu-typing-indicator" data-nu-role="typing-indicator" />;
  }

  const names = typing.map((member) => member.name);
  let text: string;
  if (names.length === 1) text = `${names[0]} is typing…`;
  else if (names.length === 2) text = `${names[0]} and ${names[1]} are typing…`;
  else text = `${names.length} people are typing…`;

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
