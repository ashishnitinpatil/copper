// Invite links: `/join/<bookId>`. The partner who owns the book shares the file
// with the other person's Google account, then sends them this link. Opening it
// remembers the book for this tab and routes to wherever joining happens — the
// Welcome screen on a new device, Settings on one already in use — which opens
// the Picker on exactly that file (see pickSharedBook).
const INVITE_KEY = 'et-invite-book-id';

export function inviteLink(bookId: string): string {
  return `${window.location.origin}/join/${encodeURIComponent(bookId)}`;
}

export function stashInvite(bookId: string): void {
  try {
    sessionStorage.setItem(INVITE_KEY, bookId);
  } catch {
    // Storage blocked: the person can still join by choosing the book manually.
  }
}

export function peekInvite(): string | null {
  try {
    return sessionStorage.getItem(INVITE_KEY);
  } catch {
    return null;
  }
}

export function clearInvite(): void {
  try {
    sessionStorage.removeItem(INVITE_KEY);
  } catch {
    // ignore
  }
}
