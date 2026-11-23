# Piece of Home: glass puzzle board

*Share your piece of home with the community.*

A big shared board, on a laptop, TV or projector, made of glass puzzle pieces. Visitors scan the QR
code on the board with their phone and get their own puzzle piece. They fill it with a photo, draw on
it, add stickers and send it. A second later it pops up big on the board and then settles into the
puzzle. The board can be turned and zoomed with hand gestures in front of the webcam.

HvA playground project. Lives next to Doodle Away and reuses its hand tracking.

## Run it

You need [Node.js](https://nodejs.org) (the LTS download). Nothing to install with npm.

- **Mac:** double-click `Start Puzzle Board.command` (the first time: right-click → Open).
- **Anywhere:** in this folder run `node server.js`, then open http://localhost:8080 in Chrome.

The terminal shows two addresses: the board (`localhost`) and the one for phones, which is also in
the QR code. Press F on the board for fullscreen.

### Getting phones connected

The phone page opens in the browser, no app to install. There are two ways for phones to reach
the laptop:

1. **Same Wi-Fi (simplest, works offline).** Phones on the same network as the laptop can scan
   and send. University Wi-Fi (eduroam) usually blocks phones from reaching a laptop, so at HvA
   turn on your phone's or laptop's **hotspot** and put the laptop and visitors on that, or bring a
   small travel router.
2. **Public link over mobile data.** Install Cloudflare's free tunnel once
   (`brew install cloudflared`), then start with `TUNNEL=1 node server.js`. After a few seconds the
   QR code switches to a `https://….trycloudflare.com` address that works from any phone, on any
   network. No account needed. The address changes every time you restart.

You can also set your own address for the QR code: `PUBLIC_URL=https://example.com node server.js`.

### Where things are saved

Every piece is a JPEG in `data/pieces/`, listed in `data/pieces.json`. To start a fresh board,
stop the server and delete the `data` folder. To keep an old board, rename the folder.

## On the board

The puzzle is not a flat sheet: it bulges towards you like part of a ball, and when you bring two open palms together it
curls all the way up into a sphere. Guide cards on the left of the screen light up for the
gesture you are making; the QR code sits on the right.

| | What it does |
| --- | --- |
| ✋ open hand | just a pointer; nothing moves, a hint under your hand says what to do |
| ✊ fist (grab) | you hold the puzzle like a ball: move your hand and it turns with it, 360° in any direction, no limits; open your hand to let go, grab again to keep turning |
| ✊✊ two fists | pull them apart or push them towards the camera to come closer, bring them together to go back; twist them like a steering wheel to turn the puzzle |
| ☝️ finger circles | draw circles in the air with your index finger and the puzzle swirls round like a whirlpool |
| 👐 two open palms | bring them together to roll the puzzle into a sphere, pull them apart to open the wall |
| drop your hands | everything stays exactly where you left it |
| mouse drag / scroll | turn / zoom (shift-drag to slide) |
| `L` or space | switch wall ↔ sphere |
| `F` | fullscreen |
| `R` | reset the view |
| `C` | show or hide the small camera preview |
| `H` | show or hide the gesture guide |
| `D` | speed info (fps, pieces, draw calls, hand tracking) |
| `X` / `Shift+X` | add 60 / 500 test pieces (only on screen, not saved) |

A ring of small dots sits behind the puzzle (it becomes a shell of dots around the sphere). When a
new piece arrives, the dots next to it light up in the piece's colour.

The board never moves on its own: it stays where the last person left it. If you'd rather have it
drift slowly by itself when nobody is around (and switch between wall and sphere every 50
seconds), set `idleSeconds` in `public/js/config.js`, e.g. to 12.

The question, the idle times and more are in `public/js/config.js`.

## On the phone

1. **Your piece**: the shape you get is the next free spot in the puzzle, so it fits its neighbours.
2. **Make it**: add a photo (camera or library), then
   - ✋ **Move**: drag the photo or a sticker, pinch to zoom and turn;
   - ✏️ **Draw**: 8 colours, 3 sizes, undo;
   - ✨ **Stickers**: tap one to add it.
   The dark area outside the outline is cut off on the board.
3. **Send**: the board shows it big for a few seconds, then it flies into the puzzle.

## How it works

```
phone (phone.html)  ── POST photo ──▶  server.js  ── live event ──▶  board (board.html)
                                         saves to data/
```

- `server.js`: plain Node, no packages. Serves the pages, saves pieces, sends every new piece to
  the board right away (Server-Sent Events), and makes the QR code.
- `public/js/puzzle.js`: the puzzle shapes. Pieces fill a square spiral from the middle, so the
  puzzle grows outwards. Each edge gets a tab that fits the neighbour.
- `public/js/board.js`: the board in three.js. The glass look (curved edge, the picture bending
  under it, shine and bright rim) is drawn by one shader. All pieces share a few big textures, so
  the whole board is ~10 draw calls even with 500+ pieces. With `pieceTexture: 256` a normal
  laptop holds about 1,500 pieces; set it to 128 for more.
- `public/js/hands.js`: webcam + MediaPipe hand tracking. It uses the model, library and gesture
  code from the Doodle Away folder above (`../models`, `../vendor`, `../js/gestures.js`), so keep
  this folder inside the repo.
- `public/js/phone.js`: the phone editor. `public/js/dots.js`: the dotted ring.

Everything (three.js, MediaPipe, the model, the QR code maker) is in the repo, so the board also
runs without internet.

### Later, if you want it online

For an online version (people adding pieces from home, a weekly archive), the server can be swapped
for a hosted database like Supabase: the phone uploads the JPEG to its storage and the board
listens for new rows. The pages wouldn't change much; only the `fetch('/api/…')` calls and the
`EventSource` in `board.js` would.
