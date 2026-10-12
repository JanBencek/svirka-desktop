# Svirka Desktop

Svirka (music.bencit.com) in its own window, for Windows and Linux. It's the web app, so new Svirka features show up
without updating this. The window adds a kept login, media keys and the OS media overlay, and its own entry in
Svirka Connect ("Svirka Desktop"), so playback moves between it, the phone and browsers.

- Run from source: `npm install && npm start`
- Build: `npm run dist` → `dist/` (Windows installer needs Windows or CI; the AppImage builds on Linux)
- Release: bump `version` in package.json, then `git tag vX.Y.Z && git push --tags`; GitHub Actions attaches
  `Svirka Setup X.Y.Z.exe` and `Svirka-X.Y.Z.AppImage` to the release.
