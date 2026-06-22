/**
 * 404 Not Found Page for News Website
 */

export default function News404() {
  return (
    <div className="news-404">
      <div className="news-container-404">
        <div className="error-content">
          <h1 className="error-code">404</h1>
          <h2 className="error-title">Page Not Found</h2>
          <p className="error-description">
            Sorry, the article or page you're looking for doesn't exist or has been removed.
          </p>
          <div className="error-actions">
            <a href="/news" className="error-btn primary">
              ← Back to Home
            </a>
            <a href="/news/search" className="error-btn secondary">
              🔍 Search News
            </a>
          </div>
        </div>
      </div>
      <style>{`
        .news-404 {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, #f9fafb 0%, #f3f4f6 100%);
        }

        .news-container-404 {
          max-width: 600px;
          margin: 0 auto;
          padding: 0 20px;
          text-align: center;
        }

        .error-content {
          background: white;
          padding: 60px 40px;
          border-radius: 12px;
          box-shadow: 0 10px 40px rgba(0, 0, 0, 0.08);
        }

        .error-code {
          font-size: 5rem;
          font-weight: 900;
          margin: 0;
          color: #6366f1;
          line-height: 1;
        }

        .error-title {
          font-size: 2rem;
          font-weight: 700;
          margin: 16px 0;
          color: #1f2937;
        }

        .error-description {
          font-size: 1.05rem;
          color: #6b7280;
          margin-bottom: 32px;
          line-height: 1.6;
        }

        .error-actions {
          display: flex;
          gap: 12px;
          justify-content: center;
          flex-wrap: wrap;
        }

        .error-btn {
          display: inline-block;
          padding: 12px 24px;
          border-radius: 6px;
          text-decoration: none;
          font-weight: 600;
          transition: all 0.2s;
          font-size: 0.95rem;
        }

        .error-btn.primary {
          background: #6366f1;
          color: white;
        }

        .error-btn.primary:hover {
          background: #4f46e5;
          transform: scale(1.05);
        }

        .error-btn.secondary {
          background: white;
          color: #6366f1;
          border: 2px solid #6366f1;
        }

        .error-btn.secondary:hover {
          background: #f0f9ff;
        }

        @media (max-width: 600px) {
          .error-code {
            font-size: 3.5rem;
          }

          .error-title {
            font-size: 1.5rem;
          }

          .error-content {
            padding: 40px 24px;
          }

          .error-actions {
            flex-direction: column;
          }

          .error-btn {
            width: 100%;
          }
        }
      `}</style>
    </div>
  )
}
