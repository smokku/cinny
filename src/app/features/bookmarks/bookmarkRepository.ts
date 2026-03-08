import { MatrixClient } from 'matrix-js-sdk';
import {
  BookmarkIndexContent,
  BookmarkItemContent,
  BOOKMARKS_INDEX_EVENT,
  bookmarkItemEventType,
  emptyIndex,
  isValidBookmarkItem,
  isValidIndexContent,
} from './bookmarkDomain';

function readIndex(mx: MatrixClient): BookmarkIndexContent {
  const evt = mx.getAccountData(BOOKMARKS_INDEX_EVENT as any);
  const content = evt?.getContent();
  if (isValidIndexContent(content)) return content;
  return emptyIndex();
}

function readItem(mx: MatrixClient, bookmarkId: string): BookmarkItemContent | undefined {
  const evt = mx.getAccountData(bookmarkItemEventType(bookmarkId) as any);
  const content = evt?.getContent();
  if (isValidBookmarkItem(content) && !content.deleted) return content;
  return undefined;
}

async function writeIndex(mx: MatrixClient, index: BookmarkIndexContent): Promise<void> {
  await mx.setAccountData(BOOKMARKS_INDEX_EVENT as any, index as any);
}

async function writeItem(mx: MatrixClient, item: BookmarkItemContent): Promise<void> {
  await mx.setAccountData(bookmarkItemEventType(item.bookmark_id) as any, item as any);
}

export async function addBookmark(mx: MatrixClient, item: BookmarkItemContent): Promise<void> {
  await writeItem(mx, item);

  const index = readIndex(mx);
  if (!index.bookmark_ids.includes(item.bookmark_id)) {
    index.bookmark_ids.unshift(item.bookmark_id);
  }
  index.revision += 1;
  index.updated_ts = Date.now();
  await writeIndex(mx, index);
}

export async function removeBookmark(mx: MatrixClient, bookmarkId: string): Promise<void> {
  const index = readIndex(mx);
  index.bookmark_ids = index.bookmark_ids.filter((id) => id !== bookmarkId);
  index.revision += 1;
  index.updated_ts = Date.now();
  await writeIndex(mx, index);

  const existing = readItem(mx, bookmarkId);
  if (existing) {
    await writeItem(mx, { ...existing, deleted: true });
  }
}

export function listBookmarks(mx: MatrixClient): BookmarkItemContent[] {
  const index = readIndex(mx);
  return index.bookmark_ids
    .map((id) => readItem(mx, id))
    .filter((item): item is BookmarkItemContent => item != null);
}

export function isBookmarked(mx: MatrixClient, bookmarkId: string): boolean {
  const index = readIndex(mx);
  return index.bookmark_ids.includes(bookmarkId);
}
