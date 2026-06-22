/**
 * News Tag Page
 *
 * Articles filtered by a specific tag
 * Features:
 * - Tag description
 * - Paginated articles grid
 * - Related tags
 */

import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import '../styles/NewsTag.css'

const NEWS_API = process.env.VITE_CONTENTSTACK_DELIVERY_HOST || 'https://api.contentstack.io'
const ACCESS_TOKEN = process.env.VITE_CONTENTSTACK_DELIVERY_TOKEN
const API_KEY = process.env.VITE_CONTENTSTACK_API_KEY
const ARTICLES_PER_PAGE = 12

export default function NewsTag() {
  const { tagSlug } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const [tag, setTag] = useState(null)
  const [articles, setArticles] = useState([])
  const [relatedTags, setRelatedTags] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const currentPage = parseInt(searchParams.get('page')) || 1

  useEffect(() => {
    fetchTagAndArticles()
  }, [tagSlug])

  const fetchTagAndArticles = async () => {
    try {
      setLoading(true)

      // Fetch tag
      const tagRes = await fetch(
        `${NEWS_API}/v3/content_types/tag/entries?query={"slug":"${tagSlug}"}&limit=1`,
        {
          headers: {
            'api_key': API_KEY,
            'access_token': ACCESS_TOKEN,
          },
        }
      )
      const tagData = await tagRes.json()
      const tg = tagData.entries?.[0]
      setTag(tg)

      if (!tg) {
        setError('Tag not found')
        return
      }

      // Fetch all articles with this tag
      const artRes = await fetch(
        `${NEWS_API}/v3/content_types/article/entries?query={"tags.uid":"${tg.uid}","status":"published"}&sort=-publish_date&limit=200`,
        {
          headers: {
            'api_key': API_KEY,
            'access_token': ACCESS_TOKEN,
          },
        }
      )
      const artData = await artRes.json()
      const arts = artData.entries || []
      setArticles(arts)

      // Extract related tags from articles
      const tagSet = new Set()
      for (const art of arts) {
        for (const t of art.tags || []) {
          if (t.uid !== tg.uid) {
            tagSet.add(JSON.stringify({ uid: t.uid, name: t.name, slug: t.slug }))
          }
        }
      }
      setRelatedTags(
        Array.from(tagSet)
          .map(t => JSON.parse(t))
          .slice(0, 8) // Top 8 related tags
      )

      setError('')
    } catch (e) {
      console.error('Failed to load tag:', e)
      setError('Failed to load tag. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const totalPages = Math.ceil(articles.length / ARTICLES_PER_PAGE)
  const startIdx = (currentPage - 1) * ARTICLES_PER_PAGE
  const paginatedArticles = articles.slice(startIdx, startIdx + ARTICLES_PER_PAGE)

  const handlePageChange = (page) => {
    setSearchParams({ page: page.toString() })
    window.scrollTo(0, 0)
  }

  if (loading) {
    return (
      <div className="tag-page">
        <div className="loading">Loading tag...</div>
      </div>
    )
  }

  if (error || !tag) {
    return (
      <div className="tag-page">
        <div className="error">{error}</div>
      </div>
    )
  }

  return (
    <div className="tag-page">
      {/* Tag Header */}
      <header className="tag-header">
        <div className="tag-container">
          <a href="/" className="back-link">← Back to News</a>

          <div className="tag-info">
            <h1 className="tag-name">{tag.name}</h1>
            {tag.description && (
              <p className="tag-description">{tag.description}</p>
            )}
            <div className="tag-meta">
              <span className="article-count">
                {articles.length} {articles.length === 1 ? 'article' : 'articles'}
              </span>
            </div>
          </div>
        </div>
      </header>

      <main className="tag-container">
        {/* Articles Grid */}
        {paginatedArticles.length > 0 ? (
          <>
            <div className="articles-grid">
              {paginatedArticles.map(article => (
                <article key={article.uid} className="article-card">
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
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="pagination">
                <button
                  className="pagination-btn"
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                >
                  ← Previous
                </button>
                <span className="pagination-info">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  className="pagination-btn"
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage === totalPages}
                >
                  Next →
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="no-articles">
            <p>No articles with this tag yet.</p>
          </div>
        )}

        {/* Related Tags */}
        {relatedTags.length > 0 && (
          <aside className="related-tags-section">
            <h3>Related Topics</h3>
            <div className="related-tags">
              {relatedTags.map(t => (
                <a key={t.uid} href={`/news/tag/${t.slug}`} className="related-tag">
                  {t.name}
                </a>
              ))}
            </div>
          </aside>
        )}
      </main>
    </div>
  )
}
