import { atom } from 'jotai';
import { BookmarkItemContent } from '../features/bookmarks/bookmarkDomain';

export const bookmarkListAtom = atom<BookmarkItemContent[]>([]);
export const bookmarkLoadingAtom = atom<boolean>(false);

export const bookmarkIdSetAtom = atom<Set<string>>((get) => {
  const list = get(bookmarkListAtom);
  return new Set(list.map((b) => b.bookmark_id));
});
