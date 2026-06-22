# News Platform — Deployment & Production Guide

Complete guide to deploying the multi-website news platform to production.

## Table of Contents
1. [Environment Setup](#environment-setup)
2. [Configuration](#configuration)
3. [Contentstack Stack Initialization](#contentstack-stack-initialization)
4. [API Keys & Secrets Management](#api-keys--secrets-management)
5. [Database Setup](#database-setup)
6. [CI/CD Pipeline](#cicd-pipeline)
7. [Docker Deployment](#docker-deployment)
8. [Performance Optimization](#performance-optimization)
9. [Monitoring & Logging](#monitoring--logging)
10. [Deployment Checklist](#deployment-checklist)

---

## Environment Setup

### Development Environment
```bash
# Clone the repository
git clone <repository-url>
cd news-platform

# Install dependencies
npm install

# Create .env.local file
cp .env.example .env.local

# Start development server
npm run dev
```

### Production Environment
```bash
# Install dependencies with production flag
npm install --production

# Build the project
npm run build

# Verify build
npm run preview
```

---

## Configuration

### Environment Variables

Create `.env.production` with the following variables:

```bash
# Contentstack API Configuration
VITE_CONTENTSTACK_API_KEY=your_api_key_here
VITE_CONTENTSTACK_DELIVERY_TOKEN=your_delivery_token_here
VITE_CONTENTSTACK_DELIVERY_HOST=https://api.contentstack.io

# News Data Source
NEWS_API_KEY=your_newsapi_key_here (register at https://newsapi.org)

# Optional: Comment System Integration
VITE_DISQUS_SHORTNAME=your_disqus_shortname

# Analytics (Optional)
VITE_GOOGLE_ANALYTICS_ID=G-XXXXXXXXXX
VITE_HOTJAR_ID=hjid

# Site Configuration
VITE_SITE_URL=https://news.yourdomain.com
VITE_SITE_NAME=Your News Platform
VITE_SITE_DESCRIPTION=High-quality news and analysis

# Optional: Email Configuration (for newsletter)
VITE_MAILCHIMP_API_KEY=your_mailchimp_key
VITE_MAILCHIMP_LIST_ID=your_list_id

# GitHub Actions (for automated entry generation)
GITHUB_TOKEN=your_github_token_here
LAUNCH_SITE_URL=https://news.yourdomain.com
```

### Vite Configuration
Update `vite.config.js` for production:

```javascript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false, // Disable source maps in production
    minify: 'terser',
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
        }
      }
    }
  },
  define: {
    'process.env.NODE_ENV': '"production"'
  }
})
```

---

## Contentstack Stack Initialization

### 1. Create Content Types

Run the initialization script:

```bash
node scripts/init-contentstack-stack.mjs
```

This script creates:
- **Site** — Multiple website configurations
- **Article** — News articles with rich content
- **Author** — Writer profiles
- **Category** — Topic organization
- **Tag** — Tagging system

### 2. Manual Setup (if script fails)

#### Create Site Content Type
```json
{
  "display_name": "Site",
  "uid": "site",
  "schema": [
    {
      "field_metadata": {
        "instruction": "Internal site identifier"
      },
      "data_type": "text",
      "uid": "site_id",
      "required": true
    },
    {
      "data_type": "text",
      "uid": "site_name",
      "display_name": "Site Name",
      "required": true
    },
    {
      "data_type": "link",
      "uid": "site_url",
      "display_name": "Site URL"
    },
    {
      "data_type": "file",
      "uid": "logo",
      "display_name": "Logo"
    },
    {
      "data_type": "text",
      "uid": "primary_color",
      "display_name": "Primary Color"
    },
    {
      "data_type": "text",
      "uid": "description",
      "data_type": "textarea"
    },
    {
      "data_type": "boolean",
      "uid": "active",
      "default_value": true
    }
  ]
}
```

#### Create Article Content Type
```json
{
  "display_name": "Article",
  "uid": "article",
  "schema": [
    {
      "data_type": "text",
      "uid": "title",
      "display_name": "Title",
      "required": true
    },
    {
      "data_type": "text",
      "uid": "slug",
      "display_name": "URL Slug",
      "required": true,
      "unique": true
    },
    {
      "data_type": "textarea",
      "uid": "excerpt",
      "display_name": "Excerpt"
    },
    {
      "data_type": "rich_text_editor",
      "uid": "body",
      "display_name": "Article Body",
      "required": true
    },
    {
      "data_type": "file",
      "uid": "featured_image",
      "display_name": "Featured Image"
    },
    {
      "data_type": "reference",
      "uid": "site",
      "display_name": "Website",
      "reference_to": ["site"],
      "required": true
    },
    {
      "data_type": "reference",
      "uid": "author",
      "display_name": "Author",
      "reference_to": ["author"]
    },
    {
      "data_type": "reference",
      "uid": "categories",
      "display_name": "Categories",
      "reference_to": ["category"],
      "multiple": true
    },
    {
      "data_type": "reference",
      "uid": "tags",
      "display_name": "Tags",
      "reference_to": ["tag"],
      "multiple": true
    },
    {
      "data_type": "link",
      "uid": "source_url",
      "display_name": "Original Source URL"
    },
    {
      "data_type": "text",
      "uid": "source_name",
      "display_name": "Source Name"
    },
    {
      "data_type": "date",
      "uid": "publish_date",
      "display_name": "Publish Date"
    },
    {
      "data_type": "date",
      "uid": "updated_date",
      "display_name": "Updated Date"
    },
    {
      "data_type": "select",
      "uid": "status",
      "display_name": "Status",
      "enum": {
        "draft": "Draft",
        "review": "In Review",
        "published": "Published",
        "archived": "Archived"
      },
      "default_value": "draft"
    },
    {
      "data_type": "number",
      "uid": "view_count",
      "display_name": "View Count",
      "default_value": 0
    },
    {
      "data_type": "boolean",
      "uid": "is_featured",
      "display_name": "Featured Article"
    },
    {
      "data_type": "boolean",
      "uid": "is_syndicated",
      "display_name": "Syndicated Content"
    }
  ]
}
```

### 3. Create Default Sites

In Contentstack dashboard, create entries for each site:

**Tech News Site**
```json
{
  "site_id": "tech-news",
  "site_name": "Tech News Daily",
  "site_url": "https://news.yourdomain.com/tech",
  "primary_color": "#0284c7",
  "description": "Latest technology and innovation news"
}
```

**World News Site**
```json
{
  "site_id": "world-news",
  "site_name": "World News Hub",
  "site_url": "https://news.yourdomain.com/world",
  "primary_color": "#6366f1",
  "description": "Global news and international coverage"
}
```

**Sports News Site**
```json
{
  "site_id": "sports-news",
  "site_name": "Sports Central",
  "site_url": "https://news.yourdomain.com/sports",
  "primary_color": "#dc2626",
  "description": "Sports news and match updates"
}
```

---

## API Keys & Secrets Management

### Contentstack API Keys

1. **Go to Contentstack Dashboard** → Settings → Tokens
2. **Create a Delivery Token** (for reading content)
   - Name: `prod-delivery-token`
   - Environment: Production
   - Expires: Never
   - Copy the token to `.env.production`

3. **Create a Management Token** (for writing content, optional)
   - Name: `prod-management-token`
   - Scopes: Create, Read, Update, Delete on all content types
   - Expires: Never

### NewsAPI.org Keys

1. **Visit** https://newsapi.org
2. **Sign up** for a free account (25 requests/day) or paid tier
3. **Get your API key** from dashboard
4. **Set in environment**: `NEWS_API_KEY=your_key`

### GitHub Secrets (for automated entry generation)

Set these in GitHub repository settings → Secrets:

```
CONTENTSTACK_API_KEY = your_contentstack_api_key
CONTENTSTACK_DELIVERY_TOKEN = your_delivery_token
CONTENTSTACK_STACK_API_HOST = https://api.contentstack.io (default)
NEWS_API_KEY = your_newsapi_key
LAUNCH_SITE_URL = https://news.yourdomain.com
```

---

## Database Setup

### Local Development (SQLite)
```bash
# Create database (automatic with init script)
node scripts/init-database.mjs

# Seed with sample data
node scripts/seed-database.mjs
```

### Production (PostgreSQL/MongoDB)

#### Option 1: PostgreSQL
```bash
# Install PostgreSQL and create database
createdb news_platform_prod

# Set connection string
DATABASE_URL=postgresql://user:password@localhost:5432/news_platform_prod

# Run migrations
npx knex migrate:latest --env production
```

#### Option 2: MongoDB
```bash
# Set connection string
MONGODB_URI=mongodb+srv://user:password@cluster.mongodb.net/news_platform

# Collections created automatically on first write
```

---

## CI/CD Pipeline

### GitHub Actions Workflow

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy News Platform

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

env:
  VITE_CONTENTSTACK_API_KEY: ${{ secrets.CONTENTSTACK_API_KEY }}
  VITE_CONTENTSTACK_DELIVERY_TOKEN: ${{ secrets.CONTENTSTACK_DELIVERY_TOKEN }}
  NEWS_API_KEY: ${{ secrets.NEWS_API_KEY }}

jobs:
  build:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '24'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm install
      
      - name: Lint
        run: npm run lint
      
      - name: Test
        run: npm run test:ci
      
      - name: Build
        run: npm run build
      
      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/coverage-final.json

  deploy:
    needs: build
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '24'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm install
      
      - name: Build
        run: npm run build
      
      - name: Deploy to Vercel
        run: npx vercel --prod --token ${{ secrets.VERCEL_TOKEN }}
        env:
          VITE_CONTENTSTACK_API_KEY: ${{ secrets.CONTENTSTACK_API_KEY }}
          VITE_CONTENTSTACK_DELIVERY_TOKEN: ${{ secrets.CONTENTSTACK_DELIVERY_TOKEN }}
          NEWS_API_KEY: ${{ secrets.NEWS_API_KEY }}

  fetch-news:
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '24'
          cache: 'npm'
      
      - name: Fetch news entries
        run: node scripts/fetch-news-entries.mjs
        env:
          CONTENTSTACK_API_KEY: ${{ secrets.CONTENTSTACK_API_KEY }}
          CONTENTSTACK_DELIVERY_TOKEN: ${{ secrets.CONTENTSTACK_DELIVERY_TOKEN }}
          NEWS_API_KEY: ${{ secrets.NEWS_API_KEY }}
          LAUNCH_SITE_URL: ${{ secrets.LAUNCH_SITE_URL }}
```

### Automated News Fetching

Create `.github/workflows/fetch-news.yml`:

```yaml
name: Fetch News Entries

on:
  schedule:
    # Run every 4 hours
    - cron: '0 */4 * * *'
  workflow_dispatch:

jobs:
  fetch:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '24'
      
      - name: Fetch news
        run: node scripts/fetch-news-entries.mjs
        env:
          CONTENTSTACK_API_KEY: ${{ secrets.CONTENTSTACK_API_KEY }}
          NEWS_API_KEY: ${{ secrets.NEWS_API_KEY }}
          LAUNCH_SITE_URL: ${{ secrets.LAUNCH_SITE_URL }}
      
      - name: Commit changes
        run: |
          git config user.name "News Bot"
          git config user.email "bot@news.local"
          git add run-history.json
          git commit -m "⚙️ Auto: Fetch news entries"
          git push
        if: failure() == false
```

---

## Docker Deployment

### Dockerfile
```dockerfile
FROM node:24-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install --production

# Copy source
COPY . .

# Build
RUN npm run build

# Use lightweight HTTP server
FROM node:24-alpine
WORKDIR /app
RUN npm install -g serve
COPY --from=0 /app/dist ./dist

EXPOSE 3000

CMD ["serve", "-s", "dist", "-l", "3000"]
```

### Docker Compose
```yaml
version: '3.8'

services:
  news-platform:
    build: .
    ports:
      - "3000:3000"
    environment:
      VITE_CONTENTSTACK_API_KEY: ${CONTENTSTACK_API_KEY}
      VITE_CONTENTSTACK_DELIVERY_TOKEN: ${CONTENTSTACK_DELIVERY_TOKEN}
      NEWS_API_KEY: ${NEWS_API_KEY}
    networks:
      - news-network

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./ssl:/etc/nginx/ssl:ro
    networks:
      - news-network
    depends_on:
      - news-platform

networks:
  news-network:
    driver: bridge
```

---

## Performance Optimization

### Caching Strategy

1. **Browser Caching**
   - Static assets: 1 year
   - HTML: No cache
   - API responses: 5 minutes

2. **CDN Setup (CloudFront)**
   ```bash
   # Deploy to CloudFront
   aws cloudfront create-invalidation \
     --distribution-id E123EXAMPLE \
     --paths "/*"
   ```

3. **Image Optimization**
   ```javascript
   // Use Imgix for image serving
   <img src="https://your-domain.imgix.net/path/to/image.jpg?w=400&h=300&fit=crop" />
   ```

### Code Splitting
```javascript
// React Router lazy loading
const NewsHomepage = lazy(() => import('./pages/NewsHomepage'))
const NewsArticle = lazy(() => import('./pages/NewsArticle'))
const NewsSearch = lazy(() => import('./pages/NewsSearch'))

// In routes:
<Suspense fallback={<Loading />}>
  <Route path="/news" element={<NewsHomepage />} />
</Suspense>
```

### Bundle Analysis
```bash
npm install --save-dev rollup-plugin-visualizer

# Generate report
npm run build -- --analyze
```

---

## Monitoring & Logging

### Google Analytics Setup
```javascript
// In main.jsx
import ReactGA from 'react-ga4'

ReactGA.initialize(process.env.VITE_GOOGLE_ANALYTICS_ID)
```

### Error Tracking (Sentry)
```bash
npm install @sentry/react @sentry/tracing

# Initialize in main.jsx
import * as Sentry from "@sentry/react"

Sentry.init({
  dsn: process.env.VITE_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1
})
```

### Logging Service
```bash
# Use structured logging
npm install winston

# Configure in services/logger.js
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
})
```

---

## Deployment Checklist

### Pre-Deployment
- [ ] All tests passing
- [ ] Code review completed
- [ ] Environment variables configured
- [ ] Contentstack stack initialized
- [ ] API keys generated and secured
- [ ] Database migrations run
- [ ] Build optimized (checked bundle size)
- [ ] Performance tested (Lighthouse score > 90)
- [ ] SEO meta tags configured
- [ ] SSL certificate installed

### Deployment
- [ ] Production build verified
- [ ] Docker image built and tested
- [ ] Health checks configured
- [ ] Database backups set up
- [ ] Monitoring/alerts configured
- [ ] CDN cache cleared
- [ ] DNS updated
- [ ] SSL/TLS verified

### Post-Deployment
- [ ] Live site smoke tests pass
- [ ] Analytics working
- [ ] Error tracking enabled
- [ ] Monitoring dashboards active
- [ ] Backup automated
- [ ] Team notified
- [ ] Rollback plan ready
- [ ] User acceptance testing scheduled

---

## Scaling Considerations

### Horizontal Scaling
- Containerize with Docker
- Use container orchestration (K8s)
- Load balance traffic
- Scale news fetcher as separate worker

### Database Scaling
- Read replicas for queries
- Write master for mutations
- Implement caching layer (Redis)
- Archive old articles

### CDN Strategy
- Serve all static assets via CDN
- Cache HTML at edge
- Geo-distributed origins

---

## Troubleshooting

### Build Failures
```bash
# Clear cache and rebuild
rm -rf node_modules dist .next
npm install
npm run build
```

### API Connection Issues
```bash
# Test Contentstack connectivity
curl -H "api_key: YOUR_KEY" \
  -H "access_token: YOUR_TOKEN" \
  "https://api.contentstack.io/v3/content_types/article/entries"
```

### Memory Issues on Large Deployments
```bash
# Increase Node memory limit
NODE_OPTIONS="--max-old-space-size=4096" npm run build
```

---

## Support & Resources

- **Contentstack Docs**: https://www.contentstack.com/docs/
- **NewsAPI Docs**: https://newsapi.org/docs
- **Vite Guide**: https://vitejs.dev/guide/
- **React Router**: https://reactrouter.com/

