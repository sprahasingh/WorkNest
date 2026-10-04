// The product screenshots. Everything about them (which pictures exist, their
// order, titles, captions, and where each one is shown) is written down in
// screens.json, so that is the only place to edit. This file just turns that
// list into objects the pages can use. See README.md in this folder.
import data from "./screens.json";

export interface Screen {
  // "section/id", for example "tasks/board".
  key: string;
  title: string;
  caption: string;
  alt: string;
  light: string;
  dark: string;
  width: number;
  height: number;
}

type Size = keyof typeof data.sizes;

// Vite finds every picture in the section folders and gives back its URL.
const files = import.meta.glob<string>("./*/*.webp", {
  eager: true,
  import: "default",
});

function urlFor(section: string, file: string, theme: "light" | "dark") {
  const path = `./${section}/${file}.${theme}.webp`;
  const url = files[path];
  if (!url) throw new Error(`Missing screenshot file: ${path}`);
  return url;
}

const screens = new Map<string, Screen>();
for (const section of data.sections) {
  const { width, height } = data.sizes[section.size as Size];
  for (const screen of section.screens) {
    const key = `${section.id}/${screen.id}`;
    screens.set(key, {
      key,
      title: screen.title,
      caption: screen.caption,
      alt: screen.alt,
      light: urlFor(section.id, screen.file, "light"),
      dark: urlFor(section.id, screen.file, "dark"),
      width,
      height,
    });
  }
}

// The pictures shown in one place on the site, in order. For example
// placement("landing.tour.messages"). The names are the keys under
// "placements" in screens.json.
export function placement(name: string): Screen[] {
  const keys = (data.placements as Record<string, string[]>)[name];
  if (!keys) throw new Error(`Unknown screenshot placement: ${name}`);
  return keys.map((key) => {
    const screen = screens.get(key);
    if (!screen) throw new Error(`Placement ${name} lists unknown ${key}`);
    return screen;
  });
}
