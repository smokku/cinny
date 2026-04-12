import { useAtomValue, useSetAtom } from 'jotai';
import { useCallback } from 'react';
import { BookmarkItemContent, computeBookmarkId } from './bookmarkDomain';
import {
  addBookmark as repoAdd,
  removeBookmark as repoRemove,
  listBookmarks,
  isBookmarked as repoIsBookmarked,
} from './bookmarkRepository';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import {
  bookmarkIdSetAtom,
  bookmarkListAtom,
  bookmarkLoadingAtom,
  bookmarkRefreshErrorAtom,
  bookmarksByAccountAtom,
} from '../../state/bookmarks';

export function useBookmarkList(): BookmarkItemContent[] {
  return useAtomValue(bookmarkListAtom);
}

export function useBookmarkLoading(): boolean {
  return useAtomValue(bookmarkLoadingAtom);
}

export function useBookmarkRefreshError(): Error | undefined {
  return useAtomValue(bookmarkRefreshErrorAtom);
}

export function useIsBookmarked(roomId: string, eventId: string): boolean {
  const idSet = useAtomValue(bookmarkIdSetAtom);
  return idSet.has(computeBookmarkId(roomId, eventId));
}

export function useBookmarkActions() {
  const mx = useMatrixClient();
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

  const add = useCallback(
    async (item: BookmarkItemContent) => {
      setByAccount((prev) => {
        const next = new Map(prev);
        const current = next.get(userId) ?? [];
        if (current.some((b: BookmarkItemContent) => b.bookmark_id === item.bookmark_id))
          return prev;
        next.set(userId, [item, ...current]);
        return next;
      });
      await repoAdd(mx, item);
    },
    [mx, userId, setByAccount]
  );

  const remove = useCallback(
    async (bookmarkId: string) => {
      setByAccount((prev) => {
        const next = new Map(prev);
        const current = next.get(userId) ?? [];
        next.set(
          userId,
          current.filter((b: BookmarkItemContent) => b.bookmark_id !== bookmarkId)
        );
        return next;
      });
      await repoRemove(mx, bookmarkId);
    },
    [mx, userId, setByAccount]
  );

  const checkIsBookmarked = useCallback(
    (roomId: string, eventId: string): boolean =>
      repoIsBookmarked(mx, computeBookmarkId(roomId, eventId)),
    [mx]
  );

  return { refresh, add, remove, checkIsBookmarked };
}
