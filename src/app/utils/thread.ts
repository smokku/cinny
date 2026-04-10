import { IMentions, MatrixEvent, NotificationCountType, Room } from 'matrix-js-sdk';
import { Thread } from 'matrix-js-sdk/lib/models/thread';
import { reactionOrEditEvent } from './room';

/**
 * Client-evaluable highlight check for thread unread fallback.
 *
 * Returns true iff the event is either:
 *  - an MSC3952 intentional mention (`m.mentions.user_ids` contains
 *    `userId`), or
 *  - an explicit rich reply (`event.replyEventId`) whose target event was
 *    sent by `userId`.
 *
 * Thread replies carry an `m.in_reply_to` with `is_falling_back: true`
 * pointing at the previous thread message (MSC3440) so non-thread-aware
 * clients still render them in context.  That relation is NOT an explicit
 * reply from the user's perspective, so we must ignore it when classifying
 * highlights — otherwise every follow-up message in a thread the user has
 * posted in would be treated as a reply to the user.
 *
 * These are the only two push rules we can evaluate reliably without
 * server-side state or text matching against display names / keywords.
 * Other rules (display-name mention, keyword match) stay server-side.
 */
function isClientHighlight(event: MatrixEvent, userId: string, room: Room): boolean {
  const mentions = event.getContent<{ 'm.mentions'?: IMentions }>()['m.mentions'];
  if (mentions?.user_ids?.includes(userId)) return true;

  const relatesTo = event.getWireContent()['m.relates_to'] as
    | { is_falling_back?: boolean }
    | undefined;
  if (relatesTo?.is_falling_back === true) return false;

  const inReplyToId = event.replyEventId;
  if (!inReplyToId) return false;
  return room.findEventById(inReplyToId)?.getSender() === userId;
}

/**
 * Get unread reply events in a thread from other users after the read marker.
 *
 * Excludes the thread root (it's the anchor, not a reply) and reactions/edits.
 * Without the root exclusion, clicking "Reply in Thread" on someone else's
 * message without actually sending a reply would surface a phantom unread
 * badge in the browser: `createThread()` seeds the new Thread with only the
 * root event, the client hasn't sent a thread read receipt yet, and every
 * call site treats the root as "an unread message from the other user".
 */
function getUnreadThreadEvents(thread: Thread, userId: string): MatrixEvent[] {
  const readUpToId = thread.getEventReadUpTo(userId, false);
  const isCountableReply = (e: MatrixEvent) =>
    e.getId() !== thread.id && e.getSender() !== userId && !reactionOrEditEvent(e);

  const { events } = thread;
  const lastEvent = events[events.length - 1];
  if (lastEvent?.getSender() === userId) return [];

  if (!readUpToId) {
    return events.filter(isCountableReply);
  }
  const markerIndex = events.findIndex((e) => e.getId() === readUpToId);
  if (markerIndex === -1) {
    return events.filter(isCountableReply);
  }
  return events.slice(markerIndex + 1).filter(isCountableReply);
}

/**
 * Check if a thread has unread events via read receipts.
 * Fallback for servers that don't provide per-thread notification counts.
 *
 * Returns:
 * - hasUnread: true if there is any unread reply from another user (for a dot)
 * - highlight: true if at least one unread reply qualifies as a highlight
 *   (see `isClientHighlight`)
 * - highlightCount: number of unread replies that qualify as highlights.
 *   This is the only count we can produce without running the full push
 *   rule engine, so it is also the only number we feed into the sidebar's
 *   unread badge.  A plain reply shows up as a dot (`hasUnread: true`,
 *   `highlightCount: 0`), not a number.
 */
export function countThreadUnread(
  thread: Thread,
  userId: string
): { hasUnread: boolean; highlight: boolean; highlightCount: number } {
  const unreadEvents = getUnreadThreadEvents(thread, userId);
  const highlightEvents = unreadEvents.filter((e) => isClientHighlight(e, userId, thread.room));
  return {
    hasUnread: unreadEvents.length > 0,
    highlight: highlightEvents.length > 0,
    highlightCount: highlightEvents.length,
  };
}

/**
 * Per-thread unread figures with a client-side fallback for homeservers
 * that don't publish per-thread notification counters.  Prefers server
 * numbers when they are non-zero; otherwise scans thread events locally
 * via `countThreadUnread`.
 *
 * `hasUnread` is reported separately from `total` so that a thread with
 * one plain reply (no mention, not a reply to the user) surfaces in the
 * sidebar as a dot (`total: 0`) instead of a "1" count.  Only highlights
 * are counted because they are the only thing we can evaluate reliably
 * client-side — the server is authoritative for everything else.
 */
export function getThreadUnreadCounts(
  room: Room,
  threadId: string,
  userId: string
): { total: number; highlight: number; hasUnread: boolean } {
  const serverTotal = room.getThreadUnreadNotificationCount(threadId, NotificationCountType.Total);
  const serverHighlight = room.getThreadUnreadNotificationCount(
    threadId,
    NotificationCountType.Highlight
  );
  if (serverTotal > 0 || serverHighlight > 0) {
    return { total: serverTotal, highlight: serverHighlight, hasUnread: true };
  }

  const thread = room.getThread(threadId);
  if (!thread) return { total: 0, highlight: 0, hasUnread: false };

  const fallback = countThreadUnread(thread, userId);
  return {
    total: fallback.highlightCount,
    highlight: fallback.highlightCount,
    hasUnread: fallback.hasUnread,
  };
}
