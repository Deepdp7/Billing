/**
 * No browser hover tooltips anywhere in the app: every `title` attribute (also ones React adds later) is removed as it
 * appears. When the element has no visible text (an icon button), the hint becomes its accessible name instead, so
 * screen readers still say what it does.
 */
function moveTitle(el: Element) {
  const title = el.getAttribute('title');
  if (title === null) return;
  el.removeAttribute('title');
  if (title && !el.hasAttribute('aria-label') && !el.textContent?.trim()) el.setAttribute('aria-label', title);
}

export function disableTooltips(): void {
  document.querySelectorAll('[title]').forEach(moveTitle);
  new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'attributes') moveTitle(m.target as Element);
      else m.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return;
        moveTitle(node);
        node.querySelectorAll('[title]').forEach(moveTitle);
      });
    }
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['title'] });
}
