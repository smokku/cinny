import { EventTimeline, MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { Icons, IconSrc } from 'folds';
import { useCallback, useState } from 'react';
import { StateEvent } from '../../types/matrix/room';
import { getStateEvents } from '../utils/room';
import { useMatrixClient } from './useMatrixClient';
import { useMediaAuthentication } from './useMediaAuthentication';
import { useStateEventCallback } from './useStateEventCallback';
import { mxcUrlToHttp } from '../utils/matrix';

export type RoomIntegration = {
  key: string;
  name: string;
  description: string;
  icon: IconSrc;
  avatarUrl?: string;
  externalUrl?: string;
};

// --- MSC2346 bridges (uk.half-shot.bridge) ---

type BridgeEntity = {
  id?: string;
  displayname?: string;
  avatar_url?: string;
  external_url?: string;
};

type BridgeContent = {
  bridgebot?: string;
  creator?: string;
  protocol?: BridgeEntity;
  network?: BridgeEntity;
  channel?: BridgeEntity;
};

function bridgeToIntegration(
  stateKey: string,
  content: BridgeContent,
  mx: MatrixClient,
  useAuthentication: boolean
): RoomIntegration {
  const { protocol, network, channel } = content;

  const name = protocol?.displayname ?? protocol?.id ?? 'Unknown Bridge';

  const channelName = channel?.displayname ?? channel?.id;
  const networkName = network?.displayname ?? network?.id;
  let description: string;
  if (channelName && networkName) {
    description = `${channelName} on ${networkName}`;
  } else {
    description = channelName ?? networkName ?? 'Unknown Channel';
  }

  const avatarMxc = protocol?.avatar_url ?? channel?.avatar_url;
  const avatarUrl = avatarMxc
    ? mxcUrlToHttp(mx, avatarMxc, useAuthentication, 36, 36, 'crop') ?? undefined
    : undefined;

  return {
    key: `bridge:${stateKey}`,
    name,
    description,
    icon: Icons.Link,
    avatarUrl,
    externalUrl: channel?.external_url ?? protocol?.external_url,
  };
}

// --- Hookshot connections (uk.half-shot.matrix-hookshot.*) ---

const HOOKSHOT_PREFIX = 'uk.half-shot.matrix-hookshot.';

const HOOKSHOT_NAMES: Record<string, { name: string; icon: IconSrc }> = {
  feed: { name: 'RSS/Atom Feed', icon: Icons.Globe },
  'github.repository': { name: 'GitHub', icon: Icons.Code },
  'gitlab.repository': { name: 'GitLab', icon: Icons.Code },
  'jira.project': { name: 'JIRA', icon: Icons.Bookmark },
  'generic.hook': { name: 'Webhook', icon: Icons.Link },
  figma: { name: 'Figma', icon: Icons.Pencil },
};

function hookshotDescription(
  connectionType: string,
  content: Record<string, unknown>,
  stateKey: string
): string {
  if (connectionType === 'feed') {
    return (content.label as string) ?? (content.url as string) ?? stateKey;
  }
  if (connectionType === 'github.repository' || connectionType === 'gitlab.repository') {
    const org = content.org as string | undefined;
    const repo = content.repo as string | undefined;
    if (org && repo) return `${org}/${repo}`;
    return stateKey;
  }
  if (connectionType === 'generic.hook') {
    return (content.name as string) ?? stateKey;
  }
  return stateKey;
}

// --- Unified reader ---

function getRoomIntegrations(
  room: Room,
  mx: MatrixClient,
  useAuthentication: boolean
): RoomIntegration[] {
  const integrations: RoomIntegration[] = [];

  // MSC2346 bridges
  const bridgeEvents = getStateEvents(room, StateEvent.Bridge);
  bridgeEvents.forEach((event) => {
    const content = event.getContent<BridgeContent>();
    const stateKey = event.getStateKey();
    if (stateKey !== undefined && content.protocol) {
      integrations.push(bridgeToIntegration(stateKey, content, mx, useAuthentication));
    }
  });

  // Hookshot connections
  const roomState = room.getLiveTimeline().getState(EventTimeline.FORWARDS);
  if (roomState) {
    roomState.events.forEach((stateKeyToEvent: Map<string, MatrixEvent>, eventType: string) => {
      if (!eventType.startsWith(HOOKSHOT_PREFIX)) return;
      const connectionType = eventType.slice(HOOKSHOT_PREFIX.length);
      const display = HOOKSHOT_NAMES[connectionType];

      stateKeyToEvent.forEach((mEvent, stateKey) => {
        const content = mEvent.getContent<Record<string, unknown>>();
        if (Object.keys(content).length === 0) return;

        integrations.push({
          key: `hookshot:${eventType}:${stateKey}`,
          name: display?.name ?? connectionType,
          description: hookshotDescription(connectionType, content, stateKey),
          icon: display?.icon ?? Icons.Link,
        });
      });
    });
  }

  return integrations;
}

// --- Hook ---

export const useRoomIntegrations = (room: Room): RoomIntegration[] => {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const [integrations, setIntegrations] = useState(() =>
    getRoomIntegrations(room, mx, useAuthentication)
  );

  useStateEventCallback(
    mx,
    useCallback(
      (mEvent) => {
        if (mEvent.getRoomId() !== room.roomId) return;
        const type = mEvent.getType();
        if (type === StateEvent.Bridge || type.startsWith(HOOKSHOT_PREFIX)) {
          setIntegrations(getRoomIntegrations(room, mx, useAuthentication));
        }
      },
      [room, mx, useAuthentication]
    )
  );

  return integrations;
};
