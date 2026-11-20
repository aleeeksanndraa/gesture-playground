#!/bin/bash
# Double-click to start the puzzle board: runs the small server and opens the board in Chrome.
# Needs Node.js (https://nodejs.org, the LTS download). Close this window to stop.
cd "$(dirname "$0")"
PORT=8080
(sleep 1.5; open -a "Google Chrome" "http://localhost:$PORT" 2>/dev/null || open "http://localhost:$PORT") &
node server.js
