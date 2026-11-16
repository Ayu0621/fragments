FRAGMENTS v7.0 — TYPOGRAPHY + APPROVED COLLAGE APP ICON
========================================================

Built directly from the v6.0 Cloud Status Fix project.

Only changes in this release:
- English typeface: Cormorant (Google Fonts).
- Chinese typeface: GenRyuMin TW / 源流明體 (official ButTaiwan project, loaded via jsDelivr).
- Unified responsive typography scale:
  Desktop: page 34px, section 24px, subheading 18px, body 15px, caption 13px, label 11px.
  Mobile: page 28px, section 21px, subheading 17px, body 15px, caption 13px, label 11px.
- Approved collage artwork installed as iOS apple-touch-icon and PWA icons.

All original pages, content, feature scripts, data keys, Supabase configuration, and cloud-sync logic are retained from v6.0 Status Fix. No new app features or storage behavior have been introduced.

DEPLOY
1. Back up the current repository.
2. Replace the repository contents with the contents of this ZIP's inner folder.
3. Commit and push to the same GitHub Pages branch.
4. After deployment, remove the old Home Screen shortcut from iPhone.
5. Open the website in Safari, use Share -> Add to Home Screen, then add it again.

FONT SOURCES
- Cormorant: Google Fonts.
- GenRyuMin TW: https://github.com/ButTaiwan/genryu-font
  Licensed under SIL Open Font License 1.1.

Note: The Chinese font is loaded from the official upstream project through jsDelivr, so the device needs an internet connection on first font load. If the CDN is unavailable, the CSS includes system serif fallbacks.


TASK TYPOGRAPHY CONSISTENCY CORRECTION
-------------------------------------
Restored the original task-label scale instead of the temporary 16px size:
14px desktop and 13px mobile. ToDo, Maybe and Wish task labels share the
same font family, weight and line-height. This changes CSS only; app logic,
data and cloud-sync files remain unchanged.


V7.0 FIXED-V4 — SELF-HOSTED CHINESE FONT
---------------------------------------
GenRyuMin2TW-R.otf is bundled locally at ./fonts/GenRyuMin2TW-R.otf.
The @font-face now uses a same-origin relative URL, with font-weight: 400.
HTML pages preload the local font to reduce first-render fallback on mobile.
Cormorant remains the English/Latin font; GenRyuMin TW is the Chinese glyph
fallback. No external CDN is required for GenRyuMin TW.
Task typography remains 14px desktop / 13px mobile.
