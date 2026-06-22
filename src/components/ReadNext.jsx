/**
 * Read Next Component
 *
 * Suggests the next article to read
 * Appears at bottom of article, before comments
 */

import { useEffect, useState } from 'react'
import '../styles/ReadNext.css'

const NEWS_API = process.env.VITE_CONTENTSTACK_DELIVERY_HOST || 'https://api.contentstack.io'
const ACCESS_TOKEN = process.env.VITE_CONTENTSTACK_DELIVERY_TOKEN
const API_KEY = process.env.VITE_CONTENTSTACK_API_KEY

export default function ReadNext({ currentArticleUid, categoryUid }) {
  const [nextArticle, setNextArticle] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (categoryUid && currentArticleUid) {
      fetchNextArticle()
    }
  }, [currentArticleUid, categoryUid])

  const fetchNextArticle = async () => {
    try {
      setLoading(true)

      const res = await fetch(
        `${NEWS_API}/v3/content_types/article/entries?query={"categories.uid":"${categoryUid}","uid":{"$ne":"${currentArticleUid}"},"status":"published"}&sort=-publish_date&limit=1`,
        {
          headers: {
            'api_key': API_KEY,
            'access_token': ACCESS_TOKEN,
          },
        }
      )
      const data = await res.json()
      const article = data.entries?.[0]

      if (article) {
        setNextArticle(article)
      }
    } catch (e) {
      console.error('Failed to fetch next article:', e)
    } finally {
      setLoading(false)
    }
  }

  if (loading || !nextArticle) {
    return null
  }

  const categorySlug = nextArticle.categories?.[0]?.slug || 'news'

  return (
    <section className="read-next">
      <div className="read-next-container">
        <h3 className="read-next-title">📖 Read Next</h3>
        <a href={`/news/${categorySlug}/${nextArticle.slug}`} className="read-next-card">
          <div className="read-next-image">
            <img
              src={nextArticle.featured_image?.url || 'https://via.placeholder.com/400x200'}
              alt={nextArticle.title}
            />
          </div>
          <div className="read-next-content">
            <h4 className="read-next-article-title">{nextArticle.title}</h4>
            <p className="read-next-excerpt">{nextArticle.excerpt}</p>
            <div className="read-next-meta">
              {nextArticle.author && (
                <span className="read-next-author">By {nextArticle.author.name}</span>
              )}
              <span className="read-next-date">
                {new Date(nextArticle.publish_date).toLocaleDateString()}
              </span>
            </div>
            <span className="read-next-cta">Continue Reading →</span>
          </div>
        </a>
      </div>
    </section>
  )
}
