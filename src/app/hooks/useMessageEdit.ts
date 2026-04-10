import { useState, useCallback, useRef } from 'react';
import { Editor } from 'slate';
import { ReactEditor } from 'slate-react';
import { isEmptyEditor, moveCursor } from '../components/editor';

export interface UseMessageEditOptions {
  onReset?: () => void;
  alive?: () => boolean;
}

/**
 * Manages the "edit mode" state for a message composer.
 *
 * Centralises the `editId` state and the `handleEdit` callback so that the
 * room timeline and the thread drawer share identical behaviour: passing an
 * id activates the editor for that event; passing `undefined` clears it,
 * restores focus, and resets the editor if it has become empty.
 */
export function useMessageEdit(
  editor: Editor,
  options?: UseMessageEditOptions
): { editId: string | undefined; handleEdit: (editId?: string) => void } {
  const [editId, setEditId] = useState<string | undefined>(undefined);

  const aliveRef = useRef(options?.alive);
  aliveRef.current = options?.alive;
  const onResetRef = useRef(options?.onReset);
  onResetRef.current = options?.onReset;

  const handleEdit = useCallback(
    (targetEditId?: string) => {
      if (targetEditId) {
        setEditId(targetEditId);
        return;
      }
      setEditId(undefined);
      requestAnimationFrame(() => {
        if (aliveRef.current && !aliveRef.current()) return;
        if (onResetRef.current && isEmptyEditor(editor)) onResetRef.current();
        ReactEditor.focus(editor);
        moveCursor(editor);
      });
    },
    [editor]
  );

  return { editId, handleEdit };
}
