import { ReactNode, useCallback, useEffect } from 'react';
import { AsyncStatus, useAsyncCallback } from '../hooks/useAsyncCallback';
import { useMatrixClient } from '../hooks/useMatrixClient';
import { MediaConfig } from '../hooks/useMediaConfig';
import { useSpecVersions } from '../hooks/useSpecVersions';
import { requestMediaConfig } from '../utils/mediaAuthentication';

type MediaConfigLoaderProps = {
  children: (mediaConfig: MediaConfig | undefined) => ReactNode;
};
export function MediaConfigLoader({ children }: MediaConfigLoaderProps) {
  const mx = useMatrixClient();
  const specVersions = useSpecVersions();

  const [state, load] = useAsyncCallback(
    useCallback(() => requestMediaConfig<MediaConfig>(mx, specVersions), [mx, specVersions])
  );

  useEffect(() => {
    load();
  }, [load]);

  return children(state.status === AsyncStatus.Success ? state.data : undefined);
}
