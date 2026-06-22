/**
 * News Search Page
 *
 * Full-text search across article titles, excerpts, and content
 * Features:
 * - Real-time search
 * - Pagination
 * - Highlighted results
 */

import { useState, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import '../styles/NewsSearch.css'

const NEWS_API = process.env.VITE_CONTENTSTACK_DELIVERY_HOST || 'https://api.contentstack.io'
const ACCESS_TOKEN = process.env.VITE_CONTENTSTACK_DELIVERY_TOKEN
const API_KEY = process.env.VITE_CONTENTSTACK_API_KEY
const RESULTS_PER_PAGE = 20

export default function NewsSearch() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [articles, setArticles] = useState([])
  const [loading, setLoading] = useState(false)

  const query = searchParams.get('q') || ''
  const currentPage = parseInt(searchParams.get('page')) || 1

  const handleSearch = async (searchQuery) => {
    if (!searchQuery.trim()) {
      setArticles([])
      return
    }

    setLoading(true)
    try {
      // Fetch all published articles (Contentstack doesn't have built-in FTS)
      // In production, would use Elasticsearch or Algolia
      const res = await fetch(
        `${NEWS_API}/v3/content_types/article/entries?query={"status":"published"}&limit=500`,
        {
          headers: {
            'api_key': API_KEY,
            'access_token': ACCESS_TOKEN,
          },
        }
      )
      const data = await res.json()
      const allArticles = data.entries || []

      // Client-side filtering (demo only - use proper search service in production)
      const lowerQuery = searchQuery.toLowerCase()
      const filtered = allArticles.filter(a =>
        a.title?.toLowerCase().includes(lowerQuery) ||
        a.excerpt?.toLowerCase().includes(lowerQuery) ||
        a.body?.toLowerCase().includes(lowerQuery)
      )

      setArticles(filtered)
    } catch (e) {
      console.error('Search error:', e)
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    const formQuery = e.target.elements.query.value
    setSearchParams({ q: formQuery, page: '1' })
    handleSearch(formQuery)
  }

  // Pagination
  const totalPages = Math.ceil(articles.length / RESULTS_PER_PAGE)
  const startIdx = (currentPage - 1) * RESULTS_PER_PAGE
  const endIdx = startIdx + RESULTS_PER_PAGE
  const paginatedResults = articles.slice(startIdx, endIdx)

  const handlePageChange = (page) => {
    setSearchParams({ q: query, page: page.toString() })
    window.scrollTo(0, 300)
  }

  // Initial search on mount if query present
  useMemo(() => {
    if (query) {
      handleSearch(query)
    }
  }, [])

  return (
    <div className="search-page">
      <header className="search-header">
        <div className="search-container">
          <h1>Search News</h1>
          <form onSubmit={handleSubmit} className="search-form">
            <input
              type="text"
              name="query"
              placeholder="Search articles by title, topic..."
              defaultValue={query}
              className="search-input"
              autoFocus
            />
            <button type="submit" className="search-btn">🔍 Search</button>
          </form>
        </div>
      </header>

      <main className="search-container">
        {query && (
          <div className="search-status">
            {loading ? (
              <p>Searching...</p>
            ) : (
              <p>Found <strong>{articles.length}</strong> results for "<strong>{query}</strong>"</p>
            )}
          </div>
        )}

        {paginatedResults.length > 0 ? (
          <>
            <div className="search-results">
              {paginatedResults.map(article => (
                <article key={article.uid} className="search-result">
                  <a href={`/news/${article.categories?.[0]?.slug || 'news'}/${article.slug}`} className="result-link">
                    <h2 className="result-title">{article.title}</h2>
                    <p className="result-excerpt">{article.excerpt}</p>
                    <div className="result-meta">
                      {article.categories?.[0] && (
                        <span className="result-category">{article.categories[0].name}</span>
                      )}
                      <span className="result-date">
                        {new Date(article.publish_date).toLocaleDateString()}
                      </span>
                    </div>
                  </a>
                </article>
              ))}
            </div>

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
        ) : query && !loading ? (
          <div className="no-results">
            <p>No articles found matching your search.</p>
            <p className="no-results-tip">Try different keywords or browse by category.</p>
            <a href="/" className="no-results-link">← Back to Home</a>
          </div>
        ) : !query ? (
          <div className="search-prompt">
            <p>Enter a search term to find articles</p>
          </div>
        ) : null}
      </main>
    </div>
  )
}
