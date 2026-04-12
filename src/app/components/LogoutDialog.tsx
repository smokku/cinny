import React, { forwardRef, useCallback } from 'react';
import { Dialog, Header, config, Box, Text, Button, Spinner, color } from 'folds';
import { useAtomValue, useSetAtom } from 'jotai';
import { AsyncStatus, useAsyncCallback } from '../hooks/useAsyncCallback';
import { logoutClient } from '../../client/initMatrix';
import { useMatrixClient } from '../hooks/useMatrixClient';
import { useCrossSigningActive } from '../hooks/useCrossSigning';
import { InfoCard } from './info-card';
import {
  useDeviceVerificationStatus,
  VerificationStatus,
} from '../hooks/useDeviceVerificationStatus';
import { sessionsAtom } from '../state/sessions';
import { removeLiveClientAtom } from '../state/clientManager';
import { cleanupAccountAtomsAtom } from '../state/accountCleanup';

type LogoutDialogProps = {
  handleClose: () => void;
};
export const LogoutDialog = forwardRef<HTMLDivElement, LogoutDialogProps>(
  ({ handleClose }, ref) => {
    const mx = useMatrixClient();
    const sessions = useAtomValue(sessionsAtom);
    const setSessions = useSetAtom(sessionsAtom);
    const removeLiveClient = useSetAtom(removeLiveClientAtom);
    const cleanupAccountAtoms = useSetAtom(cleanupAccountAtomsAtom);
    const session = sessions.find((s) => s.userId === mx.getSafeUserId());
    const hasEncryptedRoom = !!mx.getRooms().find((room) => room.hasEncryptionStateEvent());
    const crossSigningActive = useCrossSigningActive();
    const verificationStatus = useDeviceVerificationStatus(
      mx.getCrypto(),
      mx.getSafeUserId(),
      mx.getDeviceId() ?? undefined
    );

    const [logoutState, logout] = useAsyncCallback<void, Error, []>(
      useCallback(async () => {
        if (session) {
          setSessions({ type: 'DELETE', session });
          removeLiveClient(session.userId);
          cleanupAccountAtoms(session.userId);
        }
        await logoutClient(mx, session);
      }, [mx, session, setSessions, removeLiveClient, cleanupAccountAtoms])
    );

    const ongoingLogout = logoutState.status === AsyncStatus.Loading;

    return (
      <Dialog variant="Surface" ref={ref}>
        <Header
          style={{
            padding: `0 ${config.space.S200} 0 ${config.space.S400}`,
            borderBottomWidth: config.borderWidth.B300,
          }}
          variant="Surface"
          size="500"
        >
          <Box grow="Yes">
            <Text size="H4">Logout</Text>
          </Box>
        </Header>
        <Box style={{ padding: config.space.S400 }} direction="Column" gap="400">
          {hasEncryptedRoom &&
            (crossSigningActive ? (
              verificationStatus === VerificationStatus.Unverified && (
                <InfoCard
                  variant="Critical"
                  title="Unverified Device"
                  description="Verify your device before logging out to save your encrypted messages."
                />
              )
            ) : (
              <InfoCard
                variant="Critical"
                title="Alert"
                description="Enable device verification or export your encrypted data from settings to avoid losing access to your messages."
              />
            ))}
          <Text priority="400">You’re about to log out. Are you sure?</Text>
          {logoutState.status === AsyncStatus.Error && (
            <Text style={{ color: color.Critical.Main }} size="T300">
              Failed to logout! {logoutState.error.message}
            </Text>
          )}
          <Box direction="Column" gap="200">
            <Button
              variant="Critical"
              onClick={logout}
              disabled={ongoingLogout}
              before={ongoingLogout && <Spinner variant="Critical" fill="Solid" size="200" />}
            >
              <Text size="B400">Logout</Text>
            </Button>
            <Button variant="Secondary" fill="Soft" onClick={handleClose} disabled={ongoingLogout}>
              <Text size="B400">Cancel</Text>
            </Button>
          </Box>
        </Box>
      </Dialog>
    );
  }
);
