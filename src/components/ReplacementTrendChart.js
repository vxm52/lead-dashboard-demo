/**
 * ReplacementTrendChart.js
 *
 * Line chart showing statewide lead service line replacements per year
 * (2021–2024), with an optional county filter.
 *
 * Replaces the hardcoded yearlyData in Dashboard.js with data aggregated
 * from the merged dataset. When the real pipeline CSV is ready, swap:
 *
 *   import mockMergedData from '../data/mockMergedData';
 *   →
 *   import mergedData from '../data/mergedData';
 *
 * Props:
 *   data {Array}  — merged dataset (default: mockMergedData).
 *                   Each row must have: lines_replaced (number|null), year (number),
 *                   county (string), inventory_complete_flag (boolean).
 *
 * Data notes:
 *   - Only rows with year 2021–2024 and non-null lines_replaced are included,
 *     because 2025 is inventory-only (no LSLR replacement data).
 *   - The county dropdown is derived dynamically from the dataset so it
 *     stays accurate when the real data lands.
 *   - The insight box calculates % change from 2021 to the most recent year
 *     automatically rather than being hardcoded.
 */

import React, { useState, useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import mergedData from '../data/mergedData';

// Years covered by LSLR data — update this array when new years are added
const LSLR_YEARS = [2021, 2022, 2023, 2024];

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Aggregates lines_replaced by year for a given subset of rows.
 * Skips rows where lines_replaced is null (incomplete data).
 *
 * @param {Array} rows — filtered subset of the merged dataset
 * @returns {Array<{ year: string, replacements: number }>}
 */
function aggregateByYear(rows) {
  const totals = {};

  // Initialize all LSLR years to 0 so years with no data still appear on chart
  LSLR_YEARS.forEach((y) => { totals[y] = 0; });

  rows.forEach((row) => {
    if (LSLR_YEARS.includes(row.year) && row.lines_replaced != null) {
      totals[row.year] = (totals[row.year] || 0) + row.lines_replaced;
    }
  });

  return LSLR_YEARS.map((y) => ({
    year: String(y),
    replacements: totals[y],
  }));
}

/**
 * Returns the percentage change from the first to the last year's value.
 * Returns null if either value is zero or missing.
 *
 * @param {Array<{ replacements: number }>} chartData
 * @returns {number|null}
 */
function calcPctChange(chartData) {
  const first = chartData[0]?.replacements;
  const last  = chartData[chartData.length - 1]?.replacements;
  if (!first || !last) return null;
  return Math.round(((last - first) / first) * 100);
}

// =============================================================================
// CUSTOM TOOLTIP
// =============================================================================

/**
 * Custom Recharts tooltip showing the year and formatted replacement count.
 * Styled to match the existing Dashboard chart tooltips.
 */
function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: '#fff',
      border: '1px solid #e2e8f0',
      borderRadius: '6px',
      padding: '10px 14px',
      fontSize: '0.85rem',
    }}>
      <p style={{ margin: '0 0 4px', fontWeight: 600, color: '#1f2937' }}>{label}</p>
      <p style={{ margin: 0, color: '#3b82f6' }}>
        {payload[0].value.toLocaleString()} lines replaced
      </p>
    </div>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

/**
 * ReplacementTrendChart
 *
 * Renders a line chart of annual lead service line replacements.
 * Includes a county filter dropdown and an auto-calculated insight box.
 *
 * Designed to drop into Dashboard.js in place of the existing
 * "Annual Replacement Trend" chart-card div.
 */
function ReplacementTrendChart({ data = mergedData }) {
  const [selectedCounty, setSelectedCounty] = useState('all');

  // Derive sorted county list from the dataset for the filter dropdown
  const counties = useMemo(() => {
    const unique = Array.from(new Set(data.map((r) => r.county))).sort();
    return unique;
  }, [data]);

  // Filter rows by selected county, then aggregate by year
  const chartData = useMemo(() => {
    const rows = selectedCounty === 'all'
      ? data
      : data.filter((r) => r.county === selectedCounty);
    return aggregateByYear(rows);
  }, [data, selectedCounty]);

  // Auto-calculate the insight: % change from first to last year
  const pctChange = calcPctChange(chartData);
  const insightText = pctChange != null
    ? `${pctChange > 0 ? '+' : ''}${pctChange}% change from ${LSLR_YEARS[0]} to ${LSLR_YEARS[LSLR_YEARS.length - 1]}`
    : 'Insufficient data to calculate trend';
  const insightPositive = pctChange != null && pctChange > 0;

  return (
    <div className="chart-card">
      {/* Header row: title + county filter */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h3 style={{ margin: 0 }}>Annual Replacement Trend</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <label
            htmlFor="trendCountyFilter"
            style={{ fontSize: '0.8rem', color: '#6b7280', whiteSpace: 'nowrap' }}
          >
            County
          </label>
          <select
            id="trendCountyFilter"
            value={selectedCounty}
            onChange={(e) => setSelectedCounty(e.target.value)}
            style={{
              height: '30px',
              padding: '0 0.5rem',
              fontSize: '0.82rem',
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              background: '#fff',
              color: '#1f2937',
              cursor: 'pointer',
            }}
          >
            <option value="all">All counties</option>
            {counties.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Line chart */}
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={chartData} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="year" stroke="#64748b" tick={{ fontSize: 13 }} />
          <YAxis
            stroke="#64748b"
            tick={{ fontSize: 12 }}
            tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}
          />
          <Tooltip content={<CustomTooltip />} />
          {/* Zero reference line so the chart reads correctly when values are small */}
          <ReferenceLine y={0} stroke="#e2e8f0" />
          <Line
            type="monotone"
            dataKey="replacements"
            stroke="#3b82f6"
            strokeWidth={3}
            dot={{ fill: '#3b82f6', r: 6 }}
            activeDot={{ r: 8 }}
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>

      {/* Auto-calculated insight box */}
      <div className={`insight-box ${insightPositive ? 'green' : 'yellow'}`}>
        <strong>{insightText}</strong>
        {selectedCounty !== 'all' && (
          <span> in {selectedCounty} County</span>
        )}
      </div>

      {/* Data note: 2025 excluded because it has no LSLR replacement data */}
      <p style={{ fontSize: '0.72rem', color: '#9ca3af', margin: '0.5rem 0 0', lineHeight: 1.4 }}>
        2021–2024 data from EGLE Lead Service Line Replacement Reports.
        2025 inventory data is not shown here as it does not include replacement counts.
      </p>
    </div>
  );
}

export default ReplacementTrendChart;
