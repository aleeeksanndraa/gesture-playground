// Guesses what a photo is about, right on the phone (no server): MediaPipe's small image classifier
// (EfficientNet-Lite0, the 1000 ImageNet classes) and a map from its classes to our topics.
// The guess only preselects a topic; the visitor can change it.
import { online } from './api.js';
const ROOT = online ? new URL('../../../', import.meta.url).href : '/';

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const MAP = new Map();
const put = (topic, ids) => ids.forEach(i => MAP.set(i, topic));
put('animal', range(0, 397));                                                       // fish, birds, reptiles, dogs, cats, insects ...
put('food', [...range(923, 969), 987, 988, 989, 990, ...range(991, 997)]);          // dishes, fruit, vegetables, drinks, mushrooms
put('nature', [...range(970, 980), 984, 985, 986, 738, 883]);                      // mountains, lakes, sea, flowers, pot plant, vase
put('place', [425, 449, 460, 483, 497, 498, 509, 536, 538, 562, 580, 598, 624, 660, 663, 668, 698, 706, 727, 743, 762, 821, 839, 873, 888, 900, 912, 919]);
put('people', [399, 400, 411, 445, 457, 474, 568, 608, 610, 614, 617, 629, 638, 639, 643, 652, 655, 697, 834, 836, 837, 841, 842, 869, 903, 981, 982, 983]);

let ready = null;
function load() {
  ready ||= (async () => {
    const { FilesetResolver, ImageClassifier } = await import(ROOT + 'vendor/tasks-vision/vision_bundle.mjs');
    const fileset = await FilesetResolver.forVisionTasks(ROOT + 'vendor/tasks-vision/wasm');
    return ImageClassifier.createFromOptions(fileset, { baseOptions: { modelAssetPath: ROOT + 'models/efficientnet_lite0.tflite' }, maxResults: 10, runningMode: 'IMAGE' });
  })();
  return ready;
}
export function warmUp() { load().catch(() => {}); }

// canvas → 'animal' | 'food' | ... | 'thing', or null if the classifier could not run
export async function guessTopic(canvas) {
  try {
    const clf = await load();
    const cats = clf.classify(canvas).classifications[0]?.categories || [];
    const score = {};
    for (const c of cats) { const t = MAP.get(c.index) || 'thing'; score[t] = (score[t] || 0) + c.score; }
    const best = Object.entries(score).sort((a, b) => b[1] - a[1])[0];
    if (!best) return null;
    // 'thing' is the catch-all: prefer a real topic when it has a fair share
    const real = Object.entries(score).filter(([t]) => t !== 'thing').sort((a, b) => b[1] - a[1])[0];
    if (real && real[1] > (real[0] === 'animal' ? 0.3 : 0.12)) return real[0];   // animals are 40% of the classes: ask for more
    return best[1] > 0.1 ? best[0] : 'thing';
  } catch (e) { console.warn('topic guess off:', e); return null; }
}
