import React from 'react';
import { Box, Button, Spinner, Text, color } from 'folds';

import * as css from './RoomTombstone.css';
import { AsyncStatus } from '../../hooks/useAsyncCallback';
import { Membership } from '../../../types/matrix/room';
import { RoomInputPlaceholder } from './RoomInputPlaceholder';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { useRoomReplacement, useReplacementOpen } from '../../hooks/useRoomReplacement';

type RoomTombstoneProps = { roomId: string; body?: string; replacementRoomId?: string };
export function RoomTombstone({ roomId, body, replacementRoomId }: RoomTombstoneProps) {
  const { navigateRoom } = useRoomNavigate();
  const { validReplacementRoomId, replacementRoom, joinState, handleJoin } = useRoomReplacement(
    roomId,
    replacementRoomId
  );

  const handleOpen = useReplacementOpen(replacementRoom, joinState, navigateRoom);

  const defaultMessage = validReplacementRoomId
    ? 'This room has been replaced and is no longer active.'
    : 'This room has been closed and is no longer active.';

  return (
    <RoomInputPlaceholder alignItems="Center" gap="600" className={css.RoomTombstone}>
      <Box direction="Column" grow="Yes">
        <Text size="T400">{body || defaultMessage}</Text>
        {joinState.status === AsyncStatus.Error && (
          <Text style={{ color: color.Critical.Main }} size="T200">
            {(joinState.error as any)?.message ?? 'Failed to join replacement room!'}
          </Text>
        )}
      </Box>
      {validReplacementRoomId && (
        <Box shrink="No">
          {replacementRoom?.getMyMembership() === Membership.Join ||
          joinState.status === AsyncStatus.Success ? (
            <Button onClick={handleOpen} size="300" variant="Success" fill="Solid" radii="300">
              <Text size="B300">Open New Room</Text>
            </Button>
          ) : (
            <Button
              onClick={handleJoin}
              size="300"
              variant="Primary"
              fill="Solid"
              radii="300"
              before={
                joinState.status === AsyncStatus.Loading && (
                  <Spinner size="100" variant="Primary" fill="Solid" />
                )
              }
              disabled={joinState.status === AsyncStatus.Loading}
            >
              <Text size="B300">Join New Room</Text>
            </Button>
          )}
        </Box>
      )}
    </RoomInputPlaceholder>
  );
}
