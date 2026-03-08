import React, { FormEventHandler, MouseEventHandler, useMemo, useRef, useState } from 'react';
import { JoinRule } from 'matrix-js-sdk';
import {
  Avatar,
  Box,
  Button,
  Chip,
  Dialog,
  Header,
  Icon,
  IconButton,
  Icons,
  Input,
  Line,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Scroll,
  Spinner,
  Text,
  color,
  config,
  toRem,
} from 'folds';
import FocusTrap from 'focus-trap-react';
import { useAtomValue } from 'jotai';
import {
  Page,
  PageContent,
  PageContentCenter,
  PageHeader,
  PageHero,
  PageHeroEmpty,
  PageHeroSection,
} from '../../../components/page';
import {
  useBookmarkList,
  useBookmarkLoading,
  useBookmarkActions,
  useBookmarkRefreshError,
} from '../../../features/bookmarks/useBookmarks';
import { BookmarkItemContent } from '../../../features/bookmarks/bookmarkDomain';
import { SequenceCard } from '../../../components/sequence-card';
import { useRoomNavigate } from '../../../hooks/useRoomNavigate';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { getMxIdLocalPart, mxcUrlToHttp } from '../../../utils/matrix';
import {
  AvatarBase,
  ModernLayout,
  Time,
  Username,
  UsernameBold,
} from '../../../components/message';
import { UserAvatar } from '../../../components/user-avatar';
import { RoomAvatar, RoomIcon } from '../../../components/room-avatar';
import { getMemberAvatarMxc, getMemberDisplayName, getRoomAvatarUrl } from '../../../utils/room';
import { useSetting } from '../../../state/hooks/settings';
import { settingsAtom } from '../../../state/settings';
import { ScreenSize, useScreenSizeContext } from '../../../hooks/useScreenSize';
import { BackRouteHandler } from '../../../components/BackRouteHandler';
import { useMediaAuthentication } from '../../../hooks/useMediaAuthentication';
import { mDirectAtom } from '../../../state/mDirectList';
import colorMXID from '../../../../util/colorMXID';
import { stopPropagation } from '../../../utils/keyboard';
import { highlightText, makeHighlightRegex } from '../../../plugins/react-custom-html-parser';
import { ContainerColor } from '../../../styles/ContainerColor.css';

