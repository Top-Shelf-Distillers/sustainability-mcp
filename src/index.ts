#!/usr/bin/env node

/**
 * Sustainability Data MCP Server
 *
 * A Model Context Protocol (MCP) server that exposes sustainability emissions data
 * to Claude, enabling natural language queries and interactive visualization generation.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { SustainabilityDatabase } from './database.js';
import { listResources, readResource } from './resources.js';
import { handleGetEmissionsByYear } from './tools/emissions.js';
import { handleGetEmissionsSummary } from './tools/totals.js';
import {
  handleCreateTrendChart,
  handleCreateBreakdownChart,
} from './tools/visualize.js';
import {
  handleGetTransportationBySupplier,
  handleListSuppliers,
} from './tools/transportation.js';

// Create server instance
const server = new McpServer(
  {
    name: 'sustainability-data',
    version: '0.1.0',
  },
  {
    capabilities: {
      resources: {},
      tools: {},
    },
  }
);

// Initialize database connection
const db = new SustainabilityDatabase();

// Register tools
server.registerTool(
  'get_emissions_by_year',
  {
    description:
      'Query emissions data for a specific year with optional filters. ' +
      'Returns detailed emission records including source, category, scope, ' +
      'and CO2e emissions. Can filter by scope (1, 2, or 3) and category.',
    inputSchema: {
      year: z.number().min(2023).max(2025).describe('Year to query (2023-2025)'),
      scope: z.number().optional().describe('Optional: Filter by scope (1, 2, or 3)'),
      category: z.string().optional().describe('Optional: Filter by category name'),
    },
  },
  async (args) => handleGetEmissionsByYear(db, args)
);

server.registerTool(
  'get_emissions_summary',
  {
    description:
      'Get aggregated statistics and insights for a specific year. ' +
      'Returns total emissions, scope breakdown with percentages, ' +
      'top emission sources, category breakdown, and key metrics like ' +
      'emissions per LPA.',
    inputSchema: {
      year: z.number().min(2023).max(2025).describe('Year to summarize (2023-2025)'),
    },
  },
  async (args) => handleGetEmissionsSummary(db, args)
);

server.registerTool(
  'create_trend_chart',
  {
    description:
      'Generate an interactive line chart showing emissions trends over time. ' +
      'Supports metrics: total_emissions, emissions_per_lpa, scope_1, scope_2, scope_3. ' +
      'Returns an HTML visualization that can be viewed in a browser.',
    inputSchema: {
      metric: z.enum(['total_emissions', 'emissions_per_lpa', 'scope_1', 'scope_2', 'scope_3']).describe('Metric to trend'),
      start_year: z.number().min(2023).max(2025).optional().describe('Start year (default: 2023)'),
      end_year: z.number().min(2023).max(2025).optional().describe('End year (default: 2025)'),
    },
  },
  async (args) => handleCreateTrendChart(db, args)
);

server.registerTool(
  'create_breakdown_chart',
  {
    description:
      'Create a bar or pie chart breaking down emissions by category. ' +
      'Can group by: scope (1/2/3), category (operational categories), ' +
      'or top_sources (highest emitting sources). Supports both bar and pie chart types.',
    inputSchema: {
      year: z.number().min(2023).max(2025).describe('Year to visualize (2023-2025)'),
      group_by: z
        .enum(['scope', 'category', 'top_sources'])
        .describe('How to group the data'),
      chart_type: z.enum(['bar', 'pie']).optional().describe('Chart type (default: bar)'),
    },
  },
  async (args) => handleCreateBreakdownChart(db, args)
);

server.registerTool(
  'get_transportation_by_supplier',
  {
    description:
      'Query transportation data for a specific supplier. ' +
      'Returns distance, transport mode, emissions, and weight data. ' +
      'Supports partial name matching (e.g., "Mississippi" finds "Mississippi Mills Malting Co.").',
    inputSchema: {
      supplier: z.string().describe('Supplier name (partial match supported, e.g. "Mississippi" matches "Mississippi Mills Malting Co.")'),
      year: z.number().min(2023).max(2025).optional().describe('Optional: Filter by year (2023-2025)'),
    },
  },
  async (args) => handleGetTransportationBySupplier(db, args)
);

server.registerTool(
  'list_suppliers',
  {
    description:
      'List all suppliers in the transportation database. ' +
      'Use this to discover available supplier names before querying specific suppliers.',
    inputSchema: {
      year: z.number().min(2023).max(2025).optional().describe('Optional: Filter by year (2023-2025)'),
    },
  },
  async (args) => handleListSuppliers(db, args)
);

// Register resources
const resources = listResources();
for (const resource of resources) {
  server.registerResource(
    resource.name,
    resource.uri,
    {
      description: resource.description,
      mimeType: resource.mimeType,
    },
    async (uri: URL) => {
      const contents = await readResource(uri.toString(), db);
      return {
        contents: [
          {
            uri: uri.toString(),
            mimeType: 'application/json',
            text: contents,
          },
        ],
      };
    }
  );
}

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Sustainability MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
