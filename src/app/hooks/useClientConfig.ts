import { createContext, useContext } from 'react';
import CinnySVG from '../../../public/res/svg/cinny.svg';

export type HashRouterConfig = {
  enabled?: boolean;
  basename?: string;
};

export type BrandingConfig = {
  enabled?: boolean;
  name?: string;
  version?: string;
  logo?: string;
  sourceUrl?: string;
};

export type ResolvedBranding = {
  name: string;
  version: string;
  logo: string;
  sourceUrl: string;
  deviceDisplayName: string;
};

export type ClientConfig = {
  defaultHomeserver?: number;
  homeserverList?: string[];
  allowCustomHomeservers?: boolean;

  featuredCommunities?: {
    openAsDefault?: boolean;
    spaces?: string[];
    rooms?: string[];
    servers?: string[];
  };

  registrationTokenSources?: Record<string, string>;

  hashRouter?: HashRouterConfig;

  branding?: BrandingConfig;
};

const ClientConfigContext = createContext<ClientConfig | null>(null);

export const ClientConfigProvider = ClientConfigContext.Provider;

export function useClientConfig(): ClientConfig {
  const config = useContext(ClientConfigContext);
  if (!config) throw new Error('Client config are not provided!');
  return config;
}

export const clientDefaultServer = (clientConfig: ClientConfig): string =>
  clientConfig.homeserverList?.[clientConfig.defaultHomeserver ?? 0] ?? 'matrix.org';

export const clientAllowedServer = (clientConfig: ClientConfig, server: string): boolean => {
  const { homeserverList, allowCustomHomeservers } = clientConfig;

  if (allowCustomHomeservers) return true;

  return homeserverList?.includes(server) === true;
};

const DEFAULT_BRANDING: ResolvedBranding = {
  name: 'Cinny',
  version: '4.10.5',
  logo: CinnySVG,
  sourceUrl: 'https://github.com/cinnyapp/cinny',
  deviceDisplayName: 'Cinny Web',
};

export const clientBranding = (clientConfig: ClientConfig): ResolvedBranding => {
  const branding = clientConfig.branding ?? {};
  const merged = {
    ...DEFAULT_BRANDING,
    ...(branding.enabled !== false
      ? Object.fromEntries(
          Object.entries(branding).filter(
            ([k, v]) => k !== 'enabled' && v !== undefined && v !== ''
          )
        )
      : {}),
  };
  return {
    ...merged,
    deviceDisplayName: `${merged.name} Web`,
  };
};
