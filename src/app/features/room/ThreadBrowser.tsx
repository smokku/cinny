import React, {
  ChangeEventHandler,
  MouseEventHandler,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Box,
  Header,
  Icon,
  IconButton,
  Icons,
  Input,
  Scroll,
  Spinner,
  Text,
  Avatar,
  config,
  Chip,
  toRem,
} from 'folds';
import { EventTimelineSet, MatrixEvent, NotificationCountType, Room } from 'matrix-js-sdk';
import { Thread, ThreadEvent } from 'matrix-js-sdk/lib/models/thread';
import { useAtomValue } from 'jotai';
import { HTMLReactParserOptions } from 'html-react-parser';
import { Opts as LinkifyOpts } from 'linkifyjs';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import {
  getMemberAvatarMxc,
  getMemberDisplayName,
  getThreadReplies,
  formatThreadReplyCount,
} from '../../utils/room';
import { getMxIdLocalPart, mxcUrlToHttp } from '../../utils/matrix';
import { UserAvatar } from '../../components/user-avatar';
import {
  AvatarBase,
  ModernLayout,
  RedactedContent,
  Time,
  Username,
  UsernameBold,
  Reply,
} from '../../components/message';
import { RenderMessageContent } from '../../components/RenderMessageContent';
import { UrlPreviewSize, settingsAtom } from '../../state/settings';
import { useSetting } from '../../state/hooks/settings';
import { GetContentCallback } from '../../../types/matrix/room';
import { useMentionClickHandler } from '../../hooks/useMentionClickHandler';
import { useSpoilerClickHandler } from '../../hooks/useSpoilerClickHandler';
import {
  factoryRenderLinkifyWithMention,
  getReactCustomHtmlParser,
  LINKIFY_OPTS,
  makeMentionCustomProps,
  renderMatrixMention,
} from '../../plugins/react-custom-html-parser';
import { EncryptedContent } from './message';
import { nicknamesAtom } from '../../state/nicknames';
import { UnreadBadge } from '../../components/unread-badge';
import { countThreadUnread } from '../../utils/thread';
import * as css from './ThreadDrawer.css';

type ThreadPreviewProps = {
  room: Room;
  thread: Thread;
  onClick: (threadId: string) => void;
  onJump?: () => void;
};

