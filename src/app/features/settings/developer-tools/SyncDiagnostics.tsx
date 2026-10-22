import React, { useEffect, useState } from 'react';
import { useAtomValue } from 'jotai';
import { Box, Text, config } from 'folds';
import { KnownMembership } from 'matrix-js-sdk';
import { SequenceCard } from '../../../components/sequence-card';
import { SequenceCardStyle } from '../styles.css';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { getClientSyncDiagnostics } from '../../../../client/initMatrix';
import { allRoomsAtom } from '../../../state/room-list/roomList';
import { allInvitesAtom } from '../../../state/room-list/inviteList';

const formatListCoverage = (knownCount: number, rangeEnd: number): string => {
  if (knownCount <= 0) return '0/0';
  const loadedCount = Math.max(0, Math.min(knownCount, rangeEnd + 1));
  return `${loadedCount}/${knownCount}`;
};

export function SyncDiagnostics() {
  const mx = useMatrixClient();
  const listedJoinedRoomIds = useAtomValue(allRoomsAtom);
  const listedInviteRoomIds = useAtomValue(allInvitesAtom);
  const [, setTick] = useState(0);

  useEffect(() => {
    const intervalId = window.setInterval(() => setTick((v) => v + 1), 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  const diagnostics = getClientSyncDiagnostics(mx);
  const rooms = mx.getRooms();
  const joinedRooms = rooms.filter((room) => room.getMyMembership() === KnownMembership.Join);
  const inviteRooms = rooms.filter((room) => room.getMyMembership() === KnownMembership.Invite);

  return (
    <Box direction="Column" gap="100">
      <Text size="L400">Sync Diagnostics</Text>
      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <Box direction="Column" gap="100" style={{ padding: config.space.S300 }}>
          <Text size="T300">Transport: {diagnostics.transport}</Text>
          <Text size="T300">State: {diagnostics.syncState ?? 'null'}</Text>
          <Text size="T300">
            Rooms: {rooms.length} total, {joinedRooms.length} joined, {inviteRooms.length} invites
          </Text>
          <Text size="T300">
            Room list: {listedJoinedRoomIds.length} joined, {listedInviteRoomIds.length} invites
          </Text>
          {diagnostics.sliding && (
            <>
              <Text size="T300">Sliding sync base URL: {diagnostics.sliding.baseUrl}</Text>
              <Text size="T300">Room timeline limit: {diagnostics.sliding.timelineLimit}</Text>
              {diagnostics.sliding.lists.map((list) => (
                <Text size="T300" key={list.key}>
                  List `{list.key}` coverage: {formatListCoverage(list.knownCount, list.rangeEnd)}
                  {list.requestedRangeEnd > list.rangeEnd
                    ? ` (requested through ${list.requestedRangeEnd + 1})`
                    : ''}
                </Text>
              ))}
            </>
          )}
        </Box>
      </SequenceCard>
    </Box>
  );
}