type RemoveBookmarkDialogProps = {
  open: boolean;
  bodyPreview?: string;
  sender?: string;
  displayName?: string;
  senderAvatarMxc?: string;
  onConfirm: () => void;
  onClose: () => void;
};
function RemoveBookmarkDialog({
  open,
  bodyPreview,
  sender,
  displayName,
  senderAvatarMxc,
  onConfirm,
  onClose,
}: RemoveBookmarkDialogProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  return (
    <Overlay open={open} backdrop={<OverlayBackdrop />}>
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
                <Text size="H4">Remove Bookmark</Text>
              </Box>
              <IconButton size="300" onClick={onClose} radii="300">
                <Icon src={Icons.Cross} />
              </IconButton>
            </Header>
            <Box style={{ padding: config.space.S400 }} direction="Column" gap="400">
              <Text priority="400">Are you sure you want to remove this bookmark?</Text>
              {(bodyPreview || sender) && (
                <Box
                  style={{
                    padding: config.space.S200,
                    borderRadius: config.radii.R300,
                  }}
                  direction="Column"
                  gap="200"
                >
                  {sender && (
                    <Box gap="200" alignItems="Center">
                      <Avatar size="200">
                        <UserAvatar
                          userId={sender}
                          src={
                            senderAvatarMxc
                              ? mxcUrlToHttp(
                                  mx,
                                  senderAvatarMxc,
                                  useAuthentication,
                                  32,
                                  32,
                                  'crop'
                                ) ?? undefined
                              : undefined
                          }
                          alt={displayName ?? sender}
                          renderFallback={() => <Icon size="50" src={Icons.User} filled />}
                        />
                      </Avatar>
                      <Text size="T300" truncate>
                        <b>{displayName ?? sender}</b>
                      </Text>
                    </Box>
                  )}
                  {bodyPreview && (
                    <Text size="T300" priority="300">
                      {bodyPreview}
                    </Text>
                  )}
                </Box>
              )}
              <Button variant="Critical" onClick={onConfirm}>
                <Text size="B400">Remove</Text>
              </Button>
            </Box>
          </Dialog>
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}

type BookmarkItemRowProps = {
  item: BookmarkItemContent;
  displayName: string;
  senderAvatarMxc?: string;
  usernameColor?: string;
  hour24Clock: boolean;
  dateFormatString: string;
  onOpen: MouseEventHandler;
  onRemove: (bookmarkId: string) => void;
  highlightRegex?: RegExp;
};
function BookmarkItemRow({
  item,
  displayName,
  senderAvatarMxc,
  usernameColor,
  hour24Clock,
  dateFormatString,
  onOpen,
  onRemove,
  highlightRegex,
}: BookmarkItemRowProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleConfirmRemove = () => {
    setConfirmOpen(false);
    onRemove(item.bookmark_id);
  };

  return (
    <>
      <RemoveBookmarkDialog
        open={confirmOpen}
        bodyPreview={item.body_preview}
        sender={item.sender}
        displayName={displayName}
        senderAvatarMxc={senderAvatarMxc}
        onConfirm={handleConfirmRemove}
        onClose={() => setConfirmOpen(false)}
      />
      <SequenceCard
        style={{ padding: config.space.S400 }}
        variant="SurfaceVariant"
        direction="Column"
      >
        <ModernLayout
          before={
            <AvatarBase>
              <Avatar size="300">
                <UserAvatar
                  userId={item.sender ?? ''}
                  src={
                    senderAvatarMxc
                      ? mxcUrlToHttp(mx, senderAvatarMxc, useAuthentication, 48, 48, 'crop') ??
                        undefined
                      : undefined
                  }
                  alt={displayName}
                  renderFallback={() => <Icon size="200" src={Icons.User} filled />}
                />
              </Avatar>
            </AvatarBase>
          }
        >
          <Box gap="300" justifyContent="SpaceBetween" alignItems="Center" grow="Yes">
            <Box gap="200" alignItems="Baseline">
              <Username style={{ color: usernameColor }}>
                <Text as="span" truncate>
                  <UsernameBold>{displayName}</UsernameBold>
                </Text>
              </Username>
              <Time
                ts={item.event_ts}
                hour24Clock={hour24Clock}
                dateFormatString={dateFormatString}
              />
            </Box>
            <Box shrink="No" gap="200" alignItems="Center">
              <Box gap="100" alignItems="Center">
                <Icon size="50" src={Icons.Bookmark} />
                <Time
                  ts={item.bookmarked_ts}
                  hour24Clock={hour24Clock}
                  dateFormatString={dateFormatString}
                />
              </Box>
              <Chip data-event-id={item.event_id} onClick={onOpen} variant="Secondary" radii="400">
                <Text size="T200">Go to…</Text>
              </Chip>
              <IconButton
                onClick={(evt: React.MouseEvent) => {
                  evt.stopPropagation();
                  setConfirmOpen(true);
                }}
                size="300"
                radii="300"
                aria-label="Remove bookmark"
                style={{ color: color.Critical.Main }}
              >
                <Icon src={Icons.Delete} size="100" />
              </IconButton>
            </Box>
          </Box>
          {item.body_preview && (
            <Box grow="Yes" direction="Column">
              <Text size="T400" style={{ whiteSpace: 'pre-wrap' }}>
                {highlightRegex
                  ? highlightText(highlightRegex, [item.body_preview])
                  : item.body_preview}
              </Text>
            </Box>
          )}
        </ModernLayout>
      </SequenceCard>
    </>
  );
}

type BookmarkResultGroupProps = {
  roomId: string;
  roomName?: string;
  items: BookmarkItemContent[];
  onOpen: (roomId: string, eventId: string) => void;
  onRemove: (bookmarkId: string) => void;
  hour24Clock: boolean;
  dateFormatString: string;
  legacyUsernameColor?: boolean;
  highlightRegex?: RegExp;
};
function BookmarkResultGroup({
  roomId,
  roomName,
  items,
  onOpen,
  onRemove,
  hour24Clock,
  dateFormatString,
  legacyUsernameColor,
  highlightRegex,
}: BookmarkResultGroupProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const room = mx.getRoom(roomId);

  const handleOpenClick: MouseEventHandler = (evt) => {
    const eventId = evt.currentTarget.getAttribute('data-event-id');
    if (!eventId) return;
    onOpen(roomId, eventId);
  };

  return (
    <Box direction="Column" gap="200">
      <Header size="300">
        <Box gap="200" grow="Yes">
          <Avatar size="200" radii="300">
            {room ? (
              <RoomAvatar
                roomId={roomId}
                src={getRoomAvatarUrl(mx, room, 96, useAuthentication)}
                alt={room.name}
                renderFallback={() => (
                  <RoomIcon
                    size="50"
                    roomType={room.getType()}
                    joinRule={room.getJoinRule() ?? JoinRule.Restricted}
                    filled
                  />
                )}
              />
            ) : (
              <RoomIcon size="50" joinRule={JoinRule.Restricted} filled />
            )}
          </Avatar>
          <Text size="H4" truncate>
            {room?.name ?? roomName ?? roomId}
          </Text>
        </Box>
      </Header>
      <Box direction="Column" gap="100">
        {items.map((item) => {
          const displayName = room
            ? getMemberDisplayName(room, item.sender ?? '') ??
              getMxIdLocalPart(item.sender ?? '') ??
              item.sender ??
              'Unknown'
            : getMxIdLocalPart(item.sender ?? '') ?? item.sender ?? 'Unknown';
          const senderAvatarMxc =
            room && item.sender ? getMemberAvatarMxc(room, item.sender) : undefined;

          const usernameColor =
            legacyUsernameColor && item.sender ? colorMXID(item.sender) : undefined;

          return (
            <BookmarkItemRow
              key={item.bookmark_id}
              item={item}
              displayName={displayName}
              senderAvatarMxc={senderAvatarMxc}
              usernameColor={usernameColor}
              hour24Clock={hour24Clock}
              dateFormatString={dateFormatString}
              onOpen={handleOpenClick}
              onRemove={onRemove}
              highlightRegex={highlightRegex}
            />
          );
        })}
      </Box>
    </Box>
  );
}

type BookmarkFilterInputProps = {
  active?: boolean;
  loading?: boolean;
  searchInputRef: React.RefObject<HTMLInputElement>;
  onFilter: (term: string) => void;
  onReset: () => void;
};
function BookmarkFilterInput({
  active,
  loading,
  searchInputRef,
  onFilter,
  onReset,
}: BookmarkFilterInputProps) {
  const handleSubmit: FormEventHandler<HTMLFormElement> = (evt) => {
    evt.preventDefault();
    const { searchInput } = evt.target as HTMLFormElement & {
      searchInput: HTMLInputElement;
    };
    const term = searchInput.value.trim() || undefined;
    if (term) {
      onFilter(term);
    }
  };

  return (
    <Box as="form" direction="Column" gap="100" onSubmit={handleSubmit}>
      <span data-spacing-node />
      <Text size="L400">Search</Text>
      <Input
        ref={searchInputRef}
        style={{ paddingRight: config.space.S300 }}
        name="searchInput"
        autoFocus
        size="500"
        variant="Background"
        placeholder="Search for keyword"
        autoComplete="off"
        before={
          active && loading ? (
            <Spinner variant="Secondary" size="200" />
          ) : (
            <Icon size="200" src={Icons.Search} />
          )
        }
        after={
          active ? (
            <Chip
              key="resetButton"
              type="reset"
              variant="Secondary"
              size="400"
              radii="Pill"
              outlined
              after={<Icon size="50" src={Icons.Cross} />}
              onClick={onReset}
            >
              <Text size="B300">Clear</Text>
            </Chip>
          ) : (
            <Chip type="submit" variant="Primary" size="400" radii="Pill" outlined>
              <Text size="B300">Enter</Text>
            </Chip>
          )
        }
      />
    </Box>
  );
}

export function BookmarksList() {
  const bookmarks = useBookmarkList();
  const loading = useBookmarkLoading();
  const refreshError = useBookmarkRefreshError();
  const { refresh, remove } = useBookmarkActions();
  const { navigateRoom } = useRoomNavigate();
  const screenSize = useScreenSizeContext();
  const mDirects = useAtomValue(mDirectAtom);

  const [legacyUsernameColor] = useSetting(settingsAtom, 'legacyUsernameColor');
  const [hour24Clock] = useSetting(settingsAtom, 'hour24Clock');
  const [dateFormatString] = useSetting(settingsAtom, 'dateFormatString');

  const searchInputRef = useRef<HTMLInputElement>(null);
  const [filterTerm, setFilterTerm] = useState<string | undefined>();

  // Filter bookmarks by search term
  const filtered = useMemo(() => {
    if (!filterTerm) return bookmarks;
    const lower = filterTerm.toLowerCase();
    return bookmarks.filter(
      (b) =>
        (b.body_preview && b.body_preview.toLowerCase().includes(lower)) ||
        (b.room_name && b.room_name.toLowerCase().includes(lower)) ||
        (b.sender && b.sender.toLowerCase().includes(lower))
    );
  }, [bookmarks, filterTerm]);

  const highlightRegex = useMemo(
    () => (filterTerm ? makeHighlightRegex([filterTerm]) : undefined),
    [filterTerm]
  );

  // Group filtered bookmarks by room
  const groups = useMemo(() => {
    const byBookmarkedTsDesc = (a: BookmarkItemContent, b: BookmarkItemContent): number => {
      if (a.bookmarked_ts !== b.bookmarked_ts) {
        return b.bookmarked_ts - a.bookmarked_ts;
      }
      if (a.event_ts !== b.event_ts) {
        return b.event_ts - a.event_ts;
      }
      if (a.bookmark_id < b.bookmark_id) {
        return -1;
      }
      if (a.bookmark_id > b.bookmark_id) {
        return 1;
      }
      return 0;
    };

    const map = filtered.reduce((acc, item) => {
      const existing = acc.get(item.room_id);
      if (existing) {
        existing.push(item);
      } else {
        acc.set(item.room_id, [item]);
      }
      return acc;
    }, new Map<string, BookmarkItemContent[]>());

    return Array.from(map.entries()).map<[string, BookmarkItemContent[]]>(([roomId, items]) => [
      roomId,
      [...items].sort(byBookmarkedTsDesc),
    ]);
  }, [filtered]);

  const handleFilter = (term: string) => {
    setFilterTerm(term);
  };

  const handleFilterClear = () => {
    if (searchInputRef.current) {
      searchInputRef.current.value = '';
    }
    setFilterTerm(undefined);
  };

  return (
    <Page>
      <PageHeader balance>
        <Box grow="Yes" alignItems="Center" gap="200">
          <Box grow="Yes" basis="No">
            {screenSize === ScreenSize.Mobile && (
              <BackRouteHandler>
                {(onBack) => (
                  <IconButton onClick={onBack}>
                    <Icon src={Icons.ArrowLeft} />
                  </IconButton>
                )}
              </BackRouteHandler>
            )}
          </Box>
          <Box justifyContent="Center" alignItems="Center" gap="200">
            {screenSize !== ScreenSize.Mobile && <Icon size="400" src={Icons.Bookmark} />}
            <Text size="H3" truncate>
              Bookmarks
            </Text>
          </Box>
          <Box grow="Yes" basis="No" />
        </Box>
      </PageHeader>
      <Box style={{ position: 'relative' }} grow="Yes">
        <Scroll hideTrack visibility="Hover">
          <PageContent>
            <PageContentCenter>
              <Box direction="Column" gap="700">
                <Box direction="Column" gap="300">
                  <BookmarkFilterInput
                    active={!!filterTerm}
                    loading={loading}
                    searchInputRef={searchInputRef}
                    onFilter={handleFilter}
                    onReset={handleFilterClear}
                  />
                </Box>

                {refreshError && !loading && (
                  <Box
                    className={ContainerColor({ variant: 'Critical' })}
                    style={{ padding: config.space.S300, borderRadius: config.radii.R400 }}
                    direction="Column"
                    gap="200"
                  >
                    <Text size="L400">Failed to refresh bookmarks.</Text>
                    <Text size="T300">{refreshError.message}</Text>
                    <Box>
                      <Button variant="Critical" size="300" onClick={() => refresh()}>
                        <Text size="B300">Retry</Text>
                      </Button>
                    </Box>
                  </Box>
                )}

                {!filterTerm && bookmarks.length === 0 && !loading && !refreshError && (
                  <PageHeroEmpty>
                    <PageHeroSection>
                      <PageHero
                        icon={<Icon size="600" src={Icons.Bookmark} />}
                        title="Bookmarks"
                        subTitle='Right-click a message and select "Bookmark Message" to save it here.'
                      />
                    </PageHeroSection>
                  </PageHeroEmpty>
                )}

                {loading && bookmarks.length === 0 && (
                  <Box direction="Column" gap="100">
                    {[...Array(4).keys()].map((key) => (
                      <SequenceCard
                        variant="SurfaceVariant"
                        key={key}
                        style={{ minHeight: toRem(80) }}
                      />
                    ))}
                  </Box>
                )}

                {filterTerm && filtered.length === 0 && (
                  <Box
                    style={{ padding: config.space.S300, borderRadius: config.radii.R400 }}
                    alignItems="Center"
                    gap="200"
                  >
                    <Icon size="200" src={Icons.Info} />
                    <Text>
                      No bookmarks found for <b>{`"${filterTerm}"`}</b>
                    </Text>
                  </Box>
                )}

                {groups.length > 0 && (
                  <Box direction="Column" gap="300">
                    {filterTerm && (
                      <Box direction="Column" gap="200">
                        <Text size="H5">{`Bookmarks matching "${filterTerm}"`}</Text>
                        <Line size="300" variant="Surface" />
                      </Box>
                    )}
                    {groups.map(([roomId, items]) => (
                      <Box
                        key={roomId}
                        direction="Column"
                        style={{ paddingBottom: config.space.S500 }}
                      >
                        <BookmarkResultGroup
                          roomId={roomId}
                          roomName={items[0]?.room_name}
                          items={items}
                          onOpen={navigateRoom}
                          onRemove={remove}
                          hour24Clock={hour24Clock}
                          dateFormatString={dateFormatString}
                          legacyUsernameColor={legacyUsernameColor || mDirects.has(roomId)}
                          highlightRegex={highlightRegex}
                        />
                      </Box>
                    ))}
                  </Box>
                )}
              </Box>
            </PageContentCenter>
          </PageContent>
        </Scroll>
      </Box>
    </Page>
  );
}
