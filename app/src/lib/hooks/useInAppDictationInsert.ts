import { emit, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { useEffect } from 'react';
import { usePlatform } from '@/platform/PlatformContext';

/** Input types that take free text. */
const TEXT_INPUT_TYPES = new Set(['text', 'search', 'url', 'email', 'tel', '']);

function isEditableField(element: Element | null): element is HTMLElement {
  if (element instanceof HTMLTextAreaElement) return !element.readOnly && !element.disabled;
  if (element instanceof HTMLInputElement) {
    return TEXT_INPUT_TYPES.has(element.type) && !element.readOnly && !element.disabled;
  }
  return element instanceof HTMLElement && element.isContentEditable;
}

/**
 * Type `text` into the focused field. `insertText` goes through the browser's
 * editing pipeline, so React's `onChange` fires and undo works.
 */
function insertIntoFocusedField(text: string): boolean {
  if (!isEditableField(document.activeElement)) return false;
  return document.execCommand('insertText', false, text);
}

/** The text selected in the focused field, or on the page. */
function selectedText(): string {
  const element = document.activeElement;
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    const { selectionStart, selectionEnd, value } = element;
    if (selectionStart !== null && selectionEnd !== null)
      return value.slice(selectionStart, selectionEnd);
  }
  return window.getSelection()?.toString() ?? '';
}

/**
 * Receive dictation aimed at Herga's own window. When the shortcut fires
 * while a Herga field has focus (writing a correction, say), Rust can't
 * paste into its own webview, so it sends the text here and waits for the
 * reply to decide whether the pill shows an error. A Command Mode take aimed
 * here asks for the selection first (`dictation:selection-request`); its
 * rewrite then arrives as an insert, which replaces the selection.
 *
 * Call once per window that has fields to dictate into.
 */
export function useInAppDictationInsert() {
  const platform = usePlatform();

  useEffect(() => {
    if (!platform.metadata.isTauri) return;
    // Only what Rust sends this window: it picks the focused one.
    const webview = getCurrentWebviewWindow();
    let disposed = false;
    const unlisteners: UnlistenFn[] = [];
    const keep = (fn: UnlistenFn) => {
      if (disposed) fn();
      else unlisteners.push(fn);
    };
    webview
      .listen<{ take: number; text: string }>('dictation:insert', (event) => {
        const { take, text } = event.payload;
        const inserted = insertIntoFocusedField(text);
        emit('dictation:inserted', { take, inserted }).catch(() => {});
      })
      .then(keep)
      .catch((err) => console.warn('[dictation] insert listener registration failed:', err));
    webview
      .listen<{ take: number }>('dictation:selection-request', (event) => {
        emit('dictation:selection', { take: event.payload.take, text: selectedText() }).catch(
          () => {},
        );
      })
      .then(keep)
      .catch((err) => console.warn('[dictation] selection listener registration failed:', err));
    return () => {
      disposed = true;
      for (const fn of unlisteners) fn();
    };
  }, [platform.metadata.isTauri]);
}
