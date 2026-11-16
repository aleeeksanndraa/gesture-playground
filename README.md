# Gesture Playground

A shared canvas that people draw on with their hands. A webcam watches the people in front of a wall
or a big TV. MediaPipe tracks their hands (or whole bodies), and p5.js turns the movement into ink.
Every finished drawing goes to an online gallery, where you can watch it being drawn again.

HvA playground project.

## Run it

No build step. Everything is in the repo, including the MediaPipe models, so it also works
offline at an exhibition.

```bash
cd gesture-playground
python3 -m http.server 8000
# open http://localhost:8000 in Chrome, click "Start camera", then press F for fullscreen
```

The camera only works on `localhost` or over `https`, so open the page through a local server,
not as a file.

- `index.html`: the wall. Put it on the projector or TV, fullscreen.
- `gallery.html`: the gallery. Saved drawings show up here, and new ones appear live.

## Gestures

Hand mode (default), for one or more people standing about 1–3 m from the camera:

| Gesture | What it does |
| --- | --- |
| 🤏 pinch thumb + index | draw |
| ☝️ point | aim (cursor only, no ink) |
| ✋ open palm | eraser |
| ✊ fist | grab the canvas and move it (infinite canvas, FigJam style) |
| ✌️ peace sign | next colour |
| 🤘 index + pinky | next brush (ink, neon, spray) |
| 👍 thumbs up, held 1.2 s | save to the gallery |
| ✋✋ two open palms, held 2.5 s | save, then start a fresh canvas |
| ↕ hand closer to the camera | thicker line (depth sets brush size) |

Body mode (press **B**, or the toggle at the top) works for people further away. Each raised wrist
paints a neon trail, and both hands over your head make sparkles. Stepping closer gives a thicker brush.

Several people can draw at once. Every hand gets its own colour and cursor.

When nobody has been in view for 90 seconds, the drawing is saved and the canvas starts fresh, so
the installation can run unattended. Change this in `js/config.js`.

### Operator keys

`F` fullscreen · `C` camera preview · `B` hand/body mode · `S` save · `N` save & new · `X` clear
without saving · `H` hide the gesture legend · `D` debug. The mouse also draws, for testing.

## How it fits together

```
webcam ─► MediaPipe HandLandmarker / PoseLandmarker (WASM + GPU, in the browser)
        ─► js/gestures.js   classify each hand, track identities, smooth the cursor
        ─► js/app.js        p5.js wall: strokes, eraser, panning, particles, HUD
        ─► js/store.js      save {PNG, stroke data} ─► gallery.html (thumbnails + replay)
```

Drawings are saved as a PNG plus the raw stroke data (points, width, time). The gallery uses the
stroke data to replay the drawing as a short timelapse. `js/render.js` draws strokes the same way
on the wall and in the gallery.

## Online gallery

Out of the box, drawings are stored in the browser on the wall computer (IndexedDB), and
`gallery.html` on the same computer updates live. That is enough for a demo.

To put the gallery online, so people can see drawings on their phones, use a free
[Supabase](https://supabase.com) project and host the folder on any static host
(GitHub Pages, Netlify, Vercel):

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

2. Under Storage, create a **public** bucket called `drawings`, and add a policy that allows `insert`
   for the `anon` role.
3. Put the project URL and anon key in `js/config.js`.

The Supabase adapter in `js/store.js` has not been tested against a live project yet. Expect to
adjust it the first time you connect it. Before a public exhibition, add moderation, for example
a `hidden` column that the gallery filters on.

## Tuning for the space

- `reachMargin` in `js/config.js`: how much of the camera frame covers the whole wall. Raise it
  if people can't reach the edges.
- `minBrush` / `maxBrush`: line width range.
- Pinch sensitivity lives in `classify()` in `js/gestures.js`. Thresholds were checked on
  MediaPipe's sample hand photos and should be tuned with the real camera and lighting.
- Put the camera just above or below the projection, at chest height, facing the people.
  Good front light helps tracking much more than a better camera.

## Libraries

- [MediaPipe Tasks Vision](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker) 0.10.14
  (`vendor/tasks-vision`, models in `models/`)
- [p5.js](https://p5js.org) 1.9.4 (`vendor/p5.min.js`)
