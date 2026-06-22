/**
 * Breadcrumb Navigation Component
 *
 * Shows user's current location in site hierarchy
 * Example: Home > Technology > Article Title
 */

import '../styles/Breadcrumb.css'

export default function Breadcrumb({ items }) {
  return (
    <nav className="breadcrumb" aria-label="Breadcrumb">
      <ol className="breadcrumb-list">
        <li className="breadcrumb-item">
          <a href="/news" className="breadcrumb-link">Home</a>
        </li>
        {items.map((item, idx) => (
          <li key={idx} className="breadcrumb-item">
            <span className="breadcrumb-separator">/</span>
            {item.url ? (
              <a href={item.url} className="breadcrumb-link">{item.label}</a>
            ) : (
              <span className="breadcrumb-current">{item.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}
