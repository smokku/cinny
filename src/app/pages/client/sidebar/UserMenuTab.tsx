import React, {
  ChangeEventHandler,
  FormEventHandler,
  MouseEventHandler,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  Box,
  Button,
  Icon,
  IconButton,
  Icons,
  Input,
  Line,
  Menu,
  MenuItem,
  PopOut,
  RectCords,
  Spinner,
  Text,
  config,
  toRem,
} from 'folds';
import FocusTrap from 'focus-trap-react';
import { SidebarAvatar, SidebarItem, SidebarItemTooltip } from '../../../components/sidebar';
import { UserAvatar } from '../../../components/user-avatar';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { getMxIdLocalPart, mxcUrlToHttp } from '../../../utils/matrix';
import { nameInitials } from '../../../utils/common';
import { useMediaAuthentication } from '../../../hooks/useMediaAuthentication';
import { Settings } from '../../../features/settings';
import { useUserProfile } from '../../../hooks/useUserProfile';
import { Modal500 } from '../../../components/Modal500';
import { stopPropagation } from '../../../utils/keyboard';
import { useUserPresence, Presence } from '../../../hooks/useUserPresence';
import { UserHero, UserHeroName } from '../../../components/user-profile/UserHero';
import { useSetting } from '../../../state/hooks/settings';
import { settingsAtom } from '../../../state/settings';
import { PresenceBadge } from '../../../components/presence';

type PresenceClient = {
  setPresence?: (state: { presence: string; status_msg?: string }) => Promise<void>;
};

const PresenceOptions: Array<{ value: Presence; label: string }> = [
  { value: Presence.Online, label: 'Online' },
  { value: Presence.Unavailable, label: 'Away' },
  { value: Presence.Offline, label: 'Offline' },
];

