/**
 * Database connection and query utilities for sustainability data
 */

import pg from 'pg';
import dotenv from 'dotenv';

const { Pool } = pg;

// Load environment variables
dotenv.config();

export interface EmissionRecord {
  year: number;
  scope: number;
  source: string;
  category: string;
  amount: number | null;
  unit: string | null;
  emissions_factor: number | null;
  ef_unit: string | null;
  co2e_emissions_kg: number | null;
  percentage: number | null;
}

export interface ScopeBreakdown {
  scope: number;
  emissions_kgco2e: number;
  percentage: number;
  record_count: number;
}

export interface TopSource {
  source: string;
  category: string;
  scope: number;
  co2e_emissions_kg: number;
}

export interface CategoryBreakdown {
  category: string;
  record_count: number;
  total_emissions: number | null;
}

export interface SummaryStats {
  year: number;
  totals?: {
    total_emissions_kg: number;
    total_lpa: number;
    emissions_ratio: number;
    water_use_ratio: number;
    energy_use_ratio: number;
    natural_gas_kwh?: number;
    electricity_kwh?: number;
    total_energy_kwh?: number;
  };
  scope_breakdown: ScopeBreakdown[];
  top_sources: TopSource[];
  category_breakdown: CategoryBreakdown[];
}

export interface TrendData {
  metric: string;
  years: number[];
  values: number[];
}

export interface BreakdownData {
  year: number;
  group_by: string;
  labels: string[];
  values: number[];
}

export class SustainabilityDatabase {
  private pool: pg.Pool;

