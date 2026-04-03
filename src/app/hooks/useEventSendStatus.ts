import { useEffect, useState } from 'react';
import { MatrixEvent, MatrixEventEvent, MatrixEventHandlerMap } from 'matrix-js-sdk';
import { EventStatus } from 'matrix-js-sdk/lib/models/event-status';

export function useEventSendStatus(mEvent: MatrixEvent): EventStatus | null {
  const [status, setStatus] = useState<EventStatus | null>(mEvent.status);

  useEffect(() => {
    setStatus(mEvent.status);
    const handleStatus: MatrixEventHandlerMap[MatrixEventEvent.Status] = (_event, newStatus) => {
      setStatus(newStatus);
    };
    mEvent.on(MatrixEventEvent.Status, handleStatus);
    return () => {
      mEvent.removeListener(MatrixEventEvent.Status, handleStatus);
    };
  }, [mEvent]);

  return status;
}
