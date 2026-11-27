// Cover gallery, in the spirit of Notion's: colours and gradients, then public-domain art.
//
// A cover is stored as a string on the note: a CSS colour or gradient, "/covers/<file>.jpg" for
// one of these bundled images, or "/files/<key>" for an upload. Use coverCss() to turn it into a
// CSS background, so every place that shows covers agrees.
//
// The gradient images are original (scripted grainy gradients). The art is from The Metropolitan
// Museum of Art's Open Access collection, released under CC0; see public/covers/CREDITS.md.

export interface CoverItem { value: string; label: string; thumb?: string }
export interface CoverSection { title: string; items: CoverItem[] }

const img = (name: string, label: string): CoverItem => ({ value: `/covers/${name}.jpg`, thumb: `/covers/${name}.thumb.jpg`, label });

export const COVER_SECTIONS: CoverSection[] = [
  {
    title: "Color & gradient",
    items: [
      { value: "#e3a399", label: "Red" }, { value: "#f1cf7d", label: "Yellow" }, { value: "#a8c9ae", label: "Sage" },
      { value: "#93b9da", label: "Blue" }, { value: "#c8b8e2", label: "Lilac" }, { value: "#ece5d8", label: "Beige" },
      img("gradient-peach", "Peach"), img("gradient-sunset", "Sunset"), img("gradient-berry", "Berry"), img("gradient-blush", "Blush"),
      img("gradient-lemon", "Lemon"), img("gradient-mint", "Mint"), img("gradient-seaglass", "Sea glass"), img("gradient-ocean", "Ocean"),
      img("gradient-lavender", "Lavender"), img("gradient-dusk", "Dusk"), img("gradient-aurora", "Aurora"), img("gradient-clay", "Clay"),
    ],
  },
  {
    title: "Patterns",
    items: [
      img("met-pattern-384022", "Willow Bough, William Morris, 1887"), img("met-pattern-384017", "Daisy, William Morris, 1864"),
      img("met-pattern-365338", "Fruit, William Morris, ca. 1866"), img("met-pattern-383485", "Jasmine, William Morris, 1872"),
      img("met-pattern-13869", "Chintz appliquéd quilt, Mary Malvina Cook Taft, ca. 1835–40"), img("met-pattern-219804", "Trafalgar chintz, John Bury, 1806"),
    ],
  },
  {
    title: "Japanese prints",
    items: [
      img("met-print-36461", "Sudden Shower over Shin-Ōhashi Bridge, Utagawa Hiroshige, 1857"), img("met-print-36515", "Cherry Blossoms at Arashiyama, Utagawa Hiroshige, ca. 1834"),
      img("met-print-36511", "Otomo Kihan, Utagawa Hiroshige, ca. 1836"), img("met-print-36512", "Haneda Rakugan, Utagawa Hiroshige, ca. 1835"),
      img("met-print-36485", "Poem by Empress Jitō, Katsushika Hokusai, 1839"), img("met-print-36486", "Poem by Kakinomoto Hitomaro, Katsushika Hokusai, 1839"),
    ],
  },
];

/** A random gallery cover, for "Add cover" (Notion picks one at random too). */
export const randomCover = () => {
  const all = COVER_SECTIONS.flatMap((s) => s.items).filter((i) => i.thumb);
  return all[Math.floor(Math.random() * all.length)].value;
};

const isImage = (c: string) => c.startsWith("/files/") || c.startsWith("/covers/");

/** The CSS background for a stored cover value. */
export const coverCss = (c: string) => (isImage(c) ? `url(${c}) center / cover no-repeat` : c);
