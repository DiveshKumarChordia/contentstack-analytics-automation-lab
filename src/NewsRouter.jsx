/**
 * News Website Router
 *
 * Wires all news pages together with proper URL routing
 */

import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import NewsHomepage from './pages/NewsHomepage'
import NewsArticle from './pages/NewsArticle'
import NewsCategoryArchive from './pages/NewsCategoryArchive'
import NewsSearch from './pages/NewsSearch'
import NewsAuthor from './pages/NewsAuthor'
import NewsTag from './pages/NewsTag'
import News404 from './pages/News404'

export default function NewsRouter() {
  return (
    <Router>
      <Routes>
        {/* Homepage */}
        <Route path="/news" element={<NewsHomepage />} />
        <Route path="/news/" element={<NewsHomepage />} />

        {/* Search */}
        <Route path="/news/search" element={<NewsSearch />} />

        {/* Category Archive */}
        <Route path="/news/category/:categorySlug" element={<NewsCategoryArchive />} />

        {/* Article Detail */}
        <Route path="/news/:category/:slug" element={<NewsArticle />} />

        {/* Author Page */}
        <Route path="/news/author/:authorSlug" element={<NewsAuthor />} />

        {/* Tag Page */}
        <Route path="/news/tag/:tagSlug" element={<NewsTag />} />

        {/* 404 */}
        <Route path="/news/*" element={<News404 />} />
      </Routes>
    </Router>
  )
}

/**
 * URL Patterns
 *
 * /news                           → Homepage
 * /news/search?q=query            → Search results
 * /news/category/{slug}?page=2    → Category archive (paginated)
 * /news/{category}/{slug}         → Article detail
 * /news/author/{slug}?page=2      → Author page (paginated)
 * /news/tag/{slug}?page=2         → Tag page (paginated)
 * /news/anything-else             → 404
 */
