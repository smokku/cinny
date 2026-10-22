import {
  ClientEvent,
  EventType,
  Filter,
  MatrixClient,
  Method,
  SetPresence,
  User,
} from 'matrix-js-sdk';

type PresenceSyncResponse = {
  next_batch?: string;
  presence?: { events?: unknown[] };
};

/**
 * Simplified sliding sync (MSC4186) has no presence extension, so presence is
 * kept up to date with a filtered classic /sync that carries nothing but
 * presence. It also broadcasts our own presence through `set_presence`.
 */
export class PresenceSyncManager {
  private disposed = false;

  private desiredSetPresence = SetPresence.Online;

  private activeRequest: Promise<void> | null = null;

  private abortController: AbortController | undefined;

  private nextPollTimer: ReturnType<typeof setTimeout> | undefined;

  private syncToken: string | undefined;

  private readonly mx: MatrixClient;

  private readonly pollTimeoutMs: number;

  private readonly pollingIntervalMs: number;

  public constructor(mx: MatrixClient, pollTimeoutMs = 30000, pollingIntervalMs = 20000) {
    this.mx = mx;
    this.pollTimeoutMs = pollTimeoutMs;
    this.pollingIntervalMs = pollingIntervalMs;
  }

  public setDesiredPresence(presence: SetPresence): void {
    this.desiredSetPresence = presence;
  }

  public start(): void {
    if (this.disposed || this.activeRequest) return;
    this.poll();
  }

  public dispose(): void {
    this.disposed = true;
    if (this.nextPollTimer !== undefined) clearTimeout(this.nextPollTimer);
    this.nextPollTimer = undefined;
    this.abortController?.abort();
  }

  private processPresence(response: PresenceSyncResponse): void {
    const events = response.presence?.events;
    if (!events || !Array.isArray(events)) return;

    const mapper = this.mx.getEventMapper();
    events.forEach((rawEvent) => {
      if (
        typeof rawEvent !== 'object' ||
        !rawEvent ||
        (rawEvent as Record<string, unknown>).type !== EventType.Presence
      )
        return;

      const presenceEvent = mapper(rawEvent);
      const userId =
        presenceEvent.getSender() ?? (presenceEvent.getContent().user_id as string | undefined);
      if (!userId) return;

      let user = this.mx.store.getUser(userId);
      if (!user) {
        user = User.createUser(userId, this.mx);
        this.mx.store.storeUser(user);
      }
      user.setPresenceEvent(presenceEvent);
      this.mx.emit(ClientEvent.Event, presenceEvent);
    });
  }

  private poll(): void {
    if (this.disposed) return;

    this.abortController = new AbortController();
    const { signal } = this.abortController;

    this.activeRequest = (async () => {
      try {
        const filter = new Filter(this.mx.getUserId());
        filter.setDefinition({
          room: { rooms: [] },
          account_data: { types: [] },
          presence: { types: [EventType.Presence] },
        });

        const filterId = await this.mx.getOrCreateFilter('presence_only', filter);
        const response = await this.mx.http.authedRequest<PresenceSyncResponse>(
          Method.Get,
          '/sync',
          {
            filter: filterId,
            since: this.syncToken,
            timeout: this.pollTimeoutMs,
            set_presence: this.desiredSetPresence,
          },
          undefined,
          { abortSignal: signal }
        );

        // Emitting after teardown drives SDK listeners into a crypto store that is closing.
        if (signal.aborted || this.disposed || !this.mx.clientRunning) return;

        this.processPresence(response);
        this.syncToken = response.next_batch;
      } catch (err) {
        if (!signal.aborted && !this.disposed) {
          console.warn('Presence sync request failed', err);
        }
      }
    })();

    this.activeRequest.finally(() => {
      this.activeRequest = null;
      this.abortController = undefined;

      if (!this.disposed) {
        this.nextPollTimer = setTimeout(() => {
          this.nextPollTimer = undefined;
          this.poll();
        }, this.pollingIntervalMs);
      }
    });
  }
}
