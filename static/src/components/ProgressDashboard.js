import React, { useMemo, useState } from 'react';
import { formatDuration } from './WorkoutSession';
import {
  buildProgressFacts,
  MAIN_LIFTS,
  sampleProgressSeries,
  summarizeProgressFacts,
} from '../data/progress';

const RANGE_OPTIONS = [
  ['30d', '30 days'],
  ['90d', '90 days'],
  ['1y', '1 year'],
  ['all', 'All time'],
];

const formatWeight = value => `${Math.round(value).toLocaleString()} lb`;
const formatVolume = value => `${Math.round(value).toLocaleString()} lb`;
const fullDateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});
const shortDateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
});
const formatDate = value => fullDateFormatter.format(new Date(value));

const weekLabel = value => shortDateFormatter.format(value);

const LineChart = ({ points, lift }) => {
  const [tableExpanded, setTableExpanded] = useState(false);
  if (!points.length) return <div className="progress-empty">No tracked {lift.toLowerCase()} sets in this range.</div>;
  // Calculations and the accessible table keep the complete series; only bound the
  // expensive SVG point groups so long-lived profiles cannot grow the chart DOM forever.
  const renderedPoints = sampleProgressSeries(points);
  const width = Math.max(600, 56 + (renderedPoints.length - 1) * 72);
  const height = 220;
  const padding = 28;
  const values = renderedPoints.map(point => point.value);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const best = points.reduce((value, point) => Math.max(value, point.value), points[0].value);
  const spread = maximum - minimum || Math.max(maximum * 0.1, 1);
  const coordinates = renderedPoints.map((point, index) => ({
    ...point,
    x: renderedPoints.length === 1 ? width / 2 : padding + index * ((width - padding * 2) / (renderedPoints.length - 1)),
    y: height - padding - ((point.value - minimum) / spread) * (height - padding * 2),
  }));

  return (
    <div className="chart-wrap">
      <div className="chart-scroll">
        <svg className="line-chart" style={{ minWidth: `${width}px` }} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${lift} estimated max trend, ${points.length} workouts, ${formatDate(points[0].completedAt)} to ${formatDate(points[points.length - 1].completedAt)}, starting at ${formatWeight(points[0].value)}, ending at ${formatWeight(points[points.length - 1].value)}, best ${formatWeight(best)}`}>
          <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} />
          {coordinates.length > 1 && <polyline points={coordinates.map(point => `${point.x},${point.y}`).join(' ')} />}
          {coordinates.map(point => (
            <g className="chart-point" key={point.workoutId}>
              <circle cx={point.x} cy={point.y} r="6"><title>{formatDate(point.completedAt)} · {formatWeight(point.value)}</title></circle>
              <text x={point.x} y={point.y - 13} textAnchor="middle">{formatWeight(point.value)}</text>
            </g>
          ))}
        </svg>
      </div>
      <div className="chart-range"><span>{formatDate(points[0].completedAt)}</span><span>{formatDate(points[points.length - 1].completedAt)}</span></div>
      <details className="chart-data" onToggle={event => setTableExpanded(event.currentTarget.open)}>
        <summary>View all {points.length} data points</summary>
        {tableExpanded && <table><thead><tr><th>Date</th><th>Estimated max</th></tr></thead><tbody>{points.map(point => (
          <tr key={point.workoutId}><td>{formatDate(point.completedAt)}</td><td>{formatWeight(point.value)}</td></tr>
        ))}</tbody></table>}
      </details>
    </div>
  );
};

const BarChart = ({ buckets, metric, label, formatValue }) => {
  const maximum = Math.max(0, ...buckets.map(bucket => bucket[metric]));
  return (
    <div className="bar-chart" role="img" aria-label={`${label}: ${buckets.map(bucket => `week of ${weekLabel(bucket.start)}, ${formatValue(bucket[metric])}`).join('; ')}`}>
      {buckets.map(bucket => (
        <div className="bar-column" key={bucket.key} title={`Week of ${weekLabel(bucket.start)} · ${formatValue(bucket[metric])}`}>
          <span style={{ height: maximum ? `${Math.max(3, bucket[metric] / maximum * 100)}%` : '0' }} />
        </div>
      ))}
    </div>
  );
};

const Metric = ({ label, value, detail }) => (
  <div className="progress-metric"><small>{label}</small><strong>{value}</strong>{detail && <span>{detail}</span>}</div>
);

export const ProgressDashboard = ({ profile, routines, now }) => {
  const [range, setRange] = useState('90d');
  const [routineId, setRoutineId] = useState('all');
  const [lift, setLift] = useState('Squat');
  // Capture "now" once per mounted dashboard. A default `new Date()` in the parameters
  // invalidated the expensive history summary whenever an unrelated parent state changed.
  const currentTime = useMemo(() => now || new Date(), [now]);
  // Routine identity changes only when loaded records change, so filter controls reuse
  // the session facts instead of repeatedly walking every exercise and completed set.
  const facts = useMemo(() => buildProgressFacts(routines), [routines]);
  const result = useMemo(() => summarizeProgressFacts(facts, {
    range,
    routineId,
    lift,
    now: currentTime,
  }), [facts, range, routineId, lift, currentTime]);

  return (
    <section className="section-page progress-page">
      <p className="eyebrow">{profile.name}</p>
      <h1>Progress</h1>

      <div className="progress-filters" aria-label="Progress filters">
        <label className="form-field"><span className="field-label">Time range</span><select className="number-input" value={range} onChange={event => setRange(event.target.value)}>{RANGE_OPTIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label className="form-field"><span className="field-label">Plan</span><select className="number-input" value={routineId} onChange={event => setRoutineId(event.target.value)}><option value="all">All plans</option>{routines.map(routine => <option value={routine.id} key={routine.id}>{routine.name}</option>)}</select></label>
      </div>

      <div className="progress-overview">
        <Metric label="Completed volume" value={formatVolume(result.totalVolume)} />
        <Metric label="Workouts" value={result.completedWorkouts} />
        <Metric label="Active weeks" value={`${Math.round(result.consistency.activeWeekRate * 100)}%`} detail={`${result.consistency.activeWeeks} of ${result.consistency.totalWeeks}`} />
      </div>

      <article className="progress-card strength-progress">
        <div className="progress-card-heading"><div><p className="eyebrow">Strength trend</p><h2>Estimated max</h2></div>{result.personalRecord && <div className="pr-summary"><small>Lifetime estimated max</small><strong>{formatWeight(result.personalRecord.value)}</strong><span>{formatDate(result.personalRecord.completedAt)}</span></div>}</div>
        <div className="lift-tabs" role="group" aria-label="Main lift">{MAIN_LIFTS.map(item => <button className={lift === item ? 'active' : ''} type="button" onClick={() => setLift(item)} aria-pressed={lift === item} key={item}>{item}</button>)}</div>
        <LineChart points={result.e1rmSeries} lift={lift} />
        <p className="progress-note">Best completed set per workout using the Epley estimate.</p>
      </article>

      <article className="progress-card">
        <p className="eyebrow">Training load</p><h2>Completed volume</h2>
        <BarChart buckets={result.weekly} metric="volume" label="Weekly completed volume" formatValue={formatVolume} />
        <p className="progress-note">All completed weighted sets, grouped by calendar week.</p>
      </article>

      <article className="progress-card">
        <p className="eyebrow">Consistency</p><h2>Weekly workouts</h2>
        <div className="consistency-stats"><Metric label="Current streak" value={`${result.consistency.current} wk`} /><Metric label="Longest streak" value={`${result.consistency.longest} wk`} /></div>
        <BarChart buckets={result.weekly} metric="workouts" label="Weekly completed workouts" formatValue={value => `${value} workout${value === 1 ? '' : 's'}`} />
      </article>

      <article className="progress-card">
        <p className="eyebrow">Training pace</p><h2>Average split time by main lift</h2>
        <div className="timing-grid">{result.timing.map(item => (
          <section className="timing-card" key={item.lift}>
            <h3>{item.lift}</h3>
            <dl><div><dt>Workout</dt><dd>{item.averageWorkoutSeconds === null ? '—' : formatDuration(Math.round(item.averageWorkoutSeconds))}</dd></div><div><dt>Set interval</dt><dd>{item.averageSetIntervalSeconds === null ? '—' : formatDuration(Math.round(item.averageSetIntervalSeconds))}</dd></div></dl>
            <small>{item.workoutCount ? `${item.workoutCount} tracked workout${item.workoutCount === 1 ? '' : 's'}` : 'No tracked workouts'}</small>
          </section>
        ))}</div>
      </article>

      {!result.completedWorkouts && <p className="progress-empty-note">Completed workouts will appear here when they fall within the selected filters.</p>}
    </section>
  );
};
