import { MatrixClient, ReceiptType, RelationType } from 'matrix-js-sdk';

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

export async function markAsRead(mx: MatrixClient, roomId: string, privateReceipt: boolean) {
  await sendLatestReadReceipt(mx, roomId, privateReceipt, false, false);
}

export async function markAsReadScope(mx: MatrixClient, roomId: string, privateReceipt: boolean) {
  await sendLatestReadReceipt(mx, roomId, privateReceipt, true, true);
}
