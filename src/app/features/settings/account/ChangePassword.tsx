import React, { FormEventHandler, useCallback, useEffect, useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  color,
  config,
  Dialog,
  Header,
  Icon,
  IconButton,
  Icons,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Spinner,
  Text,
} from 'folds';
import FocusTrap from 'focus-trap-react';
import to from 'await-to-js';
import { AuthDict, IAuthData, MatrixClient, MatrixError } from 'matrix-js-sdk';
import { SequenceCard } from '../../../components/sequence-card';
import { SequenceCardStyle } from '../styles.css';
import { SettingTile } from '../../../components/setting-tile';
import { PasswordInput } from '../../../components/password-input';
import { ConfirmPasswordMatch } from '../../../components/ConfirmPasswordMatch';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { AsyncStatus, useAsyncCallback } from '../../../hooks/useAsyncCallback';
import { ActionUIA, ActionUIAFlowsLoader } from '../../../components/ActionUIA';
import { useCapabilities } from '../../../hooks/useCapabilities';
import { stopPropagation } from '../../../utils/keyboard';

type ChangePasswordResponse = Record<string, never>;
type ChangePasswordResult = [IAuthData, undefined] | [undefined, ChangePasswordResponse];

const changePassword = async (
  mx: MatrixClient,
  authDict: AuthDict,
  newPassword: string,
  logoutDevices: boolean
): Promise<ChangePasswordResult> => {
  const [err, res] = await to<ChangePasswordResponse, MatrixError>(
    mx.setPassword(authDict, newPassword, logoutDevices)
  );

  if (err) {
    if (err.httpStatus === 401) {
      const authData = err.data as IAuthData;
      return [authData, undefined];
    }
    throw err;
  }
  return [undefined, res];
};

