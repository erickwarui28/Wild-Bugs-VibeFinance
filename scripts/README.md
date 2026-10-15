# Submission video

The recording pipeline captures the deployed public application with Playwright. It does not mock Live responses. Demo-only examples are explicitly narrated and shown in Demo mode. It never accesses the admin dashboard or uploads the recording.

Requirements: repository dependencies and Playwright Chromium, Windows SAPI with the Microsoft Zira desktop voice, and a full FFmpeg build with ffprobe, H.264, AAC and subtitles support. Playwright's minimal FFmpeg build is insufficient.

From the repository root in PowerShell:

```powershell
$env:VF_VIDEO_FFMPEG = 'C:\path\to\ffmpeg.exe'
$env:VF_VIDEO_OUTPUT = Join-Path (Get-Location) 'test-results\submission-video'
node scripts/submission-video.mjs prepare
powershell.exe -NoProfile -File scripts/speak-submission.ps1 -PlanPath "$env:VF_VIDEO_OUTPUT\plan.json"
node scripts/submission-video.mjs audio
node scripts/submission-video.mjs record
node scripts/submission-video.mjs render
```

Stop on any command failure. Audio preparation rejects a duration over five minutes. Recording makes bounded analysis/compare requests against production, which can consume the existing visitor and spending allowance. It requires an actual connected Live result and stops if expected states fail. Do not remove these safeguards to simulate a successful Live demo.

Review the MP4, captions, source coverage and chapter screenshots before sharing. Current source availability and network latency can change; selectors and narration must be rechecked for each recording. Keep generated media, browser recordings and downloaded tooling out of Git. The user publishes the video themselves.
