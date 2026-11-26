// Settings for the board and the phone page. Change and reload.
export const CONFIG = {
  // The question on the board and on the phone. Change it every week if you like.
  question: 'What makes you feel at home?',
  hint: 'Scan to add your piece',

  // Start view: 'wall' (the puzzle) or 'sphere' (floating 3D gallery).
  startLayout: 'wall',
  // 0 = the board stays exactly where people left it. Set e.g. 12 to let it drift slowly by
  // itself after 12 s with nobody around, and switch wall/sphere every `autoSwitchSeconds`.
  idleSeconds: 0,
  autoSwitchSeconds: 50,

  // Seconds a newly sent piece is shown big in the middle before it flies into the puzzle.
  showNewSeconds: 3,

  // Hand gestures (needs a webcam). Turn off to use only mouse and keyboard.
  gestures: true,

  // Texture size of one piece on the board (px). Lower = more pieces fit in GPU memory.
  // 256 is good for about 1,500 pieces on a normal laptop; 128 for many thousands.
  pieceTexture: 256,

  // Online without the laptop server (GitHub Pages + a free Supabase project, see supabase.sql).
  // Leave empty to use the Node server. The anon key is public by design; never put the
  // service_role key here.
  supabaseUrl: 'https://womszzwdplrckbzotvkl.supabase.co',
  supabaseAnonKey: 'sb_publishable_HrheXia4L5hAMunIAmOGHw_e2Uvy5AN',
};
