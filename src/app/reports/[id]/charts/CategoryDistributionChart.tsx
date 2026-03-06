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

interface CategoryData {
  category: string
  projects: number
  funding: number
}

interface CategoryDistributionChartProps {
  data: CategoryData[]
  height?: number
  showFunding?: boolean
}

const formatFunding = (value: number): string => {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(0)}M`
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`
  return `$${value.toLocaleString()}`
}

const formatCategory = (category: string): string => {
  return category
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .substring(0, 20) + (category.length > 20 ? '...' : '')
}

// Color palette
const CATEGORY_COLORS = [
  '#E07A5F',
  '#F4A261',
  '#E9C46A',
  '#2A9D8F',
  '#264653',
  '#9C6644',
  '#BC6C25',
  '#606C38',
]

export function CategoryDistributionChart({
  data,
  height = 300,
  showFunding = true,
}: CategoryDistributionChartProps) {
  // Take top 8 categories
  const chartData = data.slice(0, 8).map((d) => ({
    ...d,
    displayCategory: formatCategory(d.category),
  }))

  if (chartData.length === 0) {
    return (
      <div className="flex items-center justify-center h-[200px] text-gray-400">
        No category data available
      </div>
    )
  }

  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 10, right: 30, left: 100, bottom: 10 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" horizontal={false} />
          <XAxis
            type="number"
            dataKey={showFunding ? 'funding' : 'projects'}
            tickFormatter={showFunding ? formatFunding : (v) => v.toString()}
            tick={{ fill: '#525252', fontSize: 12 }}
            axisLine={{ stroke: '#E5E5E5' }}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="displayCategory"
            tick={{ fill: '#525252', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={95}
          />
          <Tooltip
            formatter={(value, name) => {
              const numValue = typeof value === 'number' ? value : 0
              if (name === 'funding') return [formatFunding(numValue), 'Funding']
              return [numValue, 'Projects']
            }}
            labelFormatter={(label) => String(label)}
            contentStyle={{
              backgroundColor: 'white',
              border: '1px solid #E5E5E5',
              borderRadius: '8px',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
            }}
          />
          <Bar
            dataKey={showFunding ? 'funding' : 'projects'}
            radius={[0, 4, 4, 0]}
            maxBarSize={25}
          >
            {chartData.map((_, index) => (
              <Cell
                key={`cell-${index}`}
                fill={CATEGORY_COLORS[index % CATEGORY_COLORS.length]}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
