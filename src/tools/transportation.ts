/**
 * Transportation query tools
 */

import { SustainabilityDatabase } from '../database.js';

export interface GetTransportationBySupplierArgs {
  supplier: string;
  year?: number;
}

export interface ListSuppliersArgs {
  year?: number;
}

export async function handleGetTransportationBySupplier(
  db: SustainabilityDatabase,
  args: GetTransportationBySupplierArgs
) {
  const { supplier, year } = args;

  let query = `
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
      combined_emissions_kgco2e,
      ship_emissions_kgco2e,
      truck_emissions_kgco2e
    FROM transportation_calcs
    WHERE supplier ILIKE $1
  `;
  const params: (string | number)[] = [`%${supplier}%`];

  if (year !== undefined) {
    params.push(year);
    query += ` AND year = $${params.length}`;
  }

  query += ' ORDER BY year, COALESCE(combined_emissions_kgco2e, emissions_kgco2e, 0) DESC';

  const result = await db['pool'].query(query, params);

  if (result.rows.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              error: `No transportation data found for supplier matching: ${supplier}`,
              suggestion: 'Try a partial name or use list_suppliers tool to see all suppliers',
            },
            null,
            2
          ),
        },
      ],
    };
  }

  // Calculate total emissions
  const totalEmissions = result.rows.reduce((sum, r) => {
    return sum + Number(r.combined_emissions_kgco2e || r.emissions_kgco2e || 0);
  }, 0);

  const response = {
    supplier: result.rows[0].supplier,
    total_routes: result.rows.length,
    total_emissions_kgco2e: Math.round(totalEmissions * 100) / 100,
    routes: result.rows.map((r) => ({
      year: r.year,
      item: r.item,
      distance_km: r.distance_km,
      transport_mode: r.transport_mode,
      emissions_kgco2e: Number(r.combined_emissions_kgco2e || r.emissions_kgco2e || 0),
      weight_kg: r.weight_kg,
      weight_tonnes: r.weight_tonnes,
      transport_ef: r.transport_ef,
      ef_unit: r.ef_unit,
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

export async function handleListSuppliers(
  db: SustainabilityDatabase,
  args: ListSuppliersArgs
) {
  const { year } = args;

  let query = 'SELECT DISTINCT supplier FROM transportation_calcs';
  const params: number[] = [];

  if (year !== undefined) {
    params.push(year);
    query += ' WHERE year = $1';
  }

  query += ' ORDER BY supplier';

  const result = await db['pool'].query(query, params);

  const suppliers = result.rows.map((r) => r.supplier);

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            total_suppliers: suppliers.length,
            year: year || 'all years',
            suppliers,
          },
          null,
          2
        ),
      },
    ],
  };
}
