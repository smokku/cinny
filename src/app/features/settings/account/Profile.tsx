import React, {
  ChangeEventHandler,
  FormEventHandler,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useSetAtom } from 'jotai';
import {
  Avatar,
  Box,
  Button,
  color,
  config,
  Dialog,
  Header,
  Icon,
  IconButton,
  Icons,
  Input,
  Modal,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Spinner,
  Text,
} from 'folds';
import FocusTrap from 'focus-trap-react';
import { SequenceCard } from '../../../components/sequence-card';
import { SequenceCardStyle } from '../styles.css';
import { SettingTile } from '../../../components/setting-tile';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { UserProfile, useUserProfile } from '../../../hooks/useUserProfile';
import { getMxIdLocalPart, mxcUrlToHttp } from '../../../utils/matrix';
import { UserAvatar } from '../../../components/user-avatar';
import { useMediaAuthentication } from '../../../hooks/useMediaAuthentication';
import { nameInitials } from '../../../utils/common';
import { AsyncStatus, useAsyncCallback } from '../../../hooks/useAsyncCallback';
import { useFilePicker } from '../../../hooks/useFilePicker';
import { useObjectURL } from '../../../hooks/useObjectURL';
import { stopPropagation } from '../../../utils/keyboard';
import { ImageEditor } from '../../../components/image-editor';
import { ModalWide } from '../../../styles/Modal.css';
import { createUploadAtom, UploadSuccess } from '../../../state/upload';
import { CompactUploadCardRenderer } from '../../../components/upload-card';
import { useCapabilities } from '../../../hooks/useCapabilities';
import { profilesCacheAtom } from '../../../state/userRoomProfile';
import { useUserPresence } from '../../../hooks/useUserPresence';
import { PronounEditor } from './PronounEditor';
import { PronounSet } from '../../../utils/pronouns';
import { StatusEditor } from './StatusEditor';
import { TimezoneEditor } from './TimezoneEditor';
import { BioEditor } from './BioEditor';

type ExtendedProfileClient = {
  setExtendedProfileProperty?: (key: string, value: unknown) => Promise<void>;
};

type ProfileProps = {
  profile: UserProfile;
  userId: string;
};

