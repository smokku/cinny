import React, { RefObject, useEffect, useMemo, useRef } from 'react';
import { Text, Box, Icon, Icons, config, Spinner, IconButton, Line, toRem } from 'folds';
import { useAtomValue } from 'jotai';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { SearchOrderBy } from 'matrix-js-sdk';
import { PageHero, PageHeroEmpty, PageHeroSection } from '../../components/page';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { _SearchPathSearchParams } from '../../pages/paths';
import { useSetting } from '../../state/hooks/settings';
import { settingsAtom } from '../../state/settings';
import { SequenceCard } from '../../components/sequence-card';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { ScrollTopContainer } from '../../components/scroll-top-container';
import { ContainerColor } from '../../styles/ContainerColor.css';
import { decodeSearchParamValueArray, encodeSearchParamValueArray } from '../../pages/pathUtils';
import { useRooms } from '../../state/hooks/roomList';
import { allRoomsAtom } from '../../state/room-list/roomList';
import { mDirectAtom } from '../../state/mDirectList';
import { MessageSearchParams, useMessageSearch } from './useMessageSearch';
import { SearchResultGroup } from './SearchResultGroup';
import { SearchInput } from './SearchInput';
import { SearchFilters } from './SearchFilters';
import { VirtualTile } from '../../components/virtualizer';
import { parseSearchOperators } from './parseSearchOperators';

const useSearchPathSearchParams = (searchParams: URLSearchParams): _SearchPathSearchParams =>
  useMemo(
    () => ({
      global: searchParams.get('global') ?? undefined,
      term: searchParams.get('term') ?? undefined,
      order: searchParams.get('order') ?? undefined,
      rooms: searchParams.get('rooms') ?? undefined,
      senders: searchParams.get('senders') ?? undefined,
      mentions: searchParams.get('mentions') ?? undefined,
    }),
    [searchParams]
  );

