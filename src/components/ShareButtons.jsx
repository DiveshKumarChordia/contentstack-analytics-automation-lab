/**
 * Advanced Share Buttons Component
 *
 * Features:
 * - Social sharing (Twitter, Facebook, LinkedIn, Reddit)
 * - Email sharing
 * - Copy link to clipboard
 * - Print article
 * - Share stats
 */

import { useState } from 'react'
import '../styles/ShareButtons.css'

export default function ShareButtons({ articleUrl, articleTitle, articleExcerpt }) {
  const [copied, setCopied] = useState(false)
  const [shareCount, setShareCount] = useState(0)

  const encodedUrl = encodeURIComponent(articleUrl)
  const encodedTitle = encodeURIComponent(articleTitle)
  const encodedExcerpt = encodeURIComponent(articleExcerpt)

  const shareLinks = {
    twitter: `https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedTitle}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`,
    reddit: `https://reddit.com/submit?url=${encodedUrl}&title=${encodedTitle}`,
    email: `mailto:?subject=${encodedTitle}&body=${encodedExcerpt}%0A%0A${encodedUrl}`,
  }

  const handleShare = (platform) => {
    if (platform === 'print') {
      window.print()
    } else if (platform === 'copy') {
      navigator.clipboard.writeText(articleUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } else if (platform === 'email') {
      window.location.href = shareLinks.email
    } else if (navigator.share && platform !== 'twitter') {
      // Use native share if available (mobile)
      navigator.share({
        title: articleTitle,
        text: articleExcerpt,
        url: articleUrl,
      }).catch(e => console.log('Share cancelled:', e))
    } else {
      // Open social share in new window
      const width = 600
      const height = 400
      const left = window.innerWidth / 2 - width / 2
      const top = window.innerHeight / 2 - height / 2
      window.open(shareLinks[platform], '_blank', `width=${width},height=${height},left=${left},top=${top}`)
    }

    // Track share
    setShareCount(prev => prev + 1)
  }

  return (
    <div className="share-buttons">
      <div className="share-wrapper">
        <div className="share-header">
          <h4 className="share-title">Share This Article</h4>
          {shareCount > 0 && <span className="share-badge">{shareCount} shares</span>}
        </div>

        <div className="share-grid">
          {/* Twitter */}
          <button
            className="share-btn twitter"
            onClick={() => handleShare('twitter')}
            title="Share on Twitter"
            aria-label="Share on Twitter"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
              <path d="M23 3a10.9 10.9 0 01-3.14 1.53 4.48 4.48 0 00-7.86 3v1A10.66 10.66 0 013 4s-4 9 5 13a11.64 11.64 0 01-7 2s9 5 20 5a9.5 9.5 0 00-9-5.5c4.75 2.25 7-7 7-7"/>
            </svg>
            <span>X</span>
          </button>

          {/* Facebook */}
          <button
            className="share-btn facebook"
            onClick={() => handleShare('facebook')}
            title="Share on Facebook"
            aria-label="Share on Facebook"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
              <path d="M18 2h-3a6 6 0 00-6 6v3H7v4h2v8h4v-8h3l1-4h-4V8a1 1 0 011-1h3z"/>
            </svg>
            <span>Facebook</span>
          </button>

          {/* LinkedIn */}
          <button
            className="share-btn linkedin"
            onClick={() => handleShare('linkedin')}
            title="Share on LinkedIn"
            aria-label="Share on LinkedIn"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
              <path d="M16 8a6 6 0 016 6v7h-4v-7a2 2 0 00-2-2 2 2 0 00-2 2v7h-4v-7a6 6 0 016-6zM2 9h4v12H2z"/>
              <circle cx="4" cy="4" r="2"/>
            </svg>
            <span>LinkedIn</span>
          </button>

          {/* Reddit */}
          <button
            className="share-btn reddit"
            onClick={() => handleShare('reddit')}
            title="Share on Reddit"
            aria-label="Share on Reddit"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
              <circle cx="12" cy="12" r="1"/>
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11z"/>
            </svg>
            <span>Reddit</span>
          </button>

          {/* Email */}
          <button
            className="share-btn email"
            onClick={() => handleShare('email')}
            title="Share via Email"
            aria-label="Share via Email"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="20" height="20" strokeWidth="2">
              <rect x="2" y="4" width="20" height="16" rx="2"/>
              <path d="m22 7-8.97 5.7a1.94 1.94 0 01-2.06 0L2 7"/>
            </svg>
            <span>Email</span>
          </button>

          {/* Copy Link */}
          <button
            className="share-btn copy"
            onClick={() => handleShare('copy')}
            title="Copy link"
            aria-label="Copy article link"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="20" height="20" strokeWidth="2">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
            </svg>
            <span>{copied ? '✓ Copied' : 'Copy'}</span>
          </button>

          {/* Print */}
          <button
            className="share-btn print"
            onClick={() => handleShare('print')}
            title="Print article"
            aria-label="Print article"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="20" height="20" strokeWidth="2">
              <polyline points="6 9 6 2 18 2 18 9"/>
              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
              <rect x="6" y="14" width="12" height="8"/>
            </svg>
            <span>Print</span>
          </button>
        </div>
      </div>
    </div>
  )
}
