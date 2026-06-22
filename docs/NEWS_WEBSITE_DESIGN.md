# Multi-Website News Platform Design

## Architecture Overview

**Goal**: Host multiple news websites using a single Contentstack stack with real, auto-fetched news content.

### Content Type Hierarchy

```
Site (root entry per website)
├── Article (the content)
│   ├── Author (reference)
│   ├── Category (multi-reference)
│   ├── FeaturedImage (media)
│   └── Tags (reference)
├── Category (taxonomy)
├── Author (bio, social)
├── Tag (folksonomy)
├── Media (images)
└── SiteConfig (settings, theme, navigation)
```

---

## Content Types Detail

### 1. **Site** 
Root entry — one per website hosted in the stack

**Fields:**
- `site_id` (text, unique): `tech-news`, `world-news`, `sports-news`
- `site_name` (text): "Tech Daily"
- `site_url` (text): `https://tech-daily.com`
- `description` (text_area): Site description for SEO
- `logo` (asset): Site logo
- `primary_color` (text): `#6366f1`
- `secondary_color` (text): `#22c55e`
- `featured_sources` (multi-line_text): Comma-separated preferred news sources
- `active` (boolean): Is this site active?

### 2. **Article**
The main content type — news articles

**Fields:**
- `title` (text, required): Article headline
- `slug` (text, required, unique): URL slug (auto-generated from title)
- `excerpt` (text_area): Short summary for lists
- `body` (rich_text_editor): Full article content
- `featured_image` (asset): Hero image
- `featured_image_credit` (text): Photo credit
- `site` (reference): Which site does this belong to
- `author` (reference): Article author (link to Author CT)
- `categories` (multi_reference): Primary + secondary categories
- `tags` (multi_reference): Topic tags (auto-generated from body)
- `source_url` (text): Original article URL (if syndicated)
- `source_name` (text): Original publisher (e.g., "Reuters", "AP")
- `publish_date` (date): When article should be published
- `updated_date` (date): Last update
- `status` (select): draft | review | published | archived
- `reading_time_minutes` (number): Auto-calculated
- `view_count` (number): Track popularity
- `seo_meta_description` (text): Meta description for search
- `seo_keywords` (multi_line_text): SEO keywords
- `is_featured` (boolean): Show on homepage hero
- `is_syndicated` (boolean): Did we fetch this from external source?

### 3. **Author**
Person who wrote an article

**Fields:**
- `name` (text, required): Full name
- `slug` (text, required): URL slug
- `bio` (text_area): Author biography
- `avatar` (asset): Profile photo
- `email` (email): Contact email
- `twitter` (text): Twitter handle
- `linkedin` (text): LinkedIn profile URL
- `website` (text): Personal website
- `verified` (boolean): Is this a verified author?
- `join_date` (date): When author joined

### 4. **Category**
News categories/sections

**Fields:**
- `name` (text, required): "Technology", "Sports", "World"
- `slug` (text, required, unique): URL slug
- `description` (text_area): Category description
- `icon` (text): Emoji or icon code
- `color` (text): Category color hex
- `parent_category` (reference): For hierarchical structure (optional)
- `featured_image` (asset): Category header image
- `site` (reference): Which site uses this category

### 5. **Tag**
Article tags for filtering

**Fields:**
- `name` (text, required): "AI", "Climate", "Election"
- `slug` (text, required, unique): URL slug
- `description` (text_area): What this tag covers
- `site` (reference): Which site uses this tag

### 6. **Author** (already listed above)

### 7. **SiteConfig**
Global settings per site

**Fields:**
- `site` (reference, required): Which site
- `homepage_articles_count` (number): How many articles on homepage (default 12)
- `articles_per_page` (number): Pagination size (default 20)
- `enable_comments` (boolean): Allow comments?
- `enable_search` (boolean): Show search?
- `footer_text` (text_area): Footer content
- `nav_menu` (json): Navigation structure
- `google_analytics_id` (text): Analytics tracking
- `social_links` (json): Twitter, Facebook, Instagram handles