type MessageSearchProps = {
  defaultRoomsFilterName: string;
  allowGlobal?: boolean;
  rooms: string[];
  senders?: string[];
  scrollRef: RefObject<HTMLDivElement>;
};
export function MessageSearch({
  defaultRoomsFilterName,
  allowGlobal,
  rooms,
  senders,
  scrollRef,
}: MessageSearchProps) {
  const mx = useMatrixClient();
  const mDirects = useAtomValue(mDirectAtom);
  const allRooms = useRooms(mx, allRoomsAtom, mDirects);
  const [mediaAutoLoad] = useSetting(settingsAtom, 'mediaAutoLoad');
  const [urlPreview] = useSetting(settingsAtom, 'urlPreview');
  const [legacyUsernameColor] = useSetting(settingsAtom, 'legacyUsernameColor');

  const [hour24Clock] = useSetting(settingsAtom, 'hour24Clock');
  const [dateFormatString] = useSetting(settingsAtom, 'dateFormatString');

  const searchInputRef = useRef<HTMLInputElement>(null);
  const scrollTopAnchorRef = useRef<HTMLDivElement>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const searchPathSearchParams = useSearchPathSearchParams(searchParams);
  const { navigateRoom } = useRoomNavigate();

  const userId = mx.getUserId();

  const synthesizedInputValue = useMemo(() => {
    const parts: string[] = [];
    if (searchPathSearchParams.senders) {
      decodeSearchParamValueArray(searchPathSearchParams.senders).forEach((s) =>
        parts.push(`from:${s === userId ? 'me' : s}`)
      );
    }
    if (searchPathSearchParams.mentions) {
      decodeSearchParamValueArray(searchPathSearchParams.mentions).forEach((m) =>
        parts.push(`mentions:${m === userId ? 'me' : m}`)
      );
    }
    if (searchPathSearchParams.term) {
      parts.push(searchPathSearchParams.term);
    }
    return parts.join(' ');
  }, [
    searchPathSearchParams.term,
    searchPathSearchParams.senders,
    searchPathSearchParams.mentions,
    userId,
  ]);

  useEffect(() => {
    if (searchInputRef.current) {
      searchInputRef.current.value = synthesizedInputValue;
    }
  }, [synthesizedInputValue]);

  const searchParamRooms = useMemo(() => {
    if (searchPathSearchParams.rooms) {
      const joinedRoomIds = decodeSearchParamValueArray(searchPathSearchParams.rooms).filter(
        (rId) => allRooms.includes(rId)
      );
      return joinedRoomIds;
    }
    return undefined;
  }, [allRooms, searchPathSearchParams.rooms]);
  const searchParamsSenders = useMemo(() => {
    if (searchPathSearchParams.senders) {
      return decodeSearchParamValueArray(searchPathSearchParams.senders);
    }
    return undefined;
  }, [searchPathSearchParams.senders]);

  const sendersMe = !!searchParamsSenders && !!userId && searchParamsSenders.includes(userId);

  const searchParamMentions = useMemo(() => {
    if (!searchPathSearchParams.mentions) return undefined;
    const ids = decodeSearchParamValueArray(searchPathSearchParams.mentions);
    return { user_ids: ids };
  }, [searchPathSearchParams.mentions]);

  const mentionsMe =
    !!searchParamMentions && !!userId && searchParamMentions.user_ids.includes(userId);

  const msgSearchParams: MessageSearchParams = useMemo(() => {
    const isGlobal = searchPathSearchParams.global === 'true';
    const defaultRooms = isGlobal ? undefined : rooms;

    return {
      term: searchPathSearchParams.term,
      order: searchPathSearchParams.order ?? SearchOrderBy.Recent,
      rooms: searchParamRooms ?? defaultRooms,
      senders: searchParamsSenders ?? senders,
      mentions: searchParamMentions,
    };
  }, [
    searchPathSearchParams,
    searchParamRooms,
    searchParamsSenders,
    searchParamMentions,
    rooms,
    senders,
  ]);

  const searchMessages = useMessageSearch(msgSearchParams);

  const isSearchActive = useMemo(
    () =>
      !!(
        msgSearchParams.term ||
        (msgSearchParams.senders && msgSearchParams.senders.length > 0) ||
        (msgSearchParams.mentions && msgSearchParams.mentions.user_ids.length > 0)
      ),
    [msgSearchParams]
  );

  const { status, data, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    enabled: isSearchActive,
    queryKey: [
      'search',
      msgSearchParams.term,
      msgSearchParams.order,
      msgSearchParams.rooms,
      msgSearchParams.senders,
      msgSearchParams.mentions,
    ],
    queryFn: ({ pageParam }) => searchMessages(pageParam),
    initialPageParam: '',
    getNextPageParam: (lastPage) => lastPage.nextToken,
  });

  const groups = useMemo(() => data?.pages.flatMap((result) => result.groups) ?? [], [data]);
  const highlights = useMemo(() => {
    const mixed = data?.pages.flatMap((result) => result.highlights);
    return Array.from(new Set(mixed));
  }, [data]);

  const virtualizer = useVirtualizer({
    count: groups.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 40,
    overscan: 1,
  });
  const vItems = virtualizer.getVirtualItems();

  const resolveMe = (id: string) => (id === 'me' && userId ? userId : id);

  const handleSearch = (rawInput: string) => {
    const parsed = parseSearchOperators(rawInput);

    setSearchParams((prevParams) => {
      const newParams = new URLSearchParams(prevParams);

      newParams.delete('term');
      if (parsed.searchTerm) {
        newParams.append('term', parsed.searchTerm);
      }

      newParams.delete('senders');
      if (parsed.fromUsers.length > 0) {
        const senderIds = parsed.fromUsers.map(resolveMe);
        newParams.append('senders', encodeSearchParamValueArray(senderIds));
      }

      newParams.delete('mentions');
      if (parsed.mentionUsers.length > 0) {
        const mentionIds = parsed.mentionUsers.map(resolveMe);
        newParams.append('mentions', encodeSearchParamValueArray(mentionIds));
      }

      return newParams;
    });
  };
  const handleSearchClear = () => {
    if (searchInputRef.current) {
      searchInputRef.current.value = '';
    }
    setSearchParams((prevParams) => {
      const newParams = new URLSearchParams(prevParams);
      newParams.delete('term');
      newParams.delete('senders');
      newParams.delete('mentions');
      return newParams;
    });
  };

  const handleSelectedRoomsChange = (selectedRooms?: string[]) => {
    setSearchParams((prevParams) => {
      const newParams = new URLSearchParams(prevParams);
      newParams.delete('rooms');
      if (selectedRooms && selectedRooms.length > 0) {
        newParams.append('rooms', encodeSearchParamValueArray(selectedRooms));
      }
      return newParams;
    });
  };
  const handleGlobalChange = (global?: boolean) => {
    setSearchParams((prevParams) => {
      const newParams = new URLSearchParams(prevParams);
      newParams.delete('global');
      if (global) {
        newParams.append('global', 'true');
      }
      return newParams;
    });
  };

  const handleOrderChange = (order?: string) => {
    setSearchParams((prevParams) => {
      const newParams = new URLSearchParams(prevParams);
      newParams.delete('order');
      if (order) {
        newParams.append('order', order);
      }
      return newParams;
    });
  };

  const handleSendersMeChange = (enabled: boolean) => {
    if (!userId) return;
    setSearchParams((prevParams) => {
      const newParams = new URLSearchParams(prevParams);
      newParams.delete('senders');
      if (enabled) {
        newParams.append('senders', encodeSearchParamValueArray([userId]));
      }
      return newParams;
    });
  };

  const handleMentionsMeChange = (enabled: boolean) => {
    if (!userId) return;
    setSearchParams((prevParams) => {
      const newParams = new URLSearchParams(prevParams);
      newParams.delete('mentions');
      if (enabled) {
        newParams.append('mentions', encodeSearchParamValueArray([userId]));
      }
      return newParams;
    });
  };

  const lastVItem = vItems[vItems.length - 1];
  const lastVItemIndex: number | undefined = lastVItem?.index;
  const lastGroupIndex = groups.length - 1;
  useEffect(() => {
    if (
      lastGroupIndex > -1 &&
      lastGroupIndex === lastVItemIndex &&
      !isFetchingNextPage &&
      hasNextPage
    ) {
      fetchNextPage();
    }
  }, [lastVItemIndex, lastGroupIndex, fetchNextPage, isFetchingNextPage, hasNextPage]);

  return (
    <Box direction="Column" gap="700">
      <ScrollTopContainer scrollRef={scrollRef} anchorRef={scrollTopAnchorRef}>
        <IconButton
          onClick={() => virtualizer.scrollToOffset(0)}
          variant="SurfaceVariant"
          radii="Pill"
          outlined
          size="300"
          aria-label="Scroll to Top"
        >
          <Icon src={Icons.ChevronTop} size="300" />
        </IconButton>
      </ScrollTopContainer>
      <Box ref={scrollTopAnchorRef} direction="Column" gap="300">
        <SearchInput
          active={isSearchActive}
          loading={status === 'pending'}
          searchInputRef={searchInputRef}
          onSearch={handleSearch}
          onReset={handleSearchClear}
        />
        <SearchFilters
          defaultRoomsFilterName={defaultRoomsFilterName}
          allowGlobal={allowGlobal}
          roomList={searchPathSearchParams.global === 'true' ? allRooms : rooms}
          selectedRooms={searchParamRooms}
          onSelectedRoomsChange={handleSelectedRoomsChange}
          global={searchPathSearchParams.global === 'true'}
          onGlobalChange={handleGlobalChange}
          order={msgSearchParams.order}
          onOrderChange={handleOrderChange}
          sendersMe={sendersMe}
          onSendersMeChange={handleSendersMeChange}
          mentionsMe={mentionsMe}
          onMentionsMeChange={handleMentionsMeChange}
        />
      </Box>

      {!isSearchActive && status === 'pending' && (
        <PageHeroEmpty>
          <PageHeroSection>
            <PageHero
              icon={<Icon size="600" src={Icons.Message} />}
              title="Search Messages"
              subTitle="Find helpful messages in your community by searching with related keywords."
            />
          </PageHeroSection>
        </PageHeroEmpty>
      )}

      {isSearchActive && groups.length === 0 && status === 'success' && (
        <Box
          className={ContainerColor({ variant: 'Warning' })}
          style={{ padding: config.space.S300, borderRadius: config.radii.R400 }}
          alignItems="Center"
          gap="200"
        >
          <Icon size="200" src={Icons.Info} />
          <Text>
            No results found
            {msgSearchParams.term ? (
              <>
                {' '}
                for <b>{`"${msgSearchParams.term}"`}</b>
              </>
            ) : null}
          </Text>
        </Box>
      )}

      {((isSearchActive && status === 'pending') || (groups.length > 0 && vItems.length === 0)) && (
        <Box direction="Column" gap="100">
          {[...Array(8).keys()].map((key) => (
            <SequenceCard variant="SurfaceVariant" key={key} style={{ minHeight: toRem(80) }} />
          ))}
        </Box>
      )}

      {vItems.length > 0 && (
        <Box direction="Column" gap="300">
          <Box direction="Column" gap="200">
            <Text size="H5">
              {msgSearchParams.term ? `Results for "${msgSearchParams.term}"` : 'Results'}
            </Text>
            <Line size="300" variant="Surface" />
          </Box>
          <div
            style={{
              position: 'relative',
              height: virtualizer.getTotalSize(),
            }}
          >
            {vItems.map((vItem) => {
              const group = groups[vItem.index];
              if (!group) return null;
              const groupRoom = mx.getRoom(group.roomId);
              if (!groupRoom) return null;

              return (
                <VirtualTile
                  virtualItem={vItem}
                  style={{ paddingBottom: config.space.S500 }}
                  ref={virtualizer.measureElement}
                  key={vItem.index}
                >
                  <SearchResultGroup
                    room={groupRoom}
                    highlights={highlights}
                    items={group.items}
                    mediaAutoLoad={mediaAutoLoad}
                    urlPreview={urlPreview}
                    onOpen={navigateRoom}
                    legacyUsernameColor={legacyUsernameColor || mDirects.has(groupRoom.roomId)}
                    hour24Clock={hour24Clock}
                    dateFormatString={dateFormatString}
                  />
                </VirtualTile>
              );
            })}
          </div>
          {isFetchingNextPage && (
            <Box justifyContent="Center" alignItems="Center">
              <Spinner size="600" variant="Secondary" />
            </Box>
          )}
        </Box>
      )}

      {error && (
        <Box
          className={ContainerColor({ variant: 'Critical' })}
          style={{
            padding: config.space.S300,
            borderRadius: config.radii.R400,
          }}
          direction="Column"
          gap="200"
        >
          <Text size="L400">{error.name}</Text>
          <Text size="T300">{error.message}</Text>
        </Box>
      )}
    </Box>
  );
}
