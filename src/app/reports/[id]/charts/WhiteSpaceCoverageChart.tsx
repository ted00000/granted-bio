'use client'

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LabelList,
  Cell,
} from 'recharts'

interface CoverageCategoryDatum {
  name: string
  keywords: string[]
  projectCount: number
  fundingTotal: number
  broaderNihCount: number
  projectExamples: string[]
}

interface WhiteSpaceCoverageChartProps {
  dimensionName: string
  categories: CoverageCategoryDatum[]
  totalProjects: number
  totalUnclassified: number
}

const formatFunding = (value: number): string => {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`
  return `$${value.toLocaleString()}`
}

// Palette biased toward the granted.bio brand — the top-funded category
// gets the primary color, less-funded categories drift toward warm tones.
const BAR_COLORS = [
  '#E07A5F', // brand primary
  '#F4A261',
  '#E9C46A',
  '#2A9D8F',
  '#264653',
  '#9C6644',
  '#BC6C25',
  '#606C38',
]

interface TooltipItem {
  payload: {
    name: string
    projectCount: number
    fundingTotal: number
    broaderNihCount: number
    share: number
  }
  value: number
}

const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: TooltipItem[] }) => {
  if (!active || !payload || payload.length === 0) return null
  const d = payload[0].payload
  const broaderCell = d.broaderNihCount === -1 ? 'n/a' : d.broaderNihCount.toLocaleString()
  return (
    <div className="bg-white border border-gray-200 rounded-md shadow-md px-3 py-2 text-xs">
      <div className="font-semibold text-gray-900 mb-1">{d.name}</div>
      <div className="text-gray-700">
        <div>
          <span className="text-gray-500">In topic sample:</span>{' '}
          <span className="font-medium">
            {d.projectCount} project{d.projectCount === 1 ? '' : 's'} ({d.share.toFixed(1)}%)
          </span>
        </div>
        <div>
          <span className="text-gray-500">Funding:</span>{' '}
          <span className="font-medium">{formatFunding(d.fundingTotal)}</span>
        </div>
        <div>
          <span className="text-gray-500">Broader NIH RePORTER:</span>{' '}
          <span className="font-medium">{broaderCell}</span>
        </div>
      </div>
    </div>
  )
}

/**
 * Horizontal bar chart of category coverage within a white-space dimension.
 * Categories on Y-axis, project count on X-axis. Bar labels show the count.
 * Tooltip surfaces the full context (count, share, funding, broader NIH).
 *
 * Design: this chart is the visual signal for the white-space section.
 * A short bar for a category with a large broader-NIH count is the
 * whitespace shape the reader is meant to notice.
 */
export function WhiteSpaceCoverageChart({
  dimensionName,
  categories,
  totalProjects,
  totalUnclassified,
}: WhiteSpaceCoverageChartProps) {
  if (!categories || categories.length === 0) return null

  // Sort descending by projectCount so densest categories are at the top —
  // the empty space at the bottom is the visual white space.
  const data = [...categories]
    .sort((a, b) => b.projectCount - a.projectCount)
    .map((c) => ({
      name: c.name,
      projectCount: c.projectCount,
      fundingTotal: c.fundingTotal,
      broaderNihCount: c.broaderNihCount,
      share: totalProjects > 0 ? (c.projectCount / totalProjects) * 100 : 0,
    }))

  // Dynamic height — one bar per category, plus padding for axis labels.
  const height = Math.max(180, data.length * 34 + 60)

  return (
    <div className="my-6">
      <div className="flex items-baseline justify-between mb-2 text-sm text-gray-600">
        <div>
          <span className="font-medium text-gray-900">{dimensionName}</span>
          <span className="ml-3 text-xs">
            {totalProjects} projects in sample · {totalUnclassified} unclassified
          </span>
        </div>
      </div>
      <div style={{ width: '100%', height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 5, right: 60, left: 5, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
            <XAxis
              type="number"
              tick={{ fontSize: 11, fill: '#6b7280' }}
              axisLine={{ stroke: '#e5e7eb' }}
              tickLine={{ stroke: '#e5e7eb' }}
            />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fontSize: 11, fill: '#374151' }}
              width={140}
              interval={0}
              axisLine={{ stroke: '#e5e7eb' }}
              tickLine={{ stroke: '#e5e7eb' }}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(224, 122, 95, 0.08)' }} />
            <Bar dataKey="projectCount" radius={[0, 4, 4, 0]}>
              {data.map((_, i) => (
                <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
              ))}
              <LabelList
                dataKey="projectCount"
                position="right"
                fill="#374151"
                style={{ fontSize: 11, fontWeight: 500 }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