---

## Entry Generation Pipeline

### Real News Sources

1. **NewsAPI.org** (25 requests/day free)
   - URL: `https://newsapi.org/v2/everything?q=QUERY&sortBy=publishedAt`
   - Returns: title, description, urlToImage, content, source, author, publishedAt
   
2. **RSS Feeds** (unlimited, direct from publishers)
   - BBC News: `http://feeds.bbc.co.uk/news/rss.xml`
   - The Guardian: `https://www.theguardian.com/international/rss`
   - Reuters: `https://www.reutersagency.com/feed/?taxonomy=best-topics&output=rss`

3. **The Guardian Open Platform** (12 calls/sec free)
   - Structured data, filtering by section/keyword

### Generator Logic

**For each source:**
1. Fetch latest articles (from last run timestamp)
2. **Deduplication**: Hash(title + source_url) — skip if exists
3. **Transform**: Map API fields → Contentstack fields
   - API title → Article.title
   - API description → Article.excerpt
   - API content → Article.body (truncate, add source link)
   - API image → Featured image (download & upload to Contentstack)
   - API author → Find/create Author entry
4. **Enrichment**:
   - Extract keywords from body → create Tags
   - Assign Category based on source section
   - Calculate reading_time
   - Generate SEO meta description
5. **Create entry**: POST to Contentstack Management API
   - Status: `draft` (for editorial review)
   - `is_syndicated: true`
   - Link back to original source

### Rate Limiting & Scheduling

- Run every **4 hours** (6 times/day, well under API limits)
- Stagger by site (don't hammer one source)
- Backoff on rate-limit errors (429 → wait 1 hour)

---

## Frontend Structure

### Pages

1. **Homepage** (`/`)
   - Featured article (large hero)
   - Category sections (6 articles each)
   - Trending sidebar (most viewed this week)
   - Newsletter signup

2. **Category Archive** (`/{category}`)
   - Grid of articles (20 per page)
   - Filters: date range, author, source
   - Pagination

3. **Article Detail** (`/{category}/{year}/{month}/{slug}`)
   - Full article body
   - Author card + bio
   - Related articles (by category/tag)
   - Social share buttons
   - Comments (if enabled)

4. **Search Results** (`/search?q=...`)
   - Full-text search across title, excerpt, body
   - Filters by category, author, date

5. **Author Page** (`/author/{author-slug}`)
   - Author bio + photo
   - All articles by this author
   - Social links

---

## URL Patterns

```
/                                    # Homepage
/{site_id}                          # Site homepage (if multi-site UI)
/{category}                          # Category archive
/{category}/{year}/{month}/{slug}   # Article detail
/author/{author-slug}                # Author page
/search?q=term                       # Search
/tag/{tag-slug}                      # Tag archive
```

---

## Integration with drive-all

**New step in periodic-entries-from-manifest.mjs:**

```javascript
// Before: "periodic entries from manifest"
// New: "fetch real news from NewsAPI + RSS feeds"
// After: "localize entries" (apply translations)
```

This ensures on each 4-hour automation run:
1. Fetch latest news from configured sources
2. Create Article entries (draft status)
3. Create Author entries as needed
4. Publish only after editorial review

---

## Example Run Data

When drive-all runs the news generator:

```json
{
  "kpis": {
    "articles_fetched": 45,
    "articles_created": 32,
    "articles_deduplicated": 13,
    "authors_created": 18,
    "images_processed": 32,
    "fetch_errors": 0
  }
}
```

This becomes visible in the /runs dashboard, showing the news pipeline health.

---

## Multi-Site Example

**Site 1: Tech Daily**
- `site_id`: "tech-news"
- Sources: Hacker News, Product Hunt, TechCrunch RSS
- Categories: AI, Security, Startups, Web3

**Site 2: Sports Weekly**
- `site_id`: "sports-news"
- Sources: ESPN API, Sky Sports RSS
- Categories: Football, Basketball, Tennis

Both sites run on the **same Contentstack stack**, separated by `site_id` references.
