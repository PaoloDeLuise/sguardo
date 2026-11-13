# MediaPipe Tasks Vision 0.10.14

Files used by Sguardo to find the face landmarks, copied here unchanged so that the page
does not contact any other server.

| File | Source |
|---|---|
| `vision_bundle.mjs`, `wasm/*` | npm package [`@mediapipe/tasks-vision`](https://www.npmjs.com/package/@mediapipe/tasks-vision) version 0.10.14 |
| `face_landmarker.task` | <https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task> |

Copyright The MediaPipe Authors (Google LLC). Licensed under the Apache License 2.0: see
[LICENSE](LICENSE).

To update: download the same files of the new version into a new folder
`vendor/mediapipe-<version>/` and change the three addresses in `js/tracker.js`. Then recalibrate
and compare with `node tools/evaluate.mjs`: a new version can move the face landmarks slightly.
