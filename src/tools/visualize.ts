/**
 * Visualization tools for emissions data
 */

import { SustainabilityDatabase } from '../database.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeFile } from 'fs/promises';
// @ts-ignore
import Plotly from 'plotly.js-dist-min';

export interface CreateTrendChartArgs {
  metric: string;
  start_year?: number;
  end_year?: number;
}

export interface CreateBreakdownChartArgs {
  year: number;
  group_by: string;
  chart_type?: 'bar' | 'pie';
}

function createPlotlyHTML(plotData: any[], layout: any): string {
  // Create a basic HTML structure with Plotly
  return `<!DOCTYPE html>
<html>
<head>
    <script src="https://cdn.plot.ly/plotly-latest.min.js"></script>
</head>
<body>
    <div id="chart"></div>
    <script>
        var data = ${JSON.stringify(plotData)};
        var layout = ${JSON.stringify(layout)};
        Plotly.newPlot('chart', data, layout);
    </script>
</body>
</html>`;
}

export async function handleCreateTrendChart(
  db: SustainabilityDatabase,
  args: CreateTrendChartArgs
) {
  const { metric, start_year = 2023, end_year = 2025 } = args;

  // Generate year range
  const years: number[] = [];
  for (let y = start_year; y <= end_year; y++) {
    years.push(y);
  }

  // Get trend data from database
  const trendData = await db.getEmissionsTrend(years, metric);

  if (trendData.values.length === 0) {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              error: `No data found for metric '${metric}' in years ${start_year}-${end_year}`,
              metric,
              years_queried: years,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  // Determine y-axis title based on metric
  let yTitle = 'Value';
  if (metric.includes('emissions') && metric !== 'emissions_per_lpa') {
    yTitle = 'kg CO2e';
  } else if (metric === 'emissions_per_lpa') {
    yTitle = 'kg CO2e per LPA';
  }

  // Create plotly data
  const plotData = [
    {
      x: trendData.years,
      y: trendData.values,
      mode: 'lines+markers',
      name: metric.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase()),
      line: { width: 3, color: '#2E86AB' },
      marker: { size: 10, color: '#A23B72' },
      type: 'scatter',
    },
  ];

  const layout = {
    title: {
      text: `${metric.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())} Trend Over Time`,
      x: 0.5,
      xanchor: 'center',
      font: { size: 20 },
    },
    xaxis: {
      title: 'Year',
      showgrid: true,
      gridwidth: 1,
      gridcolor: 'lightgray',
    },
    yaxis: {
      title: yTitle,
      showgrid: true,
      gridwidth: 1,
      gridcolor: 'lightgray',
    },
    template: 'plotly_white',
    hovermode: 'x unified',
    showlegend: true,
    height: 500,
    margin: { l: 50, r: 50, t: 80, b: 50 },
  };

  // Create HTML
  const chartHtml = createPlotlyHTML(plotData, layout);

  // Calculate trend analysis
  let summary = '';
  if (trendData.values.length >= 2) {
    const firstValue = trendData.values[0];
    const lastValue = trendData.values[trendData.values.length - 1];
    const change = lastValue - firstValue;
    const percentChange = firstValue !== 0 ? (change / firstValue) * 100 : 0;

    const trendDirection =
      change > 0 ? 'increased' : change < 0 ? 'decreased' : 'remained stable';

    summary = `${metric.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())} ${trendDirection} from ${firstValue.toFixed(2)} in ${trendData.years[0]} to ${lastValue.toFixed(2)} in ${trendData.years[trendData.years.length - 1]} (${percentChange > 0 ? '+' : ''}${percentChange.toFixed(1)}%)`;
  } else {
    summary = `Single data point for ${metric}`;
  }

  // Save HTML to temporary file
  const tempDir = tmpdir();
  const chartPath = join(tempDir, `trend_${metric}_${start_year}_${end_year}.html`);
  await writeFile(chartPath, chartHtml);

  const response = {
    chart_type: 'line',
    metric,
    years: trendData.years,
    values: trendData.values.map((v) => Math.round(v * 100) / 100),
    data_points: trendData.values.length,
    summary,
    chart_saved_to: chartPath,
    note: 'Open the HTML file in a browser to view the interactive chart',
  };

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(response, null, 2),
      },
      {
        type: 'resource' as const,
        resource: {
          uri: `file://${chartPath}`,
          mimeType: 'text/html',
          text: chartHtml,
        },
      },
    ],
  };
}

