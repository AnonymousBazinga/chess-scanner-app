# Chess Scanner web

The browser version lives on the `web-version` branch and runs entirely in the
browser. Stockfish and ONNX Runtime ship in `vendor/`; the recognition model is
downloaded from its pinned Hugging Face URL on first use.

Production: https://chess-scanner-app.vercel.app

Deploy from this `web/` directory to the personal Vercel workspace:

```sh
npx vercel@62.1.0 link --yes --project chess-scanner-app --scope anonymousbazingas-projects
npx vercel@62.1.0 --prod --scope anonymousbazingas-projects
```

No build step or API credentials are required. The `qa/` directory is excluded
from deployment. Run its existing browser checks against production with:

```sh
cd qa
npm ci
BASE_URL=https://chess-scanner-app.vercel.app/ npm run qa
```
