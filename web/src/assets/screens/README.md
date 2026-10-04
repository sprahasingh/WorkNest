# Product screenshots

These are the pictures used on the landing page, in the "How to use" guide and in the main README. Every screen has two files, one for the light theme and one for the dark theme, named `<screen>-light.webp` and `<screen>-dark.webp`.

## Sizes

- Desktop screens: 1280 x 860
- Phone screens (names start with `m-`): 390 x 844

Keep to these sizes. The sliders reserve space from them, so a different size makes the page jump when you move between slides.

## How they are used

`index.ts` imports every file and lists them in one `SCREENS` object, with a short name for each (for example `board`, `meetingDetail`, `phoneMessages`). Pages never import a picture directly. They use the name:

```tsx
<Screenshot
  name="board"
  alt="A project board with To do and In progress columns"
/>
```

- The landing page tour: the `TOUR` list in `web/src/pages/Landing.tsx`.
- The guide: the `screens` of each step in `web/src/pages/HowToUse.tsx`.
- The phone strip on the landing page and the guide: `PhoneShowcase` in `Landing.tsx` and the "On your phone" section in `HowToUse.tsx`.
- The README points straight at the `-light.webp` files.

`Screenshot` shows the light or dark version to match the theme, and clicking one opens it in the zoomable viewer.

## Changing a screenshot

Take the new picture at the size above, once in each theme, convert both to WebP and overwrite the two files. Nothing else needs to change. Quality 80 to 85 keeps them small.

## Adding a screenshot

1. Add `<name>-light.webp` and `<name>-dark.webp` to this folder.
2. In `index.ts`, add the two imports and one line in `SCREENS`, using `desktop` or `phone` for the size.
3. Use it as a slide (`{ screen: "name", alt, caption }`) in `TOUR` or in a guide step, or with `<Screenshot name="name" />`.
4. If the README should show it, link the `-light.webp` file there.

## The demo data

The pictures show a demo organization called Sunshine with five made-up people. It is not what `npm run seed` creates (that makes Acme Corp and Globex), so to retake a picture, set up an organization like Sunshine first: an admin, a manager, three members, four projects with some tasks and a few days of history, a group chat and a few meetings.
