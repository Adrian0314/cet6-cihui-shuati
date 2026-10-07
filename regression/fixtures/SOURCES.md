# Speech regression fixtures

## vosk-digits.wav

Unmodified Vosk official example audio, obtained from:
https://raw.githubusercontent.com/alphacep/vosk-api/05adbfcc0df27a1535913c6accd4b7fc60ffd59d/python/example/test.wav

Copyright Alpha Cephei Inc.; Apache-2.0, matching the upstream repository license. A copy of that license is available at `../../vosk/LICENSE-vosk-model.txt`.
SHA-256: `dcfea5712c43a43ba7ae8083afb39d36993e5a69c46e88b68aaa72b65cb615bb`.

## prestige.wav

Synthetic speech saying “prestige”, generated locally with Windows SAPI on 2026-10-07 exclusively for the browser's fake microphone integration test. It is not a user's microphone recording.

The tests load real WASM/model files for end-to-end cases; stubbed recognition is used only for deterministic failure/lifecycle tests. No test uses a human's microphone or contacts a cloud speech service.
