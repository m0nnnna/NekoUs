import { ROLE_LEVELS, type RoleId } from '../matrix/roles';
import { Icon } from './Icon';
import './RoleBadge.css';

/** Small crown (admin) or shield (moderator) after a name — in the member list and next to a
 *  message's sender. Renders nothing for ordinary members. */
export function RoleBadge({ roleId }: { roleId: RoleId }) {
  if (roleId === 'member') return null;
  const label = ROLE_LEVELS.find((role) => role.id === roleId)?.label;
  return (
    <span className={`nu-role-badge nu-role-badge--${roleId}`} data-nu-role="role-badge" title={label} aria-label={label}>
      <Icon name={roleId === 'admin' ? 'crown' : 'shield'} size={12} />
    </span>
  );
}
