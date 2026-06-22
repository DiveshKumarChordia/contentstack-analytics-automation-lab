/**
 * Comments Section Component
 *
 * Supports:
 * - Built-in comment form + display
 * - Disqus integration (optional)
 * - Comment moderation status
 */

import { useEffect, useState } from 'react'
import '../styles/CommentsSection.css'

export default function CommentsSection({ articleUid, articleTitle, articleUrl }) {
  const [comments, setComments] = useState([])
  const [newComment, setNewComment] = useState({ author: '', email: '', text: '' })
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [useDisqus] = useState(!!process.env.VITE_DISQUS_SHORTNAME)

  const DISQUS_SHORTNAME = process.env.VITE_DISQUS_SHORTNAME

  useEffect(() => {
    // Load built-in comments from localStorage (for demo)
    loadComments()

    // Load Disqus if configured
    if (useDisqus) {
      loadDisqus()
    }
  }, [articleUid])

  const loadComments = () => {
    try {
      const stored = localStorage.getItem(`comments-${articleUid}`)
      if (stored) {
        setComments(JSON.parse(stored))
      }
    } catch (e) {
      console.error('Failed to load comments:', e)
    }
  }

  const loadDisqus = () => {
    // Load Disqus script
    window.disqus_config = function () {
      this.page.url = articleUrl
      this.page.identifier = articleUid
      this.page.title = articleTitle
    }

    const script = document.createElement('script')
    script.src = `https://${DISQUS_SHORTNAME}.disqus.com/embed.js`
    script.async = true
    script.setAttribute('data-timestamp', new Date().getTime())
    document.body.appendChild(script)
  }

  const handleCommentSubmit = (e) => {
    e.preventDefault()

    if (!newComment.author || !newComment.email || !newComment.text) {
      alert('Please fill in all fields')
      return
    }

    setLoading(true)

    // Simulate API call
    setTimeout(() => {
      const comment = {
        id: Date.now(),
        author: newComment.author,
        email: newComment.email,
        text: newComment.text,
        date: new Date().toISOString(),
        approved: false, // Would be moderated in real app
      }

      const updated = [comment, ...comments]
      setComments(updated)

      // Save to localStorage (for demo)
      localStorage.setItem(`comments-${articleUid}`, JSON.stringify(updated))

      setNewComment({ author: '', email: '', text: '' })
      setSubmitted(true)
      setLoading(false)

      setTimeout(() => setSubmitted(false), 3000)
    }, 1000)
  }

  if (useDisqus) {
    return (
      <section className="comments-section">
        <div className="comments-container">
          <h3 className="comments-title">💬 Discussions</h3>
          <div id="disqus_thread"></div>
        </div>
      </section>
    )
  }

  return (
    <section className="comments-section">
      <div className="comments-container">
        <h3 className="comments-title">💬 Comments ({comments.length})</h3>

        {/* Comment Form */}
        <form className="comment-form" onSubmit={handleCommentSubmit}>
          <h4 className="form-title">Leave a Comment</h4>

          <div className="form-group">
            <input
              type="text"
              placeholder="Your Name"
              value={newComment.author}
              onChange={(e) => setNewComment({ ...newComment, author: e.target.value })}
              className="form-input"
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <input
              type="email"
              placeholder="Your Email"
              value={newComment.email}
              onChange={(e) => setNewComment({ ...newComment, email: e.target.value })}
              className="form-input"
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <textarea
              placeholder="Your Comment"
              value={newComment.text}
              onChange={(e) => setNewComment({ ...newComment, text: e.target.value })}
              className="form-textarea"
              rows="4"
              disabled={loading}
            ></textarea>
          </div>

          <button type="submit" className="form-submit" disabled={loading}>
            {loading ? 'Posting...' : 'Post Comment'}
          </button>

          {submitted && (
            <div className="success-message">
              ✅ Comment posted! Awaiting moderation.
            </div>
          )}
        </form>

        {/* Comments List */}
        {comments.length > 0 && (
          <div className="comments-list">
            {comments.map((comment) => (
              <article key={comment.id} className="comment">
                <div className="comment-header">
                  <strong className="comment-author">{comment.author}</strong>
                  <time className="comment-date">
                    {new Date(comment.date).toLocaleDateString()}
                  </time>
                  {!comment.approved && (
                    <span className="comment-status">Pending Moderation</span>
                  )}
                </div>
                <p className="comment-text">{comment.text}</p>
              </article>
            ))}
          </div>
        )}

        {comments.length === 0 && !submitted && (
          <p className="no-comments">No comments yet. Be the first to comment!</p>
        )}
      </div>
    </section>
  )
}
