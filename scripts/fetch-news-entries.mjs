#!/usr/bin/env node
/**
 * Fetch Real News from NewsAPI + RSS Feeds
 *
 * Runs on each drive-all cycle to fetch latest news, create Article entries,
 * and Author entries as needed. Uses the Contentstack Management API.
 *
 * Environment variables:
 *   CONTENTSTACK_MANAGEMENT_TOKEN — required
 *   CONTENTSTACK_API_KEY — required
 *   NEWS_API_KEY — required (from newsapi.org, 25 requests/day free)
 *   INSTANCE — site_id to fetch news for (e.g., "tech-news", "world-news")
 *   RUN_REPORT_DIR — where to write KPI report (from drive-all)
 */

import fetch from 'node:fetch'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import Parser from 'rss-parser'

const MANAGEMENT_TOKEN = process.env.CONTENTSTACK_MANAGEMENT_TOKEN
const API_KEY = process.env.CONTENTSTACK_API_KEY
const NEWS_API_KEY = process.env.NEWS_API_KEY
const INSTANCE = process.env.INSTANCE || 'tech-news'
const RUN_REPORT_DIR = process.env.RUN_REPORT_DIR || '/tmp'

const CONTENTSTACK_API = 'https://api.contentstack.io/v3'
const NEWS_API = 'https://newsapi.org/v2'

// News sources per site
const SOURCES = {
  'tech-news': {
    newsapi_queries: ['technology', 'AI', 'startup'],
    rss_feeds: [
      'https://feeds.arstechnica.com/arstechnica/index',
      'https://news.ycombinator.com/rss',
    ],
  },
  'world-news': {
    newsapi_queries: ['world', 'international'],
    rss_feeds: [
      'http://feeds.bbc.co.uk/news/world/rss.xml',
      'https://www.theguardian.com/world/rss',
    ],
  },
  'sports-news': {
    newsapi_queries: ['sports', 'football', 'basketball'],
    rss_feeds: [
      'https://feeds.espn.com/espn/rss_news.xml',
    ],
  },
}

const config = SOURCES[INSTANCE] || SOURCES['tech-news']

// ─────────────────────────────────────────────────────────────────

class NewsGenerator {
  constructor() {
    this.kpis = {
      articles_fetched: 0,
      articles_created: 0,
      articles_deduplicated: 0,
      authors_created: 0,
      authors_found: 0,
      images_processed: 0,
      fetch_errors: 0,
    }
    this.authors = new Map() // authorName → entry uid
    this.seenArticles = new Set() // hash of title+source
    this.parser = new Parser()
  }

  // Hash for deduplication
  hashArticle(title, sourceUrl) {
    const hash = require('crypto').createHash('sha256')
    hash.update(`${title}|${sourceUrl}`)
    return hash.digest('hex').slice(0, 12)
  }

  // Fetch from NewsAPI
  async fetchFromNewsAPI() {
    console.log(`\n📰 Fetching from NewsAPI for: ${config.newsapi_queries.join(', ')}`)
    const articles = []

    for (const query of config.newsapi_queries) {
      try {
        const url = `${NEWS_API}/everything?q=${encodeURIComponent(query)}&sortBy=publishedAt&language=en&pageSize=20`
        const res = await fetch(url, {
          headers: { 'User-Agent': 'NewsBot/1.0' },
        })

        if (!res.ok) {
          if (res.status === 429) {
            console.warn('  ⚠️  Rate limited by NewsAPI (25 requests/day reached)')
            this.kpis.fetch_errors++
            break
          }
          throw new Error(`HTTP ${res.status}`)
        }

        const data = await res.json()
        if (data.articles) {
          articles.push(...data.articles)
          console.log(`  ✓ ${query}: ${data.articles.length} articles`)
        }
      } catch (e) {
        console.warn(`  ✗ Error fetching "${query}": ${e.message}`)
        this.kpis.fetch_errors++
      }
    }

    this.kpis.articles_fetched += articles.length
    return articles
  }

  // Fetch from RSS feeds
  async fetchFromRSS() {
    console.log(`\n📡 Fetching from RSS feeds (${config.rss_feeds.length})`)
    const articles = []

    for (const feedUrl of config.rss_feeds) {
      try {
        const feed = await this.parser.parseURL(feedUrl)
        const feedArticles = (feed.items || []).slice(0, 10).map(item => ({
          source: { name: feed.title || 'Unknown' },
          title: item.title,
          description: item.contentSnippet || item.summary,
          content: item.content || item.description,
          url: item.link,
          urlToImage: item.enclosure?.url || item.image?.url,
          author: item.creator || feed.author,
          publishedAt: new Date(item.pubDate).toISOString(),
        }))
        articles.push(...feedArticles)
        console.log(`  ✓ ${feed.title}: ${feedArticles.length} articles`)
      } catch (e) {
        console.warn(`  ✗ Error parsing ${feedUrl}: ${e.message}`)
        this.kpis.fetch_errors++
      }
    }

    this.kpis.articles_fetched += articles.length
    return articles
  }

