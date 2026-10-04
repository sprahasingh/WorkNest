# Product screenshots

Every picture on the landing page, in the "How to use" guide and in the main README lives here. One file, `screens.json`, is the list of all of them: what exists, in what order, what each is called, and where it is shown. Nothing else needs to know a file name.

## The folder

```
screens/
  screens.json         the list (edit this)
  index.ts             reads the list for the site (rarely needs editing)
  README.md            this file
  dashboard/           one folder per part of the product
    01-overview.light.webp
    01-overview.dark.webp
    02-charts.light.webp
    ...
  projects/  tasks/  updates/  messages/  meetings/  team/  settings/  audit/
  phone/               phone screens, 390 x 844
```

- Every screen has two files, one per theme: `<NN>-<name>.light.webp` and `<NN>-<name>.dark.webp`.
- `NN` is the position inside its folder (01, 02, 03 ...), so the folder always lists in the same order the slider shows them.
- Desktop screens are 1280 x 860, phone screens are 390 x 844. Sliders reserve space from these sizes, so keep them exact.

## Where each picture is shown

The pages never name a file. They ask for a placement, which is a named list of screens in `screens.json`:

| Placement                                                                                                 | Shown in                                                            | Code                                           |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------- |
| `landing.tour.dashboard`, `.tasks`, `.messages`, `.meetings`, `.team`                                     | The "See it in action" tabs on the landing page, one slider per tab | `TOUR` in `web/src/pages/Landing.tsx`          |
| `landing.phones`                                                                                          | "Just as good on your phone" on the landing page                    | `PhoneShowcase` in `web/src/pages/Landing.tsx` |
| `guide.project`, `.team`, `.tasks`, `.updates`, `.messages`, `.meetings`, `.dashboard`, `.audit`, `.plan` | The slider under each step of the guide                             | `STEPS` in `web/src/pages/HowToUse.tsx`        |
| `guide.phones`                                                                                            | "On your phone" in the guide                                        | `web/src/pages/HowToUse.tsx`                   |
| `readme.*`                                                                                                | The Screenshots section of the main README                          | generated, see below                           |

A slider shows its screens in the order the placement lists them. To change what a slider shows, or its order, edit that placement's list in `screens.json`.

## Things you will want to do

**Replace a picture.** Overwrite its two files (light and dark) with new ones at the same size. Nothing else changes.

**Change a title, caption or description.** Edit the `title`, `caption` or `alt` of the screen in `screens.json`. The title is the short heading used in the README tables, the caption is the line under a slider, and the alt text is for screen readers.

**Add a picture.**

1. Put `<NN>-<name>.light.webp` and `<NN>-<name>.dark.webp` in the right folder, numbered so it sits where you want it.
2. Add an entry to that section in `screens.json` (`id`, `file`, `title`, `caption`, `alt`). Keep the entries in the same order as the numbers.
3. Add its `"section/id"` to the placements that should show it, for example `landing.tour.tasks` and `guide.tasks`.

**Add a new section or a new slider.** Add a section in `screens.json`, then a placement for it, then use `placement("your.name")` in the page, the same way `Landing.tsx` does for its tabs.

**Change what the README shows.** Edit the `readme` list in `screens.json` (heading, text, placement, number of columns), then run `npm run screens:readme` from `web/`. It rewrites the block between the `screens:start` and `screens:end` markers in the README. Don't edit that block by hand.

**Remove a picture.** Delete its two files, its entry in `screens.json`, and its name from every placement.

## Checking your work

From `web/`:

```bash
npm run screens:check
```

It fails, and says what is wrong, if a file is missing or has the wrong size, a file in a folder isn't listed, a file name's number doesn't match its position, a placement names a screen that doesn't exist, a screen isn't shown anywhere, the code asks for a placement that isn't in the list, or the README is out of date. The same check runs on every pull request.

## Retaking the pictures

The pictures show a demo organization called Sunshine. The scripts in `tools/screenshots` build it and retake every picture into these folders, so nothing has to be drawn by hand. Its README has the steps.
