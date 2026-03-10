import React, { ChangeEvent, useEffect, useState } from 'react';
import { Input } from 'folds';
import { SettingTile } from '../../../components/setting-tile';
import { parsePronounsInput, PronounSet } from '../../../utils/pronouns';

type PronounEditorProps = {
  title: string;
  current: PronounSet[];
  onSave: (p: PronounSet[]) => void;
  disabled?: boolean;
};

export function PronounEditor({ title, current, onSave, disabled }: PronounEditorProps) {
  const initialString = current
    .map((p) => `${p.language ? `${p.language}:` : ''}${p.summary}`)
    .join(', ');
  const [val, setVal] = useState(initialString);

  useEffect(() => setVal(initialString), [initialString]);

  const handleSave = () => {
    if (val === initialString) return;
    const safeVal = val.slice(0, 128);
    const next = parsePronounsInput(safeVal);
    onSave(next);
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    setVal(e.currentTarget.value);
  };

  return (
    <SettingTile
      title={title}
      description="Separate sets with commas (e.g. 'they/them, en:it/its, de:sie/ihr')."
      after={
        <Input
          value={val}
          size="300"
          radii="300"
          disabled={disabled ?? false}
          variant="Secondary"
          placeholder="Add pronouns..."
          onChange={handleChange}
          onBlur={handleSave}
          onKeyDown={(e) => e.key === 'Enter' && handleSave()}
          style={{ width: '232px' }}
        />
      }
    />
  );
}
