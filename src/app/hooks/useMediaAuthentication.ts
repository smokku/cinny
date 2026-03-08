import { useSpecVersions } from './useSpecVersions';
import { supportsAuthenticatedMedia } from '../utils/mediaAuthentication';

export const useMediaAuthentication = (): boolean => supportsAuthenticatedMedia(useSpecVersions());
