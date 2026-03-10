import React, { ChangeEvent, useEffect, useMemo, useState } from 'react';
import { Box, Button, Icon, IconButton, Icons, Input, Text } from 'folds';
import { SettingTile } from '../../../components/setting-tile';

interface IntlWithSupportedValues {
  supportedValuesOf(key: 'timeZone' | string): string[];
}

type TimezoneEditorProps = {
  current?: string;
  onSave: (tz: string) => void;
  disabled?: boolean;
};

export function TimezoneEditor({ current, onSave, disabled }: TimezoneEditorProps) {
  const [val, setVal] = useState(current ?? '');
  const zones = useMemo(() => {
    const intlPolyfill = Intl as unknown as IntlWithSupportedValues;
    return intlPolyfill.supportedValuesOf('timeZone');
  }, []);

  useEffect(() => setVal(current ?? ''), [current]);

  const handleSync = () => {
    if (disabled) return;
    const systemTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    setVal(systemTz);
    onSave(systemTz);
  };

  const handleReset = () => {
    if (disabled) return;
    setVal('');
    onSave('');
  };

  const handleManualSave = () => {
    if (disabled) return;
    const trimmed = val.trim().slice(0, 64);
    const matchedZone = zones.find((z) => z.toLowerCase() === trimmed.toLowerCase());
    if (matchedZone && matchedZone !== current) {
      onSave(matchedZone);
      setVal(matchedZone);
    }
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    setVal(e.currentTarget.value);
  };

  return (
    <SettingTile
      title="Timezone"
      description="Set manually or sync with your system."
      after={
        <Box gap="200" alignItems="Center">
          <Input
            list="tz-list"
            value={val}
            size="300"
            radii="300"
            variant="Secondary"
            placeholder="e.g. Europe/London"
            onChange={handleChange}
            onBlur={handleManualSave}
            onKeyDown={(e) => e.key === 'Enter' && handleManualSave()}
            style={{ width: '180px' }}
            disabled={disabled}
          />
          <datalist id="tz-list">
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </datalist>
          <Button
            variant="Secondary"
            fill="Soft"
            size="300"
            radii="300"
            outlined
            onClick={handleSync}
            disabled={disabled}
          >
            <Text size="B300">System</Text>
          </Button>
          <IconButton
            size="300"
            variant="Critical"
            fill="None"
            onClick={handleReset}
            radii="300"
            title="Reset"
            disabled={disabled}
          >
            <Icon src={Icons.Cross} size="100" />
          </IconButton>
        </Box>
      }
    />
  );
}
