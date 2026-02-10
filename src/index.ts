#!/usr/bin/env node

/**
 * Sustainability Data MCP Server
 *
 * A Model Context Protocol (MCP) server that exposes sustainability emissions data
 * to Claude, enabling natural language queries and interactive visualization generation.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
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
const server = new Server(
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

// Tool schemas
const GET_EMISSIONS_BY_YEAR_SCHEMA = {
  type: 'object' as const,
  properties: {
    year: {
      type: 'number' as const,
      description: 'Year to query (2023-2025)',
      minimum: 2023,
      maximum: 2025,
    },
    scope: {
      type: 'number' as const,
      description: 'Optional: Filter by scope (1, 2, or 3)',
      enum: [1, 2, 3],
    },
    category: {
      type: 'string' as const,
      description: 'Optional: Filter by category name',
    },
  },
  required: ['year'],
};

const GET_EMISSIONS_SUMMARY_SCHEMA = {
  type: 'object' as const,
  properties: {
    year: {
      type: 'number' as const,
      description: 'Year to summarize (2023-2025)',
      minimum: 2023,
      maximum: 2025,
    },
  },
  required: ['year'],
};

const CREATE_TREND_CHART_SCHEMA = {
  type: 'object' as const,
  properties: {
    metric: {
      type: 'string' as const,
      description: 'Metric to trend',
      enum: [
        'total_emissions',
        'emissions_per_lpa',
        'scope_1',
        'scope_2',
        'scope_3',
      ],
    },
    start_year: {
      type: 'number' as const,
      description: 'Start year (default: 2023)',
      minimum: 2023,
      maximum: 2025,
    },
    end_year: {
      type: 'number' as const,
      description: 'End year (default: 2025)',
      minimum: 2023,
      maximum: 2025,
    },
  },
  required: ['metric'],
};

const CREATE_BREAKDOWN_CHART_SCHEMA = {
  type: 'object' as const,
  properties: {
    year: {
      type: 'number' as const,
      description: 'Year to visualize (2023-2025)',
      minimum: 2023,
      maximum: 2025,
    },
    group_by: {
      type: 'string' as const,
      description: 'How to group the data',
      enum: ['scope', 'category', 'top_sources'],
    },
    chart_type: {
      type: 'string' as const,
      description: 'Chart type (default: bar)',
      enum: ['bar', 'pie'],
    },
  },
  required: ['year', 'group_by'],
};

const GET_TRANSPORTATION_BY_SUPPLIER_SCHEMA = {
  type: 'object' as const,
  properties: {
    supplier: {
      type: 'string' as const,
      description: 'Supplier name (partial match supported, e.g. "Mississippi" matches "Mississippi Mills Malting Co.")',
    },
    year: {
      type: 'number' as const,
      description: 'Optional: Filter by year (2023-2025)',
      minimum: 2023,
      maximum: 2025,
    },
  },
  required: ['supplier'],
};

const LIST_SUPPLIERS_SCHEMA = {
  type: 'object' as const,
  properties: {
    year: {
      type: 'number' as const,
      description: 'Optional: Filter by year (2023-2025)',
      minimum: 2023,
      maximum: 2025,
    },
  },
};

// List tools handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'get_emissions_by_year',
        description:
          'Query emissions data for a specific year with optional filters. ' +
          'Returns detailed emission records including source, category, scope, ' +
          'and CO2e emissions. Can filter by scope (1, 2, or 3) and category.',
        inputSchema: GET_EMISSIONS_BY_YEAR_SCHEMA,
      },
      {
        name: 'get_emissions_summary',
        description:
          'Get aggregated statistics and insights for a specific year. ' +
          'Returns total emissions, scope breakdown with percentages, ' +
          'top emission sources, category breakdown, and key metrics like ' +
          'emissions per LPA.',
        inputSchema: GET_EMISSIONS_SUMMARY_SCHEMA,
      },
      {
        name: 'create_trend_chart',
        description:
          'Generate an interactive line chart showing emissions trends over time. ' +
          'Supports metrics: total_emissions, emissions_per_lpa, scope_1, scope_2, scope_3. ' +
          'Returns an HTML visualization that can be viewed in a browser.',
        inputSchema: CREATE_TREND_CHART_SCHEMA,
      },
      {
        name: 'create_breakdown_chart',
        description:
          'Create a bar or pie chart breaking down emissions by category. ' +
          'Can group by: scope (1/2/3), category (operational categories), ' +
          'or top_sources (highest emitting sources). Supports both bar and pie chart types.',
        inputSchema: CREATE_BREAKDOWN_CHART_SCHEMA,
      },
      {
        name: 'get_transportation_by_supplier',
        description:
          'Query transportation data for a specific supplier. ' +
          'Returns distance, transport mode, emissions, and weight data. ' +
          'Supports partial name matching (e.g., "Mississippi" finds "Mississippi Mills Malting Co.").',
        inputSchema: GET_TRANSPORTATION_BY_SUPPLIER_SCHEMA,
      },
      {
        name: 'list_suppliers',
        description:
          'List all suppliers in the transportation database. ' +
          'Use this to discover available supplier names before querying specific suppliers.',
        inputSchema: LIST_SUPPLIERS_SCHEMA,
      },
    ],
  };
});

// Call tool handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params;

    switch (name) {
      case 'get_emissions_by_year':
        return await handleGetEmissionsByYear(db, args as any);

      case 'get_emissions_summary':
        return await handleGetEmissionsSummary(db, args as any);

      case 'create_trend_chart':
        return await handleCreateTrendChart(db, args as any);

      case 'create_breakdown_chart':
        return await handleCreateBreakdownChart(db, args as any);

      case 'get_transportation_by_supplier':
        return await handleGetTransportationBySupplier(db, args as any);

      case 'list_suppliers':
        return await handleListSuppliers(db, args as any);

      default:
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  error: `Unknown tool: ${name}`,
                  available_tools: [
                    'get_emissions_by_year',
                    'get_emissions_summary',
                    'create_trend_chart',
                    'create_breakdown_chart',
                    'get_transportation_by_supplier',
                    'list_suppliers',
                  ],
                },
                null,
                2
              ),
            },
          ],
        };
    }
  } catch (error) {
    const err = error as Error;
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              error: err.message,
              tool: request.params.name,
              arguments: request.params.arguments,
            },
            null,
            2
          ),
        },
      ],
      isError: true,
    };
  }
});

// List resources handler
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: listResources(),
  };
});

// Read resource handler
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  try {
    const { uri } = request.params;
    const contents = await readResource(uri, db);
    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: contents,
        },
      ],
    };
  } catch (error) {
    const err = error as Error;
    return {
      contents: [
        {
          uri: request.params.uri,
          mimeType: 'application/json',
          text: JSON.stringify({ error: err.message, uri: request.params.uri }, null, 2),
        },
      ],
    };
  }
});

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
