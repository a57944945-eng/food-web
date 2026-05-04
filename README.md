# Food Web

Personal food map built as a static website.

## Update Data

Edit `food-data.xlsx`, then run:

```powershell
powershell -ExecutionPolicy Bypass -File .\sync-data.ps1
```

Commit and push the updated files after `data/restaurants.json` changes.

## Cloudflare Pages

- Framework preset: None
- Build command: leave empty
- Build output directory: `/`

Cloudflare Pages will serve `index.html` directly.
