# Visualization Dashboard Guide

Interactive calendar heatmap and detailed day analytics for automation runs.

---

## 🎨 Overview

The enhanced RunsDashboard now features:
- **Calendar Heatmap**: Visual overview of runs across days/months
- **Day Analytics**: Detailed metrics when you click on a day
- **Interactive Filtering**: Select day → see that day's runs
- **Responsive Design**: Works on mobile, tablet, desktop
- **Dark Mode Support**: Automatic theme based on system preference

---

## 📅 Calendar Heatmap Features

### Visual Representation
```
Day cells show:
- Date number
- Run count (badge)
- Color intensity (white → light blue → dark blue → green)
- Border highlight when selected
```

### Color Coding
| Color | Intensity | Meaning |
|-------|-----------|---------|
| #f0f0f0 (White) | 0 | No runs |
| #e6f3ff (Light) | 0-20% | 1-2 runs |
| #99d6ff (Blue) | 20-40% | 3-5 runs |
| #4da6ff (Darker) | 40-60% | 6-10 runs |
| #0073e6 (Dark) | 60-80% | 10+ runs |
| #00b300 (Green) | 80%+ | All runs successful |

### Interactions
- **Click a day**: Select it and view detailed analytics
- **Hover**: See tooltip with run count and entries created
- **Month nav**: ← → buttons to navigate months
- **Selected state**: Day has blue border and shadow highlight

### Legend
Shows color scale and what each intensity represents.

---

## 📊 Day Analytics Panel

### Appears When You Select a Day

Shows aggregated + individual run data for that specific day.

### Key Metrics Grid
```
┌──────────┬─────────────┬──────────────┬──────────────┐
│ 5 Runs   │ 92% Success │ 4 All-Green  │ 12.5s Avg    │
├──────────┼─────────────┼──────────────┼──────────────┤
│ 150 Entries │ 120 Published │ 30 Deleted │ 25 Localized │
│ Created    │               │            │              │
└──────────┴─────────────┴──────────────┴──────────────┘
```

Each metric is a card showing:
- Large value (number)
- Small label (metric name)
- Color-coded based on value (green for good, red for errors)

### Success Trend Chart
```
Bar chart showing success rate for each run on that day:
100%│                █
    │         █  █ █ █
    │      █ █ █ █ █ █
 50%│  █ █ █ █ █ █ █ █
    │ ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄
  0%└─────────────────── Time
    1st run        Last run
```

- Height = success percentage
- Color = green (good) / orange (warning) / red (bad)
- Hoverable for exact values
- Shows trend across day's runs

### Individual Runs Table
Each run shows:
```
Time  │ Steps    │ Created │ Published │ Duration │ Errors
------|----------|---------|-----------|----------|-------
14:31 │ 12/12 ✓  │ 150     │ 120       │ 12.5s    │ 0
14:45 │ 11/12    │ 148     │ 118       │ 13.2s    │ 1
```

Features:
- Time of execution
- Steps successful/total with checkmark if all green
- Entries created
- Entries published
- Duration
- Error count (red if > 0)
- Colored left border if all steps passed (green)

### Operations Summary Grid
```
┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│      150    │  │      120    │  │       30    │  │       25    │
│   Created   │  │  Published  │  │   Deleted   │  │  Localized  │
│ ■■■■■■■■■■ │  │ ■■■■■■■■■■ │  │ ■■■■■■■■■■ │  │ ■■■■■■■■■■ │
└─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘
```

Cards showing:
- Large count
- Operation label
- Colored bar underneath
- Each operation has distinct color (blue for create, green for publish, orange for delete, purple for localize)

---

## 🎯 Usage Examples

### Example 1: Find High-Activity Day
1. Look at calendar heatmap
2. Find darkest color (most runs)
3. Click on that day
4. View detailed breakdown

**Result**: See which day had most automation activity

### Example 2: Investigate Failed Run
1. Navigate calendar to day with failures
2. Click day to select it
3. Look at "Individual Runs" section
4. Find run with lowest success percentage (red bar)
5. Check "Errors" count and timestamp

**Result**: Identify which specific run failed and when

### Example 3: Compare Performance Across Week
1. Select different days by clicking
2. Check "Success Trend" chart for each day
3. Compare run counts and success rates
4. Identify patterns

**Result**: See if certain days have more/fewer failures

### Example 4: Track Operations Performed
1. Select a day
2. Look at "Operations Summary" grid
3. Check if entries were created/published/deleted/localized
4. Monitor entry lifecycle

**Result**: Verify automation completed expected operations

---

## 🛠️ Component APIs

### CalendarHeatmap Props
```javascript
<CalendarHeatmap
  runs={array}           // All runs to group by day
  onDaySelect={fn}       // Callback: (dayKey, stats) => void
  selectedDay={string}   // Current selected day ("2025-12-08")
/>
```

### DayAnalytics Props
```javascript
<DayAnalytics
  day={string}           // Selected day key
  runs={array}           // Runs for that day
  stats={object}         // Pre-calculated daily stats
/>
```

