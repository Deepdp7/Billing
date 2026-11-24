/**
 * The app's own "this field needs attention" bubble instead of the browser's ("Please fill out this field."), on every
 * form. When a form is submitted with a missing or wrong value the browser fires an `invalid` event for each such field
 * and shows its own plain bubble for the first one; here that bubble is cancelled, and a bubble in the app's style is
 * shown instead, with a message that names the field ("Business Email is needed"), beside the field. The field is
 * focused and ringed in red until it is changed. It goes away when the person types, leaves the field, presses Esc or
 * after a few seconds. The form's own rules (`required`, `type="email"`, `min`, `pattern`...) stay as they are.
 */
const SHOW_MS = 6000;

let bubble: HTMLDivElement | null = null;
let current: HTMLElement | null = null;
let timer: number | undefined;
let handled = false;

const CONTROLS = 'input:not([type="hidden"]):not([type="button"]):not([type="submit"]), select, textarea';

/**
 * The field's label. Most forms here write a plain `<label>` above a box that holds the input, without linking the two;
 * then the label is the one that comes before the field inside the nearest parent that holds this one field only (so a
 * neighbouring field's label is never taken).
 */
function labelOf(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): HTMLElement | null {
  if (el.labels && el.labels.length) return el.labels[0];
  let parent = el.parentElement;
  for (let depth = 0; parent && depth < 4; depth++, parent = parent.parentElement) {
    if (parent.querySelectorAll(CONTROLS).length !== 1) return null;
    const found = [...parent.querySelectorAll('label')].find((l) => !l.querySelector(CONTROLS) && (l.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING));
    if (found) return found;
  }
  return null;
}

/** What the person calls this field: its label (not its options), else its aria-label */
function nameOf(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): string {
  let raw = '';
  const label = labelOf(el);
  if (label) {
    const copy = label.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('input, select, textarea, button, svg').forEach((n) => n.remove());
    raw = copy.textContent || '';
  }
  if (!raw.trim()) raw = el.getAttribute('aria-label') || '';
  const clean = raw.replace(/\s+/g, ' ').replace(/\s*\((optional|required)\)\s*/gi, ' ').replace(/[*:]+\s*$/g, '').trim();
  // A long hint or sentence is not a name
  return clean.length > 0 && clean.length <= 40 ? clean : '';
}

function messageFor(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): string {
  const v = el.validity;
  const name = nameOf(el);
  const type = el instanceof HTMLInputElement ? el.type : el instanceof HTMLSelectElement ? 'select' : 'textarea';
  if (v.customError && el.validationMessage) return el.validationMessage;
  if (v.valueMissing) {
    if (type === 'checkbox') return name ? `Please tick “${name}” to continue` : 'Please tick this box to continue';
    if (type === 'radio' || type === 'select') return name ? `Please choose ${name}` : 'Please choose one';
    if (type === 'file') return 'Please choose a file';
    return name ? `${name} is needed` : 'This field is needed';
  }
  if (v.typeMismatch) {
    if (type === 'email') return 'Enter a valid email, like name@shop.com';
    if (type === 'url') return 'Enter a full web address, like https://myshop.in';
    return 'That is not in the right form';
  }
  if (v.badInput) return type === 'number' ? 'Enter a number (digits only)' : 'That is not a valid value';
  if (v.tooShort) return `${name || 'This field'} needs at least ${(el as HTMLInputElement).minLength} characters`;
  if (v.tooLong) return `${name || 'This field'} can have at most ${(el as HTMLInputElement).maxLength} characters`;
  if (v.rangeUnderflow) return `${name || 'This value'} must be ${(el as HTMLInputElement).min} or more`;
  if (v.rangeOverflow) return `${name || 'This value'} must be ${(el as HTMLInputElement).max} or less`;
  if (v.stepMismatch) return 'Enter a whole number' + ((el as HTMLInputElement).step && (el as HTMLInputElement).step !== '1' ? ` (in steps of ${(el as HTMLInputElement).step})` : '');
  if (v.patternMismatch) return name ? `Check ${name}: it is not in the format asked for` : 'This is not in the format asked for';
  return el.validationMessage || 'Please check this field';
}

/** The box to point at: the field itself, or (a hidden field behind a styled one) its nearest visible parent */
function anchorOf(el: HTMLElement): HTMLElement {
  let n: HTMLElement | null = el;
  while (n && n !== document.body) {
    const r = n.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return n;
    n = n.parentElement;
  }
  return el;
}

function place() {
  if (!bubble || !current) return;
  const r = anchorOf(current).getBoundingClientRect();
  if (r.bottom < 0 || r.top > window.innerHeight) { hide(); return; }
  const b = bubble.getBoundingClientRect();
  const below = r.bottom + 12 + b.height <= window.innerHeight - 8 || r.top - b.height - 12 < 8;
  const top = below ? r.bottom + 12 : r.top - b.height - 12;
  const left = Math.max(8, Math.min(r.left + 8, window.innerWidth - b.width - 8));
  bubble.style.top = `${Math.round(top)}px`;
  bubble.style.left = `${Math.round(left)}px`;
  bubble.style.setProperty('--arrow-x', `${Math.round(Math.max(16, Math.min(r.left + 26 - left, b.width - 28)))}px`);
  bubble.dataset.side = below ? 'below' : 'above';
}

function hide() {
  window.clearTimeout(timer);
  if (current) {
    current.classList.remove('field-invalid');
    current.removeAttribute('aria-invalid');
    current.removeAttribute('aria-describedby');
    current.removeEventListener('input', hide);
    current.removeEventListener('change', hide);
    current.removeEventListener('blur', hide);
  }
  current = null;
  bubble?.remove();
  bubble = null;
}

function show(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement) {
  hide();
  current = el;
  bubble = document.createElement('div');
  bubble.className = 'field-warning';
  bubble.id = 'field-warning';
  bubble.setAttribute('role', 'alert');
  bubble.innerHTML = '<span class="field-warning-icon" aria-hidden="true">!</span><span class="field-warning-text"></span>';
  (bubble.querySelector('.field-warning-text') as HTMLElement).textContent = messageFor(el);
  document.body.appendChild(bubble);

  el.classList.add('field-invalid');
  el.setAttribute('aria-invalid', 'true');
  el.setAttribute('aria-describedby', 'field-warning');
  // The browser would focus the first problem itself, but not after its bubble was cancelled
  el.focus();
  place();
  el.addEventListener('input', hide);
  el.addEventListener('change', hide);
  el.addEventListener('blur', hide);
  timer = window.setTimeout(hide, SHOW_MS);
}

export function installFieldWarnings(): void {
  // `invalid` does not bubble: capture it on the document to see every form's
  document.addEventListener('invalid', (e) => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) return;
    e.preventDefault(); // no browser bubble
    // A submit makes one event per problem field, first to last in the page: the first is the one to show
    if (handled) return;
    handled = true;
    window.setTimeout(() => { handled = false; }, 0);
    show(el);
  }, true);
  // Esc closes the bubble first (and not also the dialog the form is in)
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && current) { hide(); e.stopPropagation(); } }, true);
  // Pages scroll inside their own panels (scroll does not bubble: captured), and windows get resized
  document.addEventListener('scroll', place, true);
  window.addEventListener('resize', place);
}
