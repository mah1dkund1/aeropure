'use client'

import React from 'react'
import { Line, LineChart, CartesianGrid, XAxis, YAxis, Bar, BarChart, ResponsiveContainer } from 'recharts'
import { ChartContainer, ChartTooltip } from '@/components/ui/chart'

function ChartRendererInner(props: any) {
  const {
    selectedDeviceIds,
    multiAssetSeries,
    multiAssetTicks,
    multiAssetDomain,
    showChart,
    showAverageOnly,
    assets,
    multiAggLoading,
    aggLoading,
    displaySeries,
    concatenatedSeries,
    tickIndices,
    barDomain,
    metricColors,
    selectedMetrics,
    isNarrow,
    CustomTick,
    CustomTickIndexed,
    CustomTooltip,
    animate = true,
  } = props

  // Performance: downsample large series, memoize configs, and limit rendered lines
  const MAX_LINES = 8
  // Compute a dynamic max points cap: base 300 but scale with tick count so
  // we don't downsample more aggressively than the number of ticks implies.
  const computedMaxPoints = React.useMemo(() => {
    const base = 300
    const ticks = (multiAssetTicks && Array.isArray(multiAssetTicks)) ? multiAssetTicks.length : 0
    // Aim to keep ~10 points per tick interval when available, but never below base
    const scaled = ticks > 0 ? Math.max(base, ticks * 10) : base
    // Cap to avoid enormous rendering cost
    return Math.min(scaled, 5000)
  }, [multiAssetTicks])

  const effectiveAnimate = React.useMemo(() => {
    if (!animate) return false
    if (selectedDeviceIds && selectedDeviceIds.length > MAX_LINES) return false
    return true
  }, [animate, selectedDeviceIds])

  const sampledMultiAssetSeries = React.useMemo(() => {
    if (!multiAssetSeries || !Array.isArray(multiAssetSeries)) return multiAssetSeries
    const len = multiAssetSeries.length
    const MAX_POINTS = computedMaxPoints
    if (len <= MAX_POINTS) return multiAssetSeries
    const step = Math.ceil(len / MAX_POINTS)
    return multiAssetSeries.filter((_: any, i: number) => i % step === 0 || i === len - 1)
  }, [multiAssetSeries, computedMaxPoints])

  const sampledConcatenatedSeries = React.useMemo(() => {
    if (!concatenatedSeries || !Array.isArray(concatenatedSeries)) return concatenatedSeries
    const len = concatenatedSeries.length
    const MAX_POINTS = Math.max(300, Math.floor((multiAssetTicks?.length ?? 0) * 6))
    if (len <= MAX_POINTS) return concatenatedSeries
    const step = Math.ceil(len / MAX_POINTS)
    return concatenatedSeries.filter((_: any, i: number) => i % step === 0 || i === len - 1)
  }, [concatenatedSeries, multiAssetTicks])

  const renderedDeviceIds = React.useMemo(() => {
    if (!selectedDeviceIds) return []
    return selectedDeviceIds.length > MAX_LINES ? selectedDeviceIds.slice(0, MAX_LINES) : selectedDeviceIds
  }, [selectedDeviceIds])

  const multiAssetConfig = React.useMemo(() => {
    const metric = selectedMetrics?.[0] ?? 'AQI'
    const c: Record<string, { label: string; color: string }> = {}
    if (showAverageOnly) {
      c[`avg__${metric}`] = { label: 'Average', color: '#6b7280' }
    } else {
      renderedDeviceIds.forEach((devId: string, idx: number) => {
        const asset = assets.find((a: any) => String(a.deviceId) === devId)
        const label = asset ? (asset.name || devId) : devId
        const color = ['#8b5cf6','#FF6B6B','#FFB86B','#FFD56B','#6BCBFF','#6BFF95','#C56BFF','#FF9999','#3B82F6','#60A5FA'][idx % 10]
        c[`d_${devId}__${metric}`] = { label, color }
      })
    }
    return c
  }, [showAverageOnly, selectedMetrics, renderedDeviceIds, assets])

  const multiAssetConfig2 = React.useMemo(() => {
    const metric = selectedMetrics?.[0] ?? 'AQI'
    const c: Record<string, { label: string; color: string }> = {}
    if (showAverageOnly) {
      c[`avg__${metric}`] = { label: 'Average', color: '#6b7280' }
    } else {
      renderedDeviceIds.forEach((devId: string, idx: number) => {
        const asset = assets.find((a: any) => String(a.deviceId) === devId)
        const label = asset ? (asset.name || devId) : devId
        const color = ['#8b5cf6','#FF6B6B','#FFB86B','#FFD56B','#6BCBFF','#6BFF95','#C56BFF','#FF9999','#3B82F6','#60A5FA'][idx % 10]
        c[`d_${devId}__${metric}`] = { label, color }
      })
    }
    return c
  }, [showAverageOnly, selectedMetrics, renderedDeviceIds, assets])

  // Multi-asset / single-asset rendering ported from page.tsx
  if (selectedDeviceIds && selectedDeviceIds.length > 1) {
    if (!multiAssetSeries || !multiAssetSeries.length) {
      return multiAggLoading ? (
        <div className="h-72 flex items-center justify-center">
          <img src="/images/logo.png" alt="Loading" className="h-20 w-20 object-contain animate-pulse" />
        </div>
      ) : (
        <div className="h-72 flex items-center justify-center text-sm text-muted-foreground">No data for the selected window.</div>
      )
    }

    if (showChart === 'line') {
      const metric = selectedMetrics[0] ?? 'AQI'

      return (
        <ChartContainer className="w-full h-72 overflow-hidden aspect-none" config={multiAssetConfig}>
          <LineChart data={sampledMultiAssetSeries} margin={{ left: 10, right: 28, top: 10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="time"
              type="number"
              domain={multiAssetDomain ? multiAssetDomain : ['auto', 'auto']}
              ticks={multiAssetTicks as any}
              interval={0}
              tick={CustomTick}
              label={{ value: 'Time', position: 'insideBottom', offset: -5 }}
            />
            <YAxis width={40} label={{ value: 'Value', angle: -90, position: 'insideLeft' }} />
            <ChartTooltip content={<CustomTooltip />} />
            {showAverageOnly ? (
              <Line
                key={`avg__${selectedMetrics[0] ?? 'AQI'}`}
                data={sampledMultiAssetSeries}
                type="linear"
                dataKey={`avg__${selectedMetrics[0] ?? 'AQI'}`}
                stroke="#6b7280"
                dot={false}
                strokeWidth={2}
                connectNulls={true}
                isAnimationActive={effectiveAnimate}
                animationDuration={effectiveAnimate ? 600 : 0}
                animationEasing="ease-out"
              />
            ) : (
              renderedDeviceIds.map((devId: string, idx: number) => (
                <Line
                  key={devId}
                  data={sampledMultiAssetSeries}
                  type="linear"
                  dataKey={`d_${devId}__${selectedMetrics[0] ?? 'AQI'}`}
                  stroke={['#8b5cf6','#FF6B6B','#FFB86B','#FFD56B','#6BCBFF','#6BFF95','#C56BFF','#FF9999','#3B82F6','#60A5FA'][idx % 10]}
                  dot={false}
                  strokeWidth={2}
                  connectNulls={true}
                  isAnimationActive={effectiveAnimate}
                  animationDuration={effectiveAnimate ? 600 : 0}
                  animationEasing="ease-out"
                />
              ))
            )}
          </LineChart>
        </ChartContainer>
      )
    }

    // bar chart for multi-asset
    const metric = selectedMetrics[0] ?? 'AQI'

    return (
      <ChartContainer className="w-full h-80 overflow-hidden aspect-none" config={multiAssetConfig2}>
        <BarChart data={sampledMultiAssetSeries} margin={{ left: 16, right: 24, top: 10, bottom: (isNarrow ? 28 : 12) }} barCategoryGap="20%" barGap={2}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="time"
            type="number"
            domain={multiAssetDomain ? multiAssetDomain : ['auto', 'auto']}
            ticks={multiAssetTicks as any}
            interval={0}
            tickMargin={8}
            minTickGap={12}
            tick={CustomTick}
            label={{ value: 'Time', position: 'insideBottom', offset: -5 }}
          />
          <YAxis width={40} label={{ value: 'Value', angle: -90, position: 'insideLeft' }} />
          <ChartTooltip content={<CustomTooltip />} />
          {showAverageOnly ? (
            <Bar key={`avg__${selectedMetrics[0] ?? 'AQI'}`} dataKey={`avg__${selectedMetrics[0] ?? 'AQI'}`} fill="#6b7280" maxBarSize={isNarrow ? 14 : 24} isAnimationActive={effectiveAnimate} animationDuration={effectiveAnimate ? 600 : 0} />
          ) : (
            renderedDeviceIds.map((devId: string, idx: number) => (
              <Bar key={devId} dataKey={`d_${devId}__${selectedMetrics[0] ?? 'AQI'}`} fill={['#8b5cf6','#FF6B6B','#FFB86B','#FFD56B','#6BCBFF','#6BFF95','#C56BFF','#FF9999','#3B82F6','#60A5FA'][idx % 10]} maxBarSize={isNarrow ? 14 : 24} isAnimationActive={effectiveAnimate} animationDuration={effectiveAnimate ? 600 : 0} />
            ))
          )}
        </BarChart>
      </ChartContainer>
    )
  }

  // Single-asset / aggregated plotting
  if (displaySeries.length === 0) {
    return aggLoading ? (
      <div className="h-72 flex items-center justify-center">
        <img src="/images/logo.png" alt="Loading" className="h-20 w-20 object-contain animate-pulse" />
      </div>
    ) : (
      <div className="h-72 flex items-center justify-center text-sm text-muted-foreground">No data for the selected window.</div>
    )
  }

  if (showChart === 'line') {
    return (
      <ChartContainer
        className="w-full h-72 overflow-hidden aspect-none"
        config={{
          AQI: { label: 'AQI', color: '#8b5cf6' },
          PM2_5: { label: 'PM2.5 (µg/m³)', color: '#FF6B6B' },
          PM10: { label: 'PM10 (µg/m³)', color: '#FFB86B' },
          NO2: { label: 'NO₂ (µg/m³)', color: '#6BCBFF' },
          O3: { label: 'O₃ (µg/m³)', color: '#6BFF95' },
          SO2: { label: 'SO₂ (µg/m³)', color: '#C56BFF' },
          Temperature: { label: 'Air Temperature (°C)', color: '#FF9999' },
          Humidity: { label: 'Air Humidity (%)', color: '#3B82F6' },
          Pressure: { label: 'Atmospheric Pressure (hPa)', color: '#60A5FA' }
        }}
      >
        <LineChart margin={{ left: 10, right: 28, top: 10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="x"
            type="number"
            domain={[0, Math.max(0, (concatenatedSeries?.length ?? 1) - 1)]}
            ticks={tickIndices as any}
            interval={0}
            tick={CustomTickIndexed}
          />
          <YAxis width={40} />
          <ChartTooltip content={<CustomTooltip />} />
          {selectedMetrics.map((metric: string) => (
            <Line
              key={metric}
              data={concatenatedSeries}
              type="linear"
              dataKey={metric}
              stroke={metricColors[metric]}
              dot={false}
              strokeWidth={2}
              connectNulls={true}
              isAnimationActive={animate}
              animationDuration={600}
              animationEasing="ease-out"
            />
          ))}
        </LineChart>
      </ChartContainer>
    )
  }

  // bar chart single-asset
  return (
    <ChartContainer
      className="w-full h-80 overflow-hidden aspect-none"
      config={{
        AQI: { label: 'AQI', color: '#8b5cf6' },
        PM2_5: { label: 'PM2.5', color: '#FF6B6B' },
        PM10: { label: 'PM10', color: '#FFB86B' },
        NO2: { label: 'NO₂', color: '#6BCBFF' },
        O3: { label: 'O₃', color: '#6BFF95' },
        SO2: { label: 'SO₂', color: '#C56BFF' },
        Temperature: { label: 'Air Temperature', color: '#FF9999' },
        Humidity: { label: 'Air Humidity', color: '#3B82F6' },
        Pressure: { label: 'Atmospheric Pressure', color: '#60A5FA' }
      }}
    >
      <BarChart data={concatenatedSeries} margin={{ left: 16, right: 24, top: 10, bottom: (isNarrow ? 28 : 12) }} barCategoryGap="20%" barGap={2}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis
          dataKey="x"
          type="number"
          domain={barDomain as any}
          ticks={tickIndices as any}
          interval={0}
          tickMargin={8}
          minTickGap={12}
          tick={CustomTickIndexed}
        />
        <YAxis width={40} />
        <ChartTooltip content={<CustomTooltip />} />
        {selectedMetrics.map((metric: string) => (
          <Bar key={metric} dataKey={metric} fill={metricColors[metric]} maxBarSize={isNarrow ? 14 : 24} />
        ))}
      </BarChart>
    </ChartContainer>
  )
}

function seriesSignature(arr: any): string {
  try {
    if (!arr) return ''
    if (!Array.isArray(arr)) return String(arr)
    const len = arr.length
    if (len === 0) return 'len:0'
    const first = arr[0]?.time ?? arr[0]?.x ?? JSON.stringify(arr[0])
    const last = arr[len - 1]?.time ?? arr[len - 1]?.x ?? JSON.stringify(arr[len - 1])
    return `len:${len}|first:${first}|last:${last}`
  } catch (e) {
    return ''
  }
}

function shallowArrayEq(a: any, b: any) {
  if (a === b) return true
  if (!a || !b) return false
  if (!Array.isArray(a) || !Array.isArray(b)) return false
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

export const ChartRenderer = React.memo(ChartRendererInner, (prev, next) => {
  // Quick primitive checks
  const keysToCheck = [
    'showChart',
    'showAverageOnly',
    'multiAggLoading',
    'aggLoading',
    'isNarrow',
  ]
  for (const k of keysToCheck) {
    if (prev[k] !== next[k]) return false
  }

  // selectedDeviceIds equality (shallow)
  if (!shallowArrayEq(prev.selectedDeviceIds, next.selectedDeviceIds)) return false
  if (!shallowArrayEq(prev.selectedMetrics, next.selectedMetrics)) return false

  // ticks and domain (small arrays)
  if (!shallowArrayEq(prev.multiAssetTicks, next.multiAssetTicks)) return false
  const prevDom = prev.multiAssetDomain || []
  const nextDom = next.multiAssetDomain || []
  if (!shallowArrayEq(prevDom, nextDom)) return false

  // For large series, compare simple signature (length + first/last timestamps)
  if (seriesSignature(prev.multiAssetSeries) !== seriesSignature(next.multiAssetSeries)) return false
  if (seriesSignature(prev.concatenatedSeries) !== seriesSignature(next.concatenatedSeries)) return false

  // Likely unchanged
  return true
})

export default ChartRenderer
