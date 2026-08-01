import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import * as fs from 'fs'
import * as path from 'path'
import { toZonedTime } from 'date-fns-tz'
import { aggregateReadings } from '@/lib/aggregate'
import { metricLabel, unitForMetric } from '@/lib/utils'

type Reading = {
  receivedAt: string
  airQualityIndex?: number
  valuePM_2_5?: number
  valuePM_10?: number
  valueCO?: number
  valueNO2?: number
  valueO3?: number
  valueSO2?: number
  airTemperature?: number
  airHumidity?: number
  atmosPressure?: number
  deviceID?: number | string
  readingCount?: number
}

type PDFReportOptions = {
  readings: Reading[]
  rawReadings?: Reading[] 
  metrics: string[]
  startDateTime: string
  endDateTime: string
  includeMap: boolean
  includeCharts: boolean
 
  mapImageDataUrl?: string
  // Support multiple map snapshots
  mapImageDataUrls?: string[]
  mapImageWidth?: number
  mapImageHeight?: number
  //tick array from aggregation (for proper x-axis alignment)
  ticks?: number[]
  // domain from aggregation (for proper x-axis alignment)
  domain?: [number, number]
  // Cover page information
  location?: string
  assetName?: string
  deviceID?: string
  sensorCount?: number
  // Per-device AQI data for individual graphs (when "All Assets" is selected)
  perDeviceAQI?: Array<{
    deviceID: string
    deviceName?: string
    readings: Array<{
      receivedAt: string
      airQualityIndex?: number
      time?: number
    }>
  }>
  // Multi-asset support
  deviceIDs?: string[]
  assetNames?: string[]
  assetLocations?: string[]
  isMultiAsset?: boolean
}

