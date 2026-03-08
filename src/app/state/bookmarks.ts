import { atom, useSetAtom } from 'jotai';
import { ClientEvent, MatrixClient, MatrixEvent } from 'matrix-js-sdk';
import { useCallback, useEffect } from 'react';
import { BOOKMARKS_INDEX_EVENT, BookmarkItemContent } from '../features/bookmarks/bookmarkDomain';
import { listBookmarks } from '../features/bookmarks/bookmarkRepository';

export const bookmarkListAtom = atom<BookmarkItemContent[]>([]);
export const bookmarkLoadingAtom = atom<boolean>(false);
export const bookmarkRefreshErrorAtom = atom<Error | undefined>(undefined);

export const bookmarksAtom = {
  list: bookmarkListAtom,
  loading: bookmarkLoadingAtom,
  refreshError: bookmarkRefreshErrorAtom,
};

export const bookmarkIdSetAtom = atom<Set<string>>((get) => {
  const list = get(bookmarkListAtom);
  return new Set(list.map((b) => b.bookmark_id));
});

export const useBindBookmarksAtom = (mx: MatrixClient, bookmarks: typeof bookmarksAtom) => {
  const setList = useSetAtom(bookmarks.list);
  const setLoading = useSetAtom(bookmarks.loading);
  const setRefreshError = useSetAtom(bookmarks.refreshError);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const items = await listBookmarks(mx);
      setList(items);
      setRefreshError(undefined);
    } catch (error) {
      setRefreshError(error as Error);
    } finally {
      setLoading(false);
    }
  }, [mx, setList, setLoading, setRefreshError]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const handleAccountData = (event: MatrixEvent) => {
      if (event.getType() === BOOKMARKS_INDEX_EVENT) {
        refresh();
      }
    };

    mx.on(ClientEvent.AccountData, handleAccountData);
    return () => {
      mx.removeListener(ClientEvent.AccountData, handleAccountData);
    };
  }, [mx, refresh]);
};