function ThreadPreview({ room, thread, onClick, onJump }: ThreadPreviewProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const nicknames = useAtomValue(nicknamesAtom);
  const { navigateRoom } = useRoomNavigate();
  const [hour24Clock] = useSetting(settingsAtom, 'hour24Clock');
  const [dateFormatString] = useSetting(settingsAtom, 'dateFormatString');
  const [mediaAutoLoad] = useSetting(settingsAtom, 'mediaAutoLoad');
  const [urlPreview] = useSetting(settingsAtom, 'urlPreview');
  const mentionClickHandler = useMentionClickHandler(room.roomId);
  const spoilerClickHandler = useSpoilerClickHandler();

  const linkifyOpts = useMemo<LinkifyOpts>(
    () => ({
      ...LINKIFY_OPTS,
      render: factoryRenderLinkifyWithMention((href: string) =>
        renderMatrixMention(mx, room.roomId, href, makeMentionCustomProps(mentionClickHandler))
      ),
    }),
    [mx, room.roomId, mentionClickHandler]
  );

  const htmlReactParserOptions = useMemo<HTMLReactParserOptions>(
    () =>
      getReactCustomHtmlParser(mx, room.roomId, {
        linkifyOpts,
        handleSpoilerClick: spoilerClickHandler,
        handleMentionClick: mentionClickHandler,
        useAuthentication,
      }),
    [mx, room, linkifyOpts, mentionClickHandler, spoilerClickHandler, useAuthentication]
  );

  const handleJumpClick: MouseEventHandler = useCallback(
    (evt) => {
      evt.stopPropagation();
      navigateRoom(room.roomId, thread.id);
      onJump?.();
    },
    [navigateRoom, room.roomId, thread.id, onJump]
  );

  const { rootEvent } = thread;
  if (!rootEvent) return null;

  const senderId = rootEvent.getSender() ?? '';
  const displayName =
    getMemberDisplayName(room, senderId, nicknames) ?? getMxIdLocalPart(senderId) ?? senderId;
  const senderAvatarMxc = getMemberAvatarMxc(room, senderId);
  const getContent = (() => rootEvent.getContent()) as GetContentCallback;

  const { allReplies, visibleReplies, redactedCount } = getThreadReplies(
    thread.events,
    thread.id
  );
  // Use Math.max so we never show fewer replies than the server reports.
  // allReplies reflects only the events already in the local window; the
  // server-side bundled aggregation (exposed via thread.length) is authoritative
  // once fetchRoomThreads() has run.
  const replyCount = Math.max(allReplies.length, thread.length ?? 0);
  const displayCount = Math.max(0, replyCount - redactedCount);

  const lastReply = visibleReplies.at(-1);
  const lastSenderId = lastReply?.getSender() ?? '';
  const lastDisplayName =
    getMemberDisplayName(room, lastSenderId, nicknames) ??
    getMxIdLocalPart(lastSenderId) ??
    lastSenderId;
  const lastContent = lastReply?.getContent();
  const lastBody: string = typeof lastContent?.body === 'string' ? lastContent.body : '';

  return (
    <Box
      as="button"
      direction="Column"
      gap="100"
      className={css.ThreadBrowserItem}
      onClick={() => onClick(thread.id)}
    >
      <ModernLayout
        before={
          <AvatarBase>
            <Box style={{ position: 'relative' }}>
              <Avatar size="300">
                <UserAvatar
                  userId={senderId}
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
              {(() => {
                const userId = mx.getUserId();
                if (!userId) return null;
                const total = room.getThreadUnreadNotificationCount(
                  thread.id,
                  NotificationCountType.Total
                );
                let highlight =
                  room.getThreadUnreadNotificationCount(
                    thread.id,
                    NotificationCountType.Highlight
                  ) > 0;
                let hasUnread = total > 0 || highlight;
                if (!hasUnread) {
                  const fallback = countThreadUnread(thread, userId);
                  highlight = fallback.highlight;
                  hasUnread = fallback.hasUnread;
                }
                if (!hasUnread) return null;
                return (
                  <Box
                    style={{
                      position: 'absolute',
                      top: toRem(-6),
                      left: toRem(-6),
                      zIndex: 1,
                      pointerEvents: 'none',
                      lineHeight: 0,
                    }}
                  >
                    <UnreadBadge highlight={highlight} count={total} />
                  </Box>
                );
              })()}
            </Box>
          </AvatarBase>
        }
      >
        <Box gap="300" justifyContent="SpaceBetween" alignItems="Center" grow="Yes">
          <Box gap="200" alignItems="Baseline">
            <Username>
              <Text as="span" truncate>
                <UsernameBold>{displayName}</UsernameBold>
              </Text>
            </Username>
            <Time
              ts={rootEvent.getTs()}
              hour24Clock={hour24Clock}
              dateFormatString={dateFormatString}
            />
          </Box>
          <Box shrink="No">
            <Chip data-event-id={thread.id} onClick={handleJumpClick} radii="Pill">
              <Text size="T200">Jump</Text>
            </Chip>
          </Box>
        </Box>
        {rootEvent.replyEventId && (
          <Reply
            room={room}
            replyEventId={rootEvent.replyEventId}
            threadRootId={rootEvent.threadRootId}
            onClick={handleJumpClick}
          />
        )}
        <Box
          direction="Column"
          style={{
            maxHeight: '200px',
            overflow: 'auto',
            flexShrink: 0,
          }}
        >
          <EncryptedContent mEvent={rootEvent}>
            {() => {
              if (rootEvent.isRedacted()) {
                return <RedactedContent />;
              }

              return (
                <RenderMessageContent
                  displayName={displayName}
                  msgType={rootEvent.getContent().msgtype ?? ''}
                  ts={rootEvent.getTs()}
                  getContent={getContent}
                  edited={!!rootEvent.replacingEvent()}
                  mediaAutoLoad={mediaAutoLoad}
                  urlPreview={urlPreview}
                  urlPreviewSize={UrlPreviewSize.Compact}
                  htmlReactParserOptions={htmlReactParserOptions}
                  linkifyOpts={linkifyOpts}
                  outlineAttachment
                />
              );
            }}
          </EncryptedContent>
        </Box>
        {replyCount > 0 && (
          <Box gap="100" alignItems="Center" style={{ marginTop: config.space.S200 }}>
            <Text size="T200" priority="300" style={{ flexShrink: 0 }}>
              {formatThreadReplyCount(displayCount, redactedCount)}
            </Text>
            {lastReply && lastBody && (
              <Text
                size="T200"
                priority="300"
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  minWidth: 0,
                }}
              >
                · {lastDisplayName}: {lastBody.slice(0, 60)}
              </Text>
            )}
          </Box>
        )}
      </ModernLayout>
    </Box>
  );
}

