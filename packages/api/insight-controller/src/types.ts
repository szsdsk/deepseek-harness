import type { JsonValue } from '@deepseek-ai/dsh-util-values'

export const INSIGHT_PROTOCOL_VERSION = 1
export type SourceKind = 'csv' | 'xlsx' | 'sqlite' | 'duckdb'
export type JoinKind = 'inner' | 'left'
export type Aggregation = 'sum' | 'avg' | 'min' | 'max' | 'count' | 'count_distinct'
export type FilterOperator = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'in' | 'is_null' | 'not_null'

export interface FieldRef {
  readonly relation: string
  readonly column: string
}
export interface JoinSpec {
  readonly relation: string
  readonly kind: JoinKind
  readonly left: FieldRef
  readonly right: FieldRef
}
export interface DimensionSpec {
  readonly field: FieldRef
  readonly alias?: string
  readonly date_grain?: 'day' | 'month' | 'year'
}
export interface MetricSpec {
  readonly aggregation: Aggregation
  readonly field?: FieldRef
  readonly alias: string
}
export interface FilterSpec {
  readonly field: FieldRef
  readonly operator: FilterOperator
  readonly value?: JsonValue
}
export interface SortSpec {
  readonly column: string
  readonly direction: 'asc' | 'desc'
}
export interface AnalysisSpec {
  readonly relation: string
  readonly join?: JoinSpec
  readonly dimensions: readonly DimensionSpec[]
  readonly metrics: readonly MetricSpec[]
  readonly filters: readonly FilterSpec[]
  readonly sort: readonly SortSpec[]
  readonly limit: number
}
export interface SourceInfo {
  readonly source_id: string
  readonly kind: SourceKind
  readonly path: string
  readonly fingerprint: string
  readonly warnings: readonly string[]
}

export interface RelationList {
  readonly source_id: string
  readonly relations: readonly string[]
  readonly warnings: readonly string[]
}
export interface ColumnInfo {
  readonly name: string
  readonly type: string
  readonly nullable: boolean
}
export interface RelationSchema {
  readonly source_id: string
  readonly relation: string
  readonly columns: readonly ColumnInfo[]
  readonly warnings: readonly string[]
}
export interface AnalysisResult {
  readonly query_id: string
  readonly source_id: string
  readonly source_fingerprint: string
  readonly sql: string
  readonly columns: readonly string[]
  readonly rows: readonly (readonly JsonValue[])[]
  readonly row_count: number
  readonly truncated: boolean
  readonly elapsed_ms: number
  readonly verified: boolean
  readonly warnings: readonly string[]
}
export interface InsightProject {
  readonly formatVersion: 1
  readonly source?: SourceInfo
  readonly analysis?: AnalysisSpec
  readonly chart?: {
    readonly type: 'table' | 'bar' | 'line' | 'scatter'
    readonly title: string
    readonly x?: string
    readonly y?: string
  }
  readonly snapshot?: AnalysisResult
}
