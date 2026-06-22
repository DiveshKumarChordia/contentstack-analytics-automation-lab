# 🚀 Quick Start — 3 Minutes to Live News

Get the news platform running in your existing project in 3 minutes.

## Step 1: Set Environment Variable (30 seconds)

Add to your `.env` file:
```bash
VITE_NEWS_API_KEY=your_key_from_newsapi.org
```

Get free key: https://newsapi.org → Sign up → Copy key

## Step 2: Copy Files (1 minute)

All news files are already in this project under `src/`:

**The files you need:**
- `src/pages/News*.jsx` (7 pages)
- `src/components/Breadcrumb.jsx`, `ReadNext.jsx`, `ShareButtons.jsx`, `CommentsSection.jsx`
- `src/styles/News*.css` and all component styles
- `src/NewsRouter.jsx` (routing config)

If integrating into a different project, copy these to your project's `src/` folder.

## Step 3: Add Route to Your App (1 minute)

In your main `App.jsx` or routing file:

**Before:**
```javascript
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        {/* other routes */}
      </Routes>
    </Router>
  )
}
```

**After:**
```javascript
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import NewsRouter from './NewsRouter'  // ← ADD THIS

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/news/*" element={<NewsRouter />} />  {/* ← ADD THIS */}
        {/* other routes */}
      </Routes>
    </Router>
  )
}
```

## Step 4: Add Navigation (30 seconds)

Add link to your navigation menu:

```javascript
<nav>
  <a href="/">Dashboard</a>
  <a href="/news">📰 News</a>  {/* ← ADD THIS */}
</nav>
```

## Done! 🎉

Visit `http://localhost:3000/news` and you're live!

---

## What You Get

| URL | Page |
|-----|------|
| `/news` | Homepage with featured articles |
| `/news/category/technology` | Articles by category |
| `/news/search?q=ai` | Search results |
| `/news/technology/article-slug` | Full article with comments |
| `/news/author/john-smith` | Author's all articles |
| `/news/tag/ai` | Articles by topic |

---

## First-Time Setup

### Option A: With Real News (Recommended)

1. Keep `VITE_NEWS_API_KEY` in `.env`
2. Real articles fetch automatically every 4 hours
3. Contentstack populates with real news

### Option B: Create Test Articles

1. Go to your Contentstack dashboard
2. Create an "Article" entry manually
3. Fill in: title, excerpt, body, featured_image, author
4. Set status: "published"
5. Refresh `/news` to see it

---

## Contentstack Content Types

You need these in Contentstack (one-time setup):

### Quick Setup
Copy-paste these into Contentstack dashboard:

**Article Type:**
- title (Text)
- slug (Text, unique)
- excerpt (Textarea)
- body (Rich Text)
- featured_image (File)
- author (Reference → Author)
- categories (Reference → Category)
- tags (Reference → Tag)
- publish_date (Date)
- status (Select: draft/review/published/archived)

**Author Type:**
- name (Text)
- slug (Text, unique)
- bio (Textarea)
- avatar (File)
- verified (Boolean)

**Category Type:**
- name (Text)
- slug (Text, unique)
- description (Textarea)

**Tag Type:**
- name (Text)
- slug (Text, unique)

**Site Type:**
- site_id (Text, unique)
- site_name (Text)
- active (Boolean)

---

## Customization

### Change Homepage Featured Count
In `src/pages/NewsHomepage.jsx`, line 40:
```javascript
// Change 1 to show more featured articles
const featured = articles.slice(0, 1)
```

### Change Category Grid Size
In `src/pages/NewsHomepage.jsx`, line 44:
```javascript
// Change 6 to show more/fewer per category
const categoryArticles = articles.filter(...).slice(0, 6)
```

### Change Articles Per Page
In any page (e.g., `NewsArticle.jsx`), search for:
```javascript
const ARTICLES_PER_PAGE = 12  // Change this number
```

### Change Colors
Update CSS variables in any `.css` file:
```css
/* Find these and change */
--primary: #6366f1;
--success: #22c55e;
--danger: #ef4444;
```

---

## Troubleshooting

### Articles not showing?
```bash
# Check API key works
curl "https://api.contentstack.io/v3/content_types/article/entries" \
  -H "api_key: YOUR_KEY" \
  -H "access_token: YOUR_TOKEN"
```

### Build errors?
```bash
# Clear and rebuild
rm -rf node_modules dist
npm install
npm run build
```

### NewsAPI rate limited?
Sign up for paid plan at https://newsapi.org or wait 24 hours

### Styles not loading?
```bash
# Clear browser cache
# Hard refresh: Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac)
```

---

## Next Steps

- ✅ News is live
- ⭕ Configure Contentstack content types
- ⭕ Add your first article
- ⭕ Customize colors/branding
- ⭕ Enable comments (optional)
- ⭕ Setup news auto-fetching (optional)

---

## Need Help?

See these docs for more details:

- **Architecture:** `docs/NEWS_WEBSITE_DESIGN.md`
- **Integration:** `docs/INTEGRATION_GUIDE.md`
- **Complete Summary:** `docs/FINAL_SUMMARY.md`
- **Features by Phase:** `docs/PHASE_*.md`

---

**Questions?** Each page has built-in error handling. Check browser console for details. 🔍

