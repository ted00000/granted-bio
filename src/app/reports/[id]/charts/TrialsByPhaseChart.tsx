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

interface TrialsByPhaseData {
  phase: string
  count: number
}

interface TrialsByPhaseChartProps {
  data: Record<string, number>
  height?: number
}

// Phase order for consistent display
const PHASE_ORDER = ['Early Phase 1', 'Phase 1', 'Phase 2', 'Phase 3', 'Phase 4', 'N/A', 'Unknown']

// Color scale - darker for later phases
const PHASE_COLORS: Record<string, string> = {
  'Early Phase 1': '#FCD5CE',
  'Phase 1': '#F9A99A',
  'Phase 2': '#E07A5F',
  'Phase 3': '#C96A4F',
  'Phase 4': '#A85A42',
  'N/A': '#D4D4D4',
  'Unknown': '#D4D4D4',
}

export function TrialsByPhaseChart({ data, height = 250 }: TrialsByPhaseChartProps) {
  // Convert to array and sort by phase order
  const chartData: TrialsByPhaseData[] = Object.entries(data)
    .map(([phase, count]) => ({ phase, count }))
    .sort((a, b) => {
      const aIndex = PHASE_ORDER.indexOf(a.phase)
      const bIndex = PHASE_ORDER.indexOf(b.phase)
      return (aIndex === -1 ? 100 : aIndex) - (bIndex === -1 ? 100 : bIndex)
    })

  if (chartData.length === 0) {
    return (
      <div className="flex items-center justify-center h-[200px] text-gray-400">
        No trial data available
      </div>
    )
  }

  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 10, right: 30, left: 80, bottom: 10 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" horizontal={false} />
          <XAxis
            type="number"
            tick={{ fill: '#525252', fontSize: 12 }}
            axisLine={{ stroke: '#E5E5E5' }}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="phase"
            tick={{ fill: '#525252', fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            width={75}
          />
          <Tooltip
            formatter={(value: number) => [value, 'Trials']}
            contentStyle={{
              backgroundColor: 'white',
              border: '1px solid #E5E5E5',
              borderRadius: '8px',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
            }}
          />
          <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={30}>
            {chartData.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={PHASE_COLORS[entry.phase] || '#E07A5F'}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
