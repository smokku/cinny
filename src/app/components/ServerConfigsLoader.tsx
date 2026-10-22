import { ReactNode, useCallback, useMemo } from 'react';
import { Capabilities, ValidatedAuthMetadata } from 'matrix-js-sdk';
import { AsyncStatus, useAsyncCallbackValue } from '../hooks/useAsyncCallback';
import { useMatrixClient } from '../hooks/useMatrixClient';
import { MediaConfig } from '../hooks/useMediaConfig';
import { useSpecVersions } from '../hooks/useSpecVersions';
import { promiseFulfilledResult } from '../utils/common';
import { requestMediaConfig } from '../utils/mediaAuthentication';

export type ServerConfigs = {
  capabilities?: Capabilities;
  mediaConfig?: MediaConfig;
  authMetadata?: ValidatedAuthMetadata;
};

type ServerConfigsLoaderProps = {
  children: (configs: ServerConfigs) => ReactNode;
};
export function ServerConfigsLoader({ children }: ServerConfigsLoaderProps) {
  const mx = useMatrixClient();
  const specVersions = useSpecVersions();
  const fallbackConfigs = useMemo(() => ({}), []);

  const [configsState] = useAsyncCallbackValue<ServerConfigs, unknown>(
    useCallback(async () => {
      const result = await Promise.allSettled([
        mx.getCapabilities(),
        requestMediaConfig<MediaConfig>(mx, specVersions),
        mx.getAuthMetadata(),
      ]);

      const capabilities = promiseFulfilledResult(result[0]);
      const mediaConfig = promiseFulfilledResult(result[1]);
      // getAuthMetadata rejects metadata that does not validate.
      const authMetadata = promiseFulfilledResult(result[2]);

      return {
        capabilities,
        mediaConfig,
        authMetadata,
      };
    }, [mx, specVersions])
  );

  const configs: ServerConfigs =
    configsState.status === AsyncStatus.Success ? configsState.data : fallbackConfigs;

  return children(configs);
}
