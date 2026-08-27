# Video Generator

A local-first React, Tailwind, and Remotion studio for managing source videos, generating timed captions, editing reusable infographic templates, and rendering MP4 files. All persistent data is stored in `projects/`, `videos/`, `renders/`, and `.runtime/`; there is no database.

## Requirements

- Node.js 22 or newer
- FFmpeg and ffprobe in `PATH`
- A Chromium-compatible browser (Remotion can provision one, or set `REMOTION_BROWSER_EXECUTABLE`)
- Internet access the first time Whisper.cpp and the selected model are installed

On Windows, FFmpeg can be installed with `winget install -e --id Gyan.FFmpeg`.

## Run

```powershell
npm install
npm run dev
```

Open `http://localhost:5173`. The API listens on `http://127.0.0.1:4174`.

For a production-style local run:

```powershell
npm run build
npm start
```

Open `http://127.0.0.1:4174`.

## Workflow

1. Upload an MP4 in **Videos**.
2. Open it and run the full caption pipeline.
3. Correct any transcription mistakes in the editable transcript and save the caption corrections.
4. Create a project and select the video.
5. Edit the scenes, theme, or raw JSON and save.
6. Render the project, optionally send the result to Drive, and download the completed MP4.
7. Open **Renders** to review completed jobs and delivery status.

When a source video is selected, the template stores the video slug in `videoFolder` (for example,
`my-video`). The renderer resolves that slug to `videos/my-video` and uses it to load both `video.mp4`
and `tokens.json` while still supporting older templates that only contain the legacy `../../videos/my-video`
path format.

Caption and render work runs through one persistent filesystem queue. If the app is stopped during a job, that job is marked failed on the next start and can be retried.

To enable Google Drive delivery and Gmail notifications, set the following in `.env`:

- `GOOGLE_ACCESS_TOKEN` or the OAuth refresh-token trio
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REFRESH_TOKEN`
- `GOOGLE_DRIVE_FOLDER_ID` if you want uploads placed in a specific folder
- `GOOGLE_DRIVE_SHARE_ANYONE=true` if you want public Drive links
- `GMAIL_FROM` to send the completion email from a configured Gmail alias

If Google returns `invalid_grant`, the refresh token has expired or been revoked. Replace
`GOOGLE_REFRESH_TOKEN` with a newly authorized token and restart the app. The local render still completes and
remains downloadable when Google delivery fails. Remove the Google OAuth values from `.env` if local-only
rendering is preferred.

## Commands

- `npm run dev` — Vite UI and watched API server
- `npm run studio` — Remotion Studio
- `npm run build` — TypeScript validation and frontend build
- `npm test` — automated tests
- `npm run lint` — strict TypeScript check

Copy `.env.example` to `.env` to change ports, upload limits, the Whisper model, or the browser executable.