export async function generatePDFReport(options: PDFReportOptions): Promise<Buffer> {
  try {
  const { 
    readings, 
    rawReadings, 
    metrics, 
    startDateTime, 
    endDateTime, 
    includeCharts, 
    mapImageDataUrl, 
    mapImageDataUrls, 
    ticks, 
    domain, 
    location, 
    assetName, 
    deviceID, 
    sensorCount, 
    perDeviceAQI,
    deviceIDs,
    assetNames,
    assetLocations,
    isMultiAsset 
  } = options

    // Helper function to load image as base64
    const loadImageAsBase64 = async (imagePath: string): Promise<string | null> => {
      try {
        if (typeof window === 'undefined') {
          const fullPath = path.join(process.cwd(), 'public', imagePath)
          const imageBuffer = await fs.promises.readFile(fullPath)
          const base64 = imageBuffer.toString('base64')
          const ext = path.extname(imagePath).toLowerCase()
          const mimeType = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png'
          return `data:${mimeType};base64,${base64}`
        }
        return null
      } catch (error) {
        console.warn(`Failed to load image: ${imagePath}`, error)
        return null
      }
    }

    // function to format time in 12-hour format with am/pm (timezone-aware)
    const format12Hour = (date: Date): { dateStr: string; timeStr: string } => {
      // Convert UTC date to user's timezone (Asia/Karachi)
      const zonedDate = toZonedTime(date, 'Asia/Karachi')
      
      const month = zonedDate.getMonth() + 1
      const day = zonedDate.getDate()
      let hours = zonedDate.getHours()
      const minutes = zonedDate.getMinutes()
      const ampm = hours >= 12 ? 'pm' : 'am'
      hours = hours % 12 || 12 // Convert 0 to 12 for midnight
      const timeStr = `${hours}:${String(minutes).padStart(2, '0')}${ampm}`
      const dateStr = `${month}/${day}`
      return { dateStr, timeStr }
    }

    // generate evenly spaced tick timestamps across a domain, independent of data presence.
    // Ensures X-axis labels appear even over gaps where no data points exist.
    const generateEvenTicks = (domainStart: number, domainEnd: number, maxTicks: number): number[] => {
      if (domainEnd <= domainStart) return [domainStart]
      const ticks: number[] = []
      const count = Math.max(2, Math.min(maxTicks, 12))
      for (let i = 0; i < count; i++) {
        const t = domainStart + (i * (domainEnd - domainStart)) / (count - 1)
        ticks.push(Math.floor(t))
      }
      return ticks
    }
    
    // function to format datetime with minutes (for display - no timezone conversion)
    const formatDateTimeWithMinutes = (dateStr: string): string => {
      // Parse "2025-11-11T14:37" format directly without timezone conversion
      const [datePart, timePart] = dateStr.split('T')
      const [year, month, day] = datePart.split('-').map(Number)
      const [hours24, minutes] = timePart.split(':').map(Number)
      
      let hours = hours24
      const ampm = hours >= 12 ? 'pm' : 'am'
      hours = hours % 12 || 12
      return `${day}/${month}/${year} ${hours}:${String(minutes).padStart(2, '0')}${ampm}`
    }

    // function to check if we need a new page
    const checkPageBreak = (currentY: number, requiredSpace: number = 20) => {

      if (currentY + requiredSpace > 265) {
        doc.addPage()
        return 20 // Reset to top of new page
      }
      return currentY
    }

    // Create PDF document (autoTable is added to prototype)
    const doc = new jsPDF() as any


    let useUnicodeFont = false
    try {
      const fontPath = path.join(process.cwd(), 'public', 'fonts', 'DejaVuSans.ttf')
      if (fs.existsSync(fontPath)) {
        const fontData = fs.readFileSync(fontPath).toString('base64')
        // Register font in jsPDF virtual file system
        doc.addFileToVFS('DejaVuSans.ttf', fontData)
        doc.addFont('DejaVuSans.ttf', 'DejaVu', 'normal')
        useUnicodeFont = true
      }
    } catch (err) {
      console.warn('[PDF Generator] Unicode font registration failed:', err)
    }

    // Helper wrapper to write text using Unicode font when available
    const writeText = (text: string, x: number, y: number, opts?: any) => {
      try {
        if (useUnicodeFont) doc.setFont('DejaVu', 'normal')
        else doc.setFont('helvetica', 'normal')
      } catch (err) {
        // Fall back silently
      }
      doc.text(text, x, y, opts || {})
    }

    // Draw a metric label with numeric part rendered as a visual subscript
    const drawMetricWithSubscript = (metricKey: string, x: number, y: number, baseFontSize = 8, unit?: string, subYOffset = 0.25) => {
      // Determine base and sub parts
      let base = ''
      let sub = ''
      let displayFull = ''
          if (metricKey === 'AQI') {
            displayFull = 'Air Quality Index'
          } else if (metricKey === 'PM2.5' || metricKey === 'PM2_5') {
            // Render as plain text 'PM2.5' (no visual subscript)
            displayFull = 'PM2.5'
          } else if (metricKey === 'PM10') {
            // Render as plain text 'PM10' (no visual subscript)
            displayFull = 'PM10'
      } else if (metricKey === 'NO2') {
        base = 'NO'
        sub = '2'
      } else if (metricKey === 'O3') {
        base = 'O'
        sub = '3'
      } else if (metricKey === 'SO2') {
        base = 'SO'
        sub = '2'
      } else if (metricKey === 'CO') {
        base = 'CO'
        sub = ''
      } else {
        displayFull = metricKey
      }

      const savedFontSize = (doc as any).internal.getFontSize()
      const savedFont = (doc as any).internal.getFont().fontName

      try {
        // If a Unicode font is available and we don't have an explicit displayFull override,
        // prefer the centralized metricLabel (contains real subscript glyphs).
        if (useUnicodeFont && metricKey !== 'AQI' && !displayFull) {
          const label = metricLabel(metricKey)
          if (label) {
            writeText(label, x, y)
            x += doc.getTextWidth(label) + 2
          }
        } else {
          // Draw either full display or base+sub
          if (displayFull) {
            // Use writeText which sets appropriate font
            writeText(displayFull, x, y)
            x += doc.getTextWidth(displayFull) + 2
          } else {
            // Draw base
            try { if (useUnicodeFont) doc.setFont('DejaVu', 'normal'); else doc.setFont('helvetica', 'normal') } catch (e) {}
            doc.setFontSize(baseFontSize)
            doc.text(base, x, y)
            const baseWidth = doc.getTextWidth(base)
            // Draw subscript as smaller text with slight vertical offset
            if (sub) {
              const subFont = Math.max(5, Math.round(baseFontSize * 0.7))
              doc.setFontSize(subFont)
              // vertical offset: controlled by subYOffset parameter (fraction of subFont)
              doc.text(sub, x + baseWidth, y + (subFont * subYOffset))
              x += baseWidth + doc.getTextWidth(sub)
            } else {
              x += baseWidth
            }
          }
        }

          // Draw unit in brackets like " (unit)" if provided (omit for AQI)
          if (unit && metricKey !== 'AQI') {
            const unitText = ` (${unit})`
            const unitFont = Math.max(6, Math.round(baseFontSize * 0.8))
            doc.setFontSize(unitFont)
            doc.setTextColor(100, 116, 139)
            doc.text(unitText, x + 4, y)
          }
      } finally {
        // restore font and size
        try { if (useUnicodeFont) doc.setFont('DejaVu', 'normal'); else doc.setFont('helvetica', 'normal') } catch (e) {}
        doc.setFontSize(savedFontSize)
      }
    }

    // Measure width for a metric with optional unit
    const measureMetricWidth = (metricKey: string, baseFontSize = 7) => {
      let width = 0
      const savedSize = (doc as any).internal.getFontSize()
      try { doc.setFontSize(baseFontSize) } catch (e) {}
      if (metricKey === 'AQI') {
        width = doc.getTextWidth('Air Quality Index')
      } else if (metricKey === 'PM2.5' || metricKey === 'PM2_5') {
        width = doc.getTextWidth('PM2.5')
      } else if (metricKey === 'PM10') {
        width = doc.getTextWidth('PM10')
      } else if (metricKey === 'NO2') {
        width = doc.getTextWidth('NO') + doc.getTextWidth('2')
      } else if (metricKey === 'O3') {
        width = doc.getTextWidth('O') + doc.getTextWidth('3')
      } else if (metricKey === 'SO2') {
        width = doc.getTextWidth('SO') + doc.getTextWidth('2')
      } else if (metricKey === 'CO') {
        width = doc.getTextWidth('CO')
      } else {
        width = doc.getTextWidth(metricKey)
      }
      const unit = unitForMetric(metricKey)
      // Omit unit width for AQI
      if (unit && metricKey !== 'AQI') width += doc.getTextWidth(` (${unit})`) + 4
      try { doc.setFontSize(savedSize) } catch (e) {}
      return width
    }

    let yPosition = 20

  // ========== COVER PAGE ==========
  
  // Load logos
  const aeropureLogo = await loadImageAsBase64('images/logo.png')
  const threepolLogo = await loadImageAsBase64('images/3pol_logo.jpeg')
  
  // Aeropure Logo (centered at top)
  if (aeropureLogo) {
    try {
      const logoWidth = 50
      const logoHeight = 15
      doc.addImage(aeropureLogo, 'PNG', (210 - logoWidth) / 2, yPosition, logoWidth, logoHeight)
      yPosition += logoHeight + 15 // Increased gap for better spacing
    } catch (error) {
      console.warn('Failed to add Aeropure logo:', error)
      yPosition += 15
    }
  } else {
    yPosition += 15
  }

  // "AeroPure" heading (large, bold, black)
  doc.setFontSize(48)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(0, 0, 0)
  doc.text('AeroPure', 105, yPosition, { align: 'center' })
  yPosition += 15

  
  // "Analysis Report" title
  doc.setFontSize(16)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(0, 0, 0)
  doc.text('Analysis Report', 105, yPosition, { align: 'center' })
  yPosition += 15

  // Show asset names if multi-asset report (render as a small table)
  if (isMultiAsset && assetNames && assetNames.length > 0) {
    doc.setFontSize(11)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(60, 60, 60)
    //doc.text(`Selected Assets:`, 105, yPosition, { align: 'center' })
    yPosition += 6

    // Prepare a two-column table with asset names and locations
    const head = [['Asset Name', 'Location']]
    const body = assetNames.map((name, index) => [
      name || '-',
      (assetLocations?.[index] ?? 'No location').split(',')[0]?.trim() || 'No location'
    ])

    // Ensure autoTable uses the Unicode font when available
    try { if (useUnicodeFont) doc.setFont('DejaVu', 'normal'); else doc.setFont('helvetica', 'normal') } catch (e) {}
    // Use autoTable to render a compact table centered on the page
    autoTable(doc, {
      head,
      body,
      startY: yPosition,
      theme: 'grid',
      styles: { fontSize: 9, halign: 'center' },
      headStyles: { 
        fillColor: [71, 85, 105],
        textColor: [255, 255, 255],
        fontSize: 9,
        fontStyle: 'bold' as any,
        lineWidth: 0.5,
        lineColor: [148, 163, 184]
      },
      bodyStyles: {
        lineWidth: 0.5,
        lineColor: [203, 213, 225]
      },
      margin: { left: 35, right: 35 },
      tableWidth: 'auto',
      alternateRowStyles: { fillColor: [248, 250, 252] },
    })

    yPosition = (doc as any).lastAutoTable.finalY + 8
  }

  // Location and Asset display
  // If a single asset is selected (not multi-asset), show Asset Name above Location and keep them separate.
  if (!isMultiAsset && assetName) {
    doc.setFontSize(14)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(30, 41, 59)
    doc.text(assetName, 105, yPosition, { align: 'center' })
    yPosition += 10

    doc.setFontSize(12)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(60, 60, 60)
    const locText = location || 'No Location'
    doc.text(`Location: ${locText}`, 105, yPosition, { align: 'center' })
    yPosition += 10
  } else {
    // Multi-asset or no specific asset: show location or All Assets
    let locationText = 'No Location'
    if (location) locationText = location
    else if (!deviceID) locationText = 'All Assets'

    doc.setFontSize(12)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(60, 60, 60)
    doc.text(`Location: ${locationText}`, 105, yPosition, { align: 'center' })
    yPosition += 10
  }

  // Format date period nicely for display (use the naive input times without timezone conversion)
  // Parse the datetime strings directly to extract the components
  const formatDateForDisplay = (dateTimeStr: string) => {
    // Parse "2025-11-11T14:37" format directly
    const [datePart, timePart] = dateTimeStr.split('T')
    const [year, month, day] = datePart.split('-').map(Number)
    const [hours24, minutes] = timePart.split(':').map(Number)
    
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
    const monthName = months[month - 1]
    const suffix = day === 1 || day === 21 || day === 31 ? 'st' : day === 2 || day === 22 ? 'nd' : day === 3 || day === 23 ? 'rd' : 'th'
    let hours = hours24
    const ampm = hours >= 12 ? 'PM' : 'AM'
    hours = hours % 12 || 12
    return `${monthName} ${day}${suffix} ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')} ${ampm}`
  }
  
  const formattedStart = formatDateForDisplay(startDateTime)
  const formattedEnd = formatDateForDisplay(endDateTime).split(' ').slice(1).join(' ')
  
  doc.text(`Data Period: ${formattedStart} to ${formattedEnd}`, 105, yPosition, { align: 'center' })
  yPosition += 15

  // Calculate hours of monitoring (need Date objects for this)
  const startDate = new Date(startDateTime)
  const endDate = new Date(endDateTime)
  const hoursMonitored = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60))
  // sensorCount represents the number of metrics/pollutants being monitored
  const displaySensorCount = sensorCount || 0
  
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.text(`Data Collection:`, 105, yPosition, { align: 'center' })
  doc.setFont('helvetica', 'normal')
  if (displaySensorCount > 0) {
    doc.text(` ${hoursMonitored} hours of continuous monitoring (${displaySensorCount} sensor${displaySensorCount > 1 ? 's' : ''})`, 105, yPosition + 5, { align: 'center' })
  } else {
    doc.text(` ${hoursMonitored} hours of continuous monitoring`, 105, yPosition + 5, { align: 'center' })
  }
  yPosition += 25

  // "By" text
  doc.setFontSize(16)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(0, 0, 0)
  doc.text('By', 105, yPosition, { align: 'center' })
  yPosition += 25 // Increased gap from 20 to 25

  // 3POL Logo (centered at bottom of cover)
  if (threepolLogo) {
    try {
      const logoWidth = 40
      const logoHeight = 40
      doc.addImage(threepolLogo, 'JPEG', (210 - logoWidth) / 2, yPosition, logoWidth, logoHeight)
      yPosition += logoHeight + 10 // Increased gap for better spacing
    } catch (error) {
      console.warn('Failed to add 3POL logo:', error)
    }
  }

  // "3POL" heading (large, green)
  doc.setFontSize(48)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(34, 197, 94) // Green color (#22C55E)
  doc.text('3POL', 105, yPosition, { align: 'center' })

  // Add new page for report content
  doc.addPage()
  yPosition = 20

  // ========== REPORT CONTENT STARTS HERE ==========
  
  // Report header (removed old title, keeping only subtitle)
  doc.setFontSize(20)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(30, 41, 59)
  doc.text('Air Quality Analysis', 105, yPosition, { align: 'center' })
  
  yPosition += 15

  // If single asset selected, show asset name and location under the report heading for plotting context
  if (!isMultiAsset && assetName) {
    doc.setFontSize(12)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(30, 41, 59)
    doc.text(`${assetName}${location ? ` (${location})` : ''}`, 105, yPosition, { align: 'center' })
    yPosition += 12
  }

  // If user-captured map snapshots were provided, embed them here
  // Support both single image (legacy) and multiple images (new)
  const imagesToEmbed = mapImageDataUrls && mapImageDataUrls.length > 0 
    ? mapImageDataUrls 
    : (mapImageDataUrl ? [mapImageDataUrl] : [])
  
  if (imagesToEmbed.length > 0) {
    for (let i = 0; i < imagesToEmbed.length; i++) {
      const imageUrl = imagesToEmbed[i]
      try {
        // Detect mobile/smaller screens: use larger dimensions
        const isMobile = typeof window !== 'undefined' && window.innerWidth < 768
        const imgW = isMobile ? 150 : 170
        const imgH = isMobile ? 200 : 130
        
        // Check if we need a new page before adding image
        yPosition = checkPageBreak(yPosition, imgH + 15)
        
        const imgX = 20
        const imgY = yPosition
        ;(doc as any).addImage(imageUrl, 'PNG', imgX, imgY, imgW, imgH)
        yPosition += imgH + 10
        
        // Add a label if multiple images
        if (imagesToEmbed.length > 1) {
          doc.setFontSize(8)
          doc.setTextColor(100, 116, 139)
          doc.text(`Map View ${i + 1} of ${imagesToEmbed.length}`, imgX, imgY + imgH + 5)
          yPosition += 5
        }
      } catch (err) {
        console.warn(`[PDF Generator] Failed to embed map snapshot ${i + 1}:`, err)
      }
    }
  }

  // Check if we need a new page before report metadata box
  yPosition = checkPageBreak(yPosition, 50)

  // Use plain ASCII metric labels in PDFs to avoid any font/encoding issues.
  const displayMetricName = (m: string) => {
    if (m === 'AQI') return 'Air Quality Index'
    switch (m) {
      case 'PM2.5':
      case 'PM2_5':
        return 'PM2.5'
      case 'PM10':
        return 'PM10'
      case 'NO2':
        return 'NO2'
      case 'O3':
        return 'O3'
      case 'SO2':
        return 'SO2'
      case 'CO':
        return 'CO'
      default:
        return m
    }
  }

  // Calculate metrics section height before drawing the box
  let metricsLineCount = 1
  {
    const boxLeftMargin = 20
    const boxRightMargin = 195 // Box ends at 15 + 180 = 195
    const maxBoxX = boxRightMargin - 5 // Leave 5pt padding inside box

    let testX = boxLeftMargin
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    testX += doc.getTextWidth('Metrics: ') + 2

    metrics.forEach((m: string, idx: number) => {
      const w = measureMetricWidth(m, 10)
      
      // Check if we need to wrap
      if (testX + w > maxBoxX) {
        metricsLineCount++
        testX = boxLeftMargin
      }
      
      testX += w + 6
      if (idx < metrics.length - 1) {
        testX += doc.getTextWidth(',')
      }
    })
  }

  // Calculate box height: 3 lines of metadata + metrics lines
  const boxHeight = 8 + (3 * 7) + (metricsLineCount * 7) + 4

  // Report metadata box
  doc.setDrawColor(226, 232, 240)
  doc.setFillColor(248, 250, 252)
  doc.rect(15, yPosition, 180, boxHeight, 'F')
  doc.rect(15, yPosition, 180, boxHeight, 'S')
  
  yPosition += 8
  doc.setFontSize(10)
  doc.setTextColor(71, 85, 105)
  doc.text(`Report Period: ${formatDateTimeWithMinutes(startDateTime)} - ${formatDateTimeWithMinutes(endDateTime)}`, 20, yPosition)
  yPosition += 7
  doc.text(`Generated: ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Karachi', hour12: true })}`, 20, yPosition)
  yPosition += 7
  // Show raw readings count if available, otherwise aggregated count
  const totalReadingsCount = rawReadings ? rawReadings.length : readings.length
  console.log(`[PDF Generator] Total readings count: ${totalReadingsCount} (rawReadings: ${rawReadings?.length || 0}, aggregated: ${readings.length})`)
  doc.text(`Total Readings: ${totalReadingsCount.toLocaleString()}`, 20, yPosition)
  yPosition += 7
  
    // Render metrics inline with subscripted numeric parts and units
    {
      // match metadata font weight/size
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10)
      doc.setTextColor(71, 85, 105)

      const boxLeftMargin = 20
      const boxRightMargin = 195 // Box ends at 15 + 180 = 195
      const maxBoxX = boxRightMargin - 5 // Leave 5pt padding inside box

      let mx = boxLeftMargin
      let lineY = yPosition
      const lineHeight = 7

      // prefix
      writeText('Metrics: ', mx, lineY)
      mx += doc.getTextWidth('Metrics: ') + 2

      metrics.forEach((m: string, idx: number) => {
        const unit = m === 'AQI' ? undefined : unitForMetric(m)
        const w = measureMetricWidth(m, 10)

        // wrap if it would overflow box boundary
        if (mx + w > maxBoxX) {
          mx = boxLeftMargin
          lineY += lineHeight
        }

        drawMetricWithSubscript(m, mx, lineY, 10, unit || undefined)
        mx += w + 6

        if (idx < metrics.length - 1 && mx + doc.getTextWidth(',') < maxBoxX) {
          writeText(',', mx - 2, lineY)
        }
      })

      yPosition = lineY + lineHeight + 4
    }

  // Check if we have data - check both aggregated and raw readings
  const hasAggregatedData = readings.length > 0
  const hasRawData = rawReadings && rawReadings.length > 0
  
  if (!hasAggregatedData && !hasRawData) {
    doc.setFontSize(12)
    doc.setTextColor(239, 68, 68)
    doc.text('No Data Available', 105, yPosition, { align: 'center' })
    yPosition += 10
    doc.setFontSize(10)
    doc.setTextColor(100, 116, 139)
    doc.text('No readings were found in the selected date range.', 105, yPosition, { align: 'center' })
    yPosition += 7
    doc.text('Please try a different date range or verify that data is available.', 105, yPosition, { align: 'center' })
    
    return Buffer.from(doc.output('arraybuffer'))
  }

  // We'll calculate stats after filtering aggregated data (to match chart calculations)
  let stats: Record<string, { avg: number; min: number; max: number; count: number }> = {}
  const totalRawReadings = rawReadings ? rawReadings.length : readings.length

  // Add charts if requested and we have aggregated data
  if (includeCharts && hasAggregatedData) {

    const aggregatedData = [...readings]
      .sort((a, b) => new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime())
      .map(r => ({
        time: new Date(r.receivedAt).getTime(),
        airQualityIndex: Number(r.airQualityIndex) || 0,
        valuePM_2_5: Number(r.valuePM_2_5) || 0,
        valuePM_10: Number(r.valuePM_10) || 0,
        valueCO: Number(r.valueCO) || 0,
        valueNO2: Number(r.valueNO2) || 0,
        valueO3: Number(r.valueO3) || 0,
        valueSO2: Number(r.valueSO2) || 0,
        airTemperature: Number(r.airTemperature) || 0,
        airHumidity: Number(r.airHumidity) || 0,
        atmosPressure: Number(r.atmosPressure) || 0,
        readingCount: r.readingCount || 1,
        deviceID: r.deviceID, // Keep deviceID for per-device grouping
      }))
    
    // Use actual data range instead of requested domain
    // This prevents empty space in charts when user selects future times with no data
    // Use all data points (including zeros) to establish the time range
    const aggStart = aggregatedData.length > 0 ? aggregatedData[0].time : (domain ? domain[0] : 0)
    const aggEnd = aggregatedData.length > 0 ? aggregatedData[aggregatedData.length - 1].time : (domain ? domain[1] : 0)
    
    // Generate ticks based on actual data points, not provided ticks
    // This ensures x-axis labels align with where the chart lines actually are
    let ticksToUse: number[] = []
    if (aggregatedData.length > 0) {
      // Use the actual timestamps from the aggregated data points
      const dataTimes = aggregatedData.map(d => d.time).sort((a, b) => a - b)
      
      // For small datasets, use all points as ticks
      if (dataTimes.length <= 10) {
        ticksToUse = dataTimes
      } else {
        // For larger datasets, sample evenly distributed points
        const step = Math.max(1, Math.floor(dataTimes.length / 8)) // Aim for ~8 ticks
        for (let i = 0; i < dataTimes.length; i += step) {
          ticksToUse.push(dataTimes[i])
        }
        // Check if last tick is too close to the previous one (would cause overlap)
        // If so, remove the second-to-last tick instead of adding the last one
        const lastDataTime = dataTimes[dataTimes.length - 1]
        if (ticksToUse.length > 0) {
          const timeSpan = aggEnd - aggStart
          const minTickSpacing = timeSpan * 0.10 // Minimum 10% of total span between last two ticks
          const secondToLastTick = ticksToUse[ticksToUse.length - 1]
          
          if (lastDataTime - secondToLastTick < minTickSpacing) {
            // Remove the second-to-last tick to make room for the last one
            ticksToUse.pop()
          }
        }
        // Now add the last point
        if (ticksToUse[ticksToUse.length - 1] !== lastDataTime) {
          ticksToUse.push(lastDataTime)
        }
      }
      
      console.log(`[PDF Generator] Generated ${ticksToUse.length} ticks from ${dataTimes.length} data points`)
    } else {
      // Fallback to provided ticks if no data
      ticksToUse = ticks || []
    }
    
    // For multi-asset reports, prepare per-device AGGREGATED data for pollutant charts
    // CRITICAL: Use the same aggregation as the dashboard to ensure charts match
    let perDeviceData: Map<string, typeof aggregatedData> = new Map()
    if (isMultiAsset && deviceIDs && deviceIDs.length > 1 && rawReadings) {
      // Determine the same binMs as used in the export route (matches dashboard)
      const aggSpan = aggEnd - aggStart
      const H = 60 * 60 * 1000
      let binMs = 2 * H
      if (aggSpan <= 24 * H) {
        binMs = 2 * 60 * 1000 // 2 minutes for <= 24h
      } else if (aggSpan <= 3 * 24 * H) {
        binMs = 5 * 60 * 1000 // 5 minutes for <= 3 days
      } else if (aggSpan <= 7 * 24 * H) {
        binMs = 1 * H // 1 hour for <= 7 days
      } else {
        binMs = 4 * H // 4 hours for > 7 days
      }
      
      // Aggregate readings for each device using the same aggregation function as dashboard
      deviceIDs.forEach(devID => {
        const deviceRawReadings = rawReadings
          .filter(r => String(r.deviceID) === String(devID))
          .map(r => ({
            receivedAt: r.receivedAt,
            airQualityIndex: r.airQualityIndex,
            valuePM_2_5: r.valuePM_2_5,
            valuePM_10: r.valuePM_10,
            valueCO: r.valueCO,
            valueNO2: r.valueNO2,
            valueO3: r.valueO3,
            valueSO2: r.valueSO2,
            airTemperature: r.airTemperature,
            airHumidity: r.airHumidity,
            atmosPressure: r.atmosPressure,
            deviceID: r.deviceID,
          }))
        
        if (deviceRawReadings.length > 0) {
          // Aggregate this device's readings using the same algorithm as dashboard
          const deviceAggregated = aggregateReadings(deviceRawReadings, {
            start: aggStart,
            end: aggEnd,
            binMs,
            maxPerBin: 50,
            deviceID: devID,
          })
          
          // Convert aggregated points to the same format as aggregatedData
          const deviceData = deviceAggregated.points.map((p: any) => ({
            time: p.time,
            airQualityIndex: p.AQI ?? 0,
            valuePM_2_5: p.PM2_5 ?? 0,
            valuePM_10: p.PM10 ?? 0,
            valueCO: p.CO ?? 0,
            valueNO2: p.NO2 ?? 0,
            valueO3: p.O3 ?? 0,
            valueSO2: p.SO2 ?? 0,
            airTemperature: p.Temperature ?? 0,
            airHumidity: p.Humidity ?? 0,
            atmosPressure: p.Pressure ?? 0,
            readingCount: p.readingCount ?? 1,
            deviceID: devID,
          }))
          
          perDeviceData.set(String(devID), deviceData)
          console.log(`[PDF Generator] Aggregated ${deviceRawReadings.length} raw readings to ${deviceData.length} points for device ${devID}`)
        }
      })
      
      console.log(`[PDF Generator] Prepared aggregated per-device data for ${perDeviceData.size} devices using ${binMs}ms bins`)
    }
    
    console.log(`[PDF Generator] Using ${aggregatedData.length} aggregated data points from API`)
    if (aggregatedData.length > 0) {
      console.log(`[PDF Generator] Domain: ${new Date(aggStart).toISOString()} to ${new Date(aggEnd).toISOString()}`)
      console.log(`[PDF Generator] Generated ${ticksToUse.length} ticks from data points`)
      console.log(`[PDF Generator] Sample PM10 values:`, aggregatedData.slice(0, 5).map(d => d.valuePM_10))
    } else {
      console.log('[PDF Generator] No data points in aggregation')
    }

    // Calculate statistics from the aggregated data (including zeros for proper averages)
    stats = calculateStats(
      aggregatedData.map(d => ({
        receivedAt: new Date(d.time).toISOString(),
        airQualityIndex: d.airQualityIndex,
        valuePM_2_5: d.valuePM_2_5,
        valuePM_10: d.valuePM_10,
        valueCO: d.valueCO,
        valueNO2: d.valueNO2,
        valueO3: d.valueO3,
        valueSO2: d.valueSO2,
        airTemperature: d.airTemperature,
        airHumidity: d.airHumidity,
        atmosPressure: d.atmosPressure,
        readingCount: d.readingCount,
      })),
      metrics,
      totalRawReadings
    )

    // Executive Summary - now that we have calculated stats from filtered data
    if (Object.keys(stats).length > 0) {
      // Add spacing to prevent collision with metadata box
      yPosition += 8
      
      // Check if we need a new page before Executive Summary
      yPosition = checkPageBreak(yPosition, 60)
      
      doc.setFontSize(14)
      doc.setTextColor(30, 41, 59)
      doc.text('Executive Summary', 15, yPosition)
      yPosition += 10

      // Statistics table
      const statsData = metrics.map((metric: string) => {
          const stat = stats[metric]
        if (!stat) return null
        
        let status = 'Normal'
        // Check if sensor has no valid data (all zeros or no readings)
        if (stat.count === 0 || (stat.avg === 0 && stat.min === 0 && stat.max === 0)) {
          status = 'Sensor not available'
        } else if (metric === 'Temperature') {
          if (stat.avg <= 18) status = 'Cool'
          else if (stat.avg <= 28) status = 'Moderate'
          else if (stat.avg <= 35) status = 'Warm'
          else status = 'Hot'
        } else if (metric === 'Humidity') {
          if (stat.avg <= 30) status = 'Dry'
          else if (stat.avg <= 60) status = 'Comfortable'
          else if (stat.avg <= 80) status = 'Humid'
          else status = 'Very Humid'
        } else if (metric === 'Pressure') {
          if (stat.avg <= 980) status = 'Low'
          else if (stat.avg <= 1010) status = 'Normal'
          else if (stat.avg <= 1030) status = 'High'
          else status = 'Very High'
        } else if (
          metric === 'AQI' ||
          metric === 'PM2_5' ||
          metric === 'PM10' ||
          metric === 'CO' ||
          metric === 'NO2' ||
          metric === 'O3' ||
          metric === 'SO2'
        ) {
          // Use the same thresholds as the dashboard Status Criteria for air quality metrics
          const metricThresholds: Record<string, [number, number, number]> = {
            AQI: [50, 100, 150],
            PM2_5: [12, 35, 55],
            PM10: [54, 154, 254],
            CO: [0.5, 1, 1.5],
            NO2: [25, 50, 100],
            O3: [60, 120, 180],
            SO2: [20, 40, 80],
          }
          const [g, m2, p] = metricThresholds[metric] || [0, 0, 0]
          if (stat.avg <= g) status = 'Good'
          else if (stat.avg <= m2) status = 'Moderate'
          else if (stat.avg <= p) status = 'Poor'
          else status = 'Unhealthy'
        } else if (metric === 'PM2_5' && stat.avg > 35) {
          status = 'Elevated'
        } else if (metric === 'PM10' && stat.avg > 150) {
          status = 'Elevated'
        }
        
        // Samples should be zero when the sensor is detected as not available
        const samples = status === 'Sensor not available' ? 0 : (stat.count || 0)

        // Leave the first cell empty; we'll custom-draw the Metric column with subscripts in didDrawCell.
        return [
          '',
          (Math.round(stat.avg * 10) / 10).toString(),
          (Math.round(stat.min * 10) / 10).toString(),
          (Math.round(stat.max * 10) / 10).toString(),
          samples.toLocaleString(),
          status
        ]
      }).filter((row): row is string[] => row !== null)

      // Ensure autoTable uses the Unicode font when available
      try { if (useUnicodeFont) doc.setFont('DejaVu', 'normal'); else doc.setFont('helvetica', 'normal') } catch (e) {}
      autoTable(doc, {
        head: [['Metric', 'Average', 'Minimum', 'Maximum', 'Samples', 'Status']],
        body: statsData,
        startY: yPosition,
        theme: 'grid',
        headStyles: { 
          fillColor: [71, 85, 105],
          textColor: [255, 255, 255],
          fontSize: 10,
          fontStyle: 'bold',
          halign: 'center',
          lineWidth: 0.5,
          lineColor: [148, 163, 184]
        },
        bodyStyles: { 
          fontSize: 9,
          lineWidth: 0.5,
          lineColor: [203, 213, 225]
        },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        columnStyles: {
          0: { cellWidth: 60, halign: 'left' },
        },
        didDrawCell: (data) => {
          // Replace the Metric text in the first column with subscripted + unit rendering
          // Only run for body rows to avoid overwriting the header cell (which should remain 'Metric')
          if (data.section === 'body' && data.column.index === 0 && data.cell && data.row) {
            const metricKey = metrics[data.row.index]
            const cellX = data.cell.x + 4
            // Centered vertically in cell
            const cellY = data.cell.y + (data.cell.height / 2) + 2
            // Clear existing text (autoTable already drew the text) by drawing white rect over it before custom draw
            try { doc.setDrawColor(255, 255, 255); doc.setFillColor(255,255,255); doc.rect(data.cell.x + 1, data.cell.y + 1, data.cell.width - 2, data.cell.height - 2, 'F') } catch (e) {}
            // Use consistent font size (9) and ensure font is set properly before drawing
            try { if (useUnicodeFont) doc.setFont('DejaVu', 'normal'); else doc.setFont('helvetica', 'normal') } catch (e) {}
            doc.setFontSize(9)
            doc.setTextColor(0, 0, 0)
            const unit = metricKey === 'AQI' ? undefined : unitForMetric(metricKey)
            drawMetricWithSubscript(metricKey, cellX, cellY, 9, unit || undefined, 0.15)
          }
        }
      })

      yPosition = (doc as any).lastAutoTable.finalY + 15

      // Add Status Criteria Scale
      yPosition = checkPageBreak(yPosition, 40)
      
      doc.setFontSize(12)
      doc.setTextColor(30, 41, 59)
      doc.text('Status Criteria', 15, yPosition)
      yPosition += 8

      // Draw colored scale bars for different metric types
      const scaleStartX = 15
      const scaleWidth = 180
      const scaleHeight = 8

      // Air Quality metrics scale (show subscripted metrics and numeric ranges matching dashboard)
      doc.setFontSize(9)
      doc.setTextColor(60, 60, 60)
      // Draw 'Air Quality (' then metric names with subscripts (metric names only, no units)
      try { writeText('Air Quality (', scaleStartX, yPosition) } catch (e) { doc.text('Air Quality (', scaleStartX, yPosition) }
      // Render metric list with subscripts
      const aqMetrics = ['AQI', 'PM2_5', 'PM10', 'CO', 'NO2', 'O3', 'SO2']
      let sx = scaleStartX + doc.getTextWidth('Air Quality (') + 2
      for (let i = 0; i < aqMetrics.length; i++) {
        const mk = aqMetrics[i]
        // include units in Status Criteria (omit for AQI)
        const unit = mk === 'AQI' ? undefined : unitForMetric(mk)
        // Draw metric name using subscript helper; use slightly larger subYOffset for visibility
        drawMetricWithSubscript(mk, sx, yPosition, 9, unit || undefined, 0.25)
        const w = measureMetricWidth(mk, 9)
        // Reduce spacing between metrics for a tighter layout
        sx += w + 2
        if (i < aqMetrics.length - 1) {
          writeText(',', sx - 1, yPosition)
        }
      }
      writeText('):', sx + 2, yPosition)
      yPosition += 5

      // Draw 4 colored bands
      const bandWidth = scaleWidth / 4
      doc.setFillColor(74, 222, 128) // Green
      doc.rect(scaleStartX, yPosition, bandWidth, scaleHeight, 'F')
      doc.setFillColor(251, 146, 60) // Amber
      doc.rect(scaleStartX + bandWidth, yPosition, bandWidth, scaleHeight, 'F')
      doc.setFillColor(249, 115, 22) // Orange
      doc.rect(scaleStartX + bandWidth * 2, yPosition, bandWidth, scaleHeight, 'F')
      doc.setFillColor(239, 68, 68) // Red
      doc.rect(scaleStartX + bandWidth * 3, yPosition, bandWidth, scaleHeight, 'F')

      // Numeric ranges below bands (dashboard thresholds)
      const aqRanges = ['0–50', '51–100', '101–150', '151+']
      doc.setFontSize(7)
      doc.setTextColor(60, 60, 60)
      for (let i = 0; i < 4; i++) {
        doc.text(aqRanges[i], scaleStartX + bandWidth * (i + 0.5), yPosition + scaleHeight + 4, { align: 'center' })
      }
      // Descriptive labels
      doc.setFontSize(7)
      doc.text('Good', scaleStartX + bandWidth / 2, yPosition + scaleHeight + 10, { align: 'center' })
      doc.text('Moderate', scaleStartX + bandWidth * 1.5, yPosition + scaleHeight + 10, { align: 'center' })
      doc.text('Poor', scaleStartX + bandWidth * 2.5, yPosition + scaleHeight + 10, { align: 'center' })
      doc.text('Unhealthy', scaleStartX + bandWidth * 3.5, yPosition + scaleHeight + 10, { align: 'center' })
      yPosition += scaleHeight + 14

      // Environmental metrics scale
      doc.setFontSize(9)
      doc.setTextColor(60, 60, 60)
      // Show sample counts only for Temperature and Humidity in the status criteria label (omit Pressure count)
      const getEnvSamples = (m: string) => {
        const s = stats[m]
        if (!s) return 0
        const unavailable = s.count === 0 || (s.avg === 0 && s.min === 0 && s.max === 0)
        return unavailable ? 0 : (s.count || 0)
      }
      const tCount = getEnvSamples('Temperature')
      const hCount = getEnvSamples('Humidity')
      // Separate scales for Temperature and Humidity
      // Temperature scale
      doc.setFontSize(9)
      doc.setTextColor(60, 60, 60)
      doc.text('Temperature:', scaleStartX, yPosition)
      yPosition += 5

      doc.setFillColor(74, 222, 128) // Green
      doc.rect(scaleStartX, yPosition, bandWidth, scaleHeight, 'F')
      doc.setFillColor(251, 146, 60) // Amber
      doc.rect(scaleStartX + bandWidth, yPosition, bandWidth, scaleHeight, 'F')
      doc.setFillColor(249, 115, 22) // Orange
      doc.rect(scaleStartX + bandWidth * 2, yPosition, bandWidth, scaleHeight, 'F')
      doc.setFillColor(239, 68, 68) // Red
      doc.rect(scaleStartX + bandWidth * 3, yPosition, bandWidth, scaleHeight, 'F')

      const tempRanges = ['<=18', '19-28', '29-35', '36+']
      doc.setFontSize(7)
      for (let i = 0; i < 4; i++) {
        doc.text(tempRanges[i], scaleStartX + bandWidth * (i + 0.5), yPosition + scaleHeight + 4, { align: 'center' })
      }
      doc.text('Cool', scaleStartX + bandWidth / 2, yPosition + scaleHeight + 10, { align: 'center' })
      doc.text('Moderate', scaleStartX + bandWidth * 1.5, yPosition + scaleHeight + 10, { align: 'center' })
      doc.text('Warm', scaleStartX + bandWidth * 2.5, yPosition + scaleHeight + 10, { align: 'center' })
      doc.text('Hot', scaleStartX + bandWidth * 3.5, yPosition + scaleHeight + 10, { align: 'center' })
      yPosition += scaleHeight + 16

      // Humidity scale
      doc.setFontSize(9)
      doc.setTextColor(60, 60, 60)
      doc.text('Humidity:', scaleStartX, yPosition)
      yPosition += 5

      doc.setFillColor(74, 222, 128) // Green
      doc.rect(scaleStartX, yPosition, bandWidth, scaleHeight, 'F')
      doc.setFillColor(251, 146, 60) // Amber
      doc.rect(scaleStartX + bandWidth, yPosition, bandWidth, scaleHeight, 'F')
      doc.setFillColor(249, 115, 22) // Orange
      doc.rect(scaleStartX + bandWidth * 2, yPosition, bandWidth, scaleHeight, 'F')
      doc.setFillColor(239, 68, 68) // Red
      doc.rect(scaleStartX + bandWidth * 3, yPosition, bandWidth, scaleHeight, 'F')

      const humRanges = ['0-30', '31-60', '61-80', '81+']
      doc.setFontSize(7)
      for (let i = 0; i < 4; i++) {
        doc.text(humRanges[i], scaleStartX + bandWidth * (i + 0.5), yPosition + scaleHeight + 4, { align: 'center' })
      }
      doc.text('Dry', scaleStartX + bandWidth / 2, yPosition + scaleHeight + 10, { align: 'center' })
      doc.text('Comfortable', scaleStartX + bandWidth * 1.5, yPosition + scaleHeight + 10, { align: 'center' })
      doc.text('Humid', scaleStartX + bandWidth * 2.5, yPosition + scaleHeight + 10, { align: 'center' })
      doc.text('Very Humid', scaleStartX + bandWidth * 3.5, yPosition + scaleHeight + 10, { align: 'center' })
      yPosition += scaleHeight + 18
    }

    // Add Sensor Availability Matrix for All Assets report with all sensors
    if (isMultiAsset && deviceIDs && deviceIDs.length > 1 && metrics.length > 1 && perDeviceData.size > 0) {
      yPosition = checkPageBreak(yPosition, 60)
      
      doc.setFontSize(14)
      doc.setTextColor(30, 41, 59)
      doc.text('Sensor Availability Matrix', 15, yPosition)
      yPosition += 10

      // Define column mapping for sensor availability check
      const sensorColumnMap: Record<string, string> = {
        AQI: "airQualityIndex",
        PM2_5: "valuePM_2_5",
        PM10: "valuePM_10",
        CO: "valueCO",
        NO2: "valueNO2",
        O3: "valueO3",
        SO2: "valueSO2",
        Temperature: "airTemperature",
        Humidity: "airHumidity",
        Pressure: "atmosPressure",
      }

      // Build matrix: rows = assets, columns = sensors
      // Compute per-metric availability counts while building rows
      const metricCounts: Record<string, number> = {}
      metrics.forEach(m => { metricCounts[m] = 0 })

      const matrixBody = deviceIDs.map((devID, idx) => {
        const assetName = assetNames?.[idx] || `Asset ${devID}`
        const location = (assetLocations?.[idx] ?? '').split(',')[0]?.trim() || ''
        const assetLabel = location ? `${assetName} (${location})` : assetName
        
        const deviceData = perDeviceData.get(String(devID))
        const row = [assetLabel]
        
        metrics.forEach(metric => {
          const key = sensorColumnMap[metric]
          if (deviceData && key) {
            // Check if this sensor has any non-zero readings
            const hasData = deviceData.some(d => {
              const val = Number((d as any)[key])
              return !isNaN(val) && val > 0
            })
            if (hasData) metricCounts[metric] = (metricCounts[metric] || 0) + 1
            row.push(hasData ? 'Yes' : 'No')
          } else {
            row.push('No')
          }
        })
        
        return row
      })

      // Prepare header row: metric names only (no units, no counts)
      const metricHeaderRow = ['Asset', ...metrics.map(m => displayMetricName(m))]

      try { if (useUnicodeFont) doc.setFont('DejaVu', 'normal'); else doc.setFont('helvetica', 'normal') } catch (e) {}
      autoTable(doc, {
        head: [metricHeaderRow],
        body: matrixBody,
        startY: yPosition,
        theme: 'grid',
        headStyles: { 
          fillColor: [71, 85, 105],
          textColor: [255, 255, 255],
          fontSize: 9,
          fontStyle: 'bold',
          halign: 'center',
          lineWidth: 0.5,
          lineColor: [148, 163, 184]
        },
        bodyStyles: { 
          fontSize: 8,
          halign: 'center',
          lineWidth: 0.5,
          lineColor: [203, 213, 225]
        },
        columnStyles: {
          0: { cellWidth: 'auto', halign: 'left', minCellWidth: 40, fontStyle: 'bold' },
        },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        didDrawCell: (data: any) => {
          // Render header metric names with subscripts (centered) and add visual distinction for Yes/No cells
          if (data.section === 'head' && data.row && data.row.index === 0 && data.column.index > 0) {
            // metric corresponding to this header column (first column is Asset)
            const metricIndex = data.column.index - 1
            const metricKey = metrics[metricIndex]
            if (metricKey && data.cell) {
              // Paint over the autoTable header text using the header fill color,
              // then draw our subscripted metric label in white so it doesn't duplicate.
              try { doc.setFillColor(71, 85, 105); doc.rect(data.cell.x, data.cell.y, data.cell.width, data.cell.height, 'F') } catch (e) {}
              // Measure width to center
              const w = measureMetricWidth(metricKey, 9)
              const x = data.cell.x + Math.max(2, (data.cell.width - w) / 2)
              const y = data.cell.y + data.cell.height / 2 + 2
              // Draw header text in white on the dark header background
              try { doc.setTextColor(255, 255, 255) } catch (e) {}
              drawMetricWithSubscript(metricKey, x, y, 9, undefined, 0.12)
              // restore to default text color
              try { doc.setTextColor(0, 0, 0) } catch (e) {}
            }
          }

          if (data.section === 'body' && data.column.index > 0) {
            const cellValue = data.cell.raw
            if (cellValue === 'Yes') {
              doc.setFillColor(220, 252, 231) // Light green
              doc.rect(data.cell.x, data.cell.y, data.cell.width, data.cell.height, 'F')
              doc.setTextColor(22, 101, 52) // Dark green
              doc.setFontSize(8)
              doc.text('Yes', data.cell.x + data.cell.width / 2, data.cell.y + data.cell.height / 2, {
                align: 'center',
                baseline: 'middle'
              })
            } else if (cellValue === 'No') {
              doc.setFillColor(254, 226, 226) // Light red
              doc.rect(data.cell.x, data.cell.y, data.cell.width, data.cell.height, 'F')
              doc.setTextColor(153, 27, 27) // Dark red
              doc.setFontSize(8)
              doc.text('No', data.cell.x + data.cell.width / 2, data.cell.y + data.cell.height / 2, {
                align: 'center',
                baseline: 'middle'
              })
            }
          }
        },
      })

      yPosition = (doc as any).lastAutoTable.finalY + 15
    }

    // Check if we have actual data - we should NOT filter out empty time spans
    // because we need to show the complete time range requested by the user
    if (aggregatedData.length === 0) {
      // Add "No Data Available" message only if truly no data points exist
      yPosition = checkPageBreak(yPosition, 50)

      doc.setFontSize(14)
      doc.setTextColor(30, 41, 59)
      doc.text('Charts', 15, yPosition)
      yPosition += 15

      doc.setFontSize(12)
      doc.setTextColor(239, 68, 68)
      doc.text('No Data Available for Charts', 105, yPosition, { align: 'center' })
      yPosition += 10
      doc.setFontSize(10)
      doc.setTextColor(100, 116, 139)
      doc.text('No readings were found in the selected date range.', 105, yPosition, { align: 'center' })
      yPosition += 7
      doc.text('The selected time period may not have any recorded data.', 105, yPosition, { align: 'center' })
      yPosition += 15
    } else {
      // We have data, proceed with charts
    yPosition = checkPageBreak(yPosition, 90)

    doc.setFontSize(14)
    doc.setTextColor(30, 41, 59)
    doc.text('Trend Analysis - All Pollutants (Line Chart)', 15, yPosition)
    yPosition += 10

    // Draw combined LINE chart
    const chartWidth = 170
    const chartHeight = 70
    const chartX = 20
    const chartY = yPosition
    const marginBottom = 20
    const marginLeft = 15

    // Adjust chart dimensions for labels
    const plotX = chartX + marginLeft
    const plotWidth = chartWidth - marginLeft
    const plotHeight = chartHeight - marginBottom

    // Draw axes
    doc.setDrawColor(100, 116, 139)
    doc.setLineWidth(0.5)
    doc.line(plotX, chartY + plotHeight, plotX + plotWidth, chartY + plotHeight) // X-axis
    doc.line(plotX, chartY, plotX, chartY + plotHeight) // Y-axis

    // Hardcoded color palette - each metric has a specific color
    const metricColors: Record<string, number[]> = {
      AQI: [96, 165, 250],      // Blue
      PM2_5: [239, 68, 68],     // Red
      PM10: [251, 146, 60],     // Orange
      CO: [34, 197, 94],        // Green
      NO2: [168, 85, 247],      // Purple
      O3: [234, 179, 8],        // Yellow
      SO2: [236, 72, 153],      // Pink
      Temperature: [14, 165, 233],  // Sky Blue
      Humidity: [20, 184, 166],     // Teal
      Pressure: [132, 204, 22],     // Lime
    }

    const columnMap: Record<string, keyof typeof aggregatedData[0]> = {
      AQI: "airQualityIndex",
      PM2_5: "valuePM_2_5",
      PM10: "valuePM_10",
      CO: "valueCO",
      NO2: "valueNO2",
      O3: "valueO3",
      SO2: "valueSO2",
      Temperature: "airTemperature",
      Humidity: "airHumidity",
      Pressure: "atmosPressure",
    }

    // Get data for all metrics and find global max
    let globalMax = 0
    const allMetricData: { data: Array<{ time: number; value: number | null }>; color: number[]; name: string }[] = []
    
    metrics.forEach((metric: string) => {
      const key = columnMap[metric]
      const color = metricColors[metric] || [100, 116, 139] // Default gray if metric not found
      if (key && aggregatedData.length > 0) {
        // Include zero-value buckets so charts plot across the full timespan (do not filter out zeros)
        const data = aggregatedData.map(d => {
          const raw = d[key] // Keep original value (null or number)
          const value = raw ?? null // Preserve null values for gap detection
          return { time: d.time, value: value as number | null }
        })

        // Always include metric series (even if all zeros) so the chart plots all buckets
        const validValues = data.map(d => d.value).filter((v): v is number => v != null && v > 0)
        const maxVal = validValues.length > 0 ? Math.max(...validValues) : 1
        globalMax = Math.max(globalMax, maxVal)
        allMetricData.push({
          data,
          color,
          name: displayMetricName(metric)
        })
      }
    })

    if (globalMax === 0) globalMax = 1

    // Draw grid lines (horizontal)
    doc.setDrawColor(230, 230, 230)
    doc.setLineWidth(0.2)
    for (let i = 1; i <= 4; i++) {
      const y = chartY + (plotHeight * i / 4)
      doc.line(plotX, y, plotX + plotWidth, y)
    }

    // Draw all pollutants as LINES only (no bars)
    allMetricData.forEach((pollutantData, idx) => {
      const dataToPlot = pollutantData.data
      const color = pollutantData.color

      // Helper: find next index after `start` that has a non-null value
      const findNextValidIndex = (arr: Array<{ time: number; value: number | null }>, start: number) => {
        for (let k = start + 1; k < arr.length; k++) {
          if (arr[k].value != null) return k
        }
        return -1
      }

      // Draw line with reduced thickness - position based on actual timestamps
      doc.setDrawColor(color[0], color[1], color[2])
      doc.setLineWidth(0.2)
      for (let i = 0; i < dataToPlot.length; i++) {
        const val1 = dataToPlot[i].value
        const hasValue1 = val1 != null

        if (!hasValue1) continue

        // Find next valid point (may be non-adjacent) and draw straight line
        const nextIdx = findNextValidIndex(dataToPlot, i)
        if (nextIdx === -1) {
          // Only draw the isolated point
          const time1 = dataToPlot[i].time
          const normalizedX1 = (time1 - aggStart) / (aggEnd - aggStart)
          const x1 = plotX + (normalizedX1 * plotWidth)
          const y1 = chartY + plotHeight - ((dataToPlot[i].value! / globalMax) * plotHeight)
          doc.setFillColor(color[0], color[1], color[2])
          doc.circle(x1, y1, 0.2, 'F')
          continue
        }

        // Draw line between i and nextIdx
        const time1 = dataToPlot[i].time
        const time2 = dataToPlot[nextIdx].time
        const normalizedX1 = (time1 - aggStart) / (aggEnd - aggStart)
        const normalizedX2 = (time2 - aggStart) / (aggEnd - aggStart)

        const x1 = plotX + (normalizedX1 * plotWidth)
        const y1 = chartY + plotHeight - ((dataToPlot[i].value! / globalMax) * plotHeight)
        const x2 = plotX + (normalizedX2 * plotWidth)
        const y2 = chartY + plotHeight - ((dataToPlot[nextIdx].value! / globalMax) * plotHeight)

        doc.line(x1, y1, x2, y2)

        // Draw starting point
        doc.setFillColor(color[0], color[1], color[2])
        doc.circle(x1, y1, 0.2, 'F')

        // Advance i to nextIdx - 1 so loop continues after the segment
        i = nextIdx - 1
      }
      // Last point (only if non-zero)
      if (dataToPlot.length > 0) {
          const lastIdx = dataToPlot.length - 1
          if (dataToPlot[lastIdx].value != null) {
          const lastTime = dataToPlot[lastIdx].time
          const normalizedX = (lastTime - aggStart) / (aggEnd - aggStart)
          const x = plotX + (normalizedX * plotWidth)
          const y = chartY + plotHeight - ((dataToPlot[lastIdx].value / globalMax) * plotHeight)
          doc.circle(x, y, 0.2, 'F')
        }
      }
    })

    // Y-axis labels - use smart rounding like the dashboard does
    doc.setFontSize(7)
    doc.setTextColor(100, 116, 139)
    
    // Helper to format Y-axis values nicely (remove unnecessary decimals)
    const formatYValue = (value: number): string => {
      if (value === 0) return '0'
      if (value >= 1000) return Math.round(value).toLocaleString()
      if (value >= 100) return Math.round(value).toString()
      if (value >= 10) return (Math.round(value * 10) / 10).toString()
      return (Math.round(value * 100) / 100).toString()
    }
    
    for (let i = 0; i <= 4; i++) {
      const value = (globalMax * i / 4)
      const y = chartY + plotHeight - (plotHeight * i / 4)
      doc.text(formatYValue(value), plotX - 3, y + 2, { align: 'right' })
    }

    // Y-axis title (rotated, positioned further left to avoid overlap)
    doc.setFontSize(8)
    doc.setTextColor(60, 60, 60)
    doc.text('Value', chartX + 5, chartY + plotHeight / 2, { angle: 90 })

    // X-axis time labels - always use evenly spaced ticks to prevent gaps in label spacing
    doc.setFontSize(6)
    doc.setTextColor(100, 116, 139)
    // Always generate evenly spaced ticks across full domain (prevents missing labels at data gaps)
    const evenTicks = generateEvenTicks(aggStart, aggEnd, 12)
    evenTicks.forEach((tickTime, i) => {
      const normalizedPosition = (tickTime - aggStart) / (aggEnd - aggStart)
      const tickX = plotX + (normalizedPosition * plotWidth)
      const clampedX = Math.max(plotX, Math.min(plotX + plotWidth, tickX))
      let align: 'left' | 'center' | 'right' = 'center'
      if (i === 0) align = 'left'
      else if (i === evenTicks.length - 1) align = 'right'
      const { dateStr, timeStr } = format12Hour(new Date(tickTime))
      doc.text(dateStr, clampedX, chartY + plotHeight + 5, { align, baseline: 'top' })
      doc.text(timeStr, clampedX, chartY + plotHeight + 9, { align, baseline: 'top' })
    })

    // X-axis title
    doc.setFontSize(7)
    doc.setTextColor(60, 60, 60)
    doc.text('Time', plotX + plotWidth / 2, chartY + plotHeight + 15, { align: 'center' })

    // Legend - increased gap from time labels (moved from Y+18 to Y+24)
    // Ensure width measurements and labels use Unicode font when available
    try { if (useUnicodeFont) doc.setFont('DejaVu', 'normal'); else doc.setFont('helvetica', 'normal') } catch (e) {}
    doc.setFontSize(7)
    let legendX = plotX
    let legendY = chartY + plotHeight + 24
    metrics.forEach((metric) => {
      const color = metricColors[metric] || [100, 116, 139] // Default gray if metric not found
      const labelWidth = measureMetricWidth(metric)

      // Check if we need to wrap to next line
      if (legendX + labelWidth + 10 > plotX + plotWidth) {
        legendX = plotX
        legendY += 6
      }

      doc.setFillColor(color[0], color[1], color[2])
      doc.rect(legendX, legendY - 2, 3, 3, 'F')
      doc.setTextColor(60, 60, 60)
      // Draw metric with subscript and unit (omit unit for AQI)
      const unit = metric === 'AQI' ? undefined : unitForMetric(metric)
      drawMetricWithSubscript(metric, legendX + 5, legendY + 1, 7, unit || undefined)
      legendX += labelWidth + 10
    })

    yPosition += chartHeight + marginBottom + 10

    // First, render the AQI individual chart if AQI is in metrics
    if (metrics.includes('AQI')) {
      const metric = 'AQI'
      const key = columnMap[metric]
      
      if (key) {
        // Include zero-value buckets so per-metric charts also plot full timespan
        const chartData = aggregatedData.map(d => {
          const raw = d[key] // Keep original value (null or number)
          const value = raw ?? null // Preserve null values for gap detection
          return { time: d.time, value: value as number | null }
        })

        const hasDataAQI = chartData.some(d => d.value != null && d.value > 0)
        if (!hasDataAQI) {
          yPosition = checkPageBreak(yPosition, 20)
          doc.setFontSize(12)
          doc.setTextColor(30, 41, 59)
          drawMetricWithSubscript('AQI', 15, yPosition, 12, undefined)
          const headingW = measureMetricWidth('AQI', 12)
          writeText(' - Sensor not available', 15 + headingW + 6, yPosition)
          yPosition += 15
        } else {
          // LINE CHART for AQI
          yPosition = checkPageBreak(yPosition, 75)

        doc.setFontSize(12)
        doc.setTextColor(30, 41, 59)
        // Draw metric with subscript + unit (omit unit for AQI), then append " - Line Chart"
        const aqiUnit = metric === 'AQI' ? undefined : unitForMetric(metric)
        drawMetricWithSubscript(metric, 15, yPosition, 12, aqiUnit || undefined)
        const headingWidth = measureMetricWidth(metric, 12)
        writeText(' - Line Chart', 15 + headingWidth + 6, yPosition)
        yPosition += 8

        const lineChartHeight = isMultiAsset && perDeviceData.size > 1 ? 70 : 60 // More height for legend
        const linePlotHeight = lineChartHeight - marginBottom
        const lineChartY = yPosition

        // FOR MULTI-ASSET: Prepare data for each device + average
        let allDeviceChartData: Array<{ data: Array<{ time: number; value: number | null }>; color: number[]; label: string }> = []
        
        if (isMultiAsset && perDeviceData.size > 1) {
          // Define colors for up to 10 devices
          const deviceColors = [
            [16, 185, 129],   // Green
            [249, 115, 22],   // Orange
            [236, 72, 153],   // Pink
            [139, 92, 246],   // Purple
            [245, 158, 11],   // Amber
            [20, 184, 166],   // Teal
            [239, 68, 68],    // Red
            [168, 85, 247],   // Violet
            [14, 165, 233],   // Sky
          ]
          
          let deviceIdx = 0
          perDeviceData.forEach((deviceData, devID) => {
            const deviceChartData = deviceData.map(d => {
              const raw = Number(d.airQualityIndex)
              const value = isNaN(raw) ? null : raw // Preserve null values for gap detection
              return { time: d.time, value }
            })
            
            const idx = deviceIDs!.indexOf(devID)
            const assetName = assetNames ? assetNames[idx] : `Asset ${devID}`
            const color = deviceColors[deviceIdx % deviceColors.length]
            
            allDeviceChartData.push({
              data: deviceChartData,
              color: color,
              label: `${assetName} (${ (assetLocations?.[idx] ?? 'No location').split(',')[0]?.trim() || 'No location' })`
            })
            
            deviceIdx++
          })
          
          // Calculate average line
          allDeviceChartData.push({
            data: chartData,
            color: [59, 130, 246],   // Blue
            label: 'Average'
          })
        }

        // Draw axes
        doc.setDrawColor(100, 116, 139)
        doc.setLineWidth(0.2)
        doc.line(plotX, lineChartY + linePlotHeight, plotX + plotWidth, lineChartY + linePlotHeight)
        doc.line(plotX, lineChartY, plotX, lineChartY + linePlotHeight)

        // Calculate max value for this metric
        let maxValue = Math.max(...chartData.map(d => d.value).filter(v => v != null), 1)
        
        // For multi-asset, also check max values across all devices
        if (isMultiAsset && allDeviceChartData.length > 0) {
          allDeviceChartData.forEach(deviceLineData => {
            const deviceMax = Math.max(...deviceLineData.data.map(d => d.value).filter((v): v is number => v != null), 1)
            maxValue = Math.max(maxValue, deviceMax)
          })
        }
        
        const color = metricColors[metric] || [100, 116, 139]

        // Draw grid
        doc.setDrawColor(230, 230, 230)
        doc.setLineWidth(0.2)
        for (let j = 1; j <= 4; j++) {
          const y = lineChartY + (linePlotHeight * j / 4)
          doc.line(plotX, y, plotX + plotWidth, y)
        }

        // Draw lines - either multi-asset or single
        if (isMultiAsset && allDeviceChartData.length > 0) {
          // Draw all device lines + average
          allDeviceChartData.forEach((deviceLineData, idx) => {
            const dataToPlot = deviceLineData.data
            const lineColor = deviceLineData.color

            // Make average line thicker
            const lineWidth = deviceLineData.label === 'Average' ? 0.2 : 0.2

            doc.setDrawColor(lineColor[0], lineColor[1], lineColor[2])
            doc.setLineWidth(lineWidth)

            // Helper: find next index after `start` that has a non-null value
            const findNextValidIndex = (arr: Array<{ time: number; value: number | null }>, start: number) => {
              for (let k = start + 1; k < arr.length; k++) {
                if (arr[k].value != null) return k
              }
              return -1
            }

            for (let j = 0; j < dataToPlot.length; j++) {
              const val1 = dataToPlot[j].value
              const hasValue1 = val1 != null
              if (!hasValue1) continue

              const nextIdx = findNextValidIndex(dataToPlot, j)
                if (nextIdx === -1) {
                  const time1 = dataToPlot[j].time
                  const normalizedX1 = (time1 - aggStart) / (aggEnd - aggStart)
                  const x1 = plotX + (normalizedX1 * plotWidth)
                  const y1 = lineChartY + linePlotHeight - ((dataToPlot[j].value! / maxValue) * linePlotHeight)
                  doc.setFillColor(lineColor[0], lineColor[1], lineColor[2])
                  doc.circle(x1, y1, lineWidth, 'F')
                  continue
                }

              // Draw line between j and nextIdx
              const time1 = dataToPlot[j].time
              const time2 = dataToPlot[nextIdx].time
              const normalizedX1 = (time1 - aggStart) / (aggEnd - aggStart)
              const normalizedX2 = (time2 - aggStart) / (aggEnd - aggStart)

              const x1 = plotX + (normalizedX1 * plotWidth)
              const y1 = lineChartY + linePlotHeight - ((dataToPlot[j].value! / maxValue) * linePlotHeight)
              const x2 = plotX + (normalizedX2 * plotWidth)
              const y2 = lineChartY + linePlotHeight - ((dataToPlot[nextIdx].value! / maxValue) * linePlotHeight)

              doc.line(x1, y1, x2, y2)
              doc.setFillColor(lineColor[0], lineColor[1], lineColor[2])
              doc.circle(x1, y1, lineWidth, 'F')

              j = nextIdx - 1
            }

            // Last point (only if non-null)
            if (dataToPlot.length > 0) {
              const lastIdx = dataToPlot.length - 1
                if (dataToPlot[lastIdx].value != null) {
                const lastTime = dataToPlot[lastIdx].time
                const normalizedX = (lastTime - aggStart) / (aggEnd - aggStart)
                const x = plotX + (normalizedX * plotWidth)
                const y = lineChartY + linePlotHeight - ((dataToPlot[lastIdx].value / maxValue) * linePlotHeight)
                doc.setFillColor(lineColor[0], lineColor[1], lineColor[2])
                doc.circle(x, y, lineWidth, 'F')
              }
            }
          })
        } else {
          // Single asset
          const dataToPlot = chartData
          
          doc.setDrawColor(color[0], color[1], color[2])
          doc.setLineWidth(0.2)
          // Helper: find next index after `start` that has a non-null value
          const findNextValidIndex = (arr: Array<{ time: number; value: number | null }>, start: number) => {
            for (let k = start + 1; k < arr.length; k++) {
              if (arr[k].value != null) return k
            }
            return -1
          }

          for (let j = 0; j < dataToPlot.length; j++) {
            const val1 = dataToPlot[j].value
            const hasValue1 = val1 != null
            if (!hasValue1) continue

            const nextIdx = findNextValidIndex(dataToPlot, j)
            if (nextIdx === -1) {
              const time1 = dataToPlot[j].time
              const normalizedX1 = (time1 - aggStart) / (aggEnd - aggStart)
              const x1 = plotX + (normalizedX1 * plotWidth)
              const y1 = lineChartY + linePlotHeight - ((val1 / maxValue) * linePlotHeight)
              doc.setFillColor(color[0], color[1], color[2])
              doc.circle(x1, y1, 0.2, 'F')
              continue
            }

            const time1 = dataToPlot[j].time
            const time2 = dataToPlot[nextIdx].time
            const normalizedX1 = (time1 - aggStart) / (aggEnd - aggStart)
            const normalizedX2 = (time2 - aggStart) / (aggEnd - aggStart)

            const x1 = plotX + (normalizedX1 * plotWidth)
            const y1 = lineChartY + linePlotHeight - ((val1 / maxValue) * linePlotHeight)
            const x2 = plotX + (normalizedX2 * plotWidth)
            const y2 = lineChartY + linePlotHeight - ((dataToPlot[nextIdx].value! / maxValue) * linePlotHeight)

            doc.line(x1, y1, x2, y2)
            doc.setFillColor(color[0], color[1], color[2])
            doc.circle(x1, y1, 0.2, 'F')

            j = nextIdx - 1
          }
          // Last point (only if non-zero)
            // Last point (only if non-null)
            if (dataToPlot.length > 0) {
              const lastIdx = dataToPlot.length - 1
              if (dataToPlot[lastIdx].value != null) {
              const lastTime = dataToPlot[lastIdx].time
              const normalizedX = (lastTime - aggStart) / (aggEnd - aggStart)
              const x = plotX + (normalizedX * plotWidth)
              const y = lineChartY + linePlotHeight - ((dataToPlot[lastIdx].value / maxValue) * linePlotHeight)
              doc.circle(x, y, 0.2, 'F')
            }
          }
        }

        // Y-axis labels
        doc.setFontSize(7)
        doc.setTextColor(100, 116, 139)
        
        const formatYValueAQI = (value: number): string => {
          if (value === 0) return '0'
          if (value >= 1000) return Math.round(value).toLocaleString()
          if (value >= 100) return Math.round(value).toString()
          if (value >= 10) return (Math.round(value * 10) / 10).toString()
          return (Math.round(value * 100) / 100).toString()
        }
        
        for (let j = 0; j <= 4; j++) {
          const value = (maxValue * j / 4)
          const y = lineChartY + linePlotHeight - (linePlotHeight * j / 4)
          doc.text(formatYValueAQI(value), plotX - 3, y + 2, { align: 'right' })
        }

        // Y-axis title
        doc.setFontSize(8)
        doc.setTextColor(60, 60, 60)
        doc.text('Value', chartX + 5, lineChartY + linePlotHeight / 2, { angle: 90 })

        // X-axis time labels - always use evenly spaced ticks
        doc.setFontSize(6)
        doc.setTextColor(100, 116, 139)
        const evenTicksAQI = generateEvenTicks(aggStart, aggEnd, 12)
        evenTicksAQI.forEach((tickTime, ti) => {
          const normalizedPosition = (tickTime - aggStart) / (aggEnd - aggStart)
          const tickX = plotX + (normalizedPosition * plotWidth)
          const clampedX = Math.max(plotX, Math.min(plotX + plotWidth, tickX))
          let align: 'left' | 'center' | 'right' = 'center'
          if (ti === 0) align = 'left'
          else if (ti === evenTicksAQI.length - 1) align = 'right'
          const { dateStr, timeStr } = format12Hour(new Date(tickTime))
          doc.text(dateStr, clampedX, lineChartY + linePlotHeight + 4, { align, baseline: 'top' })
          doc.text(timeStr, clampedX, lineChartY + linePlotHeight + 8, { align, baseline: 'top' })
        })

        // X-axis title
        doc.setFontSize(7)
        doc.setTextColor(60, 60, 60)
        doc.text('Time', plotX + plotWidth / 2, lineChartY + linePlotHeight + 15, { align: 'center' })
        
        // For multi-asset: Add legend below the chart
        if (isMultiAsset && allDeviceChartData.length > 0) {
          doc.setFontSize(6)
          let legendX = plotX
          let legendY = lineChartY + linePlotHeight + 24
          
          allDeviceChartData.forEach((deviceLineData, idx) => {
            const label = deviceLineData.label
            const lineColor = deviceLineData.color
            const labelWidth = doc.getTextWidth(label)
            
            // Check if we need to wrap to next line
            if (legendX + labelWidth + 10 > plotX + plotWidth) {
              legendX = plotX
              legendY += 5
            }
            
            // Draw color square
            doc.setFillColor(lineColor[0], lineColor[1], lineColor[2])
            doc.rect(legendX, legendY - 1.5, 2, 2, 'F')
            
            // Draw label
            doc.setTextColor(60, 60, 60)
            writeText(label, legendX + 3.5, legendY + 0.5)
            legendX += labelWidth + 8
          })
          
          yPosition += lineChartHeight + marginBottom + 15 // Extra space for legend
        } else {
          // Stats for single-asset
          doc.setFontSize(7)
          doc.setTextColor(100, 116, 139)
          const validChartData = chartData.filter((d): d is { time: number; value: number } => d.value != null)
          const avg = validChartData.length > 0 ? (validChartData.reduce((sum, d) => sum + d.value, 0) / validChartData.length).toFixed(2) : '0'
          const min = validChartData.length > 0 ? Math.min(...validChartData.map(d => d.value)).toFixed(2) : '0'
          const max = validChartData.length > 0 ? Math.max(...validChartData.map(d => d.value)).toFixed(2) : '0'
          // Show executive summary stats above chart, right-aligned
          if (stats[metric]) {
            const stat = stats[metric];
            const statText = `Avg: ${stat.avg.toFixed(2)}  Min: ${stat.min.toFixed(2)}  Max: ${stat.max.toFixed(2)}`;
            doc.setFontSize(8);
            doc.setTextColor(60, 60, 60);
            doc.text(statText, plotX + plotWidth, lineChartY - 8, { align: 'right' });
          }
          
          yPosition += lineChartHeight + marginBottom + 5
        }
      }
    }
  }

    // Individual line charts for each metric with detailed view (excluding AQI which was already rendered above)
    for (let i = 0; i < metrics.length; i++) {
      const metric = metrics[i]
      
      // Skip AQI as it was already rendered above
      if (metric === 'AQI') continue
      
      // Get chart data for this metric from aggregated data
      const key = columnMap[metric]
      if (!key) continue
      
      // LINE CHART for this metric
      // Check if we need a new page before drawing individual chart
      yPosition = checkPageBreak(yPosition, 75)

      doc.setFontSize(12)
      doc.setTextColor(30, 41, 59)
      // Draw pollutant name with subscript and unit in heading (omit unit for AQI)
      const metricUnit = metric === 'AQI' ? undefined : unitForMetric(metric)
      drawMetricWithSubscript(metric, 15, yPosition, 12, metricUnit || undefined)
      const headingW = measureMetricWidth(metric, 12)
      writeText(' - Line Chart', 15 + headingW + 6, yPosition)
      yPosition += 8

      const lineChartHeight = isMultiAsset && perDeviceData.size > 1 ? 70 : 60 // More height for legend
      const linePlotHeight = lineChartHeight - marginBottom
      const lineChartY = yPosition
      
      // FOR MULTI-ASSET: Prepare data for each device + average
      let allDeviceChartData: Array<{ data: Array<{ time: number; value: number | null }>; color: number[]; label: string }> = []
      
      if (isMultiAsset && perDeviceData.size > 1) {
        // Define colors for up to 10 devices
        const deviceColors = [  
          [16, 185, 129],   // Green
          [249, 115, 22],   // Orange
          [236, 72, 153],   // Pink
          [139, 92, 246],   // Purple
          [245, 158, 11],   // Amber
          [20, 184, 166],   // Teal
          [239, 68, 68],    // Red
          [168, 85, 247],   // Violet
          [14, 165, 233],   // Sky
        ]
        
        let deviceIdx = 0
        perDeviceData.forEach((deviceData, devID) => {
          const deviceChartData = deviceData.map(d => {
            const raw = Number((d as any)[key])
            const value = isNaN(raw) ? null : raw // Preserve null values for gap detection
            return { time: d.time, value }
          })
          
          const idx = deviceIDs!.indexOf(devID)
          const assetName = assetNames ? assetNames[idx] : `Asset ${devID}`
          const color = deviceColors[deviceIdx % deviceColors.length]
          
          allDeviceChartData.push({
            data: deviceChartData,
            color: color,
            label: `${assetName} (${ (assetLocations?.[idx] ?? 'No location').split(',')[0]?.trim() || 'No location' })`
          })
          
          deviceIdx++
        })
        
        // Calculate average line
        const avgChartData = aggregatedData.map(d => {
          const raw = Number((d as any)[key])
          const value = isNaN(raw) ? null : raw // Preserve null values for gap detection
          return { time: d.time, value }
        })
        
        allDeviceChartData.push({
          data: avgChartData,
          color: [59, 130, 246], // blue for average
          label: 'Average'
        })
      }
      
      // Include zero-value buckets so per-metric charts also plot full timespan
      const chartData = aggregatedData.map(d => {
        const raw = Number((d as any)[key])
        const value = isNaN(raw) ? null : raw // Preserve null values for gap detection
        return { time: d.time, value }
      })

      const hasData = chartData.some(d => d.value != null && d.value > 0)
      if (!hasData) {
        yPosition = checkPageBreak(yPosition, 20)
        doc.setFontSize(12)
        doc.setTextColor(30, 41, 59)
        drawMetricWithSubscript(metric, 15, yPosition, 12, metricUnit || undefined)
        const headingW = measureMetricWidth(metric, 12)
        writeText(' - Sensor not available', 15 + headingW + 6, yPosition)
        yPosition += 15
        continue
      }

      // Draw axes
      doc.setDrawColor(100, 116, 139)
      doc.setLineWidth(0.2)
      doc.line(plotX, lineChartY + linePlotHeight, plotX + plotWidth, lineChartY + linePlotHeight)
      doc.line(plotX, lineChartY, plotX, lineChartY + linePlotHeight)

      // Draw grid
      doc.setDrawColor(230, 230, 230)
      doc.setLineWidth(0.2)
      for (let j = 1; j <= 4; j++) {
        const y = lineChartY + (linePlotHeight * j / 4)
        doc.line(plotX, y, plotX + plotWidth, y)
      }

        // Calculate max value for this metric
        let maxValue = 1
        if (isMultiAsset && allDeviceChartData.length > 0) {
          // Find max across all devices
          maxValue = Math.max(
            ...allDeviceChartData.flatMap(d => d.data.map(p => p.value).filter(v => v != null)),
            1
          )
        } else {
          maxValue = Math.max(...chartData.map(d => d.value).filter(v => v != null), 1)
        }      // Draw lines - multi-asset or single-asset
      if (isMultiAsset && allDeviceChartData.length > 0) {
        // Draw all device lines + average
        allDeviceChartData.forEach((deviceLineData, idx) => {
          const dataToPlot = deviceLineData.data
          const color = deviceLineData.color
          const isAverage = deviceLineData.label === 'Average'

          // Make average line thicker
          doc.setDrawColor(color[0], color[1], color[2])
          doc.setLineWidth(isAverage ? 0.2 : 0.2)

          // Helper: find next index after `start` that has a non-null value
          const findNextValidIndex = (arr: Array<{ time: number; value: number | null }>, start: number) => {
            for (let k = start + 1; k < arr.length; k++) {
              if (arr[k].value != null) return k
            }
            return -1
          }

          for (let j = 0; j < dataToPlot.length; j++) {
            const val1 = dataToPlot[j].value
            const hasValue1 = val1 != null
            if (!hasValue1) continue

            const nextIdx = findNextValidIndex(dataToPlot, j)
            if (nextIdx === -1) {
              const time1 = dataToPlot[j].time
              const normalizedX1 = (time1 - aggStart) / (aggEnd - aggStart)
              const x1 = plotX + (normalizedX1 * plotWidth)
              const y1 = lineChartY + linePlotHeight - ((val1 / maxValue) * linePlotHeight)
              doc.setFillColor(color[0], color[1], color[2])
              doc.circle(x1, y1, isAverage ? 0.2 : 0.2, 'F')
              continue
            }

            // Draw straight line from j to nextIdx
            const time1 = dataToPlot[j].time
            const time2 = dataToPlot[nextIdx].time
            const normalizedX1 = (time1 - aggStart) / (aggEnd - aggStart)
            const normalizedX2 = (time2 - aggStart) / (aggEnd - aggStart)

            const x1 = plotX + (normalizedX1 * plotWidth)
            const y1 = lineChartY + linePlotHeight - ((dataToPlot[j].value! / maxValue) * linePlotHeight)
            const x2 = plotX + (normalizedX2 * plotWidth)
            const y2 = lineChartY + linePlotHeight - ((dataToPlot[nextIdx].value! / maxValue) * linePlotHeight)

            doc.line(x1, y1, x2, y2)
            doc.setFillColor(color[0], color[1], color[2])
            doc.circle(x1, y1, isAverage ? 0.2 : 0.2, 'F')

            j = nextIdx - 1
          }

          // Last point (only if non-null)
          if (dataToPlot.length > 0) {
            const lastIdx = dataToPlot.length - 1
            if (dataToPlot[lastIdx].value != null) {
              const lastTime = dataToPlot[lastIdx].time
              const normalizedX = (lastTime - aggStart) / (aggEnd - aggStart)
              const x = plotX + (normalizedX * plotWidth)
              const y = lineChartY + linePlotHeight - ((dataToPlot[lastIdx].value / maxValue) * linePlotHeight)
              doc.circle(x, y, isAverage ? 0.2 : 0.2, 'F')
            }
          }
        })
      } else {
        // Single-asset: draw one line
        const dataToPlot = chartData
        const color = metricColors[metric] || [100, 116, 139]

        doc.setDrawColor(color[0], color[1], color[2])
        doc.setLineWidth(0.2)
        // Helper: find next index after `start` that has a non-null value
        const findNextValidIndex = (arr: Array<{ time: number; value: number | null }>, start: number) => {
          for (let k = start + 1; k < arr.length; k++) {
            if (arr[k].value != null) return k
          }
          return -1
        }

        for (let j = 0; j < dataToPlot.length; j++) {
          const val1 = dataToPlot[j].value
          const hasValue1 = val1 != null
          if (!hasValue1) continue

          const nextIdx = findNextValidIndex(dataToPlot, j)
          if (nextIdx === -1) {
            const time1 = dataToPlot[j].time
            const normalizedX1 = (time1 - aggStart) / (aggEnd - aggStart)
            const x1 = plotX + (normalizedX1 * plotWidth)
            const y1 = lineChartY + linePlotHeight - ((val1 / maxValue) * linePlotHeight)
            doc.setFillColor(color[0], color[1], color[2])
            doc.circle(x1, y1, 0.2, 'F')
            continue
          }

          const time1 = dataToPlot[j].time
          const time2 = dataToPlot[nextIdx].time
          const normalizedX1 = (time1 - aggStart) / (aggEnd - aggStart)
          const normalizedX2 = (time2 - aggStart) / (aggEnd - aggStart)

          const x1 = plotX + (normalizedX1 * plotWidth)
          const y1 = lineChartY + linePlotHeight - ((val1 / maxValue) * linePlotHeight)
          const x2 = plotX + (normalizedX2 * plotWidth)
          const y2 = lineChartY + linePlotHeight - ((dataToPlot[nextIdx].value! / maxValue) * linePlotHeight)

          doc.line(x1, y1, x2, y2)
          doc.setFillColor(color[0], color[1], color[2])
          doc.circle(x1, y1, 0.2, 'F')

          j = nextIdx - 1
        }
        // Last point (only if non-zero)
          // Last point (only if non-null)
          if (dataToPlot.length > 0) {
            const lastIdx = dataToPlot.length - 1
            if (dataToPlot[lastIdx].value != null) {
            const lastTime = dataToPlot[lastIdx].time
            const normalizedX = (lastTime - aggStart) / (aggEnd - aggStart)
            const x = plotX + (normalizedX * plotWidth)
            const y = lineChartY + linePlotHeight - ((dataToPlot[lastIdx].value / maxValue) * linePlotHeight)
            doc.circle(x, y, 0.2, 'F')
          }
        }
      }

      // Y-axis labels - use smart rounding like the dashboard does
      doc.setFontSize(7)
      doc.setTextColor(100, 116, 139)
      
      // Helper to format Y-axis values nicely (remove unnecessary decimals)
      const formatYValue = (value: number): string => {
        if (value === 0) return '0'
        if (value >= 1000) return Math.round(value).toLocaleString()
        if (value >= 100) return Math.round(value).toString()
        if (value >= 10) return (Math.round(value * 10) / 10).toString()
        return (Math.round(value * 100) / 100).toString()
      }
      
      for (let j = 0; j <= 4; j++) {
        const value = (maxValue * j / 4)
        const y = lineChartY + linePlotHeight - (linePlotHeight * j / 4)
        doc.text(formatYValue(value), plotX - 3, y + 2, { align: 'right' })
      }

      // Y-axis title (positioned further left to avoid overlap)
      doc.setFontSize(8)
      doc.setTextColor(60, 60, 60)
      doc.text('Value', chartX + 5, lineChartY + linePlotHeight / 2, { angle: 90 })

      // X-axis time labels - always use evenly spaced ticks
      doc.setFontSize(6)
      doc.setTextColor(100, 116, 139)
      const evenTicksPollutant = generateEvenTicks(aggStart, aggEnd, 12)
      evenTicksPollutant.forEach((tickTime, ti) => {
        const normalizedPosition = (tickTime - aggStart) / (aggEnd - aggStart)
        const tickX = plotX + (normalizedPosition * plotWidth)
        const clampedX = Math.max(plotX, Math.min(plotX + plotWidth, tickX))
        let align: 'left' | 'center' | 'right' = 'center'
        if (ti === 0) align = 'left'
        else if (ti === evenTicksPollutant.length - 1) align = 'right'
        const { dateStr, timeStr } = format12Hour(new Date(tickTime))
        doc.text(dateStr, clampedX, lineChartY + linePlotHeight + 4, { align, baseline: 'top' })
        doc.text(timeStr, clampedX, lineChartY + linePlotHeight + 8, { align, baseline: 'top' })
      })

      // X-axis title
      doc.setFontSize(7)
      doc.setTextColor(60, 60, 60)
      doc.text('Time', plotX + plotWidth / 2, lineChartY + linePlotHeight + 15, { align: 'center' })
      
      // For multi-asset: Add legend below the chart
      if (isMultiAsset && allDeviceChartData.length > 0) {
        doc.setFontSize(6)
        // Ensure legend text measurement uses Unicode font when available
        try { if (useUnicodeFont) doc.setFont('DejaVu', 'normal'); else doc.setFont('helvetica', 'normal') } catch (e) {}
        let legendX = plotX
        let legendY = lineChartY + linePlotHeight + 24
        
        allDeviceChartData.forEach((deviceLineData, idx) => {
          const label = deviceLineData.label
          const color = deviceLineData.color
          const labelWidth = doc.getTextWidth(label)
          
          // Check if we need to wrap to next line
          if (legendX + labelWidth + 10 > plotX + plotWidth) {
            legendX = plotX
            legendY += 5
          }
          
          // Draw color square
          doc.setFillColor(color[0], color[1], color[2])
          doc.rect(legendX, legendY - 1.5, 2, 2, 'F')
          
          // Draw label
          doc.setTextColor(60, 60, 60)
          writeText(label, legendX + 3.5, legendY + 0.5)
          legendX += labelWidth + 8
        })
        
        yPosition += lineChartHeight + marginBottom + 15 // Extra space for legend
      } else {
        // Stats for single-asset
        doc.setFontSize(7)
        doc.setTextColor(100, 116, 139)
        const validChartData = chartData.filter((d): d is { time: number; value: number } => d.value != null)
        const avg = validChartData.length > 0 ? (validChartData.reduce((sum, d) => sum + d.value, 0) / validChartData.length).toFixed(2) : '0'
        const min = validChartData.length > 0 ? Math.min(...validChartData.map(d => d.value)).toFixed(2) : '0'
        const max = validChartData.length > 0 ? Math.max(...validChartData.map(d => d.value)).toFixed(2) : '0'
        // Show executive summary stats above chart, right-aligned
        if (stats[metric]) {
          const stat = stats[metric];
          const statText = `Avg: ${stat.avg.toFixed(2)}  Min: ${stat.min.toFixed(2)}  Max: ${stat.max.toFixed(2)}`;
          doc.setFontSize(8);
          doc.setTextColor(60, 60, 60);
          doc.text(statText, plotX + plotWidth, lineChartY - 8, { align: 'right' });
        }
        
        yPosition += lineChartHeight + marginBottom + 5
      }
    }
    } // end of else block (we have data)
  } // end of if (includeCharts && hasAggregatedData)

  // Raw data table removed - only showing summary and charts as requested

  // Footer: skip cover page (page 1). Number pages starting from the second page as Page 1.
  const pageCount = doc.internal.getNumberOfPages()
  if (pageCount > 1) {
    const numberedTotal = pageCount - 1
    for (let i = 2; i <= pageCount; i++) {
      doc.setPage(i)
      doc.setFontSize(8)
      doc.setTextColor(150, 150, 150)
      const pageNum = i - 1
      doc.text(`Page ${pageNum} of ${numberedTotal}`, 105, 285, { align: 'center' })
      doc.text('Aeropure - Air Quality Monitoring System', 105, 290, { align: 'center' })
    }
  }

  // Convert to buffer
  const pdfBuffer = Buffer.from(doc.output('arraybuffer'))
  return pdfBuffer
  } catch (error) {
    console.error('[PDF Generator] Error:', error)
    throw new Error(`Failed to generate PDF: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

function calculateStats(readings: Reading[], metrics: string[], totalSamples: number) {
  const columnMap: Record<string, keyof Reading> = {
    AQI: "airQualityIndex",
    PM2_5: "valuePM_2_5",
    PM10: "valuePM_10",
    CO: "valueCO",
    NO2: "valueNO2",
    O3: "valueO3",
    SO2: "valueSO2",
    Temperature: "airTemperature",
    Humidity: "airHumidity",
    Pressure: "atmosPressure",
  }

  const stats: Record<string, { avg: number; min: number; max: number; count: number }> = {}

  metrics.forEach((metric: string) => {
    const key = columnMap[metric]
    if (key) {
      const values = readings
        .map((r) => Number(r[key]))
        .filter((v) => !isNaN(v) && v !== null && v !== undefined)

      if (values.length > 0) {
        stats[metric] = {
          avg: values.reduce((a, b) => a + b, 0) / values.length,
          min: Math.min(...values),
          max: Math.max(...values),
          count: totalSamples, // Total raw readings count (not calculated)
        }
      }
    }
  })

  return stats
}

function createChartData(readings: Reading[], pollutants: string[]) {
  const columnMap: Record<string, keyof Reading> = {
    AQI: "airQualityIndex",
    PM2_5: "valuePM_2_5",
    PM10: "valuePM_10",
    CO: "valueCO",
    NO2: "valueNO2",
    O3: "valueO3",
    SO2: "valueSO2",
  }

  // Use first metric for chart
  const metric = pollutants[0]
  const key = columnMap[metric]
  
  if (!key) return []

  const data = readings.map(r => {
    const raw = Number(r[key])
    const value = isNaN(raw) ? 0 : raw // Use raw value directly
    return {
      time: new Date(r.receivedAt),
      value
    }
  })

  return data
}

