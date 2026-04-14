/**
 * LeadLevelTrendChart.js
 *
 * Line chart showing a single water system's 90th percentile lead
 * concentration (lead_90th_ppb) over time (2021–2024).
 *
 * This is a new visualization — no equivalent exists in the current dashboard.
 * It surfaces lead level trends per system, which is the key public health
 * story the merged dataset unlocks beyond replacement counts alone.
 *
 * When the real pipeline CSV is ready, swap the import:
 *   import mockMergedData from '../data/mockMergedData';
 *   → import mergedData from '../data/mergedData';
 *
 * Props:
 *   data {Array} — merged dataset (default: mockMergedData).
 *                  Each row must have: resolved_pwsid, display_name,
 *                  lead_90th_ppb (number|null), year (number),
 *                  above_action_level (boolean).
 *
 * Data notes:
 *   - Only rows with year 2021–2024 and non-null lead_90th_ppb are charted.
 *     2025 is inventory-only and has no monitoring data.
 *   - Michigan's lead action level is 15 ppb. A reference line is drawn at
 *     this threshold so users can immediately see when a system exceeded it.
 *   - Use resolved_pwsid as the unique system key (not base_pwsid), and
 *     display_name for all labels (not system_name).
 *   - Systems are deduplicated by resolved_pwsid for the search dropdown.
 *
 * To add to Dashboard.js:
 *   import LeadLevelTrendChart from './LeadLevelTrendChart';
 *   // place inside the charts-grid div after ReplacementTrendChart
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
import mockMergedData from '../data/mockMergedData';

// Years covered by lead monitoring data — update when new years are added
const MONITORING_YEARS = [2021, 2022, 2023, 2024];

// Michigan's lead action level in ppb (15 ppb as of Lead and Copper Rule revision)
const ACTION_LEVEL_PPB = 15;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Returns a deduplicated list of systems that have at least one year of
 * lead monitoring data, sorted alphabetically by display_name.
 * Used to populate the system search dropdown.
 *
 * @param {Array} data — full merged dataset
 * @returns {Array<{ resolved_pwsid: string, display_name: string }>}
 */
function getSystemsWithMonitoringData(data) {
  const seen = new Set();
  const systems = [];

  data
    .filter((row) => MONITORING_YEARS.includes(row.year) && row.lead_90th_ppb != null)
    .forEach((row) => {
      if (!seen.has(row.resolved_pwsid)) {
        seen.add(row.resolved_pwsid);
        systems.push({
          resolved_pwsid: row.resolved_pwsid,
          display_name: row.display_name,
        });
      }
    });

  return systems.sort((a, b) => a.display_name.localeCompare(b.display_name));
}

/**
 * Extracts the lead_90th_ppb time series for a single system.
 * Returns one data point per monitoring year, with null where data is missing
 * so Recharts can render a gap rather than connecting across missing years.
 *
 * @param {Array} data          — full merged dataset
 * @param {string} resolvedPwsid — resolved_pwsid of the selected system
 * @returns {Array<{ year: string, ppb: number|null, aboveActionLevel: boolean }>}
 */
function getSystemTimeSeries(data, resolvedPwsid) {
  const rowsByYear = {};

  data
    .filter((row) => row.resolved_pwsid === resolvedPwsid && MONITORING_YEARS.includes(row.year))
    .forEach((row) => { rowsByYear[row.year] = row; });

  return MONITORING_YEARS.map((y) => {
    const row = rowsByYear[y];
    return {
      year: String(y),
      ppb: row?.lead_90th_ppb ?? null,
      aboveActionLevel: row?.above_action_level ?? false,
    };
  });
}

// =============================================================================
// CUSTOM TOOLTIP
// =============================================================================

/**
 * Custom Recharts tooltip showing year, ppb value, and an action level warning
 * when the value exceeds Michigan's 15 ppb threshold.
 */
function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;

  const ppb = payload[0]?.value;
  const aboveLimit = ppb != null && ppb >= ACTION_LEVEL_PPB;

  return (
    <div style={{
      background: '#fff',
      border: '1px solid #e2e8f0',
      borderRadius: '6px',
      padding: '10px 14px',
      fontSize: '0.85rem',
      minWidth: '160px',
    }}>
      <p style={{ margin: '0 0 4px', fontWeight: 600, color: '#1f2937' }}>{label}</p>
      {ppb != null ? (
        <>
          <p style={{ margin: '0 0 2px', color: aboveLimit ? '#dc2626' : '#3b82f6' }}>
            {ppb.toFixed(1)} ppb (90th percentile)
          </p>
          {aboveLimit && (
            <p style={{ margin: 0, fontSize: '0.75rem', color: '#dc2626', fontWeight: 600 }}>
              ⚠ Above {ACTION_LEVEL_PPB} ppb action level
            </p>
          )}
        </>
      ) : (
        <p style={{ margin: 0, color: '#9ca3af' }}>No data this year</p>
      )}
    </div>
  );
}

// =============================================================================
// CUSTOM DOT
// =============================================================================

/**
 * Custom dot renderer for the line chart.
 * Dots for years above the action level are rendered red and slightly larger
 * to draw attention without requiring the user to hover.
 */