function ProfileAvatar({ profile, userId }: ProfileProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const capabilities = useCapabilities();
  const [alertRemove, setAlertRemove] = useState(false);
  const disableSetAvatar = capabilities['m.set_avatar_url']?.enabled === false;

  const defaultDisplayName = profile.displayName ?? getMxIdLocalPart(userId) ?? userId;
  const avatarUrl = profile.avatarUrl
    ? mxcUrlToHttp(mx, profile.avatarUrl, useAuthentication, 96, 96, 'crop') ?? undefined
    : undefined;

  const [imageFile, setImageFile] = useState<File>();
  const imageFileURL = useObjectURL(imageFile);
  const uploadAtom = useMemo(() => {
    if (imageFile) return createUploadAtom(imageFile);
    return undefined;
  }, [imageFile]);

  const pickFile = useFilePicker(setImageFile, false);

  const handleRemoveUpload = useCallback(() => {
    setImageFile(undefined);
  }, []);

  const handleUploaded = useCallback(
    (upload: UploadSuccess) => {
      const { mxc } = upload;
      mx.setAvatarUrl(mxc);
      handleRemoveUpload();
    },
    [mx, handleRemoveUpload]
  );

  const handleRemoveAvatar = () => {
    mx.setAvatarUrl('');
    setAlertRemove(false);
  };

  return (
    <SettingTile
      title="Avatar"
      after={
        <Avatar size="500" radii="300">
          <UserAvatar
            userId={userId}
            src={avatarUrl}
            renderFallback={() => <Text size="H4">{nameInitials(defaultDisplayName)}</Text>}
          />
        </Avatar>
      }
    >
      {uploadAtom ? (
        <Box gap="200" direction="Column">
          <CompactUploadCardRenderer
            uploadAtom={uploadAtom}
            onRemove={handleRemoveUpload}
            onComplete={handleUploaded}
          />
        </Box>
      ) : (
        <Box gap="200">
          <Button
            onClick={() => pickFile('image/*')}
            size="300"
            variant="Secondary"
            fill="Soft"
            outlined
            radii="300"
            disabled={disableSetAvatar}
          >
            <Text size="B300">Upload</Text>
          </Button>
          {avatarUrl && (
            <Button
              size="300"
              variant="Critical"
              fill="None"
              radii="300"
              disabled={disableSetAvatar}
              onClick={() => setAlertRemove(true)}
            >
              <Text size="B300">Remove</Text>
            </Button>
          )}
        </Box>
      )}

      {imageFileURL && (
        <Overlay open={false} backdrop={<OverlayBackdrop />}>
          <OverlayCenter>
            <FocusTrap
              focusTrapOptions={{
                initialFocus: false,
                onDeactivate: handleRemoveUpload,
                clickOutsideDeactivates: true,
                escapeDeactivates: stopPropagation,
              }}
            >
              <Modal className={ModalWide} variant="Surface" size="500">
                <ImageEditor
                  name={imageFile?.name ?? 'Unnamed'}
                  url={imageFileURL}
                  requestClose={handleRemoveUpload}
                />
              </Modal>
            </FocusTrap>
          </OverlayCenter>
        </Overlay>
      )}

      <Overlay open={alertRemove} backdrop={<OverlayBackdrop />}>
        <OverlayCenter>
          <FocusTrap
            focusTrapOptions={{
              initialFocus: false,
              onDeactivate: () => setAlertRemove(false),
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
                  <Text size="H4">Remove Avatar</Text>
                </Box>
                <IconButton size="300" onClick={() => setAlertRemove(false)} radii="300">
                  <Icon src={Icons.Cross} />
                </IconButton>
              </Header>
              <Box style={{ padding: config.space.S400 }} direction="Column" gap="400">
                <Box direction="Column" gap="200">
                  <Text priority="400">Are you sure you want to remove profile avatar?</Text>
                </Box>
                <Button variant="Critical" onClick={handleRemoveAvatar}>
                  <Text size="B400">Remove</Text>
                </Button>
              </Box>
            </Dialog>
          </FocusTrap>
        </OverlayCenter>
      </Overlay>
    </SettingTile>
  );
}

type ProfileBannerProps = {
  profile: UserProfile;
  onSaveField: (key: string, value: unknown) => Promise<void>;
  disabled?: boolean;
};

function ProfileBanner({ profile, onSaveField, disabled }: ProfileBannerProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const [alertRemove, setAlertRemove] = useState(false);

  const [stagedUrl, setStagedUrl] = useState<string>();
  const [isRemoving, setIsRemoving] = useState(false);

  const parsedBanner =
    typeof profile.bannerUrl === 'string' ? profile.bannerUrl.replace(/^"|"$/g, '') : undefined;
  const bannerUrl = parsedBanner
    ? mxcUrlToHttp(mx, parsedBanner, useAuthentication) ?? undefined
    : undefined;

  useEffect(() => {
    if (bannerUrl) {
      setStagedUrl(undefined);
    }
  }, [bannerUrl]);

  const [imageFile, setImageFile] = useState<File>();
  const imageFileURL = useObjectURL(imageFile);

  const uploadAtom = useMemo(() => {
    if (imageFile) return createUploadAtom(imageFile);
    return undefined;
  }, [imageFile]);

  const pickFile = useFilePicker(setImageFile, false);

  const handlePick = useCallback(() => {
    setIsRemoving(false);
    setStagedUrl(undefined);
    pickFile('image/*');
  }, [pickFile]);

  const handleRemoveUpload = useCallback(() => {
    setImageFile(undefined);
  }, []);

  const handleUploaded = useCallback(
    (upload: UploadSuccess) => {
      const { mxc } = upload;

      if (imageFileURL) setStagedUrl(imageFileURL);

      onSaveField('chat.commet.profile_banner', mxc).catch(() => undefined);
      setImageFile(undefined);
    },
    [onSaveField, imageFileURL]
  );

  const handleRemoveBanner = async () => {
    setIsRemoving(true);
    setStagedUrl(undefined);
    setImageFile(undefined);

    await onSaveField('chat.commet.profile_banner', null);

    setAlertRemove(false);
  };

  const previewUrl = isRemoving ? undefined : imageFileURL || stagedUrl || bannerUrl;

  return (
    <SettingTile title="Banner">
      <Box direction="Column" gap="300" grow="Yes">
        <Box
          style={{
            height: '100px',
            width: '100%',
            borderRadius: config.radii.R400,
            overflow: 'hidden',
            backgroundColor: color.SurfaceVariant.Container,
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {previewUrl ? (
            <img
              src={previewUrl}
              key={previewUrl}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              alt="Banner Preview"
            />
          ) : (
            <Box justifyContent="Center" alignItems="Center">
              <Text priority="300" size="T200">
                No Banner Set
              </Text>
            </Box>
          )}
        </Box>

        {uploadAtom ? (
          <Box gap="200" direction="Column">
            <CompactUploadCardRenderer
              uploadAtom={uploadAtom}
              onRemove={handleRemoveUpload}
              onComplete={handleUploaded}
            />
          </Box>
        ) : (
          <Box gap="200">
            <Button
              onClick={handlePick}
              size="300"
              variant="Secondary"
              fill="Soft"
              outlined
              radii="300"
              disabled={disabled}
            >
              <Text size="B300">{bannerUrl ? 'Change Banner' : 'Upload Banner'}</Text>
            </Button>
            {bannerUrl && (
              <Button
                size="300"
                variant="Critical"
                fill="None"
                radii="300"
                onClick={() => setAlertRemove(true)}
                disabled={disabled}
              >
                <Text size="B300">Remove</Text>
              </Button>
            )}
          </Box>
        )}
      </Box>

      <Overlay open={alertRemove} backdrop={<OverlayBackdrop />}>
        <OverlayCenter>
          <FocusTrap
            focusTrapOptions={{
              initialFocus: false,
              onDeactivate: () => setAlertRemove(false),
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
                  <Text size="H4">Remove Banner</Text>
                </Box>
                <IconButton size="300" onClick={() => setAlertRemove(false)} radii="300">
                  <Icon src={Icons.Cross} />
                </IconButton>
              </Header>
              <Box style={{ padding: config.space.S400 }} direction="Column" gap="400">
                <Text priority="400">Are you sure you want to remove profile banner?</Text>
                <Button variant="Critical" onClick={handleRemoveBanner} disabled={disabled}>
                  <Text size="B400">Remove</Text>
                </Button>
              </Box>
            </Dialog>
          </FocusTrap>
        </OverlayCenter>
      </Overlay>
    </SettingTile>
  );
}

function ProfileDisplayName({ profile, userId }: ProfileProps) {
  const mx = useMatrixClient();
  const capabilities = useCapabilities();
  const disableSetDisplayname = capabilities['m.set_displayname']?.enabled === false;

  const defaultDisplayName = profile.displayName ?? getMxIdLocalPart(userId) ?? userId;
  const [displayName, setDisplayName] = useState<string>(defaultDisplayName);

  const [changeState, changeDisplayName] = useAsyncCallback(
    useCallback((name: string) => mx.setDisplayName(name), [mx])
  );
  const changingDisplayName = changeState.status === AsyncStatus.Loading;

  useEffect(() => {
    setDisplayName(defaultDisplayName);
  }, [defaultDisplayName]);

  const handleChange: ChangeEventHandler<HTMLInputElement> = (evt) => {
    const name = evt.currentTarget.value;
    setDisplayName(name);
  };

  const handleReset = () => {
    setDisplayName(defaultDisplayName);
  };

  const handleSubmit: FormEventHandler<HTMLFormElement> = (evt) => {
    evt.preventDefault();
    if (changingDisplayName) return;

    const target = evt.target as HTMLFormElement | undefined;
    const displayNameInput = target?.displayNameInput as HTMLInputElement | undefined;
    const name = displayNameInput?.value;
    if (!name) return;

    changeDisplayName(name);
  };

  const hasChanges = displayName !== defaultDisplayName;
  return (
    <SettingTile title="Display Name">
      <Box direction="Column" grow="Yes" gap="100">
        <Box
          as="form"
          onSubmit={handleSubmit}
          gap="200"
          aria-disabled={changingDisplayName || disableSetDisplayname}
        >
          <Box grow="Yes" direction="Column">
            <Input
              required
              name="displayNameInput"
              value={displayName}
              onChange={handleChange}
              variant="Secondary"
              radii="300"
              style={{ paddingRight: config.space.S200 }}
              readOnly={changingDisplayName || disableSetDisplayname}
              after={
                hasChanges &&
                !changingDisplayName && (
                  <IconButton
                    type="reset"
                    onClick={handleReset}
                    size="300"
                    radii="300"
                    variant="Secondary"
                  >
                    <Icon src={Icons.Cross} size="100" />
                  </IconButton>
                )
              }
            />
          </Box>
          <Button
            size="400"
            variant={hasChanges ? 'Success' : 'Secondary'}
            fill={hasChanges ? 'Solid' : 'Soft'}
            outlined
            radii="300"
            disabled={!hasChanges || changingDisplayName}
            type="submit"
          >
            {changingDisplayName && <Spinner variant="Success" fill="Solid" size="300" />}
            <Text size="B400">Save</Text>
          </Button>
        </Box>
      </Box>
    </SettingTile>
  );
}

type ProfileExtendedProps = ProfileProps & {
  onSaveField: (key: string, value: unknown) => Promise<void>;
  disableExtended?: boolean;
};

function ProfileExtended({ profile, userId, onSaveField, disableExtended }: ProfileExtendedProps) {
  const mx = useMatrixClient();
  const presence = useUserPresence(userId);

  const pronouns = (profile.pronouns as PronounSet[]) || [];
  const currentStatus = presence?.status || '';

  const extendedFields = Object.entries(profile.extended || {});

  const handleSaveStatus = useCallback(
    async (newStatus: string) => {
      const currentState = presence?.presence || 'online';
      await (
        mx as { setPresence?: (state: { presence: string; status_msg?: string }) => Promise<void> }
      ).setPresence?.({
        presence: currentState,
        status_msg: newStatus,
      });
    },
    [mx, presence]
  );

  return (
    <Box direction="Column" gap="100">
      <Text size="L400">Extended Profile</Text>
      <SequenceCard
        className={SequenceCardStyle}
        variant="SurfaceVariant"
        direction="Column"
        gap="400"
      >
        <StatusEditor current={currentStatus} onSave={handleSaveStatus} />
      </SequenceCard>
      <SequenceCard
        className={SequenceCardStyle}
        variant="SurfaceVariant"
        direction="Column"
        gap="400"
      >
        <PronounEditor
          title="Pronouns"
          current={pronouns}
          onSave={(nextPronouns) => {
            onSaveField('io.fsky.nyx.pronouns', nextPronouns).catch(() => undefined);
          }}
          disabled={disableExtended}
        />
      </SequenceCard>
      <SequenceCard
        className={SequenceCardStyle}
        variant="SurfaceVariant"
        direction="Column"
        gap="400"
      >
        <TimezoneEditor
          current={profile.timezone}
          onSave={(tz) => {
            onSaveField('us.cloke.msc4175.tz', tz).catch(() => undefined);
            onSaveField('m.tz', tz).catch(() => undefined);
          }}
          disabled={disableExtended}
        />
      </SequenceCard>
      <SequenceCard
        className={SequenceCardStyle}
        variant="SurfaceVariant"
        direction="Column"
        gap="400"
      >
        <BioEditor
          value={
            profile.extended?.['moe.sable.app.bio'] ||
            profile.extended?.['chat.commet.profile_bio'] ||
            profile.bio
          }
          onSave={(htmlBio) => {
            onSaveField('moe.sable.app.bio', htmlBio).catch(() => undefined);

            const cleanedHtml = htmlBio.replace(/<br\/><\/blockquote>/g, '</blockquote>');
            onSaveField('chat.commet.profile_bio', {
              format: 'org.matrix.custom.html',
              formatted_body: cleanedHtml,
            }).catch(() => undefined);
          }}
          disabled={disableExtended}
        />
      </SequenceCard>

      {extendedFields.length > 0 &&
        extendedFields.map(([key, value]) => {
          if (
            typeof value !== 'string' &&
            typeof value !== 'number' &&
            typeof value !== 'boolean'
          ) {
            return null;
          }

          const strVal = String(value);
          if (strVal.length > 256) {
            return null;
          }

          return (
            <SequenceCard
              key={key}
              className={SequenceCardStyle}
              variant="SurfaceVariant"
              direction="Column"
              gap="400"
            >
              <SettingTile
                title={key.split('.').pop() || key}
                description={key}
                after={
                  <Text size="T300" truncate>
                    {strVal}
                  </Text>
                }
              />
            </SequenceCard>
          );
        })}
    </Box>
  );
}

export function Profile() {
  const mx = useMatrixClient();
  const userId = mx.getUserId();
  const safeUserId = userId ?? '';
  const profile = useUserProfile(safeUserId);
  const setGlobalProfiles = useSetAtom(profilesCacheAtom);

  const canSetExtendedProfile =
    typeof (mx as unknown as ExtendedProfileClient).setExtendedProfileProperty === 'function';

  const invalidateProfileCache = useCallback(() => {
    setGlobalProfiles((prev) => {
      const next = { ...prev };
      delete next[safeUserId];
      return next;
    });
  }, [setGlobalProfiles, safeUserId]);

  const handleSaveField = useCallback(
    async (key: string, value: unknown) => {
      await (mx as ExtendedProfileClient).setExtendedProfileProperty?.(key, value);
      invalidateProfileCache();
    },
    [mx, invalidateProfileCache]
  );

  if (!userId) return null;

  return (
    <Box direction="Column" gap="700">
      <Box direction="Column" gap="100">
        <Text size="L400">Profile</Text>
        <SequenceCard
          className={SequenceCardStyle}
          variant="SurfaceVariant"
          direction="Column"
          gap="400"
        >
          <ProfileBanner
            profile={profile}
            onSaveField={handleSaveField}
            disabled={!canSetExtendedProfile}
          />
        </SequenceCard>
        <SequenceCard
          className={SequenceCardStyle}
          variant="SurfaceVariant"
          direction="Column"
          gap="400"
        >
          <ProfileAvatar userId={userId} profile={profile} />
        </SequenceCard>
        <SequenceCard
          className={SequenceCardStyle}
          variant="SurfaceVariant"
          direction="Column"
          gap="400"
        >
          <ProfileDisplayName userId={userId} profile={profile} />
        </SequenceCard>
      </Box>
      <ProfileExtended
        userId={userId}
        profile={profile}
        onSaveField={handleSaveField}
        disableExtended={!canSetExtendedProfile}
      />
    </Box>
  );
}
