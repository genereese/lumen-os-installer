// Collapsible sections (<details>) slide open and closed instead of
// snapping. One document-level listener covers every <details> on the page,
// including ones added later. Opt out with <details data-instant>.
// Used by the desktop and by the web installer.
const running = new WeakMap();
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const EASE = 'cubic-bezier(.2,.9,.25,1)';

function closedHeight(d) {
  const s = d.querySelector(':scope > summary');
  const cs = getComputedStyle(d);
  return (s ? s.offsetHeight : 0) + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
}

function animate(d, from, to, done) {
  running.get(d)?.cancel();
  const prev = { overflow: d.style.overflow, boxSizing: d.style.boxSizing };
  d.style.overflow = 'hidden';
  d.style.boxSizing = 'border-box';
  const ms = Math.min(420, 180 + Math.abs(to - from) * 0.6);
  const a = d.animate([{ height: from + 'px' }, { height: to + 'px' }], { duration: ms, easing: EASE });
  running.set(d, a);
  const end = () => {
    running.delete(d);
    Object.assign(d.style, prev);
    done?.();
  };
  a.onfinish = end;
  a.oncancel = () => { running.delete(d); Object.assign(d.style, prev); };
  return ms;
}

export function toggleDetails(d, open = !d.open || d.dataset.closing === '1') {
  if (reduced()) { d.open = open; return; }
  const start = d.getBoundingClientRect().height;
  if (open) {
    delete d.dataset.closing;
    d.open = true;
    const end = d.getBoundingClientRect().height;
    const ms = animate(d, start, end);
    for (const el of d.children) {
      if (el.tagName === 'SUMMARY') continue;
      el.animate([{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }], { duration: ms, easing: EASE });
    }
  } else {
    d.dataset.closing = '1';
    const end = closedHeight(d);
    for (const el of d.children) {
      if (el.tagName === 'SUMMARY') continue;
      el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: 'ease-in', fill: 'forwards' }).onfinish = function () { this.cancel(); };
    }
    animate(d, start, end, () => { d.open = false; delete d.dataset.closing; });
  }
}

let installed = false;
export function initSmoothDetails() {
  if (installed) return;
  installed = true;
  document.addEventListener('click', (e) => {
    const sum = e.target.closest?.('summary');
    if (!sum || e.defaultPrevented) return;
    const d = sum.parentElement;
    if (!(d instanceof HTMLDetailsElement) || 'instant' in d.dataset || reduced()) return;
    // Links or buttons inside a summary keep working normally.
    if (e.target.closest('a, button, input') && e.target.closest('a, button, input') !== sum) return;
    e.preventDefault();
    toggleDetails(d);
  });
}
