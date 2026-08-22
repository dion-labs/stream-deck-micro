const MAC_NOTIFICATION_SCRIPT = `on run argv
  display notification (item 2 of argv) with title (item 1 of argv) sound name "Subtle"
end run`;

/** Build osascript arguments without interpolating user/session text into AppleScript. */
export function macNotificationArgs(title: string, body: string): string[] {
  return [
    '-e',
    MAC_NOTIFICATION_SCRIPT,
    '--',
    title.slice(0, 80),
    body.slice(0, 250),
  ];
}
