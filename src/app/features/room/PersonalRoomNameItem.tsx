import React, { KeyboardEventHandler, useEffect, useRef, useState } from 'react';
import { Box, Icon, Icons, MenuItem, Text, color, config } from 'folds';
import { Room } from 'matrix-js-sdk';
import { useRoomName } from '../../hooks/useRoomMeta';
import { useRoomNamePrivate, useSetRoomNamePrivate } from '../../hooks/useRoomNamePrivate';

type PersonalRoomNameItemProps = {
  room: Room;
  requestClose: () => void;
};
export function PersonalRoomNameItem({ room, requestClose }: PersonalRoomNameItemProps) {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const currentName = useRoomNamePrivate(room);
  const canonicalName = useRoomName(room);
  const setRoomName = useSetRoomNamePrivate();

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const handleSave = () => {
    // Empty string is a valid blank name per MSC4431, so send it verbatim.
    setRoomName(room, inputRef.current?.value ?? '');
    requestClose();
  };

  const handleClear = () => {
    setRoomName(room, undefined);
    requestClose();
  };

  const handleKeyDown: KeyboardEventHandler<HTMLInputElement> = (e) => {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') setEditing(false);
  };

  if (!editing) {
    return (
      <MenuItem
        onClick={() => setEditing(true)}
        size="300"
        after={<Icon size="100" src={Icons.Pencil} />}
        radii="300"
      >
        <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
          Rename
        </Text>
      </MenuItem>
    );
  }

  return (
    <Box
      direction="Column"
      gap="100"
      style={{ padding: `${config.space.S100} ${config.space.S200}` }}
    >
      <Text size="L400">Personal Name</Text>
      <Text size="T200" priority="300" truncate>
        Others see: {canonicalName}
      </Text>
      <input
        ref={inputRef}
        defaultValue={currentName ?? canonicalName}
        placeholder="Enter a name..."
        onKeyDown={handleKeyDown}
        style={{
          background: color.Surface.Container,
          color: color.Surface.OnContainer,
          border: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`,
          borderRadius: '6px',
          padding: '4px 8px',
          fontSize: '14px',
          width: '100%',
          outline: 'none',
        }}
      />
      <Box gap="200">
        <MenuItem size="300" radii="300" variant="Success" fill="None" onClick={handleSave}>
          <Text size="B300">Save</Text>
        </MenuItem>
        <MenuItem size="300" radii="300" variant="Critical" fill="None" onClick={handleClear}>
          <Text size="B300">Clear</Text>
        </MenuItem>
      </Box>
    </Box>
  );
}
