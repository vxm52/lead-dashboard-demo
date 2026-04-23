/**
 * SystemTrendPanel.js
 *
 * Combined panel showing two stacked charts for a single selected water system:
 *   1. Annual Replacement Trend — lines replaced per year (2021–2024)
 *   2. Lead Levels Over Time — 90th percentile lead (ppb) across all monitoring years
 *
 * A single system dropdown at the top controls both charts simultaneously,
 * eliminating any risk of a user comparing mismatched systems across the two charts.
 *
 * Replaces the separate ReplacementTrendChart and LeadLevelTrendChart components
 * in Dashboard.js. Those files are kept as standalone exports in case they are
 * needed elsewhere, but their individual dropdowns are no longer used here.
 *
 * Data source: src/data/mergedData.js
 *
 * To add a new LSLR year (e.g. 2025):
 *   1. Add the year to the LSLR_YEARS array below
 *   2. Ensure mergedData.js has lines_replaced populated for that year
 *
 * Props:
 *   data {Array} — merged dataset (default: mergedData)
 */

import React, { useState, useMemo } from 'react';
import {
  BarChart,
  Bar,
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

// =============================================================================
// CONFIGURATION
// =============================================================================

/** Years covered by LSLR replacement data. Update when new years are added. */
const LSLR_YEARS = [2021, 2022, 2023, 2024];

/** Michigan's current lead action level (ppb). A result > 12 ppb is an exceedance. */
const ACTION_LEVEL_PPB = 12;

const COLOR_ACTION_LEVEL = '#dc2626'; // red — action level reference line and dots
const COLOR_BAR          = '#3b82f6'; // blue — replacement bars
const COLOR_LINE         = '#3b82f6'; // blue — lead level line

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Returns all systems that appear in the dataset, sorted by display_name.
 * Used to populate the shared system dropdown.
 * A system is included if it has either monitoring data or replacement data.
 *
 * @param {Array} data — full merged dataset
 * @returns {Array<{ resolved_pwsid: string, display_name: string }>}
 */
function getAllSystems(data) {
  const seen = new Map();
  data.forEach((row) => {
    if (!seen.has(row.resolved_pwsid)) {
      seen.set(row.resolved_pwsid, row.display_name);
    }
  });
  return Array.from(seen.entries())
    .map(([resolved_pwsid, display_name]) => ({ resolved_pwsid, display_name }))
    .sort((a, b) => a.display_name.localeCompare(b.display_name));
}

/**
 * Returns the annual replacement series for a system across LSLR_YEARS.
 * Years with no data default to 0 so the x-axis stays consistent.
 *
 * @param {Array}  data          — full merged dataset
 * @param {string} resolvedPwsid — resolved_pwsid of the selected system
 * @returns {Array<{ year: string, replacements: number }>}
 */
function getReplacementSeries(data, resolvedPwsid) {
  const totals = {};
  LSLR_YEARS.forEach((y) => { totals[y] = 0; });

  data
    .filter((row) =>
      row.resolved_pwsid === resolvedPwsid &&
      LSLR_YEARS.includes(row.year) &&
      row.lines_replaced != null
    )
    .forEach((row) => {
      totals[row.year] = (totals[row.year] || 0) + row.lines_replaced;
    });

  return LSLR_YEARS.map((y) => ({ year: String(y), replacements: totals[y] }));
}

/**
 * Returns the lead monitoring time series for a system.
 * Only includes years the system actually has data for — x-axis is scoped
 * to the system's own history to avoid sparse/awkward charts.
 * When multiple monitoring rows exist for the same year, the most recent
 * monitoring_end_date is used.
 *
 * @param {Array}  data          — full merged dataset
 * @param {string} resolvedPwsid — resolved_pwsid of the selected system
 * @returns {Array<{ year: string, ppb: number, aboveActionLevel: boolean }>}
 */
function getLeadSeries(data, resolvedPwsid) {
  const latestByYear = {};

  data
    .filter((row) => row.resolved_pwsid === resolvedPwsid && row.lead_90th_ppb != null)
    .forEach((row) => {
      const existing = latestByYear[row.year];
      if (!existing || new Date(row.monitoring_end_date) > new Date(existing.monitoring_end_date)) {
        latestByYear[row.year] = row;
      }
    });

  return Object.values(latestByYear)
    .sort((a, b) => a.year - b.year)
    .map((row) => ({
      year:             String(row.year),
      ppb:              row.lead_90th_ppb,
      aboveActionLevel: row.above_action_level,
    }));
}

// =============================================================================
// CUSTOM TOOLTIPS
// =============================================================================

function ReplacementTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '10px 14px', fontSize: '0.85rem' }}>
      <p style={{ margin: '0 0 4px', fontWeight: 600, color: '#1f2937' }}>{label}</p>
      <p style={{ margin: 0, color: COLOR_BAR }}>{payload[0].value.toLocaleString()} lines replaced</p>
    </div>
  );
}

function LeadTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const ppb      = payload[0]?.value;
  const isAbove  = ppb != null && ppb > ACTION_LEVEL_PPB;
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '10px 14px', fontSize: '0.85rem', minWidth: '160px' }}>
      <p style={{ margin: '0 0 4px', fontWeight: 600, color: '#1f2937' }}>{label}</p>
      {ppb != null ? (
        <p style={{ margin: 0, color: isAbove ? COLOR_ACTION_LEVEL : COLOR_LINE }}>
          {ppb.toFixed(1)} ppb (90th percentile)
        </p>
      ) : (
        <p style={{ margin: 0, color: '#9ca3af' }}>No data this year</p>
      )}
    </div>
  );
}

// =============================================================================
// CUSTOM DOT — lead levels chart
// =============================================================================

/**
 * Red, slightly larger dot for years where lead > 12 ppb.
 * Blue dot otherwise. Makes exceedances visible without requiring a hover.
 */
function LeadDot({ cx, cy, payload }) {
  if (payload.ppb == null) return null;
  const isAbove = payload.ppb > ACTION_LEVEL_PPB;
  return (
    <circle
      cx={cx} cy={cy}
      r={isAbove ? 8 : 6}
      fill={isAbove ? COLOR_ACTION_LEVEL : COLOR_LINE}
      stroke="#fff"
      strokeWidth={2}
    />
  );
}

// =============================================================================
// SHARED DROPDOWN STYLES
// =============================================================================

const selectStyle = {
  height:       '30px',
  padding:      '0 0.5rem',
  fontSize:     '0.82rem',
  border:       '1px solid #d1d5db',
  borderRadius: '6px',
  background:   '#fff',
  color:        '#1f2937',
  cursor:       'pointer',
  maxWidth:     '240px',
};

// =============================================================================
// MAIN COMPONENT
// =============================================================================

/**
 * SystemTrendPanel
 *
 * Single card containing:
 *   - One shared system selector dropdown
 *   - Annual Replacement Trend bar chart (top)
 *   - Lead Levels Over Time line chart (bottom)
 *
 * Both charts always reflect the same selected system.
 */
