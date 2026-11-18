#!/bin/bash
# Double-click to start: serves this folder and opens it in Chrome.
cd "$(dirname "$0")"
PORT=8000
(sleep 1; open -a "Google Chrome" "http://localhost:$PORT" 2>/dev/null || open "http://localhost:$PORT") &
echo "Gesture Playground running at http://localhost:$PORT  (close this window to stop)"
python3 -m http.server $PORT
