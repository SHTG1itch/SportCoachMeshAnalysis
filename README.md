# Sport Coach — Mesh Analysis

Desktop coaching tool. You upload a clip of a professional and a clip of yourself
performing the same motion. The app runs 3D pose estimation on both, aligns the
motions in time, compares every joint frame-by-frame, and produces a coaching
guide plus saveable workout plans that target the specific differences.

## What it does, precisely

1. **3D pose extraction** (per frame) — MediaPipe BlazePose GHUM (heavy model),
   33 world landmarks in meters. Inference runs locally in the Electron renderer
   via WebAssembly, on the GPU delegate when a usable WebGL context is available
   and automatically falling back to the CPU delegate otherwise (so the pipeline
   runs everywhere, just slower). The MediaPipe WASM runtime and the pose model
   are fetched once from public CDNs (jsDelivr and Google storage) on first use
   and then cached; this is the app's only network access (see "Network use"
   below).
2. **Signal cleanup** — before any geometry: (a) missing/occluded landmarks
   (including all-zero frames from detection dropouts) are repaired by
   per-landmark temporal interpolation so they can't inject phantom "fully
   extended" joint angles; (b) landmark trajectories are smoothed with a small
   binomial filter to remove single-frame detector jitter without blurring the
   velocity peak phase detection relies on.
3. **Normalization** — for each frame the pose is translated so the hip midpoint
   is at the origin and scaled so the shoulder-to-hip midpoint distance is 1.
   Rotation is preserved so handedness and facing stay meaningful.
4. **Joint angles** — 13 biomechanical features per frame: L/R elbow flexion,
   L/R shoulder abduction, L/R hip flexion, L/R knee flexion, L/R ankle
   dorsiflexion, trunk rotation (shoulders vs hips yaw), trunk lean (torso vs
   vertical) and shoulder-line tilt. Every feature is either an intra-body
   relative angle or measured against gravity, so all 13 are invariant to which
   way the athlete faces the camera.
5. **Handedness** — each athlete's dominant side is inferred from how much the
   sport's key joint moves (the racket wrist, the kicking ankle, …). If the user
   and the pro have opposite dominant sides, the user's angle features are
   mirrored to the pro's convention so a lefty is compared limb-for-limb against
   a righty. Phase detection anchors on the pro's actual dominant-side joint.
6. **Phase detection** — tracks the speed profile of the sport's key joint
   (e.g. the dominant wrist for a tennis forehand). The global peak marks the
   release/contact moment; half-peak crossings delimit it. The motion is split
   into preparation → load → release → follow-through.
7. **Temporal alignment** — Dynamic Time Warping with a Sakoe–Chiba band
   (default 25% of sequence length) aligns your sequence to the pro's along a
   monotonic path. For pro images (single-frame mode), the best-matching user
   frame is chosen by Euclidean distance on the angle vector.