export function UserMenuTab() {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();

  const userId = mx.getUserId() ?? '';
  const profile = useUserProfile(userId);
  const presence = useUserPresence(userId);

  const [menuAnchor, setMenuAnchor] = useState<RectCords>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);

  const displayName = profile.displayName ?? getMxIdLocalPart(userId) ?? userId;
  const avatarUrl = profile.avatarUrl
    ? mxcUrlToHttp(mx, profile.avatarUrl, useAuthentication, 96, 96, 'crop') ?? undefined
    : undefined;
  const heroAvatarUrl = profile.avatarUrl
    ? mxcUrlToHttp(mx, profile.avatarUrl, useAuthentication) ?? undefined
    : undefined;

  const parsedBanner =
    typeof profile.bannerUrl === 'string' ? profile.bannerUrl.replace(/^"|"$/g, '') : undefined;
  const heroBannerUrl = parsedBanner
    ? mxcUrlToHttp(mx, parsedBanner, useAuthentication) ?? undefined
    : undefined;

  const currentPresence = presence?.presence ?? Presence.Online;
  const currentStatus = presence?.status ?? '';
  const [statusValue, setStatusValue] = useState(currentStatus);
  const [submittedState, setSubmittedState] = useState<{
    presence: Presence;
    status: string;
  } | null>(null);

  useEffect(() => {
    setStatusValue(currentStatus);
  }, [currentStatus]);

  const hasStatusChanges = statusValue !== currentStatus && statusValue !== submittedState?.status;
  const showSaveStatus = hasStatusChanges || savingStatus;

  useEffect(() => {
    if (!submittedState) return;
    if (currentPresence === submittedState.presence && currentStatus === submittedState.status) {
      setSubmittedState(null);
      setSavingStatus(false);
    }
  }, [currentPresence, currentStatus, submittedState]);

  const tooltip = useMemo(() => displayName, [displayName]);

  const handleToggle: MouseEventHandler<HTMLButtonElement> = (evt) => {
    const cords = evt.currentTarget.getBoundingClientRect();
    setMenuAnchor((cur) => (cur ? undefined : cords));
  };

  const handleCloseMenu = () => setMenuAnchor(undefined);

  const handleOpenSettings = () => {
    setMenuAnchor(undefined);
    setSettingsOpen(true);
  };

  const setPresence = async (presenceValue: Presence, statusMsg: string) => {
    const pClient = mx as PresenceClient;
    if (!pClient.setPresence) return;
    await pClient.setPresence({
      presence: presenceValue,
      status_msg: statusMsg,
    });
  };

  const handleStatusChange: ChangeEventHandler<HTMLInputElement> = (evt) => {
    setStatusValue(evt.currentTarget.value);
  };

  const handleResetStatus = () => {
    setStatusValue(currentStatus);
  };

  const handleSaveStatus: FormEventHandler<HTMLFormElement> = async (evt) => {
    evt.preventDefault();
    if (savingStatus || !hasStatusChanges) return;
    setSavingStatus(true);
    setSubmittedState({
      presence: currentPresence,
      status: statusValue,
    });
    try {
      await setPresence(currentPresence, statusValue);
    } catch {
      setSubmittedState(null);
      setSavingStatus(false);
    }
  };

  const handleSelectPresence = async (presenceValue: Presence) => {
    if (savingStatus) return;
    setSavingStatus(true);
    setSubmittedState({
      presence: presenceValue,
      status: currentStatus,
    });
    try {
      await setPresence(presenceValue, currentStatus);
    } catch {
      setSubmittedState(null);
      setSavingStatus(false);
    }
  };

  const closeSettings = () => setSettingsOpen(false);

  return (
    <SidebarItem active={!!menuAnchor || settingsOpen}>
      <SidebarItemTooltip tooltip={tooltip}>
        {(triggerRef) => (
          <SidebarAvatar as="button" ref={triggerRef} onClick={handleToggle}>
            <UserAvatar
              userId={userId}
              src={avatarUrl}
              renderFallback={() => <Text size="H4">{nameInitials(displayName)}</Text>}
            />
          </SidebarAvatar>
        )}
      </SidebarItemTooltip>

      <PopOut
        anchor={menuAnchor}
        position="Right"
        align="End"
        offset={6}
        content={
          <FocusTrap
            focusTrapOptions={{
              initialFocus: false,
              returnFocusOnDeactivate: false,
              onDeactivate: handleCloseMenu,
              clickOutsideDeactivates: true,
              isKeyForward: (evt: KeyboardEvent) => evt.key === 'ArrowDown',
              isKeyBackward: (evt: KeyboardEvent) => evt.key === 'ArrowUp',
              escapeDeactivates: stopPropagation,
            }}
          >
            <Menu style={{ minWidth: toRem(320) }}>
              <Box direction="Column" gap="0">
                <Box direction="Column" gap="200">
                  <UserHero
                    userId={userId}
                    avatarUrl={heroAvatarUrl}
                    bannerUrl={heroBannerUrl}
                    presence={presence}
                  />
                  <Box style={{ padding: `0 ${config.space.S200} ${config.space.S200}` }}>
                    <UserHeroName displayName={displayName} userId={userId} />
                  </Box>
                </Box>

                <Line variant="Surface" size="300" />

                <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
                  <Box as="form" gap="200" onSubmit={handleSaveStatus}>
                    <Box grow="Yes" direction="Column">
                      <Input
                        value={statusValue}
                        onChange={handleStatusChange}
                        placeholder="What's on your mind?"
                        variant="Background"
                        size="300"
                        radii="300"
                        readOnly={savingStatus}
                        after={
                          hasStatusChanges &&
                          !savingStatus && (
                            <IconButton
                              type="reset"
                              onClick={handleResetStatus}
                              size="300"
                              radii="300"
                              variant="Background"
                            >
                              <Icon src={Icons.Cross} size="100" />
                            </IconButton>
                          )
                        }
                      />
                    </Box>
                    {showSaveStatus && (
                      <Button
                        size="300"
                        variant={hasStatusChanges ? 'Success' : 'Secondary'}
                        fill={hasStatusChanges ? 'Solid' : 'Soft'}
                        outlined
                        radii="300"
                        disabled={!hasStatusChanges || savingStatus}
                        type="submit"
                      >
                        {savingStatus && <Spinner variant="Success" fill="Solid" size="300" />}
                        <Text size="B300">Save</Text>
                      </Button>
                    )}
                  </Box>
                  {PresenceOptions.map((option) => (
                    <MenuItem
                      key={option.value}
                      size="300"
                      radii="300"
                      variant={currentPresence === option.value ? 'Primary' : 'Surface'}
                      fill={currentPresence === option.value ? 'Soft' : 'None'}
                      aria-pressed={currentPresence === option.value}
                      disabled={savingStatus}
                      onClick={() => {
                        handleSelectPresence(option.value).catch(() => undefined);
                      }}
                      after={<PresenceBadge presence={option.value} size="400" />}
                    >
                      <Text
                        size="T300"
                        style={{
                          flexGrow: 1,
                          fontWeight:
                            currentPresence === option.value ? config.fontWeight.W600 : undefined,
                        }}
                      >
                        {option.label}
                      </Text>
                    </MenuItem>
                  ))}

                  <Line variant="Surface" size="300" />

                  <MenuItem
                    size="300"
                    radii="300"
                    after={<Icon size="100" src={Icons.Setting} />}
                    onClick={handleOpenSettings}
                  >
                    <Text style={{ flexGrow: 1 }} size="T300">
                      Settings
                    </Text>
                  </MenuItem>
                </Box>
              </Box>
            </Menu>
          </FocusTrap>
        }
      />

      {settingsOpen && (
        <Modal500 requestClose={closeSettings}>
          <Settings requestClose={closeSettings} />
        </Modal500>
      )}
    </SidebarItem>
  );
}
