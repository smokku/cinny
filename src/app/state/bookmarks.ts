import { atom, useSetAtom } from 'jotai';
import { ClientEvent, MatrixClient, MatrixEvent } from 'matrix-js-sdk';
import { useCallback, useEffect, useMemo } from 'react';
import { BOOKMARKS_INDEX_EVENT, BookmarkItemContent } from '../features/bookmarks/bookmarkDomain';
import { listBookmarks } from '../features/bookmarks/bookmarkRepository';

// ---------------------------------------------------------------------------
// Per-account storage (Map<userId, BookmarkItemContent[]>)
// ---------------------------------------------------------------------------
export const bookmarksByAccountAtom = atom<Map<string, BookmarkItemContent[]>>(new Map());
export const bookmarkLoadingAtom = atom<boolean>(false);
export const bookmarkRefreshErrorAtom = atom<Error | undefined>(undefined);

// ---------------------------------------------------------------------------
// Aggregated read-only (union across accounts, dedup by bookmark_id)
// ---------------------------------------------------------------------------
export const bookmarkListAtom = atom<BookmarkItemContent[]>((get) => {
  const byAccount = get(bookmarksByAccountAtom);
  const seen = new Set<string>();
  const result: BookmarkItemContent[] = [];
  byAccount.forEach((items) => {
    items.forEach((item) => {
      if (!seen.has(item.bookmark_id)) {
        seen.add(item.bookmark_id);
        result.push(item);
      }
    });
  });
  return result;
});

export const bookmarksAtom = {
  list: bookmarkListAtom,
  loading: bookmarkLoadingAtom,
  refreshError: bookmarkRefreshErrorAtom,
};

export const bookmarkIdSetAtom = atom<Set<string>>((get) => {
  const list = get(bookmarkListAtom);
  return new Set(list.map((b) => b.bookmark_id));
});

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------
export const removeAccountBookmarksAtom = atom(null, (_get, set, userId: string) => {
  set(bookmarksByAccountAtom, (prev) => {
    const next = new Map(prev);
    next.delete(userId);
    return next;
  });
});

// ---------------------------------------------------------------------------
// Per-account binding hook
// ---------------------------------------------------------------------------
export const useBindBookmarksAtom = (mx: MatrixClient) => {
  const userId = mx.getSafeUserId();
  const setByAccount = useSetAtom(bookmarksByAccountAtom);
  const setLoading = useSetAtom(bookmarkLoadingAtom);
  const setRefreshError = useSetAtom(bookmarkRefreshErrorAtom);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const items = await listBookmarks(mx);
      setByAccount((prev) => {
        const next = new Map(prev);
        next.set(userId, items);
        return next;
      });
      setRefreshError(undefined);
    } catch (error) {
      setRefreshError(error as Error);
    } finally {
      setLoading(false);
    }
  }, [mx, userId, setByAccount, setLoading, setRefreshError]);

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
