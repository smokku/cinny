import type { SpecVersions } from '../cs-api';

export const AUTHENTICATED_MEDIA_UNSTABLE_FEATURE = 'org.matrix.msc3916.stable';

export type MediaAuthenticationSupport = Pick<SpecVersions, 'versions' | 'unstable_features'>;

type MediaConfigFetcher<T> = {
  getMediaConfig: (useAuthenticatedMedia?: boolean) => Promise<T>;
};

type MediaConfigFetcherWithVersionLookup<T> = MediaConfigFetcher<T> & {
  getVersions: () => Promise<MediaAuthenticationSupport>;
};

export const supportsAuthenticatedMedia = ({
  versions,
  unstable_features: unstableFeatures,
}: MediaAuthenticationSupport): boolean =>
  unstableFeatures?.[AUTHENTICATED_MEDIA_UNSTABLE_FEATURE] === true || versions.includes('v1.11');

export const requestMediaConfig = <T>(
  client: MediaConfigFetcher<T>,
  support: MediaAuthenticationSupport
): Promise<T> => client.getMediaConfig(supportsAuthenticatedMedia(support));

export const requestMediaConfigFromServerVersions = async <T>(
  client: MediaConfigFetcherWithVersionLookup<T>
): Promise<T> => requestMediaConfig(client, await client.getVersions());
