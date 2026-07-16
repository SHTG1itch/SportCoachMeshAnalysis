# Bundled MediaPipe assets

These files make pose analysis work offline and prevent production from loading
executable WebAssembly from a third-party CDN.

- `wasm/` is copied without modification from `@mediapipe/tasks-vision` 0.10.34.
- `models/pose_landmarker_heavy.task` is the MediaPipe Pose Landmarker Heavy
  float16 model, version 1, downloaded from Google Cloud Storage.

Both are provided by the MediaPipe project under Apache License 2.0. Source and
license details are recorded in the repository's `THIRD_PARTY_NOTICES.md`.

## SHA-256

```text
64437AF838A65D18E5BA7A0D39B465540069BC8AAE8308DE3E318AAD31FCBC7B  pose_landmarker_heavy.task
368E048E33C9CA97222797A16BDF9461EA755C10B0E7C6EFCF3CC548A73925FB  vision_wasm_internal.js
75A31EB26E007D6D72BA654DA9A91B529DC5E309F52FA0EF529E6B574F92CE89  vision_wasm_internal.wasm
0ED17894E8D84BF97F3B721DFB85FE9023F8DCBCEAAD7DD4463EB56A0C81416C  vision_wasm_module_internal.js
C7855DA28628611C173FBD674A01A71D6194E50EBC57951CDEDC231FE6E566C3  vision_wasm_module_internal.wasm
FA063C9645C278E526151C42AFFE43F51512ACE147F6FDE2EF05B9533B77E8A9  vision_wasm_nosimd_internal.js
D0106A8656BC429B28528F2547B775A6EB7196C191CFD75FD9FC830A81BDDB80  vision_wasm_nosimd_internal.wasm
```
