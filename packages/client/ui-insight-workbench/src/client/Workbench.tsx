import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import * as echarts from 'echarts/core'
import { BarChart, LineChart, ScatterChart } from 'echarts/charts'
import {
  GridComponent, LegendComponent, TitleComponent, TooltipComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  Aggregation, AnalysisResult, AnalysisSpec, ColumnInfo, FilterOperator, InsightProject, RelationList,
  RelationSchema, SourceInfo, SourceKind,
} from '@deepseek-ai/dsh-api-insight-controller/types'
import css from './Workbench.module.css'

echarts.use([BarChart, LineChart, ScatterChart, GridComponent, LegendComponent, TitleComponent, TooltipComponent, CanvasRenderer])

type ChartType = 'table' | 'bar' | 'line' | 'scatter'
interface Field { relation: string; column: ColumnInfo }
interface MetricDraft extends Field { aggregation: Aggregation; alias: string }
interface DimensionDraft extends Field { dateGrain: '' | 'day' | 'month' | 'year' }

export interface InsightInjected {
  register(this: void, path: string, kind: SourceKind, signal: AbortSignal): Promise<SourceInfo>
  relations(this: void, sourceId: string, signal: AbortSignal): Promise<RelationList>
  describe(this: void, sourceId: string, relation: string, signal: AbortSignal): Promise<RelationSchema>
  execute(this: void, sourceId: string, spec: AnalysisSpec, signal: AbortSignal): Promise<AnalysisResult>
  save(this: void, project: InsightProject): Promise<void>
  load(this: void): Promise<InsightProject | null>
  explain(this: void, queryId: string): Promise<void>
}

type Props = PropsRuntime<'sidebar.right.pane.tab'> & PropsLocale<'insightWorkbench'> & InjectFace<InsightInjected>

function message(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) return String(error.message)
  return String(error)
}

function fieldKey(field: Field): string { return `${field.relation}\u0000${field.column.name}` }
function fieldLabel(field: Field): string { return `${field.relation}.${field.column.name}` }
function numeric(type: string): boolean { return /int|decimal|numeric|double|float|real/iu.test(type) }

interface ChartProps {
  result: AnalysisResult
  type: Exclude<ChartType, 'table'>
  title: string
  xColumn: string
  yColumn: string
  chartRef: React.MutableRefObject<echarts.ECharts | null>
}

function Chart({ result, type, title, xColumn, yColumn, chartRef }: ChartProps): ReactNode {
  const element = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (element.current === null) return
    const chart = echarts.init(element.current)
    chartRef.current = chart
    const xIndex = Math.max(0, result.columns.indexOf(xColumn))
    const selectedYIndex = result.columns.indexOf(yColumn)
    const yIndex = selectedYIndex >= 0 ? selectedYIndex : result.columns.length > 1 ? 1 : 0
    const xValues = result.columns.length > 1
      ? result.rows.map(row => row[xIndex])
      : result.rows.map((_, index) => index + 1)
    const yValues = result.rows.map(row => row[yIndex])
    chart.setOption({
      title: { text: title, subtext: result.query_id, left: 'center', textStyle: { fontSize: 14 }, subtextStyle: { fontSize: 10 } }, tooltip: {}, grid: { left: 48, right: 20, top: 68, bottom: 42 },
      xAxis: { type: type === 'scatter' ? 'value' : 'category', data: type === 'scatter' ? undefined : xValues },
      yAxis: { type: 'value' },
      series: [{ name: result.columns[yIndex] ?? '', type, data: type === 'scatter' ? xValues.map((value, index) => [value, yValues[index]]) : yValues }],
    })
    const observer = new ResizeObserver(() => { chart.resize() })
    observer.observe(element.current)
    return () => { observer.disconnect(); chart.dispose(); if (chartRef.current === chart) chartRef.current = null }
  }, [result, type, title, xColumn, yColumn, chartRef])
  return <div ref={element} className={css.chart} data-chart-type={type} />
}

function csvCell(value: unknown): string {
  let text = ''
  if (typeof value === 'string') text = value
  else if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') text = value.toString()
  else if (typeof value === 'object' && value !== null) text = JSON.stringify(value)
  if (/^[=+\-@]/u.test(text)) text = `'${text}`
  return `"${text.replaceAll('"', '""')}"`
}

