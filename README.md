# EZ MTG

Local-first Magic: The Gathering deck, collection, and wishlist manager built with React, Vite, IndexedDB, and the Scryfall API.

Decks, collection cards, and wishlist entries are stored in the browser on each device. JSON export/import includes all three, so it can be used to transfer data between devices. Individual decks and the collection can also be exported as CSV or JSON. Older exports without a wishlist remain importable.

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
