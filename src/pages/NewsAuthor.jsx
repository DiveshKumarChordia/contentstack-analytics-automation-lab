/**
 * News Author Page
 *
 * Author profile with all their articles
 * Features:
 * - Author bio, avatar, verified status
 * - Social links
 * - Paginated articles grid
 */

import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import '../styles/NewsAuthor.css'

const NEWS_API = process.env.VITE_CONTENTSTACK_DELIVERY_HOST || 'https://api.contentstack.io'
const ACCESS_TOKEN = process.env.VITE_CONTENTSTACK_DELIVERY_TOKEN
const API_KEY = process.env.VITE_CONTENTSTACK_API_KEY
const ARTICLES_PER_PAGE = 12

export default function NewsAuthor() {
  const { authorSlug } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const [author, setAuthor] = useState(null)
  const [articles, setArticles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const currentPage = parseInt(searchParams.get('page')) || 1

  useEffect(() => {
    fetchAuthorAndArticles()
  }, [authorSlug])

  const fetchAuthorAndArticles = async () => {
    try {
      setLoading(true)

      // Fetch author
      const authorRes = await fetch(
        `${NEWS_API}/v3/content_types/author/entries?query={"slug":"${authorSlug}"}&limit=1`,
        {
          headers: {
            'api_key': API_KEY,
            'access_token': ACCESS_TOKEN,
          },
        }
      )
      const authorData = await authorRes.json()
      const auth = authorData.entries?.[0]
      setAuthor(auth)

      if (!auth) {
        setError('Author not found')
        return
      }

      // Fetch all articles by this author
      const artRes = await fetch(
        `${NEWS_API}/v3/content_types/article/entries?query={"author.uid":"${auth.uid}","status":"published"}&sort=-publish_date&limit=200`,
        {
          headers: {
            'api_key': API_KEY,
            'access_token': ACCESS_TOKEN,
          },
        }
      )
      const artData = await artRes.json()
      setArticles(artData.entries || [])
      setError('')
    } catch (e) {
      console.error('Failed to load author:', e)
      setError('Failed to load author. Please try again.')
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
      <div className="author-page">
        <div className="loading">Loading author profile...</div>
      </div>
    )
  }

  if (error || !author) {
    return (
      <div className="author-page">
        <div className="error">{error}</div>
      </div>
    )
  }

  return (
    <div className="author-page">
      {/* Author Header */}
      <header className="author-header">
        <div className="author-container">
          <a href="/" className="back-link">← Back to News</a>

          <div className="author-profile">
            {author.avatar && (
              <img src={author.avatar.url} alt={author.name} className="author-avatar" />
            )}

            <div className="author-details">
              <div className="author-name-block">
                <h1 className="author-name">{author.name}</h1>
                {author.verified && (
                  <span className="verified-badge">✓ Verified Author</span>
                )}
              </div>

              {author.bio && (
                <p className="author-bio">{author.bio}</p>
              )}

              <div className="author-meta">
                <span className="article-count">
                  {articles.length} {articles.length === 1 ? 'article' : 'articles'}
                </span>
              </div>

              {/* Social Links */}
              <div className="author-social">
                {author.email && (
                  <a href={`mailto:${author.email}`} className="social-link" title="Email">
                    ✉️
                  </a>
                )}
                {author.twitter && (
                  <a href={`https://twitter.com/${author.twitter}`} target="_blank" rel="noopener noreferrer" className="social-link" title="Twitter">
                    𝕏
                  </a>
                )}
                {author.linkedin && (
                  <a href={author.linkedin} target="_blank" rel="noopener noreferrer" className="social-link" title="LinkedIn">
                    in
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Articles */}
      <main className="author-container">
        {paginatedArticles.length > 0 ? (
          <>
            <h2 className="articles-heading">Latest Articles</h2>

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
                        <span className="meta-date">
                          {new Date(article.publish_date).toLocaleDateString()}
                        </span>
                        {article.reading_time_minutes && (
                          <span className="meta-read-time">
                            {article.reading_time_minutes} min read
                          </span>
                        )}
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
            <p>No articles published yet.</p>
          </div>
        )}
      </main>
    </div>
  )
}
