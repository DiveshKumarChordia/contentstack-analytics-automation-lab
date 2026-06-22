/**
 * Dashboard Filters & Drill-down
 * Allows filtering by instance, mode, date range, and error status
 * Provides drill-down capabilities for deeper analysis
 */

import { useState } from 'react'

export default function DashboardFilters({ runs, onFilter }) {
  const [filters, setFilters] = useState({
    instance: 'all',
    mode: 'all',
    status: 'all', // all, ok, failed
    dateRange: '7d', // 24h, 7d, 30d, all
  })

  // Extract unique values from runs
  const instances = ['all', ...new Set(runs.map(r => r.instance || 'unknown'))]
  const modes = ['all', ...new Set(runs.map(r => r.mode || 'standard'))]

  const handleFilterChange = (key, value) => {
    const newFilters = { ...filters, [key]: value }
    setFilters(newFilters)
    applyFilters(newFilters)
  }

  const applyFilters = (filterConfig) => {
    let filtered = [...runs]

    // Apply instance filter
    if (filterConfig.instance !== 'all') {
      filtered = filtered.filter(r => (r.instance || 'unknown') === filterConfig.instance)
    }

    // Apply mode filter
    if (filterConfig.mode !== 'all') {
      filtered = filtered.filter(r => (r.mode || 'standard') === filterConfig.mode)
    }

    // Apply status filter
    if (filterConfig.status !== 'all') {
      if (filterConfig.status === 'ok') {
        filtered = filtered.filter(r => r.ok)
      } else if (filterConfig.status === 'failed') {
        filtered = filtered.filter(r => !r.ok)
      }
    }

    // Apply date range filter
    const now = Date.now()
    const ranges = {
      '24h': 24 * 3600000,
      '7d': 7 * 24 * 3600000,
      '30d': 30 * 24 * 3600000,
      'all': Infinity,
    }
    const cutoff = now - (ranges[filterConfig.dateRange] || Infinity)
    filtered = filtered.filter(r => new Date(r.startedAt).getTime() > cutoff)

    // Call parent with filtered runs
    onFilter?.(filtered)
  }

  return (
    <div className="filters">
      <div className="filters__grid">
        <FilterSelect
          label="Instance"
          value={filters.instance}
          options={instances}
          onChange={(v) => handleFilterChange('instance', v)}
        />

        <FilterSelect
          label="Mode"
          value={filters.mode}
          options={modes}
          onChange={(v) => handleFilterChange('mode', v)}
        />

        <FilterSelect
          label="Status"
          value={filters.status}
          options={['all', 'ok', 'failed']}
          onChange={(v) => handleFilterChange('status', v)}
        />

        <FilterSelect
          label="Date Range"
          value={filters.dateRange}
          options={['24h', '7d', '30d', 'all']}
          onChange={(v) => handleFilterChange('dateRange', v)}
        />
      </div>

      <div className="filters__summary">
        <span className="filters__badge">{runs.length} total runs</span>
      </div>
    </div>
  )
}

function FilterSelect({ label, value, options, onChange }) {
  return (
    <div className="filter-control">
      <label className="filter-control__label">{label}</label>
      <select
        className="filter-control__select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map(opt => (
          <option key={opt} value={opt}>
            {opt === 'all' ? 'All' : opt}
          </option>
        ))}
      </select>
    </div>
  )
}