function SystemTrendPanel({ data = mergedData }) {

  // All systems — union of monitoring and replacement data
  const allSystems = useMemo(() => getAllSystems(data), [data]);

  // Default to the first system
  const [selectedPwsid, setSelectedPwsid] = useState(
    () => allSystems[0]?.resolved_pwsid ?? null
  );

  const selectedName = allSystems.find(
    (s) => s.resolved_pwsid === selectedPwsid
  )?.display_name ?? '';

  // Replacement data for selected system
  const replacementData = useMemo(
    () => selectedPwsid ? getReplacementSeries(data, selectedPwsid) : [],
    [data, selectedPwsid]
  );

  // Lead monitoring data for selected system
  const leadData = useMemo(
    () => selectedPwsid ? getLeadSeries(data, selectedPwsid) : [],
    [data, selectedPwsid]
  );

  // Y-axis upper bound for lead chart — always shows the 12 ppb line
  const maxPpb = Math.max(...leadData.map((d) => d.ppb), ACTION_LEVEL_PPB + 2);
  const yMax   = Math.ceil(maxPpb * 1.15);

  // Replacement insight: % change 2021 → 2024
  const firstReplaced = replacementData[0]?.replacements;
  const lastReplaced  = replacementData[replacementData.length - 1]?.replacements;
  const pctChange     = firstReplaced ? Math.round(((lastReplaced - firstReplaced) / firstReplaced) * 100) : null;
  const insightText   = pctChange != null
    ? `${pctChange > 0 ? '+' : ''}${pctChange}% change from ${LSLR_YEARS[0]} to ${LSLR_YEARS[LSLR_YEARS.length - 1]}`
    : 'No replacement data for this system (2021–2024)';
  const insightClass  = pctChange != null && pctChange > 0 ? 'green' : 'yellow';

  return (
    <div className="chart-card">

      {/* ── Shared header: title + single system selector ── */}
      <div style={{
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
        marginBottom:   '1.25rem',
        flexWrap:       'wrap',
        gap:            '0.5rem',
      }}>
        <h3 style={{ margin: 0 }}>System Trends</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <label
            htmlFor="systemTrendSelect"
            style={{ fontSize: '0.8rem', color: '#6b7280', whiteSpace: 'nowrap' }}
          >
            Water system
          </label>
          <select
            id="systemTrendSelect"
            value={selectedPwsid ?? ''}
            onChange={(e) => setSelectedPwsid(e.target.value)}
            style={selectStyle}
          >
            {allSystems.map((s) => (
              <option key={s.resolved_pwsid} value={s.resolved_pwsid}>
                {s.display_name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* ── Chart 1: Annual Replacement Trend ── */}
      <p style={{ margin: '0 0 0.5rem', fontSize: '0.85rem', fontWeight: 600, color: '#374151' }}>
        Annual Replacement Trend
      </p>
      <p style={{ margin: '0 0 0.5rem', fontSize: '0.75rem', color: '#9ca3af' }}>
        Lead and GPCL service lines replaced per year (2021–2024)
      </p>

      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={replacementData} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="year" stroke="#64748b" tick={{ fontSize: 12 }} padding={{ right: 20 }} />
          <YAxis
            stroke="#64748b"
            tick={{ fontSize: 12 }}
            tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}
          />
          <Tooltip content={<ReplacementTooltip />} />
          <Bar dataKey="replacements" fill={COLOR_BAR} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>

      {/* Replacement insight */}
      <div className={`insight-box ${insightClass}`} style={{ margin: '0.5rem 0 1.5rem' }}>
        <strong>{insightText}</strong>
        {pctChange != null && selectedName && <span> for {selectedName}</span>}
      </div>

      {/* Divider */}
      <div style={{ borderTop: '1px solid #e5e7eb', marginBottom: '1.25rem' }} />

      {/* ── Chart 2: Lead Levels Over Time ── */}
      <p style={{ margin: '0 0 0.5rem', fontSize: '0.85rem', fontWeight: 600, color: '#374151' }}>
        Lead Levels Over Time
      </p>
      <p style={{ margin: '0 0 0.5rem', fontSize: '0.75rem', color: '#9ca3af' }}>
        90th percentile lead concentration (ppb) — red dots exceed Michigan's {ACTION_LEVEL_PPB} ppb action level
      </p>

      {leadData.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '2rem 1rem', color: '#9ca3af', fontSize: '0.875rem' }}>
          No lead monitoring data available for this system.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={leadData} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis
              dataKey="year"
              stroke="#64748b"
              tick={{ fontSize: 12 }}
              padding={{ left: 10, right: 20 }}
              angle={leadData.length > 6 ? -45 : 0}
              textAnchor={leadData.length > 6 ? 'end' : 'middle'}
              height={leadData.length > 6 ? 48 : 30}
            />
            <YAxis
              stroke="#64748b"
              tick={{ fontSize: 12 }}
              domain={[0, yMax]}
              tickFormatter={(v) => `${v} ppb`}
              width={56}
            />
            <Tooltip content={<LeadTooltip />} />
            <ReferenceLine
              y={ACTION_LEVEL_PPB}
              stroke={COLOR_ACTION_LEVEL}
              strokeDasharray="5 4"
              strokeWidth={1.5}
              label={{
                value:      `${ACTION_LEVEL_PPB} ppb action level`,
                position:   'insideBottomLeft',
                fontSize:   10,
                fill:       COLOR_ACTION_LEVEL,
                fontWeight: 600,
                dy:         -5,
              }}
            />
            <Line
              type="monotone"
              dataKey="ppb"
              stroke={COLOR_LINE}
              strokeWidth={3}
              dot={<LeadDot />}
              activeDot={false}
              connectNulls={true}
            />
          </LineChart>
        </ResponsiveContainer>
      )}

    </div>
  );
}

export default SystemTrendPanel;
