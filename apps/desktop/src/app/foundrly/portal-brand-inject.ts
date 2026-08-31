/**
 * Guest-page script injected into Admin copilot webview.
 * Replaces Intelli Verse login chrome with Foundrly mark + name (same visual slot).
 * Does not change portal auth/APIs — branding only.
 */
export const FOUNDRLY_PORTAL_MARK_DATA_URI =
  'data:image/svg+xml,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="Foundrly">` +
      `<rect width="512" height="512" rx="96" fill="#C4DAD2"/>` +
      `<rect x="148" y="112" width="88" height="288" fill="#0B1220"/>` +
      `<rect x="268" y="112" width="96" height="96" fill="#0B1220"/>` +
      `</svg>`
  )

export const FOUNDRLY_PORTAL_BRAND_CSS = `
[data-foundrly-branded="1"] img[alt*="Intelli" i],
[data-foundrly-branded="1"] img[src*="intelli" i],
[data-foundrly-branded="1"] img[src*="intelliverse" i] {
  opacity: 0 !important;
  width: 0 !important;
  height: 0 !important;
  overflow: hidden !important;
}
`

export function buildFoundrlyPortalBrandScript(markDataUri: string = FOUNDRLY_PORTAL_MARK_DATA_URI): string {
  // JSON.stringify keeps the data URI safe inside the injected IIFE.
  const markJson = JSON.stringify(markDataUri)

  return `(() => {
  if (window.__foundrlyPortalBrandInstalled) return true;
  window.__foundrlyPortalBrandInstalled = true;

  const MARK = ${markJson};
  const TAGLINE = 'AI co-founder for local businesses.';
  const NAME = 'Foundrly';

  const replaceText = (root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const value = node.nodeValue || '';
      if (!value.trim()) continue;
      let next = value;
      next = next.replace(/Intelli\\s*Verse\\s*X/gi, NAME);
      next = next.replace(/Intelli\\s*Verse/gi, NAME);
      next = next.replace(/Intelliverse\\s*X/gi, NAME);
      next = next.replace(/Intelliverse/gi, NAME);
      next = next.replace(/Immersive,?\\s*Interactive,?\\s*Infinite\\.?/gi, TAGLINE);
      if (next !== value) node.nodeValue = next;
    }
  };

  const ensureMark = (container) => {
    if (!container || container.querySelector('[data-foundrly-mark]')) return;
    const img = document.createElement('img');
    img.setAttribute('data-foundrly-mark', '1');
    img.alt = NAME;
    img.src = MARK;
    img.width = 72;
    img.height = 72;
    img.style.cssText = 'width:72px;height:72px;border-radius:16px;object-fit:contain;display:block;margin:0 0 16px 0;';
    container.insertBefore(img, container.firstChild);
  };

  const hideIvxArt = (root) => {
    root.querySelectorAll('svg, img, canvas').forEach((el) => {
      if (el.getAttribute('data-foundrly-mark') === '1') return;
      const label = ((el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('alt') || '')).toLowerCase();
      const src = (el.getAttribute('src') || '').toLowerCase();
      const nearby = (el.parentElement?.textContent || '').slice(0, 200);
      const looksIvx =
        label.includes('intelli') ||
        label.includes('verse') ||
        src.includes('intelli') ||
        src.includes('verse') ||
        /Immersive,?\\s*Interactive,?\\s*Infinite/i.test(nearby);
      // Large decorative X / brand art beside the wordmark
      const box = el.getBoundingClientRect?.();
      const bigArt = box && box.width >= 80 && box.height >= 80 && box.width <= 420;
      if (looksIvx || (bigArt && /Foundrly|Intelli/i.test(nearby))) {
        el.style.setProperty('display', 'none', 'important');
      }
    });
  };

  const brandPanel = () => {
    document.documentElement.setAttribute('data-foundrly-branded', '1');
    replaceText(document.body || document.documentElement);

    const panels = [...document.querySelectorAll('div, section, aside, main')].filter((el) => {
      const text = el.textContent || '';
      return (
        text.includes(NAME) &&
        (text.includes(TAGLINE) || /AI co-founder/i.test(text)) &&
        el.children.length > 0 &&
        el.children.length < 40
      );
    });

    panels
      .sort((a, b) => a.textContent.length - b.textContent.length)
      .slice(0, 3)
      .forEach((panel) => ensureMark(panel));

    hideIvxArt(document.body || document.documentElement);
  };

  const run = () => {
    try { brandPanel(); } catch (_) { /* guest DOM may be mid-render */ }
  };

  run();
  document.addEventListener('DOMContentLoaded', run);
  const obs = new MutationObserver(() => run());
  obs.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  setInterval(run, 1500);
  return true;
})()`
}

export type PortalBrandWebview = {
  executeJavaScript?: (code: string, userGesture?: boolean) => Promise<unknown>
  insertCSS?: (css: string) => Promise<string>
}

export async function applyFoundrlyPortalBrand(webview: PortalBrandWebview): Promise<void> {
  if (typeof webview.insertCSS === 'function') {
    await webview.insertCSS(FOUNDRLY_PORTAL_BRAND_CSS)
  }

  if (typeof webview.executeJavaScript === 'function') {
    await webview.executeJavaScript(buildFoundrlyPortalBrandScript(), false)
  }
}
