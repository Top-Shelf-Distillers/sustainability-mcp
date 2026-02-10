/**
 * MCP Resources for sustainability data
 *
 * Resources provide read-only access to data that Claude can browse and reference.
 * Unlike tools, resources don't require explicit invocation - Claude can read them
 * when needed for context.
 */

import { SustainabilityDatabase } from './database.js';

export interface ResourceInfo {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export function listResources(): ResourceInfo[] {
  return [
    // Totals resources - one per year
    {
      uri: 'sustainability://totals/2023',
      name: '2023 Totals & Metrics',
      description:
        'Total emissions, LPA, and key sustainability metrics for 2023 including energy usage',
      mimeType: 'application/json',
    },
    {
      uri: 'sustainability://totals/2024',
      name: '2024 Totals & Metrics',
      description:
        'Total emissions, LPA, and key sustainability metrics for 2024 including energy usage',
      mimeType: 'application/json',
    },
    {
      uri: 'sustainability://totals/2025',
      name: '2025 Totals & Metrics',
      description:
        'Total emissions, LPA, and key sustainability metrics for 2025 including energy usage',
      mimeType: 'application/json',
    },

    // Transportation resources - one per year
    {
      uri: 'sustainability://transportation/2023',
      name: '2023 Transportation Calculations',
      description:
        'Detailed transportation emissions calculations including suppliers, distances, weights, and multi-modal transport for 2023',
      mimeType: 'application/json',
    },
    {
      uri: 'sustainability://transportation/2024',
      name: '2024 Transportation Calculations',
      description:
        'Detailed transportation emissions calculations including suppliers, distances, weights, and multi-modal transport for 2024',
      mimeType: 'application/json',
    },
    {
      uri: 'sustainability://transportation/2025',
      name: '2025 Transportation Calculations',
      description:
        'Detailed transportation emissions calculations including suppliers, distances, weights, and multi-modal transport for 2025',
      mimeType: 'application/json',
    },

    // Summary resource - all years overview
    {
      uri: 'sustainability://summary/all',
      name: 'Multi-Year Summary',
      description:
        'Overview of emissions trends and key metrics across all years (2023-2025)',
      mimeType: 'application/json',
    },

    // LCBO distances
    {
      uri: 'sustainability://lcbo/distances',
      name: 'LCBO Store Distances',
      description:
        'Distances from Top Shelf to LCBO stores for distribution analysis',
      mimeType: 'application/json',
    },
  ];
}

export async function readResource(
  uri: string,
  db: SustainabilityDatabase
): Promise<string> {
  // Parse the URI
  if (!uri.startsWith('sustainability://')) {
    throw new Error(`Invalid resource URI: ${uri}`);
  }

  const path = uri.replace('sustainability://', '');
  const parts = path.split('/');

  if (parts.length < 2) {
    throw new Error(`Invalid resource path: ${path}`);
  }

  const resourceType = parts[0];
  const identifier = parts[1];

  // Handle different resource types
  if (resourceType === 'totals') {
    return await readTotalsResource(identifier, db);
  } else if (resourceType === 'transportation') {
    return await readTransportationResource(identifier, db);
  } else if (resourceType === 'summary') {
    return await readSummaryResource(identifier, db);
  } else if (resourceType === 'lcbo') {
    return await readLcboResource(identifier, db);
  } else {
    throw new Error(`Unknown resource type: ${resourceType}`);
  }
}

async function readTotalsResource(
  yearStr: string,
  db: SustainabilityDatabase
): Promise<string> {
  const year = parseInt(yearStr);

  // Query the totals_sheet table
  const totalsResult = await db['pool'].query(
    `
    SELECT
      year,
      total_emissions_kg,
      total_lpa,
      emissions_ratio,
      water_use_ratio,
      energy_use_ratio,
      natural_gas_kwh,
      electricity_kwh,
      total_energy_kwh
    FROM totals_sheet
    WHERE year = $1
  `,
    [year]
  );

  if (totalsResult.rows.length === 0) {
    throw new Error(`No totals data found for year ${year}`);
  }

  const data: any = totalsResult.rows[0];

  // Add scope breakdown from emissions_records
  const scopeResult = await db['pool'].query(
    `
    SELECT
      scope,
      SUM(co2e_emissions_kg) as total_emissions,
      COUNT(*) as record_count
    FROM emissions_records
    WHERE year = $1 AND co2e_emissions_kg IS NOT NULL
    GROUP BY scope
    ORDER BY scope
  `,
    [year]
  );

  if (scopeResult.rows.length > 0) {
    data.scope_breakdown = scopeResult.rows.map((row: any) => ({
      scope: row.scope,
      emissions_kgco2e: Number(row.total_emissions || 0),
      record_count: row.record_count,
    }));
  }

  return JSON.stringify(data, null, 2);
}

async function readTransportationResource(
  yearStr: string,
  db: SustainabilityDatabase
): Promise<string> {
  const year = parseInt(yearStr);

  const result = await db['pool'].query(
    `
    SELECT
      year,
      supplier,
      item,
      distance_km,
      transport_mode,
      transport_ef,
      ef_unit,
      emissions_kgco2e,
      weight_kg,
      weight_tonnes,
      weight_shipped_per_year_kg,
      weight_shipped_per_year_tonnes,
      combined_emissions_kgco2e,
      ship_emissions_kgco2e,
      truck_emissions_kgco2e,
      bottles_shipped_per_year,
      casks_shipped_per_year,
      density_kg_per_l,
      volume_shipped_per_year_l
    FROM transportation_calcs
    WHERE year = $1
    ORDER BY COALESCE(combined_emissions_kgco2e, emissions_kgco2e, 0) DESC
  `,
    [year]
  );

  if (result.rows.length === 0) {
    throw new Error(`No transportation data found for year ${year}`);
  }

  const records = result.rows;

  // Calculate summary statistics
  const totalEmissions = records.reduce((sum, r: any) => {
    return sum + Number(r.combined_emissions_kgco2e || r.emissions_kgco2e || 0);
  }, 0);

  // Count multi-modal vs single-mode transport
  const multiModal = records.filter((r: any) => r.combined_emissions_kgco2e).length;
  const singleModal = records.length - multiModal;

  const data = {
    year,
    summary: {
      total_transportation_emissions_kg: Math.round(totalEmissions * 100) / 100,
      number_of_routes: records.length,
      multi_modal_routes: multiModal,
      single_modal_routes: singleModal,
    },
    records,
  };

  return JSON.stringify(data, null, 2);
}

async function readSummaryResource(
  identifier: string,
  db: SustainabilityDatabase
): Promise<string> {
  if (identifier !== 'all') {
    throw new Error(`Unknown summary identifier: ${identifier}`);
  }

  const years = [2023, 2024, 2025];
  const summary: any = {
    years_available: years,
    totals_by_year: [],
    trends: {},
  };

  // Get totals for each year
  const result = await db['pool'].query(
    `
    SELECT
      year,
      total_emissions_kg,
      total_lpa,
      emissions_ratio
    FROM totals_sheet
    WHERE year = ANY($1)
    ORDER BY year
  `,
    [years]
  );

  summary.totals_by_year = result.rows;

  // Calculate trends
  if (result.rows.length >= 2) {
    const first = result.rows[0];
    const last = result.rows[result.rows.length - 1];

    if (first.total_emissions_kg && last.total_emissions_kg) {
      const change = Number(last.total_emissions_kg) - Number(first.total_emissions_kg);
      const percentChange = (change / Number(first.total_emissions_kg)) * 100;

      summary.trends.total_emissions = {
        change_kg: Math.round(change * 100) / 100,
        percent_change: Math.round(percentChange * 100) / 100,
        direction: change > 0 ? 'increase' : change < 0 ? 'decrease' : 'stable',
      };
    }
  }

  return JSON.stringify(summary, null, 2);
}

async function readLcboResource(
  identifier: string,
  db: SustainabilityDatabase
): Promise<string> {
  if (identifier !== 'distances') {
    throw new Error(`Unknown LCBO identifier: ${identifier}`);
  }

  const result = await db['pool'].query(`
    SELECT
      year,
      city,
      address,
      distance_from_top_shelf_km
    FROM lcbo_store_distances
    ORDER BY year, distance_from_top_shelf_km NULLS LAST
  `);

  if (result.rows.length === 0) {
    return JSON.stringify(
      { stores: [], note: 'No LCBO distance data available' },
      null,
      2
    );
  }

  const stores = result.rows;

  // Group by year
  const byYear: Record<number, any[]> = {};
  for (const store of stores) {
    const year = store.year;
    if (!byYear[year]) {
      byYear[year] = [];
    }
    byYear[year].push({
      city: store.city,
      address: store.address,
      distance_km: store.distance_from_top_shelf_km,
    });
  }

  const data = {
    total_stores: stores.length,
    stores_by_year: byYear,
    all_stores: stores,
  };

  return JSON.stringify(data, null, 2);
}
