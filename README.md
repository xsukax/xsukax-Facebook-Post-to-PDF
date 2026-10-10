# xsukax Facebook Post to PDF

A Microsoft Edge / Chromium Manifest V3 extension that turns a Facebook post into a Facebook-style PDF. **New in v1.4:** full manual corrections of the page name, publication date, optional time, and post text in the live preview, plus original author-avatar photo loading where Facebook exposes a suitable profile image.

## Install or upgrade

1. Unzip `xsukax-Facebook-Post-to-PDF-main.zip` into a permanent folder.
2. Open `edge://extensions` and enable **Developer mode**.
3. Choose **Load unpacked** and select the extracted `xsukax-Facebook-Post-to-PDF-main` folder (which contains `manifest.json`).
4. If upgrading an unpacked extension, replace the files in its existing installation folder and press **Reload** in `edge://extensions`. If you loaded it from a different folder, remove the old extension and load the new folder instead.

## Save and manually correct a post

1. Open an individual Facebook post's permanent URL in Edge. Open **See more** if needed.
2. Click **xsukax Facebook Post PDF** and choose **Extract current post**.
3. The new **Edit post before saving** panel above the Facebook-style preview contains editable fields for:
   - Facebook page name
   - Publication calendar date (a date picker)
   - Publication time (optional)
   - Complete post text (multiline editor, supporting Arabic, Amharic and English)
   - Original page photo URL (optional, supported Facebook CDN URL only)
4. Correct fields directly. The Facebook-style preview updates immediately. **Restore extracted values** resets the fields.
5. Choose **Download PDF** to generate a locally rendered PDF, or **Print / Save searchable PDF** to open Edge's native print dialog and create a PDF with selectable/searchable text.
6. The post's original Facebook URL stays **unaltered and clickable at the bottom** of the final post card.

If extraction fails or detects no post text, a blank editor still opens (with the original browser URL) so you can supply the information manually. Page name and post text are required to export; the date may be left unknown.

## Original profile photo (new in v1.4)

- The extension searches the **live publisher header** near its author link for a genuine profile-picture `<img>`, SVG `<image>` or inline CSS `background-image`. It does not mistake a post attachment or commenter avatar for the publisher photo.
- After extraction, the preview tries to fetch only HTTPS images hosted under `fbcdn.net`. This requires the limited `https://*.fbcdn.net/*` host permission in `manifest.json`.
- When the image can be loaded, the actual photo replaces the illustrated avatar in both the direct PDF and the native print PDF. If it fails (e.g. expired signed URL, Facebook CDN access restriction, removed photo), the generated PDF uses the safe initial-letter avatar instead.
- You may paste an **fbcdn.net** image URL into the optional profile-photo field and leave the field to load it. URLs to arbitrary domains are rejected; images are not sent to a proxy or other server.
- `ex1.html`–`ex4.html` (the user-provided Facebook **View Source** files) contain **no `<img>` elements or identifiable publisher avatar URLs**. Facebook typically renders these images after loading the page. Live-page support therefore cannot be validated solely from those HTML files.

## Dates

The date extractor first checks structured timestamps, then timestamp spans, ARIA labels and hover titles close to the publisher. It supports explicit calendar dates, "Today", "Yesterday", "Just Now", and relative short labels such as `2m`, `3h`, and `15 hours ago`. Times derived from relative labels are approximate. It does not invent a publication date when Facebook provides none. Enter the date manually in the new editor if automatic extraction fails.

## PDF format and privacy

- Facebook-inspired post card with actual publisher photo when accessible, page name, date, full text, decorative Like/Comment/Share row, and **original post URL at the bottom**.
- `Timestamp originally displayed`, `Verification`, `Captured at`, and the old footer remain removed.
- The edit panel, notices and PDF buttons never appear inside PDFs.
- No servers, analytics, cloud storage, telemetry or external JavaScript libraries. Post data is kept in **session storage** for the preview; manual edits and downloaded profile pictures are held temporarily in the preview. Only an optional direct image fetch to Facebook's own CDN is made to load a photo.
- The instant-download PDF rasterizes pages via Canvas for faithful Arabic and Amharic shaping; its text is not selectable. The **Print / Save searchable PDF** option uses Edge's print engine for selectable text.
- Inspect the resulting PDF before using it as an official record: manual corrections are user-supplied, not verified by Facebook, and the rendered post may be incomplete when Facebook collapses or blocks content.

## Files

- `manifest.json`: Manifest V3 permissions and action
- `popup.html`, `popup.css`, `popup.js`: extension popup and manual fallback
- `extract.js`: Facebook extraction (author/date/text/avatar)
- `report.html`, `report.css`, `report.js`: correction editor, live post preview and native PDF output
- `pdf-export.js`: offline Canvas PDF writer with embedded author image and clickable original URL
- `icons/`: extension icons
