# EZ MTG

Local-first Magic: The Gathering deck and collection manager built with React, Vite, IndexedDB, and the Scryfall API.

## Development

```bash
npm ci
npm run dev
```

## GitHub Pages deployment

The GitHub Actions workflow in `.github/workflows/deploy.yml` builds the Vite app and deploys the `dist` directory whenever a commit is pushed to `main`.

In the repository settings, open **Pages** and set the build and deployment source to **GitHub Actions**. Do not publish the repository root directly: `index.html` in the root is Vite source and refers to TypeScript/React files that need to be built first.

To verify a production build locally:

```bash
npm run build
npm run preview
```