function ChangePasswordSuccess({ onClose }: { onClose: () => void }) {
  return (
    <Overlay open backdrop={<OverlayBackdrop />}>
      <OverlayCenter>
        <FocusTrap
          focusTrapOptions={{
            initialFocus: false,
            onDeactivate: onClose,
            clickOutsideDeactivates: true,
            escapeDeactivates: stopPropagation,
          }}
        >
          <Dialog variant="Surface">
            <Header
              style={{
                padding: `0 ${config.space.S200} 0 ${config.space.S400}`,
                borderBottomWidth: config.borderWidth.B300,
              }}
              variant="Surface"
              size="500"
            >
              <Box grow="Yes">
                <Text size="H4">Password Changed</Text>
              </Box>
              <IconButton size="300" onClick={onClose} radii="300">
                <Icon src={Icons.Cross} />
              </IconButton>
            </Header>
            <Box style={{ padding: config.space.S400 }} direction="Column" gap="400">
              <Text size="T200">Your password has been changed successfully.</Text>
              <Button variant="Primary" onClick={onClose}>
                <Text as="span" size="B400">
                  Continue
                </Text>
              </Button>
            </Box>
          </Dialog>
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}

type ChangePasswordFormProps = {
  onCancel: () => void;
  onSuccess: () => void;
};

function ChangePasswordForm({ onCancel, onSuccess }: ChangePasswordFormProps) {
  const mx = useMatrixClient();
  const [formData, setFormData] = useState<{
    newPassword: string;
    logoutDevices: boolean;
  } | null>(null);

  const [changePasswordState, handleChangePassword] = useAsyncCallback<
    ChangePasswordResult,
    Error,
    [AuthDict, string, boolean]
  >(
    useCallback(
      async (authDict, newPassword, logoutDevices) =>
        changePassword(mx, authDict, newPassword, logoutDevices),
      [mx]
    )
  );

  const [ongoingAuthData, changePasswordResult] =
    changePasswordState.status === AsyncStatus.Success
      ? changePasswordState.data
      : [undefined, undefined];

  const handleFormSubmit: FormEventHandler<HTMLFormElement> = (evt) => {
    evt.preventDefault();

    const data = new FormData(evt.currentTarget);
    const newPassword = data.get('newPassword') as string;
    const confirmPassword = data.get('confirmPassword') as string;
    const logoutDevices = data.get('logoutDevices') === 'on';

    if (!newPassword || !confirmPassword) return;
    if (newPassword !== confirmPassword) return;

    setFormData({ newPassword, logoutDevices });
    handleChangePassword({} as AuthDict, newPassword, logoutDevices);
  };

  useEffect(() => {
    if (changePasswordResult && !ongoingAuthData) {
      onSuccess();
    }
  }, [changePasswordResult, ongoingAuthData, onSuccess]);

  if (changePasswordResult && !ongoingAuthData) {
    return null;
  }

  if (ongoingAuthData) {
    return (
      <ActionUIAFlowsLoader
        authData={ongoingAuthData}
        unsupported={() => (
          <Overlay open backdrop={<OverlayBackdrop />}>
            <OverlayCenter>
              <FocusTrap
                focusTrapOptions={{
                  initialFocus: false,
                  onDeactivate: onCancel,
                  clickOutsideDeactivates: true,
                  escapeDeactivates: stopPropagation,
                }}
              >
                <Dialog variant="Surface">
                  <Box style={{ padding: config.space.S400 }} direction="Column" gap="400">
                    <Text>
                      This server requires authentication methods that are not supported by this
                      client.
                    </Text>
                    <Button variant="Primary" onClick={onCancel}>
                      <Text size="B400" as="span">
                        Close
                      </Text>
                    </Button>
                  </Box>
                </Dialog>
              </FocusTrap>
            </OverlayCenter>
          </Overlay>
        )}
      >
        {(ongoingFlow) => (
          <ActionUIA
            authData={ongoingAuthData}
            ongoingFlow={ongoingFlow}
            action={(authDict) => {
              if (formData) {
                handleChangePassword(authDict, formData.newPassword, formData.logoutDevices);
              } else {
                onCancel();
              }
            }}
            onCancel={onCancel}
          />
        )}
      </ActionUIAFlowsLoader>
    );
  }

  const isLoading = changePasswordState.status === AsyncStatus.Loading;
  const error =
    changePasswordState.status === AsyncStatus.Error ? changePasswordState.error : undefined;

  return (
    <Overlay open backdrop={<OverlayBackdrop />}>
      <OverlayCenter>
        <FocusTrap
          focusTrapOptions={{
            initialFocus: false,
            onDeactivate: onCancel,
            clickOutsideDeactivates: true,
            escapeDeactivates: stopPropagation,
          }}
        >
          <Dialog variant="Surface">
            <Header
              style={{
                padding: `0 ${config.space.S200} 0 ${config.space.S400}`,
                borderBottomWidth: config.borderWidth.B300,
              }}
              variant="Surface"
              size="500"
            >
              <Box grow="Yes">
                <Text size="H4">Change Password</Text>
              </Box>
              <IconButton size="300" onClick={onCancel} radii="300">
                <Icon src={Icons.Cross} />
              </IconButton>
            </Header>
            <Box
              as="form"
              onSubmit={handleFormSubmit}
              style={{ padding: config.space.S400 }}
              direction="Column"
              gap="400"
            >
              <ConfirmPasswordMatch initialValue>
                {(match, doMatch, passRef, confPassRef) => (
                  <>
                    <Box direction="Column" gap="100">
                      <Text size="L400">New Password</Text>
                      <PasswordInput
                        ref={passRef}
                        onChange={doMatch}
                        name="newPassword"
                        size="400"
                        outlined
                        required
                        autoFocus
                      />
                    </Box>
                    <Box direction="Column" gap="100">
                      <Text size="L400">Confirm New Password</Text>
                      <PasswordInput
                        ref={confPassRef}
                        onChange={doMatch}
                        name="confirmPassword"
                        size="400"
                        style={{ color: match ? undefined : color.Critical.Main }}
                        outlined
                        required
                      />
                    </Box>
                  </>
                )}
              </ConfirmPasswordMatch>

              <Box alignItems="Center" gap="200">
                <Checkbox name="logoutDevices" size="300" variant="Primary" defaultChecked />
                <Text as="label" size="T300">
                  Logout all other devices
                </Text>
              </Box>

              {error && (
                <Text style={{ color: color.Critical.Main }} size="T200">
                  <b>Failed to change password: {error.message}</b>
                </Text>
              )}

              <Button variant="Primary" type="submit" disabled={isLoading}>
                {isLoading && <Spinner variant="Primary" size="300" />}
                <Text as="span" size="B400">
                  Change Password
                </Text>
              </Button>
            </Box>
          </Dialog>
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}

export function ChangePassword() {
  const [showDialog, setShowDialog] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const capabilities = useCapabilities();

  const disableChangePassword = capabilities['m.change_password']?.enabled === false;

  const handleCloseDialog = () => {
    setShowDialog(false);
    setShowSuccess(false);
  };
  const handleSuccess = () => {
    setShowDialog(false);
    setShowSuccess(true);
  };

  return (
    <>
      <Box direction="Column" gap="100">
        <Text size="L400">Password</Text>
        <SequenceCard
          className={SequenceCardStyle}
          variant="SurfaceVariant"
          direction="Column"
          gap="400"
        >
          <SettingTile
            title="Change Password"
            description={
              disableChangePassword
                ? 'Password changes are disabled by your server administrator.'
                : 'Change your account password.'
            }
            after={
              <Button
                variant="Secondary"
                size="300"
                fill="Soft"
                outlined
                radii="300"
                onClick={() => setShowDialog(true)}
                disabled={disableChangePassword}
              >
                <Text size="B300">Change</Text>
              </Button>
            }
          />
        </SequenceCard>
      </Box>

      {showDialog && <ChangePasswordForm onCancel={handleCloseDialog} onSuccess={handleSuccess} />}

      {showSuccess && <ChangePasswordSuccess onClose={handleCloseDialog} />}
    </>
  );
}
