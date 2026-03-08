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
import { bookmarkIdSetAtom, bookmarkListAtom, bookmarkLoadingAtom } from '../../state/bookmarks';

export function useBookmarkList(): BookmarkItemContent[] {
  return useAtomValue(bookmarkListAtom);
}

export function useBookmarkLoading(): boolean {
  return useAtomValue(bookmarkLoadingAtom);
}

export function useIsBookmarked(roomId: string, eventId: string): boolean {
  const idSet = useAtomValue(bookmarkIdSetAtom);
  return idSet.has(computeBookmarkId(roomId, eventId));
}

export function useBookmarkActions() {
  const mx = useMatrixClient();
  const setList = useSetAtom(bookmarkListAtom);
  const setLoading = useSetAtom(bookmarkLoadingAtom);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const items = listBookmarks(mx);
      setList(items);
    } finally {
      setLoading(false);
    }
  }, [mx, setList, setLoading]);

  const add = useCallback(
    async (item: BookmarkItemContent) => {
      setList((prev) => {
        if (prev.some((b) => b.bookmark_id === item.bookmark_id)) return prev;
        return [item, ...prev];
      });
      await repoAdd(mx, item);
    },
    [mx, setList]
  );

  const remove = useCallback(
    async (bookmarkId: string) => {
      setList((prev) => prev.filter((b) => b.bookmark_id !== bookmarkId));
      await repoRemove(mx, bookmarkId);
    },
    [mx, setList]
  );

  const checkIsBookmarked = useCallback(
    (roomId: string, eventId: string): boolean =>
      repoIsBookmarked(mx, computeBookmarkId(roomId, eventId)),
    [mx]
  );

  return { refresh, add, remove, checkIsBookmarked };
}
