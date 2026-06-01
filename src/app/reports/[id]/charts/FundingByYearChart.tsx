'use client'

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts'

interface FundingByYearData {
  year: number
  funding: number
  projects: number
  isPartial?: boolean
}

interface FundingByYearChartProps {
  data: FundingByYearData[]
  height?: number
}

const formatFunding = (value: number): string => {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(0)}M`
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`
  return `$${value.toLocaleString()}`
}

const COLORS = {
  bar: '#E07A5F',         // full year
  barPartial: '#F3C7BC',  // partial year (lighter tint) — accessible label suffix below
  grid: '#E5E5E5',
  text: '#525252',
}

export function FundingByYearChart({ data, height = 300 }: FundingByYearChartProps) {
  // Sort by year ascending; append "YTD" to the x-axis label of partial years
  // so the visual distinction doesn't rely on color alone.
  const sortedData = [...data]
    .sort((a, b) => a.year - b.year)
    .map((d) => ({
      ...d,
      xLabel: d.isPartial ? `${d.year} YTD` : String(d.year),
    }))

  const hasPartial = sortedData.some((d) => d.isPartial)

  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={sortedData}
          margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} vertical={false} />
          <XAxis
            dataKey="xLabel"
            tick={{ fill: COLORS.text, fontSize: 12 }}
            axisLine={{ stroke: COLORS.grid }}
            tickLine={false}
          />
          <YAxis
            tickFormatter={formatFunding}
            tick={{ fill: COLORS.text, fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            width={60}
          />
          <Tooltip
            formatter={(value) => [formatFunding(typeof value === 'number' ? value : 0), 'Funding']}
            labelFormatter={(label) => `FY ${String(label)}`}
            contentStyle={{
              backgroundColor: 'white',
              border: '1px solid #E5E5E5',
              borderRadius: '8px',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
            }}
          />
          <Bar
            dataKey="funding"
            radius={[4, 4, 0, 0]}
            maxBarSize={50}
          >
            {sortedData.map((d, index) => (
              <Cell key={`cell-${index}`} fill={d.isPartial ? COLORS.barPartial : COLORS.bar} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      {hasPartial && (
        <p className="text-xs text-gray-500 mt-1 ml-1">
          Lighter bar = partial fiscal year (YTD only); not directly comparable to fully-reported prior years.
        </p>
      )}
    </div>
  )
}
