import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Convert internall metric keys to a human-friendly label with proper subscripts
export function metricLabel(metric?: string) {
  if (!metric) return ''
  switch (metric) {
    case 'PM2.5':
      return 'PM2.5'
    case 'PM2_5':
      return 'PM2.5'
    case 'PM10':
      return 'PM10'
    case 'NO2':
      return 'NO\u2082'
    case 'O3':
      return 'O\u2083'
    case 'SO2':
      return 'SO\u2082'
    case 'AQI':
      return 'AQI'
    default:
      return metric
  }
}

// Return display unit for a metric key (used in legends and panels)
export function unitForMetric(metric?: string) {
  if (!metric) return ''
  switch (metric) {
    case 'PM2.5':
    case 'PM2_5':
    case 'PM10':
    case 'PM1':
    case 'NO2':
    case 'O3':
    case 'SO2':
      return 'µg/m³'
    case 'CO':
      // CO is commonly reported in ppm or mg/m³; keep ppm to match existing station data
      return 'ppm'
    case 'AQI':
      return ''
    case 'Temperature':
      return '°C'
    case 'Humidity':
      return '%'
    case 'Pressure':
      return 'hPa'
    default:
      return ''
  }
}
