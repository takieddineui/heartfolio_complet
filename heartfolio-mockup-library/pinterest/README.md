# Pinterest bulk-upload CSVs

Six CSVs, one per language, 42 pins each (14 designs × 3 variants), 252 pins in
total. Built from `../manifest/manifest.json` by
`mockup-exploration-v1/scripts/build_pinterest_csv.py`.

| File | Boards it needs (create them first, names must match exactly) |
|---|---|
| `pinterest-bulk-en.csv` | `Love story timeline posters (printable)` · `Song posters (printable)` |
| `pinterest-bulk-fr.csv` | `Frises d'histoire d'amour à imprimer` · `Affiches musicales à imprimer` |
| `pinterest-bulk-ar.csv` | `الخط الزمني لقصة الحب للطباعة` · `ملصقات الأغاني للطباعة` |
| `pinterest-bulk-es.csv` | `Historias de amor: pósters para imprimir` · `Pósters de canciones para imprimir` |
| `pinterest-bulk-ru.csv` | `Постеры с историей любви для печати` · `Постеры песен для печати` |
| `pinterest-bulk-zh-CN.csv` | `爱情故事时间线（可打印）` · `歌曲海报（可打印）` |

Columns: `Title, Media URL, Pinterest board, Description, Link, Publish date, Keywords`.

## First upload (English), what Pinterest told us

Pinterest accepted the columns, the order and the `YYYY-MM-DDTHH:MM:SS` dates.
It rejected 28 of 42 rows with "Multiples rows with the same title": the three
variants of a design shared one title. Titles are now unique, the two other
variants carry their look in brackets, for example `(gallery wall)`.

`pinterest-bulk-en-remaining.csv` holds the 28 English rows that were rejected
(`gallery-white` and `concrete-oak`), with their original publish dates. The 14
`studio-white` rows were accepted, so do not upload them again. The other five
languages' files are complete and should upload cleanly.

## Before the first upload

1. **Compare the header with Pinterest's own template (confirmed for English).** In Pinterest Business:
   Create → Bulk create Pins → download the sample CSV. The column order here
   is what users report for that template, not an official spec. If a column
   name or order differs, change `COLUMNS` in the script and re-run.
2. **Test with a few rows first.** There are community reports of the bulk
   uploader creating only the first rows of a file. Upload 3–5 rows, check the
   result, then upload the rest.
3. **Images are loaded from `Media URL`.** The default points at this repo's
   branch on `raw.githubusercontent.com`, which works only while the repo is
   public and the branch exists. For a lasting host, copy
   `heartfolio-mockup-library/` to your site or R2 and re-run with
   `--image-base-url https://your-host/path` (the path under it must keep
   `<product>/<lang>/<design>/<variant>.jpg`).
4. **Publish date** is `YYYY-MM-DDTHH:MM:SS` (account time zone), 3 pins a day
   from the `--start-date` (09:00, 13:00, 19:00), so a file runs for 14 days.
   Pinterest only schedules a limited window ahead, so re-run with a new
   `--start-date` when you upload. If Pinterest rejects the date format, run
   with `--no-dates` and schedule in Pinterest instead.
5. **Do not open the files in Excel and save them.** They are plain UTF-8 (no
   BOM); Excel re-encodes Arabic, Russian and Chinese text. Edit in a text
   editor or Google Sheets.

## Notes

- **Links** go to `https://www.theheartfolio.com/<locale>/products/<product>`
  with UTM tags (`utm_campaign=mockups-<lang>`, `utm_content=<design>-<variant>`).
  The site has pages in `en`, `fr` and `ar` only, so the es, ru and zh-CN pins
  link to the English page. Confirm the production site is live before posting.
- **Order:** pins alternate between the two products and go variant by variant,
  so neighbouring pins are never the same design.
- **Copy** follows the social pack's honesty rules: instant private link and QR
  card, print-ready file included, nothing shipped or printed, soundwave
  designed per order, every mockup labelled illustrative, no prices. The es, ru
  and zh-CN copy has not had a native review.
- **Regenerate:**
  `python mockup-exploration-v1/scripts/build_pinterest_csv.py --start-date 2026-11-02`
  (options: `--image-base-url`, `--per-day 1|2|3`, `--no-dates`). The script
  checks title ≤ 100 and description ≤ 500 characters, 42 unique images per
  file, and that every image exists.
- Landscape designs (Horizontal Polaroids, Horizontal Circles, Award, Sleeve)
  show smaller in Pinterest's tall feed than the portrait ones.