---

## 🎨 Customization

### Change Color Scheme
Edit `CalendarHeatmap.jsx` `getColor()` function:
```javascript
function getColor(intensity, metric = 'count') {
  // Currently: white → blue → green
  // Customize hex colors here
}
```

### Change Metrics Grid
Edit `DayAnalytics.jsx` metric calculations:
```javascript
const avgDuration = ...    // Calculate what to show
const allGreen = ...       // Count of perfect runs
```

### Add More Charts
Create new chart component and import in `DayAnalytics.jsx`:
```javascript
import MyNewChart from './MyNewChart'
// Then use in JSX
```

---

## 📱 Responsive Design

### Desktop (1100px+)
- Full calendar heatmap (7 days wide)
- Metrics grid (6 columns)
- Horizontal operations grid
- Full table width

### Tablet (768px - 1099px)
- Calendar stays 7 wide
- Metrics grid (2-3 columns)
- Stacked operations
- Table scrolls

### Mobile (<768px)
- Calendar might wrap
- Metrics stacked (1-2 columns)
- Vertical operations
- All tables scroll horizontally

---

## 🌙 Dark Mode

Automatically detected via `prefers-color-scheme`.

Colors adapt:
- Background: white → dark gray
- Text: dark gray → light gray
- Cards: white → dark blue-gray
- Borders: light gray → darker gray

No manual setup needed - uses CSS variables.

---

## 📊 Data Flow

```
Fetch run-history.json
        ↓
computeAll() groups by date
        ↓
CalendarHeatmap displays
        ↓
Click day → onDaySelect()
        ↓
setSelectedDay() + setDayStats()
        ↓
DayAnalytics renders with filtered runs
        ↓
Show individual run breakdown + metrics
```

---

## 🔮 Future Enhancements

### Planned Features
- [ ] Compare two days side-by-side
- [ ] Export day analytics as PDF/JSON
- [ ] Advanced filtering (by mode, instance, status)
- [ ] Trend analysis (week/month view)
- [ ] Anomaly detection ("this day was unusual")
- [ ] Alert thresholds ("notify if success rate < 80%")
- [ ] Custom date ranges
- [ ] Drill-down to individual steps
- [ ] Error heatmap (which steps fail most)
- [ ] Performance trends (average duration over time)

### Customization Ideas
- **Different intensity metrics**: Instead of run count, show:
  - Success rate
  - Total operations performed
  - Errors per day
  - Average duration
  
- **Additional charts** in day analytics:
  - Entries created over time (line chart)
  - Error types distribution (pie chart)
  - Step duration breakdown (stacked bar)
  - User performance matrix

---

## 💡 Tips & Tricks

### Tip 1: Speed Up Navigation
Click calendar cells quickly to jump through days without waiting for re-renders.

### Tip 2: Identify Patterns
Look at heatmap color pattern over weeks to identify:
- Which days have most runs (darker color)
- Which days have all-green runs (green color)
- Regular schedules or anomalies

### Tip 3: Monitor Success Trend
Within day analytics, success trend chart shows if runs got better/worse throughout day:
- Trending up → improving
- Trending down → degrading
- Flat → consistent

### Tip 4: Error Investigation
When you see errors in operations summary:
1. Note the error count
2. Look at individual runs to find which one failed
3. Check exact timestamp to correlate with logs

---

## 🐛 Troubleshooting

### Calendar Not Loading
- Check that `/run-history.json` exists
- Verify file has valid JSON format
- Check browser console for fetch errors

### Day Analytics Blank
- Ensure day is selected (calendar cell has blue border)
- Check that selected day has runs
- Runs should have `startedAt` timestamp

### Colors Look Wrong
- Clear browser cache
- Check if dark mode is interfering
- Verify CSS variables are defined

### Performance Issues with Many Runs
- Limit calendar to last 6 months
- Implement pagination in runs table
- Cache computed stats

---

## 📚 Related Documentation

- [Analytics & KPIs](ANALYTICS_AND_KPIS.md) - Metric definitions
- [Role-Based Guide](ROLE_BASED_GUIDE.md) - Role-based testing
- [RunsDashboard Component](../src/pages/RunsDashboard.jsx) - Main dashboard
- [CalendarHeatmap Component](../src/components/CalendarHeatmap.jsx) - Calendar logic
- [DayAnalytics Component](../src/components/DayAnalytics.jsx) - Day details

---

## ✨ Summary

The visualization dashboard provides:
- ✓ At-a-glance overview (calendar heatmap)
- ✓ Day-level drill-down (click to detail)
- ✓ Individual run breakdown (table view)
- ✓ Success tracking (trend chart)
- ✓ Operations monitoring (summary grid)
- ✓ Mobile responsive
- ✓ Dark mode support
- ✓ Interactive filtering

**Click a day on the calendar to explore its analytics!** 📅

---

**Happy analyzing! 📊**
