/**
 * News Article Detail Page
 *
 * Full article view with:
 * - Breadcrumb navigation
 * - Full content rendering
 * - Author info + bio
 * - Advanced social sharing
 * - Comment section
 * - Read next suggestion
 * - Related articles
 * - Time-to-read calculation
 */

import { useEffect, useState, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import Breadcrumb from '../components/Breadcrumb'
import ShareButtons from '../components/ShareButtons'
import ReadNext from '../components/ReadNext'
import CommentsSection from '../components/CommentsSection'
import '../styles/NewsArticle.css'

const NEWS_API = process.env.VITE_CONTENTSTACK_DELIVERY_HOST || 'https://api.contentstack.io'
const ACCESS_TOKEN = process.env.VITE_CONTENTSTACK_DELIVERY_TOKEN
const API_KEY = process.env.VITE_CONTENTSTACK_API_KEY

export default function NewsArticle() {
  const { category, slug } = useParams()
  const [article, setArticle] = useState(null)
  const [relatedArticles, setRelatedArticles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchArticle()
  }, [slug])

  const fetchArticle = async () => {
    try {
      setLoading(true)

      // Fetch article by slug
      const res = await fetch(
        `${NEWS_API}/v3/content_types/article/entries?query={"slug":"${slug}","status":"published"}&limit=1`,
        {
          headers: {
            'api_key': API_KEY,
            'access_token': ACCESS_TOKEN,
          },
        }
      )
      const data = await res.json()
      const art = data.entries?.[0]

      if (!art) {
        setError('Article not found')
        return
      }

      setArticle(art)

      // Increment view count (in real app, would call analytics service)
      updateViewCount(art.uid)

      // Fetch related articles (same category)
      if (art.categories?.length > 0) {
        const catId = art.categories[0].uid
        const relRes = await fetch(
          `${NEWS_API}/v3/content_types/article/entries?query={"categories.uid":"${catId}","uid":{"$ne":"${art.uid}"},"status":"published"}&sort=-publish_date&limit=6`,
          {
            headers: {
              'api_key': API_KEY,
              'access_token': ACCESS_TOKEN,
            },
          }
        )
        const relData = await relRes.json()
        setRelatedArticles(relData.entries || [])
      }

      setError('')
    } catch (e) {
      console.error('Failed to load article:', e)
      setError('Failed to load article. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const updateViewCount = async (articleUid) => {
    // In real app, would call analytics API or Contentstack webhook
    // For now, just log it
    console.log(`View recorded for article: ${articleUid}`)
  }

  const timeToRead = useMemo(() => {
    if (!article) return 0
    const text = article.body || ''
    const wordCount = text.split(/\s+/).length
    return Math.ceil(wordCount / 200) // 200 words per minute
  }, [article])

  if (loading) {
    return (
      <div className="article-page">
        <div className="loading">Loading article...</div>
      </div>
    )
  }

  if (error || !article) {
    return (
      <div className="article-page">
        <div className="error">{error}</div>
      </div>
    )
  }

  const articleUrl = typeof window !== 'undefined' ? window.location.href : ''

  const breadcrumbItems = [
    article.categories?.[0] ? {
      label: article.categories[0].name,
      url: `/news/category/${article.categories[0].slug}`
    } : null,
    {
      label: article.title,
      url: null
    }
  ].filter(Boolean)

  return (
    <div className="article-page">
      {/* Breadcrumb */}
      <div className="article-container breadcrumb-section">
        <Breadcrumb items={breadcrumbItems} />
      </div>

      {/* Header */}
      <header className="article-header">
        <div className="article-container">
          {article.categories?.[0] && (
            <span className="article-category">{article.categories[0].name}</span>
          )}
          <h1 className="article-title">{article.title}</h1>
          <p className="article-excerpt">{article.excerpt}</p>

          <div className="article-meta">
            <div className="meta-left">
              {article.author && (
                <div className="author-snippet">
                  {article.author.avatar && (
                    <img src={article.author.avatar.url} alt={article.author.name} className="author-avatar" />
                  )}
                  <div className="author-info">
                    <a href={`/news/author/${article.author.slug}`} className="author-name">
                      {article.author.name}
                    </a>
                    <div className="author-meta">
                      {new Date(article.publish_date).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                      })}
                      {' • '}
                      {timeToRead} min read
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Featured Image */}
      {article.featured_image && (
        <figure className="article-figure">
          <img src={article.featured_image.url} alt={article.title} />
          {article.featured_image_credit && (
            <figcaption>{article.featured_image_credit}</figcaption>
          )}
        </figure>
      )}

      {/* Main Content */}
      <main className="article-container article-content">
        <div className="article-body">
          <div className="rich-text">
            {article.body && <div dangerouslySetInnerHTML={{ __html: article.body }} />}
          </div>

          {/* Source attribution for syndicated content */}
          {article.is_syndicated && article.source_url && (
            <div className="source-attribution">
              <p>
                This article was originally published by <strong>{article.source_name || 'the original source'}</strong>.{' '}
                <a href={article.source_url} target="_blank" rel="noopener noreferrer">
                  Read the full article →
                </a>
              </p>
            </div>
          )}

          {/* Tags */}
          {article.tags && article.tags.length > 0 && (
            <div className="article-tags">
              <h3>Topics:</h3>
              <div className="tags-list">
                {article.tags.map(tag => (
                  <a key={tag.uid} href={`/news/tag/${tag.slug}`} className="tag-link">
                    {tag.name}
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <aside className="article-sidebar">
          {/* Author Card */}
          {article.author && (
            <div className="sidebar-card author-card">
              {article.author.avatar && (
                <img src={article.author.avatar.url} alt={article.author.name} />
              )}
              <h4>{article.author.name}</h4>
              {article.author.bio && <p>{article.author.bio}</p>}
              {article.author.verified && (
                <span className="verified-badge">✓ Verified</span>
              )}
              <a href={`/news/author/${article.author.slug}`} className="view-more">
                View profile →
              </a>
            </div>
          )}
        </aside>
      </main>

      {/* Advanced Share Options */}
      <div className="article-container">
        <ShareButtons
          articleUrl={articleUrl}
          articleTitle={article.title}
          articleExcerpt={article.excerpt}
        />
      </div>

      {/* Read Next Suggestion */}
      <ReadNext
        currentArticleUid={article.uid}
        categoryUid={article.categories?.[0]?.uid}
      />

      {/* Comments Section */}
      <CommentsSection
        articleUid={article.uid}
        articleTitle={article.title}
        articleUrl={articleUrl}
      />

      {/* Related Articles */}
      {relatedArticles.length > 0 && (
        <section className="related-section">
          <div className="article-container">
            <h2>Related Articles</h2>
            <div className="related-grid">
              {relatedArticles.map(art => (
                <article key={art.uid} className="related-card">
                  <a href={`/news/${art.categories?.[0]?.slug || 'news'}/${art.slug}`} className="related-link">
                    {art.featured_image && (
                      <img src={art.featured_image.url} alt={art.title} />
                    )}
                    <h3>{art.title}</h3>
                    <p>{art.excerpt}</p>
                  </a>
                </article>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