function download(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url; anchor.download = name; anchor.click()
  queueMicrotask(() => { URL.revokeObjectURL(url) })
}

/** Session-bound visual analysis workbench. */
export function Workbench({ sessionId, useSessions, register, relations, describe, execute, save, load, explain, t }: Props): ReactNode {
  const agentRunning = useSessions(state => state.byId[sessionId]?.running ?? false)
  const [path, setPath] = useState('')
  const [kind, setKind] = useState<SourceKind>('csv')
  const [source, setSource] = useState<SourceInfo>()
  const [relationList, setRelationList] = useState<RelationList>()
  const [relation, setRelation] = useState('')
  const [schemas, setSchemas] = useState<Record<string, RelationSchema>>({})
  const [dimensions, setDimensions] = useState<DimensionDraft[]>([])
  const [metrics, setMetrics] = useState<MetricDraft[]>([])
  const [joinRelation, setJoinRelation] = useState('')
  const [joinKind, setJoinKind] = useState<'inner' | 'left'>('left')
  const [joinLeft, setJoinLeft] = useState('')
  const [joinRight, setJoinRight] = useState('')
  const [filterField, setFilterField] = useState('')
  const [filterOperator, setFilterOperator] = useState<FilterOperator>('eq')
  const [filterValue, setFilterValue] = useState('')
  const [sortColumn, setSortColumn] = useState('')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')
  const [limit, setLimit] = useState(500)
  const [result, setResult] = useState<AnalysisResult>()
  const [historical, setHistorical] = useState(false)
  const [chartType, setChartType] = useState<ChartType>('table')
  const [chartX, setChartX] = useState('')
  const [chartY, setChartY] = useState('')
  const [operation, setOperation] = useState<'import' | 'analysis'>()
  const busy = operation !== undefined
  const [error, setError] = useState<string>()
  const [saved, setSaved] = useState(false)
  const chart = useRef<echarts.ECharts | null>(null)
  const activeRequest = useRef<AbortController | null>(null)

  const allFields = useMemo(() => Object.values(schemas).flatMap(schema => (
    schema.columns.map(column => ({ relation: schema.relation, column }))
  )), [schemas])
  const primaryFields = schemas[relation]?.columns ?? []
  const joinFields = schemas[joinRelation]?.columns ?? []

  useEffect(() => {
    let active = true
    void load().then((project) => {
      if (!active || project === null) return
      if (project.source !== undefined) { setSource(project.source); setPath(project.source.path); setKind(project.source.kind) }
      if (project.analysis !== undefined) {
        setRelation(project.analysis.relation); setLimit(project.analysis.limit)
        setDimensions(project.analysis.dimensions.map(item => ({
          relation: item.field.relation,
          column: { name: item.field.column, type: '', nullable: true },
          dateGrain: item.date_grain ?? '',
        })))
        setMetrics(project.analysis.metrics.flatMap(item => item.field === undefined ? [] : [{
          relation: item.field.relation,
          column: { name: item.field.column, type: '', nullable: true },
          aggregation: item.aggregation,
          alias: item.alias,
        }]))
        if (project.analysis.join !== undefined) {
          setJoinRelation(project.analysis.join.relation); setJoinKind(project.analysis.join.kind)
          setJoinLeft(project.analysis.join.left.column); setJoinRight(project.analysis.join.right.column)
        }
        const restoredFilter = project.analysis.filters[0]
        if (restoredFilter !== undefined) {
          setFilterField(`${restoredFilter.field.relation}\u0000${restoredFilter.field.column}`)
          setFilterOperator(restoredFilter.operator)
          if (restoredFilter.value !== undefined) {
            setFilterValue(Array.isArray(restoredFilter.value)
              ? restoredFilter.value.map(value => typeof value === 'object' ? JSON.stringify(value) : `${value}`).join(', ')
              : typeof restoredFilter.value === 'object'
                ? JSON.stringify(restoredFilter.value)
                : String(restoredFilter.value))
          }
        }
        const restoredSort = project.analysis.sort[0]
        if (restoredSort !== undefined) { setSortColumn(restoredSort.column); setSortDirection(restoredSort.direction) }
      }
      if (project.chart !== undefined) {
        setChartType(project.chart.type); setChartX(project.chart.x ?? ''); setChartY(project.chart.y ?? '')
      }
      if (project.snapshot !== undefined) { setResult(project.snapshot); setHistorical(true) }
    }).catch((reason: unknown) => { if (active) setError(message(reason)) })
    return () => { active = false }
  }, [load])

  useEffect(() => () => { activeRequest.current?.abort() }, [])

  useEffect(() => {
    if (result?.truncated === true && chartType !== 'table') setChartType('table')
  }, [result, chartType])

  useEffect(() => {
    if (result === undefined) return
    setChartX(current => result.columns.includes(current) ? current : result.columns[0] ?? '')
    setChartY(current => result.columns.includes(current) ? current : result.columns[1] ?? result.columns[0] ?? '')
  }, [result])

  useEffect(() => {
    if (source === undefined) return
    const controller = new AbortController()
    void relations(source.source_id, controller.signal).then((list) => {
      setRelationList(list)
      setRelation(current => current || list.relations[0] || '')
    }).catch((reason: unknown) => { if (!controller.signal.aborted) setError(message(reason)) })
    return () => { controller.abort() }
  }, [source, relations])

  useEffect(() => {
    if (source === undefined || relation === '' || schemas[relation] !== undefined) return
    const controller = new AbortController()
    void describe(source.source_id, relation, controller.signal)
      .then((schema) => { setSchemas(current => ({ ...current, [relation]: schema })) })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(message(reason)) })
    return () => { controller.abort() }
  }, [source, relation, schemas, describe])

  useEffect(() => {
    if (source === undefined || joinRelation === '' || schemas[joinRelation] !== undefined) return
    const controller = new AbortController()
    void describe(source.source_id, joinRelation, controller.signal)
      .then((schema) => { setSchemas(current => ({ ...current, [joinRelation]: schema })) })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(message(reason)) })
    return () => { controller.abort() }
  }, [source, joinRelation, schemas, describe])

  const importSource = async (): Promise<void> => {
    setOperation('import'); setError(undefined)
    const controller = new AbortController()
    activeRequest.current = controller
    try {
      const next = await register(path.trim(), kind, controller.signal)
      setSource(next); setRelationList(undefined); setSchemas({}); setRelation(''); setJoinRelation('')
      if (result !== undefined) setHistorical(true)
    } catch (reason) {
      if (!controller.signal.aborted) setError(message(reason))
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null
        setOperation(undefined)
      }
    }
  }

  const addDimension = (field: Field): void => {
    setDimensions(current => current.some(item => fieldKey(item) === fieldKey(field))
      ? current
      : [...current, { ...field, dateGrain: '' }])
  }
  const addMetric = (field: Field): void => {
    const aggregation = numeric(field.column.type) ? 'sum' : 'count'
    setMetrics(current => current.some(item => fieldKey(item) === fieldKey(field))
      ? current
      : [...current, { ...field, aggregation, alias: `${aggregation}_${field.column.name}` }])
  }
  const buildSpec = (): AnalysisSpec => {
    const join = joinRelation !== '' && joinLeft !== '' && joinRight !== '' ? {
      relation: joinRelation,
      kind: joinKind,
      left: { relation, column: joinLeft },
      right: { relation: joinRelation, column: joinRight },
    } : undefined
    const selectedFilter = allFields.find(field => fieldKey(field) === filterField)
    const filters = selectedFilter === undefined
      ? []
      : filterOperator === 'is_null' || filterOperator === 'not_null'
        ? [{ field: { relation: selectedFilter.relation, column: selectedFilter.column.name }, operator: filterOperator }]
        : filterValue === '' ? [] : [{
          field: { relation: selectedFilter.relation, column: selectedFilter.column.name },
          operator: filterOperator,
          value: filterOperator === 'in' ? filterValue.split(',').map(item => item.trim()) : filterValue,
        }]
    return {
      relation, ...(join === undefined ? {} : { join }),
      dimensions: dimensions.map(field => ({
        field: { relation: field.relation, column: field.column.name },
        ...(field.dateGrain === '' ? {} : {
          date_grain: field.dateGrain,
          alias: `${field.column.name}_${field.dateGrain}`,
        }),
      })),
      metrics: metrics.map(metric => ({
        aggregation: metric.aggregation,
        field: { relation: metric.relation, column: metric.column.name },
        alias: metric.alias,
      })),
      filters,
      sort: sortColumn === '' ? [] : [{ column: sortColumn, direction: sortDirection }], limit,
    }
  }

  const run = async (): Promise<void> => {
    if (source === undefined || relation === '' || metrics.length === 0) return
    setOperation('analysis'); setError(undefined); setSaved(false)
    const controller = new AbortController()
    activeRequest.current = controller
    try {
      const next = await execute(source.source_id, buildSpec(), controller.signal)
      setResult(next); setHistorical(false)
    } catch (reason) {
      if (!controller.signal.aborted) setError(message(reason))
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null
        setOperation(undefined)
      }
    }
  }

  const project = (): InsightProject => ({
    formatVersion: 1,
    ...(source === undefined ? {} : { source }),
    ...(source === undefined || relation === '' || metrics.length === 0 ? {} : { analysis: buildSpec() }),
    chart: { type: chartType, title: relation, x: chartX, y: chartY },
    ...(result === undefined ? {} : { snapshot: result }),
  })
  const outputColumns = [
    ...dimensions.map(item => item.dateGrain === ''
      ? item.column.name
      : `${item.column.name}_${item.dateGrain}`),
    ...metrics.map(item => item.alias),
  ]
  const saveProject = async (): Promise<void> => {
    try { await save(project()); setSaved(true); setError(undefined) }
    catch (reason) { setError(message(reason)) }
  }
  const exportCsv = (): void => {
    if (result === undefined) return
    const body = [result.columns, ...result.rows].map(row => row.map(csvCell).join(',')).join('\r\n')
    download(`insight-${result.query_id}.csv`, new Blob([`\uFEFF${body}`], { type: 'text/csv;charset=utf-8' }))
  }
  const exportPng = (): void => {
    if (result === undefined || chart.current === null) return
    const url = chart.current.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#fff' })
    const anchor = document.createElement('a')
    anchor.href = url; anchor.download = `insight-${result.query_id}.png`; anchor.click()
  }

  return <div className={css.root}>
    <section className={css.section}>
      <h2>{t('source.title')}</h2>
      <div className={css.row}>
        <select
          aria-label={t('source.kind')}
          value={kind}
          onChange={(event) => { setKind(event.target.value as SourceKind) }}
        >
          <option value="csv">{t('source.csv')}</option>
          <option value="xlsx">{t('source.xlsx')}</option>
          <option value="sqlite">{t('source.sqlite')}</option>
          <option value="duckdb">{t('source.duckdb')}</option>
        </select>
        <input value={path} onChange={(event) => { setPath(event.target.value) }} placeholder={t('source.path')} />
        <button
          type="button"
          disabled={busy || agentRunning || path.trim() === ''}
          onClick={() => { void importSource() }}
        >{t('source.register')}</button>
        {operation === 'import' && <button type="button" onClick={() => { activeRequest.current?.abort() }}>{t('action.cancel')}</button>}
      </div>
      {source !== undefined && <>
        <p className={css.meta}>{source.path} · {source.fingerprint.slice(0, 12)}</p>
        {source.warnings.map(item => <p key={item} className={css.warning}>{item}</p>)}
      </>}
    </section>

    {relationList !== undefined && <div className={css.workspace}>
      <section className={css.fields}>
        <h2>{t('fields.title')}</h2>
        <label>{t('fields.relation')}
          <select value={relation} onChange={(event) => {
            setRelation(event.target.value); setDimensions([]); setMetrics([])
            setJoinRelation(''); setJoinLeft(''); setJoinRight('')
            setFilterField(''); setFilterValue(''); setSortColumn('')
          }}>
            {relationList.relations.map(item => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </label>
        {primaryFields.map((column) => {
          const field = { relation, column }
          return <button
            draggable
            type="button"
            className={css.field}
            key={column.name}
            onDragStart={(event) => {
              event.dataTransfer.setData('application/x-insight-field', JSON.stringify(field))
            }}
            onClick={() => { addDimension(field) }}
          >
            <span>{column.name}</span><small>{column.type}</small>
          </button>
        })}
      </section>
      <section className={css.config}>
        <h2>{t('config.title')}</h2>
        <DimensionZone
          dimensions={dimensions}
          onAdd={addDimension}
          onChange={setDimensions}
          t={t}
        />
        <MetricZone metrics={metrics} onAdd={addMetric} onChange={setMetrics} t={t} />
        <JoinEditor
          relation={relation}
          relations={relationList}
          primaryFields={primaryFields}
          joinFields={joinFields}
          value={{ relation: joinRelation, kind: joinKind, left: joinLeft, right: joinRight }}
          onRelation={(value) => { setJoinRelation(value); setJoinLeft(''); setJoinRight('') }}
          onKind={setJoinKind}
          onLeft={setJoinLeft}
          onRight={setJoinRight}
          t={t}
        />
        <FilterEditor
          fields={allFields}
          field={filterField}
          operator={filterOperator}
          value={filterValue}
          onField={setFilterField}
          onOperator={setFilterOperator}
          onValue={setFilterValue}
          t={t}
        />
        <details><summary>{t('config.sort')}</summary><div className={css.row}>
          <select value={sortColumn} onChange={(event) => { setSortColumn(event.target.value) }}>
            <option value="">{t('config.noSort')}</option>
            {outputColumns.map(column => <option key={column} value={column}>{column}</option>)}
          </select>
          <select
            value={sortDirection}
            onChange={(event) => { setSortDirection(event.target.value as 'asc' | 'desc') }}
          >
            <option value="desc">{t('config.desc')}</option><option value="asc">{t('config.asc')}</option>
          </select>
        </div></details>
        <div className={css.row}>
          <label>{t('config.limit')}<input
            type="number"
            min={1}
            max={5000}
            value={limit}
            onChange={(event) => { setLimit(Math.max(1, Math.min(5000, Number(event.target.value)))) }}
          /></label>
          <button
            type="button"
            disabled={busy || agentRunning || metrics.length === 0}
            onClick={() => { void run() }}
          >{busy ? t('config.running') : t('config.run')}</button>
          {operation === 'analysis' && <button type="button" onClick={() => { activeRequest.current?.abort() }}>{t('action.cancel')}</button>}
        </div>
      </section>
    </div>}

    <section className={css.section}>
      <div className={css.resultHeader}>
        <h2>{t('result.title')}</h2>
        {result !== undefined && <div className={css.actions}>
          <button type="button" onClick={() => { void saveProject() }}>{t('action.save')}</button>
          <button type="button" onClick={exportCsv}>{t('action.csv')}</button>
          {chartType !== 'table' && <button type="button" onClick={exportPng}>{t('action.png')}</button>}
          <button
            type="button"
            disabled={!result.verified || historical || agentRunning}
            onClick={() => { void explain(result.query_id) }}
          >{t('action.explain')}</button>
        </div>}
      </div>
      {saved && <p className={css.success}>{t('status.saved')}</p>}
      {error !== undefined && <p className={css.error}><strong>{t('error.title')}:</strong> {error}</p>}
      {result === undefined ? <p className={css.empty}>{t('result.empty')}</p> : <>
        <div className={css.tabs}>{(['table', 'bar', 'line', 'scatter'] as const).map(type => (
          <button
            type="button"
            disabled={result.truncated && type !== 'table'}
            data-active={chartType === type}
            key={type}
            onClick={() => { setChartType(type) }}
          >{t(`result.${type}`)}</button>
        ))}</div>
        {chartType !== 'table' && <div className={css.formGrid}>
          <label>{t('chart.x')}<select value={chartX} onChange={(event) => { setChartX(event.target.value) }}>
            {result.columns.map(column => <option key={column} value={column}>{column}</option>)}
          </select></label>
          <label>{t('chart.y')}<select value={chartY} onChange={(event) => { setChartY(event.target.value) }}>
            {result.columns.map(column => <option key={column} value={column}>{column}</option>)}
          </select></label>
        </div>}
        <p className={css.meta}>
          {result.verified ? t('result.verified') : ''}
          {historical ? ` · ${t('result.snapshot')}` : ''}
          {' · '}{result.row_count} {t('result.rows')} · {result.elapsed_ms.toFixed(1)} {t('result.ms')}
        </p>
        {result.truncated && <p className={css.warning}>{t('result.truncated')}</p>}
        {result.rows.length === 0
          ? <p className={css.empty}>{t('result.noRows')}</p>
          : chartType === 'table'
            ? <ResultTable result={result} t={t} />
            : <Chart result={result} type={chartType} title={relation} xColumn={chartX} yColumn={chartY} chartRef={chart} />}
        <details className={css.evidence}>
          <summary>{t('result.sql')}</summary><code>{result.query_id}</code><pre>{result.sql}</pre>
          {result.warnings.map(item => <p key={item} className={css.warning}>{item}</p>)}
        </details>
      </>}
    </section>
  </div>
}

type WorkbenchT = Props['t']

interface DimensionZoneProps {
  dimensions: DimensionDraft[]
  onAdd(this: void, field: Field): void
  onChange(this: void, value: DimensionDraft[]): void
  t: WorkbenchT
}

function DimensionZone({ dimensions, onAdd, onChange, t }: DimensionZoneProps): ReactNode {
  return <DropZone title={t('config.dimension')} empty={t('config.drop')} onDropField={onAdd}>
    {dimensions.map(field => <div className={css.metric} key={fieldKey(field)}>
      <Chip
        text={fieldLabel(field)}
        onRemove={() => { onChange(dimensions.filter(item => fieldKey(item) !== fieldKey(field))) }}
      />
      <select
        aria-label={t('config.dateGrain')}
        value={field.dateGrain}
        onChange={(event) => {
          onChange(dimensions.map(item => fieldKey(item) === fieldKey(field)
            ? { ...item, dateGrain: event.target.value as DimensionDraft['dateGrain'] }
            : item))
        }}
      >
        <option value="">{t('config.noDateGrain')}</option>
        <option value="day">{t('config.day')}</option>
        <option value="month">{t('config.month')}</option>
        <option value="year">{t('config.year')}</option>
      </select>
    </div>)}
  </DropZone>
}

interface MetricZoneProps {
  metrics: MetricDraft[]
  onAdd(this: void, field: Field): void
  onChange(this: void, value: MetricDraft[]): void
  t: WorkbenchT
}

function MetricZone({ metrics, onAdd, onChange, t }: MetricZoneProps): ReactNode {
  return <DropZone title={t('config.metric')} empty={t('config.drop')} onDropField={onAdd}>
    {metrics.map(metric => <div className={css.metric} key={fieldKey(metric)}>
      <Chip
        text={fieldLabel(metric)}
        onRemove={() => { onChange(metrics.filter(item => fieldKey(item) !== fieldKey(metric))) }}
      />
      <select value={metric.aggregation} onChange={(event) => {
        const aggregation = event.target.value as Aggregation
        onChange(metrics.map(item => fieldKey(item) === fieldKey(metric)
          ? { ...item, aggregation, alias: `${aggregation}_${item.column.name}` }
          : item))
      }}>
        <option value="sum">{t('config.sum')}</option><option value="avg">{t('config.avg')}</option>
        <option value="min">{t('config.min')}</option><option value="max">{t('config.max')}</option>
        <option value="count">{t('config.count')}</option>
        <option value="count_distinct">{t('config.countDistinct')}</option>
      </select>
    </div>)}
  </DropZone>
}

interface JoinEditorProps {
  relation: string
  relations: RelationList
  primaryFields: readonly ColumnInfo[]
  joinFields: readonly ColumnInfo[]
  value: { relation: string; kind: 'inner' | 'left'; left: string; right: string }
  onRelation(this: void, value: string): void
  onKind(this: void, value: 'inner' | 'left'): void
  onLeft(this: void, value: string): void
  onRight(this: void, value: string): void
  t: WorkbenchT
}

function JoinEditor(props: JoinEditorProps): ReactNode {
  const { relation, relations, primaryFields, joinFields, value, onRelation, onKind, onLeft, onRight, t } = props
  return <details><summary>{t('join.title')}</summary><div className={css.formGrid}>
    <label>{t('join.title')}<select
      value={value.relation}
      onChange={(event) => { onRelation(event.target.value) }}
    >
      <option value="">{t('join.none')}</option>
      {relations.relations.filter(item => item !== relation).map(item => (
        <option key={item} value={item}>{item}</option>
      ))}
    </select></label>
    <label>{t('join.kind')}<select
      value={value.kind}
      onChange={(event) => { onKind(event.target.value as 'inner' | 'left') }}
    >
      <option value="left">{t('join.leftKind')}</option><option value="inner">{t('join.innerKind')}</option>
    </select></label>
    <label>{t('join.left')}<select
      value={value.left}
      onChange={(event) => { onLeft(event.target.value) }}
    ><option value="" />{primaryFields.map(item => (
        <option key={item.name} value={item.name}>{item.name}</option>
      ))}</select></label>
    <label>{t('join.right')}<select
      value={value.right}
      onChange={(event) => { onRight(event.target.value) }}
    ><option value="" />{joinFields.map(item => (
        <option key={item.name} value={item.name}>{item.name}</option>
      ))}</select></label>
  </div></details>
}

interface FilterEditorProps {
  fields: Field[]
  field: string
  operator: FilterOperator
  value: string
  onField(this: void, value: string): void
  onOperator(this: void, value: FilterOperator): void
  onValue(this: void, value: string): void
  t: WorkbenchT
}

function FilterEditor(props: FilterEditorProps): ReactNode {
  const { fields, field, operator, value, onField, onOperator, onValue, t } = props
  const operators: FilterOperator[] = [
    'eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'in', 'is_null', 'not_null',
  ]
  return <details><summary>{t('config.filter')}</summary><div className={css.row}>
    <select value={field} onChange={(event) => { onField(event.target.value) }}>
      <option value="" />
      {fields.map(item => <option key={fieldKey(item)} value={fieldKey(item)}>{fieldLabel(item)}</option>)}
    </select>
    <select
      aria-label={t('config.operator')}
      value={operator}
      onChange={(event) => { onOperator(event.target.value as FilterOperator) }}
    >
      {operators.map(item => <option key={item} value={item}>{item}</option>)}
    </select>
    <input
      disabled={operator === 'is_null' || operator === 'not_null'}
      value={value}
      onChange={(event) => { onValue(event.target.value) }}
    />
  </div></details>
}

interface DropZoneProps {
  title: string
  empty: string
  onDropField(this: void, field: Field): void
  children: ReactNode
}

function DropZone({ title, empty, onDropField, children }: DropZoneProps): ReactNode {
  return <div
    className={css.drop}
    onDragOver={(event) => { event.preventDefault() }}
    onDrop={(event) => {
      event.preventDefault()
      try { onDropField(JSON.parse(event.dataTransfer.getData('application/x-insight-field')) as Field) }
      catch { event.dataTransfer.clearData() }
    }}
  >
    <strong>{title}</strong><div className={css.chips}>{children}</div><small>{empty}</small>
  </div>
}

function Chip({ text, onRemove }: { text: string; onRemove(this: void): void }): ReactNode {
  return <span className={css.chip}>{text}
    <button type="button" aria-label={text} onClick={onRemove}>×</button>
  </span>
}

function ResultTable({ result, t }: { result: AnalysisResult; t: WorkbenchT }): ReactNode {
  return <div className={css.tableWrap}><table>
    <thead><tr>{result.columns.map(column => <th key={column}>{column}</th>)}</tr></thead>
    <tbody>{result.rows.map((row, rowIndex) => <tr key={rowIndex}>
      {row.map((value, index) => <td key={index}>{value === null
        ? t('result.null')
        : typeof value === 'object' ? JSON.stringify(value) : String(value)}</td>)}
    </tr>)}</tbody>
  </table></div>
}
