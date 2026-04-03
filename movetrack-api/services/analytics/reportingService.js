'use strict';

/**
 * Reporting Service
 *
 * Admin-facing analytics queries for beta metrics, interaction logs, and scorecard data.
 * Lives under services/analytics — this folder is intended to grow to include move analytics,
 * inventory analytics, and conversation analytics over time.
 */

const knex = require('../infra/knex');

/**
 * Returns a performance summary for the beta scorecard.
 * @param {Date} since - Start of reporting window
 */
async function getBetaMetricsSummary(since) {
  const summary = await knex('beta_interaction_logs')
    .where('created_at', '>=', since)
    .select(
      knex.raw('COUNT(*)::int AS total_interactions'),
      knex.raw('COUNT(DISTINCT user_id)::int AS unique_users'),
      knex.raw('ROUND(AVG(total_latency_ms)) AS avg_total_ms'),
      knex.raw('ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY total_latency_ms)) AS median_total_ms'),
      knex.raw('ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY total_latency_ms)) AS p95_total_ms'),
      knex.raw('ROUND(AVG(ttfe_ms)) AS avg_ttfe_ms'),
      knex.raw('ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ttfe_ms)) AS median_ttfe_ms'),
      knex.raw('ROUND(AVG(gemini_latency_ms)) AS avg_gemini_ms'),
      knex.raw('ROUND(AVG(vision_latency_ms)) AS avg_vision_ms'),
      knex.raw('COUNT(CASE WHEN total_latency_ms < 3000 THEN 1 END)::int AS under_3s_count'),
      knex.raw('COUNT(CASE WHEN total_latency_ms >= 3000 THEN 1 END)::int AS over_3s_count'),
      knex.raw('COUNT(CASE WHEN had_attachments THEN 1 END)::int AS photo_interactions'),
      knex.raw('ROUND(AVG(avg_confidence), 3) AS avg_confidence_score'),
      knex.raw('SUM(COALESCE(items_added_this_turn, 0))::int AS total_items_added'),
      knex.raw('COUNT(CASE WHEN had_error THEN 1 END)::int AS error_count')
    )
    .first();

  const perUser = await knex('beta_interaction_logs')
    .where('beta_interaction_logs.created_at', '>=', since)
    .join('users', 'beta_interaction_logs.user_id', 'users.user_id')
    .select(
      'users.first_name',
      knex.raw('COUNT(*)::int AS interactions'),
      knex.raw('ROUND(AVG(total_latency_ms)) AS avg_latency_ms'),
      knex.raw('SUM(COALESCE(items_added_this_turn, 0))::int AS items_added'),
      knex.raw('COUNT(CASE WHEN had_attachments THEN 1 END)::int AS photo_uses')
    )
    .groupBy('users.user_id', 'users.first_name')
    .orderBy('interactions', 'desc');

  const confidenceDist = await knex('items')
    .whereNotNull('confidence_score')
    .where('created_at', '>=', since)
    .select(
      knex.raw(`COUNT(CASE WHEN confidence_score >= 0.85 THEN 1 END)::int AS high_confidence`),
      knex.raw(`COUNT(CASE WHEN confidence_score >= 0.60 AND confidence_score < 0.85 THEN 1 END)::int AS medium_confidence`),
      knex.raw(`COUNT(CASE WHEN confidence_score < 0.60 THEN 1 END)::int AS low_confidence`),
      knex.raw('COUNT(*)::int AS total_with_confidence')
    )
    .first();

  const feedbackStats = await knex('item_feedback')
    .where('created_at', '>=', since)
    .select(
      knex.raw(`COUNT(CASE WHEN feedback = 'correct' THEN 1 END)::int AS correct`),
      knex.raw(`COUNT(CASE WHEN feedback = 'wrong' THEN 1 END)::int AS wrong`),
      knex.raw(`COUNT(CASE WHEN feedback = 'hallucinated' THEN 1 END)::int AS hallucinated`),
      knex.raw('COUNT(*)::int AS total_feedback')
    )
    .first();

  const scorecard = {
    ttfe_target_200ms: summary.avg_ttfe_ms != null
      ? `${summary.avg_ttfe_ms}ms avg (target: <200ms)`
      : 'No data yet',
    e2e_latency_target_3s: summary.avg_total_ms != null
      ? `${summary.avg_total_ms}ms avg, ${summary.under_3s_count} under 3s / ${summary.over_3s_count} over 3s`
      : 'No data yet',
    detection_precision: feedbackStats.total_feedback > 0
      ? `${Math.round((feedbackStats.correct / feedbackStats.total_feedback) * 100)}% correct of ${feedbackStats.total_feedback} rated items`
      : 'Need feedback data',
    hallucination_rate: feedbackStats.total_feedback > 0
      ? `${Math.round((feedbackStats.hallucinated / feedbackStats.total_feedback) * 100)}% of ${feedbackStats.total_feedback} rated items`
      : 'Need feedback data',
  };

  return { summary, perUser, confidenceDist, feedbackStats, scorecard };
}

/**
 * Returns raw interaction log rows for export.
 * @param {Date} since - Start of reporting window
 * @param {number} limit - Max rows to return (capped at 1000)
 */
async function getBetaMetricsRaw(since, limit = 200) {
  const cappedLimit = Math.min(limit, 1000);

  const rows = await knex('beta_interaction_logs')
    .where('beta_interaction_logs.created_at', '>=', since)
    .join('users', 'beta_interaction_logs.user_id', 'users.user_id')
    .select(
      'beta_interaction_logs.id',
      'beta_interaction_logs.created_at',
      'users.first_name',
      'beta_interaction_logs.total_latency_ms',
      'beta_interaction_logs.ttfe_ms',
      'beta_interaction_logs.gemini_latency_ms',
      'beta_interaction_logs.vision_latency_ms',
      'beta_interaction_logs.had_attachments',
      'beta_interaction_logs.attachment_count',
      'beta_interaction_logs.tool_calls',
      'beta_interaction_logs.items_added_this_turn',
      'beta_interaction_logs.detected_item_count',
      'beta_interaction_logs.avg_confidence',
      'beta_interaction_logs.gemini_model',
      'beta_interaction_logs.gemini_rounds',
      'beta_interaction_logs.had_error',
      'beta_interaction_logs.error_message'
    )
    .orderBy('beta_interaction_logs.created_at', 'desc')
    .limit(cappedLimit);

  return { rows, count: rows.length };
}

module.exports = { getBetaMetricsSummary, getBetaMetricsRaw };
