/**
 * LeadLevelTrendChart.js
 *
 * Line chart showing a single water system's 90th percentile lead
 * concentration (lead_90th_ppb) over time.
 *
 * Data source: src/data/mergedData.js (converted from the pipeline CSV).
 * Previously used mockMergedData — real data is now wired in.
 *
 * Props:
 *   data {Array} — merged dataset (default: mergedData).
 *                  Each row must have:
 *                    resolved_pwsid (string)
 *                    display_name (string)
 *                    lead_90th_ppb (number|null)
 *                    year (number)
 *                    monitoring_end_date (string, YYYY-MM-DD)
 *                    above_action_level (boolean)
 *                      Note: CSV stores 'True'/'False' as Python strings.
 *                      Normalize to booleans when converting CSV to JS:
 *                        above_action_level: row.above_action_level === 'True'
 *
 * Key design decisions:
 *   - The x-axis only shows years the selected system actually has data for,
 *     not all years in the dataset. This prevents awkward sparse charts when
 *     a system is only monitored every 2-3 years.
 *   - When a system has multiple monitoring rows in the same year
 *     (different monitoring_end_date values), the row with the most
 *     recent monitoring_end_date is used.
 *   - Two reference lines are shown: 12 ppb (current 2025 standard, red)
 *     and 15 ppb (pre-2025 standard, orange). Both are always visible
 *     so the scale is never misleading.
 *   - All data points are connected since the x-axis only contains years
 *     with actual data — no null gaps needed.
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

// Michigan's original lead action level (15 ppb, Lead and Copper Rule revision)
const ACTION_LEVEL_OLD_PPB = 15;

// Michigan's current lead action level (12 ppb, established 2025)
// This is the more important threshold — shown in deep red
const ACTION_LEVEL_NEW_PPB = 12;

// Reference line and dot colors — clearly distinct from each other and from the blue data line
const COLOR_OLD_STANDARD = '#b91c1c'; // deep crimson — 15 ppb pre-2025 standard
const COLOR_NEW_STANDARD = '#f97316'; // bright orange — 12 ppb current 2025 standard (more strict)

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
    .filter((row) => row.lead_90th_ppb != null)
    .forEach((row) => {
      if (!seen.has(row.resolved_pwsid)) {
        seen.add(row.resolved_pwsid);
        systems.push({
          resolved_pwsid: row.resolved_pwsid,
          display_name:   row.display_name,
        });
      }
    });

  return systems.sort((a, b) => a.display_name.localeCompare(b.display_name));
}

/**
 * Extracts the lead_90th_ppb time series for a single system.
 *
 * Only includes years the system actually has monitoring data for —
 * the x-axis is scoped to the system's own history, not the full dataset
 * range. This prevents sparse charts for systems monitored infrequently.
 *
 * When a system has multiple rows for the same year (different
 * monitoring_end_date values), the row with the most recent
 * monitoring_end_date is used.
 *
 * @param {Array}  data          — full merged dataset
 * @param {string} resolvedPwsid — resolved_pwsid of the selected system
 * @returns {Array<{ year: string, ppb: number, aboveActionLevel: boolean }>}
 */
function getSystemTimeSeries(data, resolvedPwsid) {
  // For each year, keep only the row with the most recent monitoring_end_date
  const latestByYear = {};

  data
    .filter((row) => row.resolved_pwsid === resolvedPwsid && row.lead_90th_ppb != null)
    .forEach((row) => {
      const existing = latestByYear[row.year];
      if (
        !existing ||
        new Date(row.monitoring_end_date) > new Date(existing.monitoring_end_date)
      ) {
        latestByYear[row.year] = row;
      }
    });

  // Return only years this system has data for, sorted ascending
  return Object.values(latestByYear)
    .sort((a, b) => a.year - b.year)
    .map((row) => ({
      year:             String(row.year),
      ppb:              row.lead_90th_ppb,
      aboveActionLevel: row.above_action_level,
    }));
}

// =============================================================================
// CUSTOM TOOLTIP
// =============================================================================

/**
 * Custom Recharts tooltip showing year, ppb value, and an action level
 * warning when the value meets or exceeds Michigan's 15 ppb threshold.
 */
