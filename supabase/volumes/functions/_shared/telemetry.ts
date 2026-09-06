export type TelemetrySignal = 'log' | 'span' | 'metric'
export type TelemetryEvent = { signal: TelemetrySignal; name: string; attributes: Record<string, string | number | boolean | undefined>; timestamp: number }
export interface TelemetryExporter { export(event: TelemetryEvent): Promise<void> }

export class OtlpTelemetryExporter implements TelemetryExporter {
  constructor(private readonly endpoints: Partial<Record<TelemetrySignal, string>>) {}
  async export(event: TelemetryEvent) {
    const endpoint = this.endpoints[event.signal]
    if (!endpoint) return
    const result = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(toOtlpPayload(event)) })
    if (!result.ok) throw new Error('OTLP exporter returned HTTP ' + result.status)
  }
}

export function toOtlpPayload(event: TelemetryEvent) {
  const attributes = Object.entries(event.attributes).filter(([, value]) => value !== undefined).map(([key, value]) => ({ key, value: typeof value === 'boolean' ? { boolValue: value } : typeof value === 'number' ? { intValue: String(value) } : { stringValue: value } }))
  if (event.signal === 'span') return { resourceSpans: [{ scopeSpans: [{ scope: { name: 'edulog.api' }, spans: [{ name: event.name, startTimeUnixNano: String(event.timestamp * 1_000_000), endTimeUnixNano: String(event.timestamp * 1_000_000), attributes }] }] }] }
  if (event.signal === 'metric') return { resourceMetrics: [{ scopeMetrics: [{ scope: { name: 'edulog.api' }, metrics: [{ name: event.name, sum: { dataPoints: [{ asInt: 1, timeUnixNano: String(event.timestamp * 1_000_000), attributes }] } }] }] }] }
  return { resourceLogs: [{ scopeLogs: [{ scope: { name: 'edulog.api' }, logRecords: [{ timeUnixNano: String(event.timestamp * 1_000_000), body: { stringValue: event.name }, attributes }] }] }] }
}

class NoopExporter implements TelemetryExporter { async export(_event: TelemetryEvent) {} }
let exporter: TelemetryExporter = new NoopExporter()
export function configureTelemetryExporter(next: TelemetryExporter) { exporter = next }
export function getTelemetryExporter() { return exporter }
export async function exportTelemetry(event: TelemetryEvent) {
  try { await exporter.export(event) } catch (error) { console.error(JSON.stringify({ type: 'telemetry_export_failed', name: event.name, error: error instanceof Error ? error.message : String(error) })) }
}
