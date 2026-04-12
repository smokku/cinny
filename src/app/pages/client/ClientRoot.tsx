import {
  Box,
  Button,
  config,
  Dialog,
  Icon,
  IconButton,
  Icons,
  Menu,
  MenuItem,
  PopOut,
  RectCords,
  Spinner,
  Text,
} from 'folds';
import {
  ClientEvent,
  HttpApiEvent,
  HttpApiEventHandlerMap,
  MatrixClient,
  SyncState,
} from 'matrix-js-sdk';
import FocusTrap from 'focus-trap-react';
import React, { MouseEventHandler, ReactNode, useEffect, useMemo, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import {
  clearCacheAndReload,
  clearLoginData,
  initClient,
  logoutClient,
  startClient,
  stopClient,
} from '../../../client/initMatrix';
import { SplashScreen } from '../../components/splash-screen';
import { ServerConfigsLoader } from '../../components/ServerConfigsLoader';
import { CapabilitiesProvider } from '../../hooks/useCapabilities';
import { MediaConfigProvider } from '../../hooks/useMediaConfig';
import { MatrixClientProvider } from '../../hooks/useMatrixClient';
import { SpecVersions } from './SpecVersions';
import { useSyncNicknames } from '../../hooks/useNickname';
import { stopPropagation } from '../../utils/keyboard';
import { SyncStatus } from './SyncStatus';
import { AuthMetadataProvider } from '../../hooks/useAuthMetadata';
import { Session, sessionsAtom, currentAccountIdAtom } from '../../state/sessions';
import {
  addLiveClientAtom,
  removeLiveClientAtom,
  updateSyncStateAtom,
  liveClientsAtom,
} from '../../state/clientManager';
import { AutoDiscovery } from './AutoDiscovery';
import { useBindRoomOwnerAtom } from '../../state/hooks/useBindRoomOwner';
import { useBindAtoms } from '../../state/hooks/useBindAtoms';
import { cleanupAccountAtomsAtom } from '../../state/accountCleanup';
import { pushSessionToSW } from '../../../sw-session';

function ClientRootLoading() {
  return (
    <SplashScreen>
      <Box direction="Column" grow="Yes" alignItems="Center" justifyContent="Center" gap="400">
        <Spinner variant="Secondary" size="600" />
        <Text>Heating up</Text>
      </Box>
    </SplashScreen>
  );
}

function ClientRootOptions({ mx }: { mx?: MatrixClient }) {
  const [menuAnchor, setMenuAnchor] = useState<RectCords>();

  const handleToggle: MouseEventHandler<HTMLButtonElement> = (evt) => {
    const cords = evt.currentTarget.getBoundingClientRect();
    setMenuAnchor((currentState) => {
      if (currentState) return undefined;
      return cords;
    });
  };

  return (
    <IconButton
      style={{
        position: 'absolute',
        top: config.space.S100,
        right: config.space.S100,
      }}
      variant="Background"
      fill="None"
      onClick={handleToggle}
    >
      <Icon size="200" src={Icons.VerticalDots} />
      <PopOut
        anchor={menuAnchor}
        position="Bottom"
        align="End"
        offset={6}
        content={
          <FocusTrap
            focusTrapOptions={{
              initialFocus: false,
              returnFocusOnDeactivate: false,
              onDeactivate: () => setMenuAnchor(undefined),
              clickOutsideDeactivates: true,
              isKeyForward: (evt: KeyboardEvent) => evt.key === 'ArrowDown',
              isKeyBackward: (evt: KeyboardEvent) => evt.key === 'ArrowUp',
              escapeDeactivates: stopPropagation,
            }}
          >
            <Menu>
              <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
                {mx && (
                  <MenuItem onClick={() => clearCacheAndReload(mx)} size="300" radii="300">
                    <Text as="span" size="T300" truncate>
                      Clear Cache and Reload
                    </Text>
                  </MenuItem>
                )}
                <MenuItem
                  onClick={() => {
                    if (mx) {
                      logoutClient(mx);
                      return;
                    }
                    clearLoginData();
                  }}
                  size="300"
                  radii="300"
                  variant="Critical"
                  fill="None"
                >
                  <Text as="span" size="T300" truncate>
                    Logout
                  </Text>
                </MenuItem>
              </Box>
            </Menu>
          </FocusTrap>
        }
      />
    </IconButton>
  );
}

const useLogoutListener = (mx: MatrixClient | undefined, session: Session | undefined) => {
  const setSessions = useSetAtom(sessionsAtom);
  const removeLiveClient = useSetAtom(removeLiveClientAtom);
  const cleanupAccountAtoms = useSetAtom(cleanupAccountAtomsAtom);

  useEffect(() => {
    if (!mx || !session) return undefined;
    const handleLogout: HttpApiEventHandlerMap[HttpApiEvent.SessionLoggedOut] = async () => {
      stopClient(mx);
      setSessions({ type: 'DELETE', session });
      removeLiveClient(session.userId);
      cleanupAccountAtoms(session.userId);
      await logoutClient(mx, session);
    };

    mx.on(HttpApiEvent.SessionLoggedOut, handleLogout);
    return () => {
      mx.removeListener(HttpApiEvent.SessionLoggedOut, handleLogout);
    };
  }, [mx, session, setSessions, removeLiveClient, cleanupAccountAtoms]);
};

// ---------------------------------------------------------------------------
// Per-account bootstrap hook
// ---------------------------------------------------------------------------
type AccountState = {
  session: Session;
  mx?: MatrixClient;
  error?: Error;
  syncing: boolean;
};

function useAccountBootstrap(session: Session): AccountState {
  const addLiveClient = useSetAtom(addLiveClientAtom);
  const updateSyncState = useSetAtom(updateSyncStateAtom);
  const removeLiveClient = useSetAtom(removeLiveClientAtom);

  const [mx, setMx] = useState<MatrixClient | undefined>();
  const [error, setError] = useState<Error | undefined>();
  const [syncing, setSyncing] = useState(false);

  // Init + start
  useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      try {
        const client = await initClient(session);
        if (cancelled) {
          client.stopClient();
          return;
        }
        setMx(client);
        addLiveClient({ session, client, syncState: null });

        await startClient(client);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err : new Error(String(err)));
      }
    };
    boot();
    return () => {
      cancelled = true;
    };
  }, [session, addLiveClient]);

  // Sync state tracking
  useEffect(() => {
    if (!mx) return undefined;
    const onSync = (state: SyncState) => {
      updateSyncState({ userId: session.userId, syncState: state });
      if (state === SyncState.Syncing || state === SyncState.Prepared) {
        setSyncing(true);
      }
    };
    mx.on(ClientEvent.Sync, onSync);
    return () => {
      mx.removeListener(ClientEvent.Sync, onSync);
    };
  }, [mx, session.userId, updateSyncState]);

  // Cleanup on unmount
  useEffect(
    () => () => {
      if (mx) {
        removeLiveClient(session.userId);
        mx.stopClient();
      }
    },
    [mx, session.userId, removeLiveClient]
  );

  useSyncNicknames(mx);
  useLogoutListener(mx, session);

  return { session, mx, error, syncing };
}

