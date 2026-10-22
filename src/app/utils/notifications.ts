import {
  MatrixClient,
  NotificationCountType,
  ReceiptType,
  RelationType,
  Room,
} from 'matrix-js-sdk';
import { getThreadUnreadCounts } from './thread';

const sendLatestReadReceipt = async (
  mx: MatrixClient,
  roomId: string,
  privateReceipt: boolean,
  includeThreadEvents: boolean,
  unthreaded: boolean
) => {
  const room = mx.getRoom(roomId);
  if (!room) return;

  const timeline = room.getLiveTimeline().getEvents();
  const userId = mx.getUserId();
  if (!userId) return;
  const readEventId = room.getEventReadUpTo(userId);

  const getLatestValidEvent = () => {
    for (let i = timeline.length - 1; i >= 0; i -= 1) {
      const latestEvent = timeline[i];
      if (!unthreaded && latestEvent.getId() === readEventId) return null;
      if (
        (includeThreadEvents || !latestEvent.isRelation(RelationType.Thread)) &&
        !latestEvent.isSending()
      ) {
        return latestEvent;
      }
    }
    return null;
  };
  if (timeline.length === 0) return;
  const latestEvent = getLatestValidEvent();
  if (latestEvent === null) return;

  await mx.sendReadReceipt(
    latestEvent,
    privateReceipt ? ReceiptType.ReadPrivate : ReceiptType.Read,
    unthreaded
  );
};

// Thread replies never land in the live timeline, so the room receipt alone
// can't clear them: send a receipt for the last reply of every unread thread.
const markThreadsAsRead = async (mx: MatrixClient, room: Room, privateReceipt: boolean) => {
  const userId = mx.getUserId();
  if (!userId) return;
  const receiptType = privateReceipt ? ReceiptType.ReadPrivate : ReceiptType.Read;

  await Promise.all(
    room.getThreads().map(async (thread) => {
      if (!getThreadUnreadCounts(room, thread.id, userId).hasUnread) return;

      const lastReply = thread.lastReply((event) => !event.isSending());
      if (!lastReply?.getId()) return;

      if (thread.getEventReadUpTo(userId) !== lastReply.getId()) {
        try {
          await mx.sendReadReceipt(lastReply, receiptType);
        } catch {
          return;
        }
      }
      room.setThreadUnreadNotificationCount(thread.id, NotificationCountType.Total, 0);
      room.setThreadUnreadNotificationCount(thread.id, NotificationCountType.Highlight, 0);
    })
  );
};

/**
 * @param includeThreads for explicit "mark as read" actions only: reading the
 * main timeline must not clear threads the user has not opened.
 */
export async function markAsRead(
  mx: MatrixClient,
  roomId: string,
  privateReceipt: boolean,
  includeThreads = false
) {
  await sendLatestReadReceipt(mx, roomId, privateReceipt, false, false);

  const room = mx.getRoom(roomId);
  if (includeThreads && room) await markThreadsAsRead(mx, room, privateReceipt);
}

export async function markAsReadScope(mx: MatrixClient, roomId: string, privateReceipt: boolean) {
  await sendLatestReadReceipt(mx, roomId, privateReceipt, true, true);

  const room = mx.getRoom(roomId);
  if (room) await markThreadsAsRead(mx, room, privateReceipt);
}
