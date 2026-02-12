/**
 * Totals query tools for totals_sheet table
 */

import { SustainabilityDatabase } from '../database.js';

export interface GetEmissionsSummaryArgs {
  year: number;
}

export async function handleGetEmissionsSummary(
  db: SustainabilityDatabase,
  args: GetEmissionsSummaryArgs
) {
  const { year } = args;

  // Get summary statistics from database
  const summary = await db.getSummaryStats(year);

  // Format the response with clear structure
  const response = {
    year,
    overview: {
      total_emissions_kgco2e: summary.totals?.total_emissions_kg,
      total_lpa: summary.totals?.total_lpa,
      emissions_ratio_kgco2e_per_lpa: summary.totals?.emissions_ratio,
    },
    scope_breakdown: summary.scope_breakdown,
    top_sources: summary.top_sources.map((src) => ({
      source: src.source,
      category: src.category,
      scope: src.scope,
      emissions_kgco2e: Number(src.co2e_emissions_kg || 0),
    })),
    category_breakdown: summary.category_breakdown.map((cat) => ({
      category: cat.category,
      record_count: cat.record_count,
      total_emissions_kgco2e: Number(cat.total_emissions || 0),
    })),
    additional_metrics: {
      water_use_ratio_l_per_lpa: summary.totals?.water_use_ratio,
      energy_use_ratio_kwh_per_lpa: summary.totals?.energy_use_ratio,
    },
  };

  // Add insights
  if (response.scope_breakdown.length > 0) {
    const dominantScope = response.scope_breakdown.reduce((max, curr) =>
      curr.emissions_kgco2e > max.emissions_kgco2e ? curr : max
    );

    (response as any).insights = {
      dominant_scope: `Scope ${dominantScope.scope}`,
      dominant_scope_percentage: Math.round(dominantScope.percentage * 100) / 100,
      number_of_categories: response.category_breakdown.length,
    };
  }

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(response, null, 2),
      },
    ],
  };
}
