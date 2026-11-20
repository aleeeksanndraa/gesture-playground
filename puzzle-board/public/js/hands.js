// Hand tracking for the board: webcam → MediaPipe HandLandmarker → gestures.
// The tracking and gesture recognition are the same as in Doodle Away (../js/gestures.js).
import { FilesetResolver, HandLandmarker } from '/vendor/tasks-vision/vision_bundle.mjs';
import { HandTracker, G } from '/shared/gestures.js';

export { G };

export async function startHands(video, onHands) {
  const fileset = await FilesetResolver.forVisionTasks('/vendor/tasks-vision/wasm');
  const opts = delegate => ({
    baseOptions: { modelAssetPath: '/models/hand_landmarker.task', delegate },
    runningMode: 'VIDEO',
    numHands: 2,
    minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.4, minTrackingConfidence: 0.4,
  });
  let lm, delegate;
  try { lm = await HandLandmarker.createFromOptions(fileset, opts('GPU')); delegate = 'GPU'; }
  catch { lm = await HandLandmarker.createFromOptions(fileset, opts('CPU')); delegate = 'CPU'; }

  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 60 }, facingMode: 'user' }, audio: false,
  });
  video.srcObject = stream;
  await video.play();

  const tracker = new HandTracker();
  const stats = { delegate, fps: 0, last: 0 };
  const step = () => {
    if (video.readyState >= 2) {
      const now = performance.now();
      const r = lm.detectForVideo(video, now);
      if (stats.last) stats.fps = stats.fps * 0.9 + (1000 / (now - stats.last)) * 0.1;
      stats.last = now;
      const tracks = tracker.update(r.landmarks.slice(0, 2).map(landmarks => ({ landmarks })), now);
      onHands(tracks, now);
    }
    schedule();
  };
  const schedule = () => 'requestVideoFrameCallback' in HTMLVideoElement.prototype
    ? video.requestVideoFrameCallback(step) : requestAnimationFrame(step);
  schedule();
  return stats;
}