function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;

  const ppb          = payload[0]?.value;
  const aboveNew     = ppb != null && ppb >= ACTION_LEVEL_NEW_PPB;
  const aboveOld     = ppb != null && ppb >= ACTION_LEVEL_OLD_PPB;
  const dotColor     = aboveOld ? COLOR_OLD_STANDARD : aboveNew ? COLOR_NEW_STANDARD : '#3b82f6';

  return (
    <div style={{
      background:   '#fff',
      border:       '1px solid #e2e8f0',
      borderRadius: '6px',
      padding:      '10px 14px',
      fontSize:     '0.85rem',
      minWidth:     '180px',
    }}>
      <p style={{ margin: '0 0 4px', fontWeight: 600, color: '#1f2937' }}>{label}</p>
      {ppb != null ? (
        <>
          <p style={{ margin: '0 0 4px', color: dotColor }}>
            {ppb.toFixed(1)} ppb (90th percentile)
          </p>
          {aboveOld && (
            <p style={{ margin: '0 0 2px', fontSize: '0.75rem', color: COLOR_OLD_STANDARD, fontWeight: 600 }}>
              ⚠ Above {ACTION_LEVEL_OLD_PPB} ppb (pre-2025 standard)
            </p>
          )}
          {aboveNew && !aboveOld && (
            <p style={{ margin: '0 0 2px', fontSize: '0.75rem', color: '#d97706', fontWeight: 600 }}>
              ⚠ Above {ACTION_LEVEL_NEW_PPB} ppb (current 2025 standard)
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
 * Dots for years above the action level are red and slightly larger
 * so exceedances are visible without requiring a hover.
 */
function CustomDot({ cx, cy, payload }) {
  if (payload.ppb == null) return null;

  // Three color tiers matching the two reference lines:
  //   red   — above 15 ppb (pre-2025 standard)
  //   orange — above 12 ppb but below 15 ppb (current 2025 standard)
  //   blue  — below both thresholds
  const aboveOld = payload.ppb >= ACTION_LEVEL_OLD_PPB;
  const aboveNew = payload.ppb >= ACTION_LEVEL_NEW_PPB;
  const fill     = aboveOld ? COLOR_OLD_STANDARD : aboveNew ? COLOR_NEW_STANDARD : '#3b82f6';
  const r        = aboveOld ? 8 : aboveNew ? 7 : 6;

  return (
    <circle
      cx={cx}
      cy={cy}
      r={r}
      fill={fill}
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
function LeadLevelTrendChart({ data = mergedData }) {

  // Derive available systems from the dataset — memoized so it only
  // recalculates when data changes.
  const availableSystems = useMemo(() => getSystemsWithMonitoringData(data), [data]);

  // Default to the first available system
  const [selectedPwsid, setSelectedPwsid] = useState(
    () => availableSystems[0]?.resolved_pwsid ?? null
  );

  // Time series for the selected system — scoped to years this system
  // actually has data for, not the full dataset year range.
  const chartData = useMemo(
    () => selectedPwsid ? getSystemTimeSeries(data, selectedPwsid) : [],
    [data, selectedPwsid]
  );

  // Display name for the selected system
  const selectedName = availableSystems.find(
    (s) => s.resolved_pwsid === selectedPwsid
  )?.display_name ?? '';

  // Insight box logic
  const valuesWithData  = chartData.filter((d) => d.ppb != null);
  // Exceeded the current (more strict) 12 ppb standard
  const everExceededNew = chartData.some((d) => d.ppb != null && d.ppb >= ACTION_LEVEL_NEW_PPB);
  // Exceeded the older 15 ppb standard
  const everExceededOld = chartData.some((d) => d.ppb != null && d.ppb >= ACTION_LEVEL_OLD_PPB);
  const isTrendingDown  = valuesWithData.length >= 2 &&
    valuesWithData[valuesWithData.length - 1].ppb < valuesWithData[0].ppb;

  const insightMessage = () => {
    if (valuesWithData.length === 0)       return 'No monitoring data available for this system.';
    if (everExceededOld && isTrendingDown) return `${selectedName} has exceeded the ${ACTION_LEVEL_OLD_PPB} ppb standard but lead levels have since declined.`;
    if (everExceededOld)                   return `${selectedName} has exceeded Michigan's ${ACTION_LEVEL_OLD_PPB} ppb lead action level.`;
    if (everExceededNew && isTrendingDown) return `${selectedName} has exceeded the current ${ACTION_LEVEL_NEW_PPB} ppb standard but lead levels have since declined.`;
    if (everExceededNew)                   return `${selectedName} has exceeded Michigan's current ${ACTION_LEVEL_NEW_PPB} ppb lead action level (2025 standard).`;
    if (isTrendingDown)                    return `Lead levels in ${selectedName} have declined over this period.`;
    return `Lead levels in ${selectedName} have remained below Michigan's ${ACTION_LEVEL_NEW_PPB} ppb action level.`;
  };

  const insightClass = everExceededOld ? 'yellow' : everExceededNew ? 'yellow' : 'green';

  // Y-axis: always show the action level line, with 15% headroom above max
  const maxPpb = Math.max(...valuesWithData.map((d) => d.ppb), ACTION_LEVEL_OLD_PPB + 2);
  const yMax   = Math.ceil(maxPpb * 1.15);

  return (
    <div className="chart-card">

      {/* Header row: title + system selector */}
      <div style={{
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
        marginBottom:   '0.75rem',
        flexWrap:       'wrap',
        gap:            '0.5rem',
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
              height:       '30px',
              padding:      '0 0.5rem',
              fontSize:     '0.82rem',
              border:       '1px solid #d1d5db',
              borderRadius: '6px',
              background:   '#fff',
              color:        '#1f2937',
              cursor:       'pointer',
              maxWidth:     '220px',
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

      {/* Empty state */}
      {availableSystems.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem 1rem', color: '#9ca3af', fontSize: '0.9rem' }}>
          No lead monitoring data available.
        </div>
      ) : (
        <>
          {/* Line chart */}
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                dataKey="year"
                stroke="#64748b"
                tick={{ fontSize: 12 }}
                padding={{ left: 10, right: 20 }}
                // Rotate labels when the system has many years to prevent overlap
                angle={chartData.length > 6 ? -45 : 0}
                textAnchor={chartData.length > 6 ? 'end' : 'middle'}
                height={chartData.length > 6 ? 48 : 30}
              />
              <YAxis
                stroke="#64748b"
                tick={{ fontSize: 12 }}
                domain={[0, yMax]}
                tickFormatter={(v) => `${v} ppb`}
                width={56}
              />
              <Tooltip content={<CustomTooltip />} />

              {/* Amber dashed line — 15 ppb pre-2025 standard */}
              {/* Orange dashed line — 15 ppb pre-2025 standard */}
              <ReferenceLine
                y={ACTION_LEVEL_OLD_PPB}
                stroke={COLOR_OLD_STANDARD}
                strokeDasharray="5 4"
                strokeWidth={1.5}
                label={{
                  value:      `${ACTION_LEVEL_OLD_PPB} ppb (pre-2025)`,
                  position:   'insideBottomLeft',
                  fontSize:   10,
                  fill:       COLOR_OLD_STANDARD,
                  fontWeight: 600,
                  dy:         -5,
                }}
              />
              {/* Red dashed line — 12 ppb current 2025 standard (more strict) */}
              {/* Deep red dashed line — 12 ppb current 2025 standard */}
              <ReferenceLine
                y={ACTION_LEVEL_NEW_PPB}
                stroke={COLOR_NEW_STANDARD}
                strokeDasharray="5 4"
                strokeWidth={1.5}
                label={{
                  value:      `${ACTION_LEVEL_NEW_PPB} ppb (current 2025)`,
                  position:   'insideBottomLeft',
                  fontSize:   10,
                  fill:       COLOR_NEW_STANDARD,
                  fontWeight: 600,
                  dy:         -5,
                }}
              />

              <Line
                type="monotone"
                dataKey="ppb"
                stroke="#3b82f6"
                strokeWidth={3}
                dot={<CustomDot />}
                activeDot={false}
                connectNulls={true}
              />
            </LineChart>
          </ResponsiveContainer>

          {/* Insight box */}
          <div className={`insight-box ${insightClass}`}>
            {insightMessage()}
          </div>

          {/* Data note */}
          <p style={{ fontSize: '0.72rem', color: '#9ca3af', margin: '0.5rem 0 0', lineHeight: 1.4 }}>
            90th percentile lead concentration from EGLE monitoring data.
            Michigan's current lead action level is {ACTION_LEVEL_NEW_PPB} ppb (2025 standard). The previous standard was {ACTION_LEVEL_OLD_PPB} ppb.
            Gaps indicate years with no monitoring data for this system.
            Multiple monitoring periods in the same year show the most recent result.
          </p>
        </>
      )}

    </div>
  );
}

export default LeadLevelTrendChart;