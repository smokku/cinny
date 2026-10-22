import { useEffect, useState } from 'react';
import { MatrixClient } from 'matrix-js-sdk';
import { getSlidingSyncManager } from '../../client/initMatrix';
import { HydrationProgress } from '../../client/slidingSync';

type HydrationState = { isHydrating: boolean; progress?: HydrationProgress };

/** Whether sliding sync is still paging the room lists in, and how far it got. */
export const useSlidingSyncHydrating = (mx: MatrixClient): HydrationState => {
  const manager = getSlidingSyncManager(mx);
  const [state, setState] = useState<HydrationState>(() => ({
    isHydrating: manager?.isSyncingRoomData() ?? false,
    progress: manager?.isSyncingRoomData() ? manager.getHydrationProgress() : undefined,
  }));

  useEffect(() => {
    if (!manager) {
      setState({ isHydrating: false });
      return undefined;
    }
    return manager.onHydrationStatusChange((isHydrating, progress) => {
      setState({ isHydrating, progress });
    });
  }, [manager]);

  return state;
};
