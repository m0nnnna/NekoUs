export type NotificationSupport = 'unsupported' | NotificationPermission;

export function getNotificationPermission(): NotificationSupport {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

/** Must be called from within a real user gesture (a click handler) — browsers reject/ignore
 *  this otherwise. See AccountSettingsModal.tsx for the toggle that calls it. */
export async function requestNotificationPermission(): Promise<NotificationSupport> {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.requestPermission();
}