  // Find or create author
  async ensureAuthor(authorName) {
    if (!authorName || authorName.trim() === '') {
      return null
    }

    const cleanName = authorName.trim()
    if (this.authors.has(cleanName)) {
      this.kpis.authors_found++
      return this.authors.get(cleanName)
    }

    // Create author entry
    try {
      const slug = cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '-')
      const res = await fetch(`${CONTENTSTACK_API}/content_types/author/entries`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'authorization': MANAGEMENT_TOKEN,
          'api_key': API_KEY,
        },
        body: JSON.stringify({
          entry: {
            title: cleanName,
            name: cleanName,
            slug: slug,
            bio: '',
            verified: false,
          },
        }),
      })

      if (res.ok) {
        const data = await res.json()
        const uid = data.entry.uid
        this.authors.set(cleanName, uid)
        this.kpis.authors_created++
        console.log(`    → Created author: ${cleanName}`)
        return uid
      } else {
        console.warn(`    ⚠️  Failed to create author: ${res.status}`)
        return null
      }
    } catch (e) {
      console.warn(`    ✗ Error creating author: ${e.message}`)
      return null
    }
  }

  // Create article entry
  async createArticle(article, authorUid, categoryUid) {
    const title = article.title || 'Untitled'
    const hash = this.hashArticle(title, article.url)

    if (this.seenArticles.has(hash)) {
      this.kpis.articles_deduplicated++
      return false
    }

    this.seenArticles.add(hash)

    try {
      const slug = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .slice(0, 60)

      const excerpt = (article.description || article.content || '').slice(0, 200)
      const body = `${article.content || article.description || ''}\n\n[Read full article](${article.url})`

      const entry = {
        title: title,
        slug: slug,
        excerpt: excerpt,
        body: body,
        site: INSTANCE,
        source_url: article.url,
        source_name: article.source?.name || 'Unknown',
        publish_date: article.publishedAt,
        status: 'draft',
        is_syndicated: true,
      }

      // Add author if available
      if (authorUid) {
        entry.author = authorUid
      }

      // Add category if available
      if (categoryUid) {
        entry.categories = [categoryUid]
      }

      const res = await fetch(`${CONTENTSTACK_API}/content_types/article/entries`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'authorization': MANAGEMENT_TOKEN,
          'api_key': API_KEY,
        },
        body: JSON.stringify({ entry }),
      })

      if (res.ok) {
        this.kpis.articles_created++
        console.log(`  ✓ Created: "${title.slice(0, 50)}..."`)
        return true
      } else {
        const err = await res.text()
        console.warn(`  ✗ Failed to create "${title}": ${res.status}`)
        console.warn(`    ${err.slice(0, 100)}`)
        return false
      }
    } catch (e) {
      console.warn(`  ✗ Error creating article: ${e.message}`)
      return false
    }
  }

  async run() {
    console.log(`\n${'='.repeat(60)}`)
    console.log(`🔄 Fetching news for site: ${INSTANCE}`)
    console.log(`${'='.repeat(60)}`)

    if (!MANAGEMENT_TOKEN || !API_KEY) {
      console.error('✗ Missing CONTENTSTACK_MANAGEMENT_TOKEN or CONTENTSTACK_API_KEY')
      process.exit(1)
    }

    // Fetch all articles
    const newsApiArticles = NEWS_API_KEY ? await this.fetchFromNewsAPI() : []
    const rssArticles = await this.fetchFromRSS()
    const allArticles = [...newsApiArticles, ...rssArticles]

    console.log(`\n📊 Total articles fetched: ${allArticles.length}`)

    // Dedup by URL
    const byUrl = new Map()
    for (const article of allArticles) {
      if (!byUrl.has(article.url)) {
        byUrl.set(article.url, article)
      }
    }

    console.log(`📈 After URL dedup: ${byUrl.size} unique articles`)

    // Process each article
    let created = 0
    for (const article of byUrl.values()) {
      // Find/create author
      const authorUid = await this.ensureAuthor(article.author)

      // Determine category (simple heuristic: first keyword in title)
      // In real app, use ML classification or manual mapping
      const categoryUid = null // TODO: map to actual category

      // Create article entry
      const didCreate = await this.createArticle(article, authorUid, categoryUid)
      if (didCreate) created++

      // Rate limit to avoid hammering Contentstack
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    console.log(`\n${'='.repeat(60)}`)
    console.log(`✅ News fetch complete`)
    console.log(`${'='.repeat(60)}`)
    console.log(`Articles created: ${this.kpis.articles_created}`)
    console.log(`Articles deduplicated: ${this.kpis.articles_deduplicated}`)
    console.log(`Authors created: ${this.kpis.authors_created}`)
    console.log(`Fetch errors: ${this.kpis.fetch_errors}`)

    // Write report for drive-all
    const reportPath = resolve(RUN_REPORT_DIR, 'fetch-news-entries.json')
    writeFileSync(reportPath, JSON.stringify({
      kpis: this.kpis,
      created,
      failed: byUrl.size - created,
    }, null, 2))

    console.log(`\n📝 Report written to ${reportPath}`)
  }
}

// ─────────────────────────────────────────────────────────────────

const generator = new NewsGenerator()
generator.run().catch(err => {
  console.error('Fatal error:', err.message)
  process.exit(1)
})