  constructor() {
    this.pool = new Pool({
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT || '5432'),
      ssl: process.env.DB_SSL_MODE ? { rejectUnauthorized: false } : undefined,
    });
  }

  /**
   * Query emissions records for a specific year with optional filters
   */
  async getEmissionsByYear(
    year: number,
    scope?: number,
    category?: string
  ): Promise<EmissionRecord[]> {
    let query = `
      SELECT
        year,
        scope,
        source,
        category,
        amount,
        unit,
        emissions_factor,
        ef_unit,
        co2e_emissions_kg,
        percentage
      FROM emissions_records
      WHERE year = $1
    `;
    const params: (number | string)[] = [year];

    if (scope !== undefined) {
      params.push(scope);
      query += ` AND scope = $${params.length}`;
    }

    if (category !== undefined) {
      params.push(category);
      query += ` AND category = $${params.length}`;
    }

    query += ' ORDER BY co2e_emissions_kg DESC NULLS LAST';

    const result = await this.pool.query<EmissionRecord>(query, params);
    return result.rows;
  }

  /**
   * Get aggregated statistics for a specific year
   */
  async getSummaryStats(year: number): Promise<SummaryStats> {
    const summary: SummaryStats = {
      year,
      scope_breakdown: [],
      top_sources: [],
      category_breakdown: [],
    };

    // Get totals from totals table
    const totalsResult = await this.pool.query(
      `
      SELECT
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

    if (totalsResult.rows.length > 0) {
      summary.totals = totalsResult.rows[0];
    }

    // Get scope breakdown
    const scopeResult = await this.pool.query<{
      scope: number;
      total_emissions: number;
      record_count: number;
    }>(
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

    const totalEmissions = scopeResult.rows.reduce(
      (sum, row) => sum + (row.total_emissions || 0),
      0
    );

    summary.scope_breakdown = scopeResult.rows.map((row) => ({
      scope: row.scope,
      emissions_kgco2e: Number(row.total_emissions || 0),
      percentage:
        totalEmissions > 0
          ? (Number(row.total_emissions || 0) / totalEmissions) * 100
          : 0,
      record_count: row.record_count,
    }));

    // Get top 5 sources
    const topSourcesResult = await this.pool.query<TopSource>(
      `
      SELECT
        source,
        category,
        scope,
        co2e_emissions_kg
      FROM emissions_records
      WHERE year = $1 AND co2e_emissions_kg IS NOT NULL
      ORDER BY co2e_emissions_kg DESC
      LIMIT 5
    `,
      [year]
    );
    summary.top_sources = topSourcesResult.rows;

    // Get category breakdown
    const categoryResult = await this.pool.query<CategoryBreakdown>(
      `
      SELECT
        category,
        COUNT(*) as record_count,
        SUM(co2e_emissions_kg) as total_emissions
      FROM emissions_records
      WHERE year = $1 AND category IS NOT NULL
      GROUP BY category
      ORDER BY total_emissions DESC NULLS LAST
    `,
      [year]
    );
    summary.category_breakdown = categoryResult.rows;

    return summary;
  }

  /**
   * Get time series data for a specific metric across multiple years
   */
  async getEmissionsTrend(
    years: number[],
    metric: string
  ): Promise<TrendData> {
    const data: TrendData = {
      metric,
      years: [],
      values: [],
    };

    if (metric === 'total_emissions') {
      const result = await this.pool.query<{
        year: number;
        total_emissions_kg: number;
      }>(
        `
        SELECT year, total_emissions_kg
        FROM totals_sheet
        WHERE year = ANY($1)
        ORDER BY year
      `,
        [years]
      );
      data.years = result.rows.map((row) => row.year);
      data.values = result.rows.map((row) =>
        Number(row.total_emissions_kg || 0)
      );
    } else if (metric === 'emissions_per_lpa') {
      const result = await this.pool.query<{
        year: number;
        emissions_ratio: number;
      }>(
        `
        SELECT year, emissions_ratio
        FROM totals_sheet
        WHERE year = ANY($1)
        ORDER BY year
      `,
        [years]
      );
      data.years = result.rows.map((row) => row.year);
      data.values = result.rows.map((row) =>
        Number(row.emissions_ratio || 0)
      );
    } else if (metric.startsWith('scope_')) {
      const scopeNum = parseInt(metric.split('_')[1]);
      const result = await this.pool.query<{ year: number; total: number }>(
        `
        SELECT year, SUM(co2e_emissions_kg) as total
        FROM emissions_records
        WHERE year = ANY($1) AND scope = $2 AND co2e_emissions_kg IS NOT NULL
        GROUP BY year
        ORDER BY year
      `,
        [years, scopeNum]
      );
      data.years = result.rows.map((row) => row.year);
      data.values = result.rows.map((row) => Number(row.total || 0));
    }

    return data;
  }

  /**
   * Get emissions breakdown for visualization
   */
  async getBreakdownData(
    year: number,
    groupBy: string
  ): Promise<BreakdownData> {
    const data: BreakdownData = {
      year,
      group_by: groupBy,
      labels: [],
      values: [],
    };

    if (groupBy === 'scope') {
      const result = await this.pool.query<{ scope: number; total: number }>(
        `
        SELECT
          scope,
          SUM(co2e_emissions_kg) as total
        FROM emissions_records
        WHERE year = $1 AND co2e_emissions_kg IS NOT NULL
        GROUP BY scope
        ORDER BY scope
      `,
        [year]
      );
      data.labels = result.rows.map((row) => `Scope ${row.scope}`);
      data.values = result.rows.map((row) => Number(row.total || 0));
    } else if (groupBy === 'category') {
      const result = await this.pool.query<{ category: string; total: number }>(
        `
        SELECT
          category,
          SUM(co2e_emissions_kg) as total
        FROM emissions_records
        WHERE year = $1 AND category IS NOT NULL AND co2e_emissions_kg IS NOT NULL
        GROUP BY category
        ORDER BY total DESC
      `,
        [year]
      );
      data.labels = result.rows.map((row) => row.category);
      data.values = result.rows.map((row) => Number(row.total || 0));
    } else if (groupBy === 'top_sources') {
      const result = await this.pool.query<{
        source: string;
        co2e_emissions_kg: number;
      }>(
        `
        SELECT
          source,
          co2e_emissions_kg
        FROM emissions_records
        WHERE year = $1 AND co2e_emissions_kg IS NOT NULL
        ORDER BY co2e_emissions_kg DESC
        LIMIT 10
      `,
        [year]
      );
      data.labels = result.rows.map((row) => row.source);
      data.values = result.rows.map((row) => Number(row.co2e_emissions_kg || 0));
    }

    return data;
  }

  /**
   * Close the database connection pool
   */
  async close(): Promise<void> {
    await this.pool.end();
  }
}
