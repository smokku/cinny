import { MatrixEvent } from 'matrix-js-sdk';
import { Thread } from 'matrix-js-sdk/lib/models/thread';

export function eventMentionsUser(event: MatrixEvent, userId: string): boolean {
  const content = event.getContent();
  const mentionIds: string[] | undefined = content['m.mentions']?.user_ids;
  if (Array.isArray(mentionIds) && mentionIds.includes(userId)) return true;
  const { body } = content;
  if (typeof body === 'string' && body.includes(userId)) return true;
  return false;
}

/**
 * Get unread events in a thread from others after the read marker.
 */
function getUnreadThreadEvents(thread: Thread, userId: string): MatrixEvent[] {
  const readUpToId = thread.getEventReadUpTo(userId, false);
  const { events } = thread;

  const lastEvent = events[events.length - 1];
  if (lastEvent?.getSender() === userId) return [];

  if (!readUpToId) {
    return events.filter((e) => e.getSender() !== userId);
  }
  const markerIndex = events.findIndex((e) => e.getId() === readUpToId);
  if (markerIndex === -1) {
    return events.filter((e) => e.getSender() !== userId);
  }
  return events.slice(markerIndex + 1).filter((e) => e.getSender() !== userId);
}

/**
 * Check if a thread has unread events via read receipts.
 * Fallback for servers that don't provide per-thread notification counts.
 *
 * Returns:
 * - hasUnread: true if there are any unread events from others (for showing a dot)
 * - highlight: true if any unread event mentions the user (for highlighted badge)
 *
 * Note: does NOT return a count because we can't evaluate push rules client-side.
 * The server's notification_count is the authoritative source for counts.
 * This fallback only determines presence (dot) and highlights (mention detection).
 */
export function countThreadUnread(
  thread: Thread,
  userId: string
): { hasUnread: boolean; highlight: boolean } {
  const unreadEvents = getUnreadThreadEvents(thread, userId);
  return {
    hasUnread: unreadEvents.length > 0,
    highlight: unreadEvents.some((e) => eventMentionsUser(e, userId)),
  };
}
