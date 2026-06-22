/**
 * News Category Archive Page
 *
 * Paginated grid of articles in a specific category
 * Features:
 * - Pagination (20 articles per page)
 * - Sort by date, views, trending
 * - Date range filter
 * - Category header with description
 */

import { useEffect, useState, useMemo } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import '../styles/NewsCategoryArchive.css'

const NEWS_API = process.env.VITE_CONTENTSTACK_DELIVERY_HOST || 'https://api.contentstack.io'
const ACCESS_TOKEN = process.env.VITE_CONTENTSTACK_DELIVERY_TOKEN
const API_KEY = process.env.VITE_CONTENTSTACK_API_KEY
const ARTICLES_PER_PAGE = 20

export default function NewsCategoryArchive() {
  const { categorySlug } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const [category, setCategory] = useState(null)
  const [allArticles, setAllArticles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const currentPage = parseInt(searchParams.get('page')) || 1
  const sortBy = searchParams.get('sort') || 'latest'
  const dateFilter = searchParams.get('date') || 'all'

  useEffect(() => {
    fetchCategoryAndArticles()
  }, [categorySlug])

  const fetchCategoryAndArticles = async () => {
    try {
      setLoading(true)

      // Fetch category
      const catRes = await fetch(
        `${NEWS_API}/v3/content_types/category/entries?query={"slug":"${categorySlug}"}&limit=1`,
        {
          headers: {
            'api_key': API_KEY,
            'access_token': ACCESS_TOKEN,
          },
        }
      )
      const catData = await catRes.json()
      const cat = catData.entries?.[0]
      setCategory(cat)

      // Fetch all articles in this category
      const artRes = await fetch(
        `${NEWS_API}/v3/content_types/article/entries?query={"categories.uid":"${cat?.uid}","status":"published"}&sort=-publish_date&limit=200`,
        {
          headers: {
            'api_key': API_KEY,
            'access_token': ACCESS_TOKEN,
          },
        }
      )
      const artData = await artRes.json()
      setAllArticles(artData.entries || [])
      setError('')
    } catch (e) {
      console.error('Failed to load category:', e)
      setError('Failed to load articles. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // Filter and sort articles
  const filteredArticles = useMemo(() => {
    let articles = [...allArticles]

    // Apply date filter
    if (dateFilter !== 'all') {
      const now = new Date()
      let cutoff
      switch (dateFilter) {
        case '7d':
          cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
          break
        case '30d':
          cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
          break
        case 'year':
          cutoff = new Date(now.getFullYear(), 0, 1)
          break
        default:
          cutoff = null
      }

      if (cutoff) {
        articles = articles.filter(a => new Date(a.publish_date) >= cutoff)
      }
    }

    // Apply sort
    switch (sortBy) {
      case 'oldest':
        articles.sort((a, b) => new Date(a.publish_date) - new Date(b.publish_date))
        break
      case 'views':
        articles.sort((a, b) => (b.view_count || 0) - (a.view_count || 0))
        break
      case 'latest':
      default:
        articles.sort((a, b) => new Date(b.publish_date) - new Date(a.publish_date))
        break
    }

    return articles
  }, [allArticles, sortBy, dateFilter])

  // Pagination
  const totalPages = Math.ceil(filteredArticles.length / ARTICLES_PER_PAGE)
  const startIdx = (currentPage - 1) * ARTICLES_PER_PAGE
  const endIdx = startIdx + ARTICLES_PER_PAGE
  const paginatedArticles = filteredArticles.slice(startIdx, endIdx)

  const handleSort = (newSort) => {
    setSearchParams({ sort: newSort, date: dateFilter, page: '1' })
  }

  const handleDateFilter = (newDate) => {
    setSearchParams({ sort: sortBy, date: newDate, page: '1' })
  }

  const handlePageChange = (page) => {
    setSearchParams({ sort: sortBy, date: dateFilter, page: page.toString() })
    window.scrollTo(0, 0)
  }

  if (loading) {
    return (
      <div className="category-page">
        <div className="loading">Loading articles...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="category-page">
        <div className="error">{error}</div>
      </div>
    )
  }

  return (
    <div className="category-page">
      {/* Header */}
      <header className="category-header">
        <div className="category-container">
          <a href="/" className="back-link">← Back to News</a>
          <div className="category-badge">{category?.icon || '📰'}</div>
          <h1 className="category-title">{category?.name || 'Category'}</h1>
          {category?.description && (
            <p className="category-description">{category.description}</p>
          )}
          <div className="article-count">
            {filteredArticles.length} articles
          </div>
        </div>
      </header>

      {/* Controls */}
      <div className="category-container category-controls">
        <div className="controls-group">
          <label>Sort by:</label>
          <select value={sortBy} onChange={(e) => handleSort(e.target.value)}>
            <option value="latest">Latest</option>
            <option value="oldest">Oldest</option>
            <option value="views">Most Viewed</option>
          </select>
        </div>

        <div className="controls-group">
          <label>Date range:</label>
          <select value={dateFilter} onChange={(e) => handleDateFilter(e.target.value)}>
            <option value="all">All time</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="year">This year</option>
          </select>
        </div>
      </div>

      {/* Articles Grid */}
      <main className="category-container">
        {paginatedArticles.length > 0 ? (
          <>
            <div className="articles-grid">
              {paginatedArticles.map(article => (
                <article key={article.uid} className="article-card">
                  <a href={`/news/${category?.slug || 'news'}/${article.slug}`} className="card-link">
                    <div className="card-image">
                      <img
                        src={article.featured_image?.url || 'https://via.placeholder.com/300x200'}
                        alt={article.title}
                      />
                    </div>
                    <div className="card-content">
                      <h2 className="card-title">{article.title}</h2>
                      <p className="card-excerpt">{article.excerpt}</p>
                      <div className="card-meta">
                        {article.author && (
                          <span className="meta-author">By {article.author.name}</span>
                        )}
                        <span className="meta-date">
                          {new Date(article.publish_date).toLocaleDateString()}
                        </span>
                        {article.view_count > 0 && (
                          <span className="meta-views">👁️ {article.view_count}</span>
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

                <div className="pagination-info">
                  Page {currentPage} of {totalPages}
                </div>

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
            <p>No articles found in this category.</p>
            <a href="/">← Back to News</a>
          </div>
        )}
      </main>
    </div>
  )
}
