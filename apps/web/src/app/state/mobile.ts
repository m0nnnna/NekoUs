import { atom } from 'jotai';

/**
 * Whether the member list is open as a slide-in drawer on narrow (mobile-width) viewports. Has
 * no effect above the responsive breakpoint (styles/base/shell.css), where the member list is
 * always visible as its own column. Lives in its own atom (rather than local component state)
 * because the toggle button (MainPane's header) and the drawer itself (MemberList) are sibling
 * components, not parent/child.
 */
export const mobileMemberListOpenAtom = atom<boolean>(false);
