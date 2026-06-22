# News Platform — Integration into Existing Project

Simple guide to add the news platform as a feature to your existing app.

## Setup (2 minutes)

### 1. Add Environment Variable

Add to your `.env`:
```bash
VITE_NEWS_API_KEY=your_newsapi_key_here
```

Get a free key at: https://newsapi.org

### 2. Copy News Files to Your Project

All news platform files are in `/src`:
- `src/pages/` — All news pages (Homepage, Article, Category, Search, Author, Tag, 404)
- `src/components/` — Breadcrumb, ReadNext, ShareButtons, CommentsSection
- `src/styles/` — All CSS files
- `src/NewsRouter.jsx` — Central router config

### 3. Integrate into Main App Router

In your main app file (e.g., `src/App.jsx`):

```javascript
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import NewsRouter from './NewsRouter'
import MainDashboard from './pages/MainDashboard' // your existing page

export default function App() {
  return (
    <Router>
      <Routes>
        {/* Your existing routes */}
        <Route path="/" element={<MainDashboard />} />
        
        {/* News platform routes */}
        <Route path="/news/*" element={<NewsRouter />} />
      </Routes>
    </Router>
  )
}
```

### 4. Add Navigation Link

Add a link to news platform in your main navigation:

```javascript
<nav>
  <a href="/news">📰 News</a>
  {/* other links */}
</nav>
```

## Done! 🎉

The news platform is now live as `/news/` within your existing app.

**URLs:**
- `/news` — Homepage
- `/news/category/technology` — Category view
- `/news/search?q=...` — Search
- `/news/author/{slug}` — Author profile
- `/news/tag/{slug}` — Topic page

## Contentstack Setup

Create these content types in Contentstack (one-time):

- **Article** — News articles
- **Author** — Writer profiles
- **Category** — Topic categories
- **Tag** — Article tags
- **Site** — Website configuration

See `docs/NEWS_WEBSITE_DESIGN.md` for field definitions.

## Automated Entry Generation

To get real news every 4 hours, update your GitHub Actions workflow:

In `contentstack-periodic-entries.yml`, add to periodicPhase:

```yaml
- name: Fetch news entries
  if: env.NEWS_API_KEY
  run: node scripts/fetch-news-entries.mjs
  env:
    CONTENTSTACK_API_KEY: ${{ secrets.CONTENTSTACK_API_KEY }}
    NEWS_API_KEY: ${{ secrets.NEWS_API_KEY }}
```

## That's It!

No new deployment, no new infrastructure. Just integrated as a feature. 📰
