# Doodle Away

*a free playground to draw!*

A shared paper page, projected on a wall or a big TV, that people doodle on with their hands in
the air. A webcam watches the people in front of it, MediaPipe tracks their hands, and p5.js turns
the movement into felt-tip marker lines. Every finished page goes to the gallery, where you can
watch it being drawn again.

HvA playground project.

## Run it

No build step, and everything is in the repo (MediaPipe model, fonts, libraries), so it also works
offline at an exhibition.

- **Mac:** double-click `Start Playground.command`. It starts a small local server and opens Chrome.
  The first time, right-click it and choose Open, because macOS asks about files from the internet.
- **Anywhere:** `python3 -m http.server 8000` in this folder, then open http://localhost:8000 in Chrome.

The camera only works on `localhost` or over `https`, so always open it through the local server,
not as a file.

- `index.html`: the wall. Put it on the projector or TV, fullscreen (press F).
- `gallery.html`: the scrapbook gallery. New pages appear live.

## How to play

Drawing needs **exactly two hands** in view: one person's two hands, or two people with one hand
each. The tracker never follows more than two hands. With only one hand in view, the page asks for
the other one.

| Gesture | What it does |
| --- | --- |
| 🤏 pinch thumb + index | draw (each hand has its own marker colour) |
| 🖐 open hand | erase |
| 👍👍 both thumbs up, held 1.5 s | save the page to the gallery and start a fresh page |

To change colour, rest a hand on one of the markers in the tray at the bottom of the page.
How close your hand is to the camera sets the line width a little.

After 90 seconds with nobody in view, the page is saved and a fresh one starts, so the wall can run
unattended. Change this in `js/config.js`.

### Keys

`F` fullscreen · `C` camera preview · `S` save · `N` save & new page · `X` clear without saving ·
`H` hide the how-to note. The mouse also draws, for testing.

## How it fits together

```
webcam ─► MediaPipe HandLandmarker (max 2 hands, WASM + GPU, in the browser)
        ─► js/gestures.js   classify each hand, keep its identity, smooth the cursor
        ─► js/app.js        p5.js wall: two-hand rule, markers, eraser, save
        ─► js/store.js      save {PNG, stroke data} ─► gallery.html (scrapbook + replay)
```

The look (paper, pencil frame, marker title, margin doodles) is plain HTML/SVG/CSS in `index.html`,
`css/style.css` and `js/doodles.js`, so it is easy to restyle. Fonts are Patrick Hand and Gaegu
(SIL Open Font License), in `fonts/`.

Drawings are saved as a PNG plus the raw stroke data (points, width, time). The gallery uses the
stroke data to replay the drawing. `js/render.js` draws strokes the same way on the wall and in
the gallery.

## Online gallery

Out of the box, drawings are stored in the browser on the wall computer (IndexedDB), and
`gallery.html` on the same computer updates live.

To put the gallery online, use a free [Supabase](https://supabase.com) project and host the folder
on any static host (GitHub Pages, Netlify, Vercel):

1. Create a Supabase project. In the SQL editor, run:

   ```sql
   create table drawings (
     id text primary key,
     created_at timestamptz default now(),
     image_path text not null,
     strokes jsonb,
     width int, height int, people int
   );
   alter table drawings enable row level security;
   create policy "anyone can read"   on drawings for select using (true);
   create policy "wall can insert"   on drawings for insert with check (true);
   ```

2. Under Storage, create a **public** bucket called `drawings`, and allow `insert` for the `anon` role.
3. Put the project URL and anon key in `js/config.js`.

The Supabase adapter in `js/store.js` has not been tested against a live project yet.

## Tuning for the space

- `reachMargin` in `js/config.js`: how much of the camera frame covers the page.
- `minBrush` / `maxBrush`: marker width range.
- Pinch sensitivity lives in `classify()` in `js/gestures.js`. Tune it with the real camera and light.
- Put the camera just above or below the projection, at chest height, facing the people.
  Even front light helps tracking more than a better camera.

## Libraries

- [MediaPipe Tasks Vision](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker) 0.10.14
- [p5.js](https://p5js.org) 1.9.4
- Fonts: Patrick Hand, Gaegu (via Fontsource)
