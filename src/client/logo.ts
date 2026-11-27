// The Seaglass mark: two worn pieces of sea glass, sea green in front of aqua, darker where they overlap like real glass
// on glass. The one source for the app's Logo (icons.tsx), the favicon, the app icons and the boot screen in index.html:
// after changing anything here run `npm run icons`. No imports, so the icon script can load it directly.

export const LOGO_PATHS = {
  back: "M32.9 12.4 Q37.8 9.8 43.1 8.1 Q47 6.5 49.6 9.8 Q52.3 12.4 54.4 15.7 Q57 19 56.2 23.1 Q56 27.1 54.8 30.9 Q54 35 50.1 36.6 Q47.9 38 45.4 38.4 Q41.5 40 38.9 36.7 Q37 34.9 35.6 32.3 Q33 29 31.9 24.9 Q30.5 21.4 30.1 18.1 Q29 14 32.9 12.4 Z",
  front: "M10.6 29.6 Q14.6 24.4 19.4 19.9 Q22.5 16.5 26.8 18.3 Q29.8 19 32.7 20.7 Q37 22.5 39 26.7 Q41.5 30.8 43 35.3 Q45 39.5 42.4 43.3 Q39.6 48.1 36.1 52.2 Q33.5 56 29 54.9 Q23.7 54 18.5 52.1 Q14 51 12.4 46.7 Q10.3 42.2 9.1 37.3 Q7.5 33 10.6 29.6 Z",
  // the frosted top face of each piece, catching the light
  backFrost: "M35.4 14 L43.6 10.8 Q46 9.8 47.7 11.8 L50.8 15.5 Q52.5 17.5 50.3 18.8 L46.2 21.2 Q44 22.5 41.4 22.9 L40.1 23.1 Q37.5 23.5 36.3 21.2 L34.2 17.3 Q33 15 35.4 14 Z",
  frontFrost: "M13.9 30.9 L20.9 23.1 Q22.8 21 25.4 22.1 L30.2 24.2 Q32.8 25.3 31 27.5 L27.8 31.3 Q26 33.5 23.4 34.6 L18.1 36.9 Q15.5 38 14 35.9 L13.5 35.1 Q12 33 13.9 30.9 Z",
  glint: "M14.6 31.2 L21.8 23.4",
};

export const LOGO_COLORS = { back: "#9fd3df", backFrost: "#d9f0f4", front: "#8fcaae", frontFrost: "#d6eee2", overlap: "#3f8e86", edge: "#2f6f68", tile: "#123d47" };

/** The mark as SVG markup in a 64x64 box. `id` keeps the overlap's clip path unique on a page; `cls` adds class names
 *  to its parts so the boot screen can animate them. */
export function logoSvg(id: string, cls = false) {
  const P = LOGO_PATHS, C = LOGO_COLORS, c = (n: string) => (cls ? ` class="${n}"` : "");
  return `<defs><clipPath id="${id}"><path d="${P.back}"/></clipPath></defs>`
    + `<g${c("lg-back")}><path d="${P.back}" fill="${C.back}"/><path d="${P.backFrost}" fill="${C.backFrost}" opacity=".75"/>`
    + `<path d="${P.back}" fill="none" stroke="${C.edge}" stroke-opacity=".55" stroke-width="1.6"/></g>`
    + `<g${c("lg-front")}><path d="${P.front}" fill="${C.front}"/><path d="${P.frontFrost}" fill="${C.frontFrost}" opacity=".8"/>`
    + `<path d="${P.front}" fill="none" stroke="${C.edge}" stroke-opacity=".7" stroke-width="1.6"/></g>`
    + `<g${c("lg-overlap")}><path d="${P.front}" fill="${C.overlap}" clip-path="url(#${id})"/>`
    + `<path d="${P.front}" fill="none" stroke="${C.edge}" stroke-opacity=".7" stroke-width="1.6" clip-path="url(#${id})"/></g>`
    + `<path${c("lg-glint")} d="${P.glint}" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/>`;
}
