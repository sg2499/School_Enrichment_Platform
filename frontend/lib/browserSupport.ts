/**
 * The oldest browsers Krama's pages can be drawn in (22 Oct 2026, with the
 * move to Tailwind CSS 4): Chrome or Edge 111, Safari 16.4 (iPhone and iPad
 * on iOS 16.4), Firefox 128. Older ones would get a page with its styling
 * broken: overlapping text, missing colours, controls in the wrong place.
 *
 * Shailesh, 22 Oct 2026: Krama is "usually gonna be used by the students on
 * their own in their own machines", which are mostly kept up to date. So the
 * upgrade went ahead, with this safety net: a browser below the floor is
 * sent to /old-browser.html, a plain page that asks for an update, instead
 * of a broken one.
 *
 * The test is by feature, not by browser name, so it is right for every
 * browser built on the same engines: color-mix() arrived in Chrome 111,
 * Safari 16.2 and Firefox 113; CSS.registerProperty (what @property needs)
 * in Chrome 78, Safari 16.4 and Firefox 128. Together they are the floor.
 *
 * OLD_BROWSER_CHECK is the script itself, run inline at the top of <body>
 * (app/layout.tsx) before anything else, and written in old JavaScript on
 * purpose: it has to run in exactly the browsers that can't run the rest.
 */
export const OLD_BROWSER_PAGE = "/old-browser.html";

export const OLD_BROWSER_CHECK = [
  "(function(){try{",
  "var c=window.CSS;",
  "var ok=!!(c&&c.supports&&c.supports('color','color-mix(in oklab, red, blue)')&&('registerProperty' in c));",
  `if(!ok){window.location.replace('${OLD_BROWSER_PAGE}');}`,
  "}catch(e){}})();",
].join("");
