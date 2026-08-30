// Is this element somewhere the user is entering TEXT?
//
// Keyboard shortcuts have to stand down while someone is typing, but the test
// used to be "is it an <input>", which is too broad: a range slider is an
// <input>, and the editor is full of them — the scrubber under the preview, the
// volume control, every slider in the sidebar. Dragging the scrubber leaves it
// focused, so every letter shortcut (Z/T/A/S/M/L/B/R/D) silently stopped
// working until you clicked somewhere else.
//
// A range, checkbox, radio, colour or button input consumes no letters, so a
// shortcut can safely fire while one has focus. Arrow keys still adjust them
// natively, which is what you want — the slider stays keyboard-operable AND the
// shortcuts keep working.
const TEXT_INPUT_TYPES = new Set([
  'text', 'search', 'url', 'email', 'password', 'number', 'tel',
  'date', 'datetime-local', 'month', 'week', 'time'
]);

export function isTextEntry(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  if (!t) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  // An <input> with no type attribute defaults to text.
  const type = ((t as HTMLInputElement).type || 'text').toLowerCase();
  return TEXT_INPUT_TYPES.has(type);
}
