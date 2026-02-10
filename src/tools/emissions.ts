/**
 * Emissions query tools for emissions_records table
 */

import { SustainabilityDatabase } from '../database.js';

export interface GetEmissionsByYearArgs {
  year: number;
  scope?: number;
  category?: string;
}

export async function handleGetEmissionsByYear(
  db: SustainabilityDatabase,
  args: GetEmissionsByYearArgs
) {
  const { year, scope, category } = args;

  // Query the database
  const emissions = await db.getEmissionsByYear(year, scope, category);

  // Build filters summary
  const filtersApplied: Record<string, any> = {};
  if (scope !== undefined) {
    filtersApplied.scope = scope;
  }
  if (category !== undefined) {
    filtersApplied.category = category;
  }

  // Calculate total emissions (excluding null values)
  const totalEmissions = emissions.reduce((sum, record) => {
    return sum + (record.co2e_emissions_kg || 0);
  }, 0);

  // Count records with null emissions
  const nullCount = emissions.filter(
    (record) => record.co2e_emissions_kg === null
  ).length;

  // Format response
  const response = {
    year,
    total_records: emissions.length,
    records_with_emissions: emissions.length - nullCount,
    records_with_null_emissions: nullCount,
    total_emissions_kgco2e: Math.round(totalEmissions * 100) / 100,
    filters: Object.keys(filtersApplied).length > 0 ? filtersApplied : null,
    emissions: emissions.map((record) => ({
      source: record.source,
      category: record.category,
      scope: record.scope,
      amount: record.amount,
      unit: record.unit,
      emissions_factor: record.emissions_factor,
      ef_unit: record.ef_unit,
      co2e_emissions_kg: record.co2e_emissions_kg,
      percentage: record.percentage,
    })),
  };

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(response, null, 2),
      },
    ],
  };
}
