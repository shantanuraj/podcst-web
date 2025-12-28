# [podcst-web](https://podcst.app)

[![code style: biome](https://img.shields.io/badge/code_style-biome-60a5fa?style=flat&logo=biome)](https://biomejs.dev/)

Podcst Web is a modern PWA to listen to podcasts.

The aim of this project is to provide an excellent podcast listening experience on all types of devices (desktop, tablets, mobile).

Another major focus is on accessibility, with full keyboard navigation support.

> **Note:** This project only aims to support ever-green browsers.

## Features

- User accounts with passkey authentication
- Cross-device subscription and playback sync
- Podcast search and discovery
- Top podcasts by region
- Chromecast and AirPlay support
- Private feed support
- Media session integration
- Offline PWA capabilities

## Architecture

- **Frontend**: Next.js with App Router, React 19, TypeScript
- **State Management**: Zustand for client state
- **Data Fetching**: TanStack Query
- **Database**: PostgreSQL (content + user data)
- **Caching**: Redis + IndexedDB + LocalStorage
- **Audio**: Howler.js
- **Styling**: Tailwind CSS 4 + CSS Modules
- **Code Quality**: Biome for formatting and linting

### Data Flow

```
Background Jobs (cron):
├── poll-top-charts.ts  → iTunes API → top_podcasts table
├── poll-feeds.ts       → RSS feeds → episodes table
└── sync-podcast-index  → Podcast Index dump → podcasts table

API Routes (database-first):
├── /api/top           → PostgreSQL → top podcasts
├── /api/feed          → PostgreSQL → podcast + episodes
└── /api/search        → PostgreSQL + iTunes fallback
```

### Branching Model

Simple branch-and-merge workflow:

- `main` is the production branch
- Branch off `main` for new features or fixes
- Open a PR and merge back to `main` when ready

## Prerequisites

- [Bun](https://bun.sh/) - JavaScript runtime (for scripts)
- [Node](https://nodejs.org/) - LTS version
- [yarn](https://yarnpkg.com/) - package manager
- [PostgreSQL](https://www.postgresql.org/) - database
- [Redis](https://redis.io/) - caching layer

## Getting Started

Clone this repository and install dependencies:

```bash
git clone https://github.com/shantanuraj/podcst-web
cd podcst-web
yarn
```

Set up environment variables (create `.env.local`):

```bash
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
WEBAUTHN_RP_ID=localhost
WEBAUTHN_RP_ORIGIN=http://localhost:3000
RESEND_API_KEY=...  # optional, for email verification
```

Run database migrations:

```bash
yarn db:migrate
```

Start the development server:

```bash
yarn dev
```

## Development

### Available Scripts

```bash
yarn dev                 # Start development server
yarn build               # Build for production
yarn start               # Start production server
yarn format              # Format code with Biome
yarn lint                # Lint code with Biome
yarn db:migrate          # Run database migrations
```

### Background Jobs

These scripts run as background jobs to keep content fresh:

```bash
bun scripts/poll-top-charts.ts     # Sync iTunes top charts + poll missing episodes
bun scripts/poll-feeds.ts          # Poll RSS feeds (single batch)
bun scripts/poll-feeds.ts --daemon # Poll RSS feeds continuously
bun scripts/sync-podcast-index.ts  # Sync from Podcast Index database dump
```

### Building for Production

```bash
yarn build
```

This creates an optimized production build in the `.next` folder.

## Deployment

The app is deployed on both Vercel and Fly.io, with plans to consolidate on Fly.io.

### Vercel

Automatic deployment on every push to `main`.

### Fly.io

Deploy using the Fly CLI.

```bash
./scripts/deploy-fly.sh
```

## Built With

- [TypeScript](https://www.typescriptlang.org/) - Type-safe JavaScript
- [Next.js](https://nextjs.org/) - React framework
- [React](https://react.dev/) - UI library
- [TanStack Query](https://tanstack.com/query) - Data fetching and caching
- [Zustand](https://zustand-demo.pmnd.rs/) - State management
- [Howler](https://howlerjs.com/) - Audio playback
- [Tailwind CSS](https://tailwindcss.com/) - Utility-first CSS
- [PostgreSQL](https://www.postgresql.org/) - Database
- [Redis](https://redis.io/) - Caching
- [Biome](https://biomejs.dev/) - Linting and formatting

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) for process details on collaborating on this project.

## Versioning

We use [SemVer](http://semver.org/) for versioning. For available versions of this software, see the [releases on this repository](https://github.com/shantanuraj/podcst-web/releases).

## Authors

See the list of [contributors][Contributor List] who participated in this project.

[Contributor List]: https://github.com/shantanuraj/podcst-web/contributors

## License

This project is licensed under the MIT License - see the
[LICENSE](LICENSE.md) file for details.
