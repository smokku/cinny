import { useEffect, useState } from 'react';

class LRUBlobCache {
  private cache = new Map<string, string>();

  private readonly maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  get(key: string): string | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Promote to most recent by re-inserting
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: string, value: string): void {
    // If key exists, delete first so re-insert moves it to end
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }
    this.cache.set(key, value);
    this.evict();
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  private evict(): void {
    while (this.cache.size > this.maxSize) {
      const { value: oldest, done } = this.cache.keys().next();
      if (done || oldest === undefined) break;
      const blobUrl = this.cache.get(oldest);
      this.cache.delete(oldest);
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    }
  }
}

const BLOB_CACHE_MAX_SIZE = 300;
const imageBlobCache = new LRUBlobCache(BLOB_CACHE_MAX_SIZE);
const inflightRequests = new Map<string, Promise<string>>();

export function useBlobCache(url?: string): string | undefined {
  const [cacheState, setCacheState] = useState<{ sourceUrl?: string; blobUrl?: string }>({
    sourceUrl: url,
    blobUrl: url ? imageBlobCache.get(url) : undefined,
  });

  if (url !== cacheState.sourceUrl) {
    setCacheState({
      sourceUrl: url,
      blobUrl: url ? imageBlobCache.get(url) : undefined,
    });
  }

  useEffect(() => {
    if (!url || imageBlobCache.has(url)) return undefined;

    let isMounted = true;

    const fetchBlob = async () => {
      if (inflightRequests.has(url)) {
        const existingBlobUrl = await inflightRequests.get(url);
        if (isMounted) setCacheState({ sourceUrl: url, blobUrl: existingBlobUrl });
        return;
      }

      const requestPromise = (async () => {
        try {
          const res = await fetch(url, { mode: 'cors' });
          if (!res.ok) throw new Error();
          const blob = await res.blob();
          const objectUrl = URL.createObjectURL(blob);

          imageBlobCache.set(url, objectUrl);
          return objectUrl;
        } catch (e) {
          inflightRequests.delete(url);
          throw e;
        }
      })();

      inflightRequests.set(url, requestPromise);

      try {
        const finalBlobUrl = await requestPromise;
        if (isMounted) {
          setCacheState({ sourceUrl: url, blobUrl: finalBlobUrl });
        }
      } catch {
        // Ignore cache failures and fallback to source URL.
      } finally {
        inflightRequests.delete(url);
      }
    };

    fetchBlob();

    return () => {
      isMounted = false;
    };
  }, [url]);

  return cacheState.blobUrl || url;
}