export async function handleCreateBreakdownChart(
  db: SustainabilityDatabase,
  args: CreateBreakdownChartArgs
) {
  const { year, group_by, chart_type = 'bar' } = args;

  // Get breakdown data from database
  const breakdownData = await db.getBreakdownData(year, group_by);

  if (breakdownData.labels.length === 0) {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              error: `No data found for year ${year} grouped by ${group_by}`,
              year,
              group_by,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  let plotData: any[];
  let layout: any;

  if (chart_type === 'pie') {
    plotData = [
      {
        labels: breakdownData.labels,
        values: breakdownData.values,
        type: 'pie',
        hole: 0.3,
        marker: {
          colors: ['#2E86AB', '#A23B72', '#F18F01', '#C73E1D', '#6A994E', '#BC4B51'],
        },
      },
    ];

    layout = {
      title: {
        text: `${year} Emissions Breakdown by ${group_by.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())}`,
        x: 0.5,
        xanchor: 'center',
        font: { size: 20 },
      },
      height: 600,
      showlegend: true,
      margin: { l: 50, r: 50, t: 80, b: 50 },
    };
  } else {
    // bar chart
    plotData = [
      {
        x: breakdownData.labels,
        y: breakdownData.values,
        type: 'bar',
        marker: {
          color: breakdownData.values,
          colorscale: 'Viridis',
          showscale: true,
          colorbar: { title: 'kg CO2e' },
        },
        text: breakdownData.values.map((v) => v.toFixed(0)),
        textposition: 'outside',
      },
    ];

    layout = {
      title: {
        text: `${year} Emissions Breakdown by ${group_by.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())}`,
        x: 0.5,
        xanchor: 'center',
        font: { size: 20 },
      },
      xaxis: {
        title: group_by.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase()),
        tickangle: breakdownData.labels.length > 5 ? -45 : 0,
      },
      yaxis: {
        title: 'kg CO2e',
        showgrid: true,
        gridwidth: 1,
        gridcolor: 'lightgray',
      },
      template: 'plotly_white',
      height: 600,
      showlegend: false,
      margin: { l: 50, r: 50, t: 80, b: 100 },
    };
  }

  // Create HTML
  const chartHtml = createPlotlyHTML(plotData, layout);

  // Calculate summary statistics
  const total = breakdownData.values.reduce((sum, v) => sum + v, 0);
  const maxValue = Math.max(...breakdownData.values);
  const maxIndex = breakdownData.values.indexOf(maxValue);
  const topContributor = breakdownData.labels[maxIndex] || 'N/A';
  const topPercentage = total > 0 ? (maxValue / total) * 100 : 0;

  // Save HTML to temporary file
  const tempDir = tmpdir();
  const chartPath = join(
    tempDir,
    `breakdown_${year}_${group_by}_${chart_type}.html`
  );
  await writeFile(chartPath, chartHtml);

  const response = {
    chart_type,
    year,
    group_by,
    categories: breakdownData.labels,
    values: breakdownData.values.map((v) => Math.round(v * 100) / 100),
    total_emissions_kgco2e: Math.round(total * 100) / 100,
    top_contributor: {
      name: topContributor,
      emissions_kgco2e: Math.round(maxValue * 100) / 100,
      percentage_of_total: Math.round(topPercentage * 100) / 100,
    },
    chart_saved_to: chartPath,
    note: 'Open the HTML file in a browser to view the interactive chart',
  };

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(response, null, 2),
      },
      {
        type: 'resource' as const,
        resource: {
          uri: `file://${chartPath}`,
          mimeType: 'text/html',
          text: chartHtml,
        },
      },
    ],
  };
}
