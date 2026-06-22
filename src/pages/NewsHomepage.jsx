/**
 * News Website Homepage
 *
 * Features:
 * - Featured article hero (large)
 * - Category sections with article grids
 * - Trending sidebar (most viewed this week)
 * - Newsletter signup
 */

import { useEffect, useState, useMemo } from 'react'
import '../styles/NewsHomepage.css'

const NEWS_API = process.env.VITE_CONTENTSTACK_DELIVERY_HOST || 'https://api.contentstack.io'
const ACCESS_TOKEN = process.env.VITE_CONTENTSTACK_DELIVERY_TOKEN
const API_KEY = process.env.VITE_CONTENTSTACK_API_KEY

export default function NewsHomepage() {
  const [site, setSite] = useState(null)
  const [featured, setFeatured] = useState(null)
  const [categories, setCategories] = useState([])
  const [articles, setArticles] = useState([])
  const [trending, setTrending] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const siteId = new URLSearchParams(window.location.search).get('site') || 'tech-news'

  useEffect(() => {
    fetchSiteData()
  }, [siteId])

  const fetchSiteData = async () => {
    try {
      setLoading(true)

      // Fetch site config
      const siteRes = await fetch(
        `${NEWS_API}/v3/content_types/site/entries?query={"site_id":"${siteId}"}&limit=1`,
        {
          headers: {
            'api_key': API_KEY,
            'access_token': ACCESS_TOKEN,
          },
        }
      )
      const siteData = await siteRes.json()
      setSite(siteData.entries?.[0])

      // Fetch categories
      const catRes = await fetch(
        `${NEWS_API}/v3/content_types/category/entries?query={"site.site_id":"${siteId}"}&limit=20`,
        {
          headers: {
            'api_key': API_KEY,
            'access_token': ACCESS_TOKEN,
          },
        }
      )
      const catData = await catRes.json()
      setCategories(catData.entries || [])

      // Fetch published articles
      const artRes = await fetch(
        `${NEWS_API}/v3/content_types/article/entries?query={"site":"${siteId}","status":"published"}&sort=-publish_date&limit=100`,
        {
          headers: {
            'api_key': API_KEY,
            'access_token': ACCESS_TOKEN,
          },
        }
      )
      const artData = await artRes.json()
      const allArticles = artData.entries || []

      // Find featured article
      const featuredArticle = allArticles.find(a => a.is_featured) || allArticles[0]
      setFeatured(featuredArticle)

      // Group by category and get trending
      setArticles(allArticles)
      setTrending(
        allArticles
          .sort((a, b) => (b.view_count || 0) - (a.view_count || 0))
          .slice(0, 5)
      )

      setError('')
    } catch (e) {
      console.error('Failed to load site:', e)
      setError('Failed to load news. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const categoryArticles = useMemo(() => {
    const grouped = {}
    for (const cat of categories) {
      grouped[cat.uid] = articles.filter(a =>
        a.categories?.some(c => c.uid === cat.uid)
      )
    }
    return grouped
  }, [categories, articles])

  if (loading) {
    return (
      <div className="news-page">
        <div className="loading">Loading news...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="news-page">
        <div className="error">{error}</div>
      </div>
    )
  }

  return (
    <div className="news-page">
      {/* Header */}
      <header className="news-header" style={site ? { borderBottomColor: site.primary_color } : {}}>
        <div className="news-container">
          <div className="news-logo">
            {site?.logo && <img src={site.logo.url} alt={site.site_name} />}
            <h1>{site?.site_name || 'News'}</h1>
          </div>
          <nav className="news-nav">
            <a href="/" className="nav-link">Home</a>
            {categories.map(cat => (
              <a key={cat.uid} href={`/news/category/${cat.slug}`} className="nav-link">
                {cat.name}
              </a>
            ))}
            <a href="/news/search" className="nav-link">Search</a>
          </nav>
        </div>
      </header>

      <main className="news-container">
        {/* Featured Article Hero */}
        {featured && (
          <section className="featured-hero">
            <a href={`/news/${featured.categories?.[0]?.slug || 'news'}/${featured.slug}`} className="featured-link">
              <img
                src={featured.featured_image?.url || 'https://via.placeholder.com/1200x400'}
                alt={featured.title}
                className="featured-image"
              />
              <div className="featured-overlay">
                <div className="featured-label">Featured</div>
                <h2 className="featured-title">{featured.title}</h2>
                <p className="featured-excerpt">{featured.excerpt}</p>
                <div className="featured-meta">
                  {featured.author && (
                    <span className="meta-author">By {featured.author.name}</span>
                  )}
                  <span className="meta-date">
                    {new Date(featured.publish_date).toLocaleDateString()}
                  </span>
                </div>
              </div>
            </a>
          </section>
        )}

        <div className="news-grid">
          {/* Main Content */}
          <section className="news-content">
            {/* Category Sections */}
            {categories.map(cat => {
              const catArticles = categoryArticles[cat.uid] || []
              if (catArticles.length === 0) return null

              return (
                <section key={cat.uid} className="category-section">
                  <div className="category-header">
                    <h2 className="category-title">
                      <span className="category-icon">{cat.icon || '📰'}</span>
                      {cat.name}
                    </h2>
                    <a href={`/news/category/${cat.slug}`} className="view-all">
                      View all →
                    </a>
                  </div>

                  <div className="articles-grid">
                    {catArticles.slice(0, 6).map(article => (
                      <ArticleCard key={article.uid} article={article} />
                    ))}
                  </div>
                </section>
              )
            })}
          </section>

          {/* Sidebar */}
          <aside className="news-sidebar">
            {/* Trending */}
            {trending.length > 0 && (
              <div className="sidebar-widget">
                <h3 className="widget-title">🔥 Trending</h3>
                <div className="trending-list">
                  {trending.map((article, idx) => (
                    <a
                      key={article.uid}
                      href={`/news/${article.categories?.[0]?.slug || 'news'}/${article.slug}`}
                      className="trending-item"
                    >
                      <span className="trending-number">{idx + 1}</span>
                      <span className="trending-title">{article.title}</span>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Newsletter */}
            <div className="sidebar-widget newsletter">
              <h3 className="widget-title">📧 Newsletter</h3>
              <p>Get the latest news delivered to your inbox.</p>
              <form className="newsletter-form" onSubmit={(e) => {
                e.preventDefault()
                alert('Newsletter signup coming soon!')
              }}>
                <input
                  type="email"
                  placeholder="Your email"
                  required
                  className="newsletter-input"
                />
                <button type="submit" className="newsletter-btn">Subscribe</button>
              </form>
            </div>

            {/* Site Info */}
            {site && (
              <div className="sidebar-widget">
                <h3 className="widget-title">About</h3>
                <p>{site.description}</p>
              </div>
            )}
          </aside>
        </div>
      </main>

      {/* Footer */}
      <footer className="news-footer" style={site ? { borderTopColor: site.primary_color } : {}}>
        <div className="news-container">
          <p>&copy; 2026 {site?.site_name}. All rights reserved.</p>
          <div className="footer-links">
            <a href="/news/about">About</a>
            <a href="/news/contact">Contact</a>
            <a href="/news/privacy">Privacy</a>
          </div>
        </div>
      </footer>
    </div>
  )
}

function ArticleCard({ article }) {
  return (
    <article className="article-card">
      <a href={`/news/${article.categories?.[0]?.slug || 'news'}/${article.slug}`} className="card-link">
        <div className="card-image">
          <img
            src={article.featured_image?.url || 'https://via.placeholder.com/300x200'}
            alt={article.title}
          />
          {article.categories?.[0] && (
            <span className="card-category">{article.categories[0].name}</span>
          )}
        </div>
        <div className="card-content">
          <h3 className="card-title">{article.title}</h3>
          <p className="card-excerpt">{article.excerpt}</p>
          <div className="card-meta">
            {article.author && (
              <span className="meta-author">By {article.author.name}</span>
            )}
            <span className="meta-date">
              {new Date(article.publish_date).toLocaleDateString()}
            </span>
          </div>
        </div>
      </a>
    </article>
  )
}
