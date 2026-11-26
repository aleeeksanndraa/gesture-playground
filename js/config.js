// Fill these in to send drawings to the online gallery (see README.md → "Online gallery").
// Leave empty to keep everything on this machine (IndexedDB), which is how it runs by default.
export const CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: '',

  // How much of the camera frame maps onto the drawing page. 0.12 means the outer 12% on each
  // side is ignored, so people can reach the page's edges without leaving the camera view.
  reachMargin: 0.12,

  // Marker width range in px; hand size (distance to camera) picks a value in between.
  minBrush: 6,
  maxBrush: 16,

  // Seconds both thumbs must be held up to save the page and start a fresh one.
  saveHoldSeconds: 1.5,
  // Seconds a hand has to rest on a marker in the tray to pick that colour.
  pickSeconds: 0.4,
  // Save and start a fresh page after this many seconds with nobody in view (0 = never).
  idleResetSeconds: 90,
};