type ThreadBrowserProps = {
  room: Room;
  onOpenThread: (threadId: string) => void;
  onClose: () => void;
  overlay?: boolean;
};

export function ThreadBrowser({ room, onOpenThread, onClose, overlay }: ThreadBrowserProps) {
  const mx = useMatrixClient();
  const [, forceUpdate] = useState(0);
  const [query, setQuery] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const [canLoadMore, setCanLoadMore] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const threadListTimelineSetRef = useRef<EventTimelineSet | null>(null);
  const loadingMoreRef = useRef(false);
  const canLoadMoreRef = useRef(false);
  canLoadMoreRef.current = canLoadMore;

  // Populate server-side thread objects from bundled data on a paginated
  // /threads response.  Backfills Thread objects for thread roots that are
  // outside the current sliding-sync window (fetchRoomThreads creates Thread
  // objects internally but findEventById() may not resolve them), and seeds
  // their bundled reply counts so previews render the right number before
  // the drawer is opened.
  const hydrateThreadsFromTimelineSet = useCallback(
    (set: EventTimelineSet) => {
      set
        .getLiveTimeline()
        .getEvents()
        .filter((event: MatrixEvent) => !!event.getId())
        .forEach((event: MatrixEvent) => {
          const id = event.getId()!;
          const existingThread = room.getThread(id);

          const bundled = (event.getUnsigned() as any)?.['m.relations']?.['m.thread'];
          const bundledCount: number | undefined =
            typeof bundled?.count === 'number' ? bundled.count : undefined;

          if (!existingThread) {
            room.createThread(id, event, [], false);
            return;
          }

          if (!existingThread.rootEvent) {
            existingThread.rootEvent = event;
            existingThread.setEventMetadata(event);
          }
          // Seed replyCount from bundled aggregations for threads that were
          // created by sliding-sync before fetchRoomThreads() ran.  Sliding sync
          // delivers root events without bundled aggregations, so createThread()
          // sets replyCount=0; without this, the thread drawer would skip the
          // server-side fetch because of the SDK's fast path
          // (replyCount===0 → initialEventsFetched=true).
          if (bundledCount !== undefined && (existingThread as any).replyCount === 0) {
            (existingThread as any).replyCount = bundledCount;
          }
        });
    },
    [room]
  );

  // On mount, set up thread event listeners, create the server-side thread
  // timeline sets, then fetch page 1 via paginate.  The two operations are
  // sequenced in a single effect so that createThreadsTimelineSets() always
  // resolves before fetchRoomThreads() runs — fetchRoomThreadList() has an
  // early-return guard (`if (this.threadsTimelineSets.length === 0)`) that
  // silently no-ops when the sets haven't been created yet.
  useEffect(() => {
    const onUpdate = () => forceUpdate((n) => n + 1);
    room.on(ThreadEvent.New as any, onUpdate);
    room.on(ThreadEvent.Update as any, onUpdate);
    room.on(ThreadEvent.NewReply as any, onUpdate);

    let cancelled = false;
    const loadThreads = async () => {
      setLoadingMore(true);
      try {
        const sets = await room.createThreadsTimelineSets();
        if (!sets || cancelled) return;
        const [allThreadsSet] = sets;
        threadListTimelineSetRef.current = allThreadsSet;

        await room.fetchRoomThreads().catch((err: unknown) => {
          // eslint-disable-next-line no-console
          console.warn('ThreadBrowser: fetchRoomThreads failed', err);
        });

        const hasMore = await mx.paginateEventTimeline(allThreadsSet.getLiveTimeline(), {
          backwards: true,
        });
        hydrateThreadsFromTimelineSet(allThreadsSet);
        if (!cancelled) {
          setCanLoadMore(hasMore);
          forceUpdate((n) => n + 1);
        }
      } catch {
        // Server doesn't support the threads list API; fall back to locally known threads.
      } finally {
        if (!cancelled) setLoadingMore(false);
      }
    };
    loadThreads();

    return () => {
      cancelled = true;
      room.off(ThreadEvent.New as any, onUpdate);
      room.off(ThreadEvent.Update as any, onUpdate);
      room.off(ThreadEvent.NewReply as any, onUpdate);
    };
  }, [room, mx, hydrateThreadsFromTimelineSet]);

  const handleLoadMore = useCallback(async () => {
    const tls = threadListTimelineSetRef.current;
    if (!tls || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const hasMore = await mx.paginateEventTimeline(tls.getLiveTimeline(), { backwards: true });
      hydrateThreadsFromTimelineSet(tls);
      setCanLoadMore(hasMore);
      forceUpdate((n) => n + 1);
    } catch {
      // ignore
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [mx, hydrateThreadsFromTimelineSet]);

  const handleLoadMoreRef = useRef(handleLoadMore);
  handleLoadMoreRef.current = handleLoadMore;

  const handleThreadsScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < 200 && canLoadMoreRef.current && !loadingMoreRef.current) {
      handleLoadMoreRef.current();
    }
  }, []);

  const allThreads = room.getThreads().sort((a: Thread, b: Thread) => {
    const aTs = a.events.at(-1)?.getTs() ?? a.rootEvent?.getTs() ?? 0;
    const bTs = b.events.at(-1)?.getTs() ?? b.rootEvent?.getTs() ?? 0;
    return bTs - aTs;
  });

  const lowerQuery = query.trim().toLowerCase();
  const threads = lowerQuery
    ? allThreads.filter((t: Thread) => {
        const body = t.rootEvent?.getContent()?.body ?? '';
        return typeof body === 'string' && body.toLowerCase().includes(lowerQuery);
      })
    : allThreads;

  const handleSearchChange: ChangeEventHandler<HTMLInputElement> = (e) => {
    setQuery(e.target.value);
  };

  return (
    <Box
      className={overlay ? css.ThreadDrawerOverlay : css.ThreadDrawer}
      direction="Column"
      shrink="No"
    >
      <Header className={css.ThreadDrawerHeader} variant="Background" size="600">
        <Box grow="Yes" alignItems="Center" gap="200">
          <Icon size="200" src={Icons.Thread} />
          <Text size="H5" truncate>
            Threads
          </Text>
        </Box>
        <Box alignItems="Center" gap="200" shrink="No">
          <Text size="T300" priority="300" truncate>
            # {room.name}
          </Text>
          <IconButton onClick={onClose} variant="Background" aria-label="Close threads">
            <Icon src={Icons.Cross} />
          </IconButton>
        </Box>
      </Header>

      <Box
        direction="Column"
        gap="100"
        style={{ padding: `${config.space.S200} ${config.space.S300}` }}
        shrink="No"
      >
        <Input
          ref={searchRef}
          value={query}
          onChange={handleSearchChange}
          placeholder="Search threads..."
          variant="Surface"
          size="400"
          radii="400"
          before={<Icon size="50" src={Icons.Search} />}
          after={
            query ? (
              <IconButton
                size="300"
                radii="300"
                variant="SurfaceVariant"
                onClick={() => {
                  setQuery('');
                  searchRef.current?.focus();
                }}
                aria-label="Clear search"
              >
                <Icon size="50" src={Icons.Cross} />
              </IconButton>
            ) : undefined
          }
        />
      </Box>

      <Box className={css.ThreadDrawerContent} grow="Yes" direction="Column">
        <Scroll
          variant="Background"
          visibility="Hover"
          direction="Vertical"
          hideTrack
          onScroll={handleThreadsScroll}
          style={{ flexGrow: 1 }}
        >
          {(() => {
            if (threads.length === 0 && loadingMore) {
              return (
                <Box
                  direction="Column"
                  alignItems="Center"
                  justifyContent="Center"
                  style={{ padding: config.space.S400, gap: config.space.S200 }}
                >
                  <Spinner variant="Secondary" size="400" />
                </Box>
              );
            }
            if (threads.length === 0) {
              return (
                <Box
                  direction="Column"
                  alignItems="Center"
                  justifyContent="Center"
                  style={{ padding: config.space.S400, gap: config.space.S200 }}
                >
                  <Icon size="400" src={Icons.Thread} />
                  <Text size="T300" align="Center">
                    {lowerQuery ? 'No threads match your search.' : 'No threads yet.'}
                  </Text>
                </Box>
              );
            }
            return (
              <>
                <Box
                  direction="Column"
                  style={{ padding: `${config.space.S100} ${config.space.S200}` }}
                >
                  {threads.map((thread: Thread) => (
                    <ThreadPreview
                      key={thread.id}
                      room={room}
                      thread={thread}
                      onClick={onOpenThread}
                      onJump={onClose}
                    />
                  ))}
                </Box>
                {loadingMore && (
                  <Box
                    justifyContent="Center"
                    style={{ padding: config.space.S300, flexShrink: 0 }}
                  >
                    <Spinner variant="Secondary" size="400" />
                  </Box>
                )}
              </>
            );
          })()}
        </Scroll>
      </Box>
    </Box>
  );
}