8. **Comparison report** — alignment and scoring run on a per-feature
   *standardized* distance (each joint normalized by a fixed biomechanical scale
   and clamped) so no single wide-range joint dominates the warp path or the
   score. Per-joint deltas use robust, **confidence-weighted** statistics — a
   trimmed mean for the systematic offset and a 90th-percentile "worst typical"
   instead of a single-frame max, with every paired sample weighted by the
   minimum landmark visibility feeding that joint's angle — so a few
   mis-detected frames can't inflate the numbers and a motion-blurred or
   occluded stretch (a detector guess) can't fabricate or mask a fault.
   Frames where the torso reads as implausibly inverted (a MediaPipe depth-flip
   on fast/blurred contact frames) are detected and repaired by interpolation.
   Joint **significance is keyed on the systematic signed bias**, not the
   noise-inflated mean-abs delta, so two clips of the *same* athlete read as a
   close match while a real technique difference stands out. An overall
   similarity (0–1) and per-frame timeline are reported, with per-clip
   pose-detection coverage surfaced as a confidence caveat. (`trunk_lean` is
   measured against a data-derived "up" direction, so it is correct under
   MediaPipe's y-DOWN world-coordinate convention.)
9. **Coaching guide and workouts — sport-agnostic, mesh-mismatch driven.** A
   built-in biomechanics engine turns the numeric report into a structured guide
   and three workouts, grounded **entirely in the skeletal-mesh difference**
   between you and the pro — it contains NO sport-specific knowledge, so it works
   for every possible sport (and the "custom" sport for anything else). For each
   mismatched joint it states the measured difference ("your right elbow is bent
   118° where the pro's is 100° — about 18° more") and the physical change that
   matches the pro's mesh ("to match the pro, straighten your arm more fully
   through this position"). Each joint is mapped to the **muscle groups that
   govern it**, and the three workouts (mobility & activation, corrective
   strength, flexibility & position-matching) are built from the muscle groups
   behind your biggest mismatches — ranked by gap, with an extra strength set for
   the muscles driving a high-significance difference, plus "match-the-pro"
   position holds set to the pro's exact angles. Issues are collapsed to one per
   body-part group (the worse side) so left/right of the same joint don't surface
   as separate, contradictory items. It runs natively on-device with **no API key
   and no network call** — every statement is generated deterministically from
   the actual joint-delta numbers (direction-aware via the signed bias and
   phase-aware), so it never hallucinates angles that aren't in the data.
10. **Visual skeleton comparison** — the extracted 3D skeletons are persisted
   (downsampled and time-aligned) and shown on the result screen as a scrubbable
   side-by-side pro-vs-you mesh, defaulting to the contact/release moment. The
   user's key pose is also rendered as the history/home thumbnail. Projection
   auto-orients head-up from the data, so it is correct under MediaPipe's y-DOWN
   world coordinates.
11. **Persistence** — analyses, generated workouts, and settings are stored in a
   local SQLite DB under the Electron user-data directory. Your media, poses, and
   results never leave your machine — the analysis and the coaching guide run
   entirely on-device. The only data the app fetches over the network is the
   open-source MediaPipe runtime + pose model (once, then cached); your videos
   are never uploaded anywhere (see "Network use").

## Stack

- **Electron 33** shell, frameless window with custom title bar.
- **Renderer**: React 18 + Vite + Tailwind. Pose extraction, normalization,
  joint-angle math, DTW alignment, and comparison all run here in TypeScript —
  no Python required.
- **Main**: Node. `better-sqlite3` for local storage only. The IPC bridge is the
  only seam between renderer and disk — there is no network seam.
- **Coaching engine**: a dependency-free, deterministic biomechanics rule engine
  (`renderer/src/lib/coach.ts`). No LLM, no API key, no account.
- **ML model**: `@mediapipe/tasks-vision` (PoseLandmarker, heavy float16).

## Run it

```bash
npm install
npm run dev
```

`npm run dev` starts Vite at :5173 and Electron, which loads the Vite URL in dev
and the built `dist/` in prod.

```bash
npm run build     # typecheck + vite build + electron tsc
npm run start     # runs Electron against the built bundle
npm run test      # vitest — 116 unit tests across vec / angles / dtw / normalize / prepare / handedness / landmarker / render / compare / coach (plus 6 gated real-footage evals, skipped by default)
npm run typecheck # tsc --noEmit for both tsconfigs
```

### Native module note

`better-sqlite3` is a native module. On Windows it builds against the Node ABI
of your installed Node runtime, but Electron ships its own ABI. If the app fails
to load the DB after `npm install`, run `npm run rebuild` (which invokes
`electron-builder install-app-deps` to rebuild native deps against Electron's
ABI). The renderer code (the entire analysis pipeline) has no native
dependencies and will run under any Node for `npm test`.

### No API key, fully free

There is nothing to configure and no key to obtain. The coaching guide and
workouts are computed on-device by the built-in biomechanics engine at zero
cost, and your videos, poses, and results are never uploaded — no personal data
ever leaves the machine. The one exception is a first-run download of the
open-source MediaPipe WASM runtime and pose model from public CDNs; once those
are cached the analysis runs offline.

### Network use

The app makes **no API calls and uploads nothing** — your videos, extracted
poses, analyses, and the coaching guide all stay on your machine. The only
network requests are a one-time fetch of the MediaPipe WASM runtime (jsDelivr)
and the BlazePose model (Google storage), which the browser engine then caches.
So the **first** analysis needs a connection; subsequent ones run fully offline.
Bundling those two assets into the app so it is offline even on first launch —
loading them from a local `file://` path instead of the CDNs — is a planned
improvement (it also removes a single point of runtime failure). Until then, the
offline guarantee holds after the initial model download.

The tradeoff is deliberate: the engine is a deterministic rule system keyed by
joint, direction (signed bias), and magnitude, not a language model. It gains
reproducibility, privacy, and strict grounding in the measured numbers (it can
only describe deltas that are actually in the data), at the cost of the
open-ended, sport-specific prose an LLM could produce. The advice is trustworthy
and number-driven rather than free-form.

## What's verified vs. what needs a live run

- **Verified** in this repo:
  - Vector math, joint-angle math (incl. camera-yaw invariance and the
    y-DOWN/up-sign handling of trunk lean), DTW correctness, normalization
    invariance, gap-filling/smoothing, depth-flip frame repair, handedness
    mirroring, robust + bias-centric + confidence-weighted per-joint deltas
    (incl. a regression proving a low-visibility deviant segment cannot
    fabricate a coaching fault), the compare() orchestration (incl. a
    lefty-vs-righty end-to-end match), and the native coaching engine
    (group-deduped, direction-aware, number-grounded, severity-dosed, and
    **sport-agnostic** — verified to emit identical mesh-mismatch coaching across
    sports with no sport jargon, and to drive workouts off the muscle groups
    behind each mismatch) plus the skeleton-projection math (head-up
    auto-orientation under y-DOWN coords) are all unit-tested (116 passing
    Vitest tests).
  - Renderer + Electron both typecheck clean; renderer builds clean through
    Vite.
  - The real analysis engine was validated on actual tennis footage (an amateur
    forehand vs. Novak Djokovic court-level practice, pulled from YouTube) via a
    browser harness that runs the live `compare()` + coaching pipeline on
    extracted poses. Self-consistency holds (a clip vs. itself ≈ 100%, vs. its
    mirror ≈ 100% with handedness flipped), a same-player reference scores higher
    than the amateur, and the amateur's flagged faults are biomechanically sound
    (less hip/knee load, smaller swing arc). Extraction in the harness uses
    MediaPipe IMAGE mode per frame; the shipped app uses VIDEO mode (temporal
    tracking) — the geometry/compare/coaching code is identical.
- **Not verified without a live app run**:
  - The Electron result UI on real uploads (pipeline it renders is verified;
    the React screens are typecheck-only).
  - Single-frame "pro as image" mode on real media (unit-tested only).
  - Contact-instant-only faults remain a known limitation: per-frame confidence
    weighting now discounts low-visibility contact frames in every per-joint
    statistic (so they can no longer fabricate a fault), but significance still
    keys on the whole-stroke systematic difference — a fault that exists *only*
    at the blurred contact instant is reported descriptively via the per-phase
    breakdown rather than flagged on its own.

## Source layout

```
electron/           main process (IPC, SQLite — local only, no network)
renderer/src/
  App.tsx, main.tsx, styles.css
  lib/
    analyze.ts                  end-to-end orchestrator
    coach.ts                    native coaching-guide + workout engine
    pose/
      types.ts                  landmark indices, skeleton edges
      vec.ts                    3D vector math
      prepare.ts                gap-filling + temporal smoothing
      normalize.ts              translation + scale normalization
      angles.ts                 13 joint-angle features
      handedness.ts             dominant-side detection + angle mirroring
      phases.ts                 velocity-peak phase detection
      dtw.ts                    DTW with Sakoe–Chiba band
      compare.ts                report builder (+ persisted skeleton mesh)
      landmarker.ts             MediaPipe wrapper (GPU→CPU fallback) + extractor
      render.ts                 pure skeleton projection + canvas drawing
      *.test.ts                 unit tests
    sports.ts                   sport metadata registry
  components/                   Sidebar, TopBar, MediaDrop, PoseOverlay,
                                MeshCompare (scrubbable pro-vs-you skeletons),
                                DeltaChart, JointBreakdown, GuideView,
                                WorkoutCard
  screens/                      Home, NewAnalysis, AnalysisResult,
                                WorkoutsLibrary, History, Settings
shared/types.ts                 IPC contract, domain types (guide/workout shapes)
```