// ---------------------------------------------------------------------------
// Multi-account root
// ---------------------------------------------------------------------------
type ClientRootProps = {
  children: ReactNode;
};
export function ClientRoot({ children }: ClientRootProps) {
  const sessions = useAtomValue(sessionsAtom);
  const currentAccountId = useAtomValue(currentAccountIdAtom);
  const setCurrentAccountId = useSetAtom(currentAccountIdAtom);
  const liveClients = useAtomValue(liveClientsAtom);

  // Set default current account to first session
  useEffect(() => {
    if (sessions.length > 0) {
      if (!currentAccountId || !sessions.some((s) => s.userId === currentAccountId)) {
        setCurrentAccountId(sessions[0].userId);
      }
    }
  }, [sessions, currentAccountId, setCurrentAccountId]);

  // Push all sessions to SW for multi-account media auth
  useEffect(() => {
    if (sessions.length > 0) {
      pushSessionToSW(sessions.map((s) => ({ baseUrl: s.baseUrl, accessToken: s.accessToken })));
    }
  }, [sessions]);

  // Boot each session
  const accountStates = sessions.map((s) => <AccountBootstrapper key={s.userId} session={s} />);

  // Determine the "primary" client for provider tree (first syncing account)
  const primaryClient = useMemo(() => {
    for (const s of sessions) {
      const lc = liveClients.get(s.userId);
      if (lc?.client) return lc;
    }
    return undefined;
  }, [sessions, liveClients]);

  const allSyncing = useMemo(
    () =>
      sessions.length > 0 &&
      sessions.every((s) => {
        const lc = liveClients.get(s.userId);
        return lc?.syncState === SyncState.Syncing || lc?.syncState === SyncState.Prepared;
      }),
    [sessions, liveClients]
  );

  const anyError = useMemo(() => sessions.length === 0, [sessions]);

  const loading = !allSyncing;
  const mx = primaryClient?.client;
  const session = primaryClient?.session;

  return (
    <>
      {accountStates}
      {session && (
        <AutoDiscovery userId={session.userId} baseUrl={session.baseUrl}>
          <SpecVersions baseUrl={session.baseUrl}>
            {mx && <SyncStatus mx={mx} />}
            {loading && <ClientRootOptions mx={mx} />}
            {anyError && (
              <SplashScreen>
                <Box
                  direction="Column"
                  grow="Yes"
                  alignItems="Center"
                  justifyContent="Center"
                  gap="400"
                >
                  <Dialog>
                    <Box direction="Column" gap="400" style={{ padding: config.space.S400 }}>
                      <Text>No active sessions found.</Text>
                      <Button variant="Critical" onClick={() => window.location.reload()}>
                        <Text as="span" size="B400">
                          Retry
                        </Text>
                      </Button>
                    </Box>
                  </Dialog>
                </Box>
              </SplashScreen>
            )}
            {loading || !mx ? (
              <ClientRootLoading />
            ) : (
              <MatrixClientProvider value={mx}>
                <ServerConfigsLoader>
                  {(serverConfigs) => (
                    <CapabilitiesProvider value={serverConfigs.capabilities ?? {}}>
                      <MediaConfigProvider value={serverConfigs.mediaConfig ?? {}}>
                        <AuthMetadataProvider value={serverConfigs.authMetadata}>
                          {children}
                        </AuthMetadataProvider>
                      </MediaConfigProvider>
                    </CapabilitiesProvider>
                  )}
                </ServerConfigsLoader>
              </MatrixClientProvider>
            )}
          </SpecVersions>
        </AutoDiscovery>
      )}
      {!session && (
        <SplashScreen>
          <Box direction="Column" grow="Yes" alignItems="Center" justifyContent="Center" gap="400">
            <Spinner variant="Secondary" size="600" />
            <Text>Initializing accounts...</Text>
          </Box>
        </SplashScreen>
      )}
    </>
  );
}

/**
 * Invisible component that owns the lifecycle for one account session.
 * Binds all per-account atoms (rooms, invites, DMs, parents, unread, etc.).
 */
function AccountBootstrapper({ session }: { session: Session }) {
  const { mx } = useAccountBootstrap(session);
  useBindRoomOwnerAtom(mx);
  return mx ? <AccountAtomBinder mx={mx} /> : null;
}

function AccountAtomBinder({ mx }: { mx: MatrixClient }) {
  useBindAtoms(mx);
  return null;
}
