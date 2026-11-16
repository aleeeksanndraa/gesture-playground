// Fill these in to send drawings to the online gallery (see README.md → "Online gallery").
// Leave empty to keep everything on this machine (IndexedDB), which is how the prototype runs by default.
export const CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: '',

  // How much of the camera frame maps onto the whole wall. 0.12 means the outer 12% on each side
  // is ignored, so people can reach the wall's edges without leaving the camera view.
  reachMargin: 0.12,

  // Brush width range in px; hand size (distance to camera) picks a value in between.
  minBrush: 4,
  maxBrush: 46,

  // Seconds a thumbs up must be held to save.
  saveHoldSeconds: 1.2,
  // Seconds two open palms must be held to save and start a fresh canvas.
  resetHoldSeconds: 2.5,
  // Start a fresh canvas automatically after this many seconds with nobody in view (0 = never).
  idleResetSeconds: 90,
};