function CustomDot({ cx, cy, payload }) {
  if (payload.ppb == null) return null;

  const isAbove = payload.aboveActionLevel;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={isAbove ? 8 : 6}
      fill={isAbove ? '#dc2626' : '#3b82f6'}
      stroke="#fff"
      strokeWidth={2}
    />
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

/**
 * LeadLevelTrendChart
 *
 * Renders a searchable single-system lead concentration trend chart.
 * Defaults to the first system with available monitoring data.
 */
function LeadLevelTrendChart({ data = mockMergedData }) {

  // Build the list of selectable systems from the dataset
  const availableSystems = useMemo(() => getSystemsWithMonitoringData(data), [data]);

  // Default to the first available system
  const [selectedPwsid, setSelectedPwsid] = useState(
  () => availableSystems.find((s) => s.display_name === 'Alpena City')?.resolved_pwsid
    ?? availableSystems[0]?.resolved_pwsid
    ?? null
  );

  // Get the time series for the selected system
  const chartData = useMemo(
    () => selectedPwsid ? getSystemTimeSeries(data, selectedPwsid) : [],
    [data, selectedPwsid]
  );

  // Display name for the selected system
  const selectedName = availableSystems.find((s) => s.resolved_pwsid === selectedPwsid)?.display_name ?? '';

  // Check if any year exceeded the action level — drives insight box tone
  const everExceeded = chartData.some((d) => d.aboveActionLevel);

  // Check if lead levels are trending down from first to last available year
  const valuesWithData = chartData.filter((d) => d.ppb != null);
  const isTrendingDown = valuesWithData.length >= 2 &&
    valuesWithData[valuesWithData.length - 1].ppb < valuesWithData[0].ppb;

  // Build insight message
  const insightMessage = () => {
    if (valuesWithData.length === 0) return 'No monitoring data available for this system.';
    if (everExceeded && isTrendingDown) return `${selectedName} exceeded Michigan's action level but lead levels have since declined.`;
    if (everExceeded) return `${selectedName} has exceeded Michigan's ${ACTION_LEVEL_PPB} ppb lead action level.`;
    if (isTrendingDown) return `Lead levels in ${selectedName} have declined over this period.`;
    return `Lead levels in ${selectedName} have remained below the ${ACTION_LEVEL_PPB} ppb action level.`;
  };

  const insightClass = everExceeded ? 'yellow' : 'green';

  // Y-axis upper bound: at least ACTION_LEVEL_PPB + 2 so the reference line
  // is always visible even when all values are below it
  const maxPpb = Math.max(...valuesWithData.map((d) => d.ppb), ACTION_LEVEL_PPB + 2);
  const yMax   = Math.ceil(maxPpb * 1.15); // 15% headroom above the highest value

  return (
    <div className="chart-card">

      {/* Header row: title + system selector */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '0.75rem',
        flexWrap: 'wrap',
        gap: '0.5rem',
      }}>
        <h3 style={{ margin: 0 }}>Lead Levels Over Time</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <label
            htmlFor="leadSystemSelect"
            style={{ fontSize: '0.8rem', color: '#6b7280', whiteSpace: 'nowrap' }}
          >
            System
          </label>
          <select
            id="leadSystemSelect"
            value={selectedPwsid ?? ''}
            onChange={(e) => setSelectedPwsid(e.target.value)}
            style={{
              height: '30px',
              padding: '0 0.5rem',
              fontSize: '0.82rem',
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              background: '#fff',
              color: '#1f2937',
              cursor: 'pointer',
              maxWidth: '220px',
            }}
          >
            {availableSystems.map((s) => (
              <option key={s.resolved_pwsid} value={s.resolved_pwsid}>
                {s.display_name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Empty state when no system is selected or no data exists */}
      {availableSystems.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem 1rem', color: '#9ca3af', fontSize: '0.9rem' }}>
          No lead monitoring data available.
        </div>
      ) : (
        <>
          {/* Line chart */}
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="year" stroke="#64748b" tick={{ fontSize: 13 }} />
              <YAxis
                stroke="#64748b"
                tick={{ fontSize: 12 }}
                domain={[0, yMax]}
                tickFormatter={(v) => `${v} ppb`}
                width={56}
              />
              <Tooltip content={<CustomTooltip />} />

              {/* Red dashed reference line at Michigan's 15 ppb action level */}
              <ReferenceLine
                y={ACTION_LEVEL_PPB}
                stroke="#dc2626"
                strokeDasharray="5 4"
                strokeWidth={1.5}
                label={{
                  value: `${ACTION_LEVEL_PPB} ppb action level`,
                  position: 'insideTopRight',
                  fontSize: 11,
                  fill: '#dc2626',
                  dy: -6,
                }}
              />

              <Line
                type="monotone"
                dataKey="ppb"
                stroke="#3b82f6"
                strokeWidth={3}
                dot={<CustomDot />}
                activeDot={false}
                connectNulls={false}
              />
            </LineChart>
          </ResponsiveContainer>

          {/* Auto-generated insight box */}
          <div className={`insight-box ${insightClass}`}>
            {insightMessage()}
          </div>

          {/* Data note */}
          <p style={{ fontSize: '0.72rem', color: '#9ca3af', margin: '0.5rem 0 0', lineHeight: 1.4 }}>
            90th percentile lead concentration from EGLE monitoring data.
            Michigan's lead action level is {ACTION_LEVEL_PPB} ppb.
            Gaps indicate years with no monitoring data for this system.
          </p>
        </>
      )}

    </div>
  );
}

export default LeadLevelTrendChart;
