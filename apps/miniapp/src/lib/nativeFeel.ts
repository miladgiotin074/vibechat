/**
 * Makes the Mini App behave like an installed app rather than a web page:
 *  - no text selection or copy menu on labels and texts (only in fields you type into),
 *  - no «save / open image» menu on a long press, no dragging pictures or links out,
 *  - no zooming with two fingers or a double tap.
 * Copying a chat message stays available from the message's own long-press menu.
 */

/** Where the browser's own behaviour is still wanted: anything you type into. */
function editable(target: EventTarget | null): boolean {
  const el = target instanceof Element ? target : null;
  return !!el?.closest('input, textarea, [contenteditable=""], [contenteditable="true"]');
}

export function installNativeFeel() {
  const opts = { capture: true } as const;

  // long press: the browser's menu (copy, save image, open link…) never shows
  document.addEventListener('contextmenu', (e) => !editable(e.target) && e.preventDefault(), opts);
  // starting a text selection outside a field
  document.addEventListener('selectstart', (e) => !editable(e.target) && e.preventDefault(), opts);
  // dragging a picture or a link out of the app
  document.addEventListener('dragstart', (e) => e.preventDefault(), opts);

  // pinch zoom (iOS ignores user-scalable=no) and the double-tap zoom
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
  }
  document.addEventListener('touchmove', (e) => e.touches.length > 1 && e.preventDefault(), { passive: false });
  document.addEventListener('dblclick', (e) => !editable(e.target) && e.preventDefault(), opts);

  // a selection made anyway (a field losing focus can leave one behind) is cleared
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (editable(e.target)) return;
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && !editable(sel.anchorNode?.parentElement ?? null)) sel.removeAllRanges();
    },
    opts,
  );
}
