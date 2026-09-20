import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-tools'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { AnalysisResult, AnalysisSpec, InsightProject, RelationList, RelationSchema, SourceInfo, SourceKind } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' { interface Context { insightController: InsightController } }

const NAMES = {
  register: 'mcp__insight__register_source', relations: 'mcp__insight__list_relations', describe: 'mcp__insight__describe_relation',
  execute: 'mcp__insight__execute_analysis', verify: 'mcp__insight__verify_query', result: 'mcp__insight__get_query_result',
} as const
interface Verification { readonly query_id: string; readonly valid: boolean; readonly warnings?: readonly string[] }

/** Session-scoped bridge from the browser workbench to the registered Insight MCP tools. */
export class InsightController extends TypertRemoteService {
  static inject = ['tools']
  private readonly active = new Set<string>()

  constructor(ctx: Context) { super(ctx, 'insightController', { namespace: 'insight' }) }

  @Remote register(agent: Agent, path: string, kind: SourceKind, signal: AbortSignal): Promise<SourceInfo> {
    return this.run(agent, NAMES.register, { path, kind }, signal)
  }
  @Remote relations(agent: Agent, sourceId: string, signal: AbortSignal): Promise<RelationList> {
    return this.run(agent, NAMES.relations, { source_id: sourceId }, signal)
  }
  @Remote describe(agent: Agent, sourceId: string, relation: string, signal: AbortSignal): Promise<RelationSchema> {
    return this.run(agent, NAMES.describe, { source_id: sourceId, relation }, signal)
  }
  @Remote async execute(agent: Agent, sourceId: string, spec: AnalysisSpec, signal: AbortSignal): Promise<AnalysisResult> {
    if (this.active.has(agent.id)) throw new RemoteError('gateway/bad-request', 'An analysis is already running for this session', {})
    if (agent.status !== 'idle') throw new RemoteError('gateway/bad-request', 'Wait for the current Agent turn to finish before running analysis', {})
    this.active.add(agent.id)
    try {
      const result = await this.run<AnalysisResult>(agent, NAMES.execute, { source_id: sourceId, spec }, signal)
      const checked = await this.run<Verification>(agent, NAMES.verify, { query_id: result.query_id }, signal)
      if (!checked.valid) throw new RemoteError('gateway/bad-request', 'Insight query verification failed', {})
      return { ...result, verified: true, warnings: checked.warnings ?? [] }
    } finally { this.active.delete(agent.id) }
  }
  @Remote result(agent: Agent, queryId: string, signal: AbortSignal): Promise<AnalysisResult> {
    return this.run(agent, NAMES.result, { query_id: queryId }, signal)
  }
  @Remote async save(agent: Agent, project: InsightProject): Promise<void> {
    const directory = this.projectDirectory(agent)
    await mkdir(directory, { recursive: true })
    const target = join(directory, 'workbench.json')
    const temporary = `${target}.${randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify(project, null, 2)}\n`, 'utf8')
    await rename(temporary, target)
  }
  @Remote async load(agent: Agent): Promise<InsightProject | null> {
    try {
      const raw = await readFile(join(this.projectDirectory(agent), 'workbench.json'), 'utf8')
      const value: unknown = JSON.parse(raw)
      if (typeof value !== 'object' || value === null || !('formatVersion' in value) || value.formatVersion !== 1) {
        throw new Error('unsupported Insight project format')
      }
      return value as InsightProject
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }
  private projectDirectory(agent: Agent): string {
    const cwd = agent.session.header.cwd
    if (cwd === undefined) throw new RemoteError('gateway/bad-request', 'This session has no workspace', {})
    return join(cwd, '.insight', agent.id.replace(/[^a-zA-Z0-9_-]/gu, '_'))
  }
  private async run<Value>(agent: Agent, name: string, args: unknown, signal: AbortSignal): Promise<Value> {
    const result = await this.ctx.tools.execute({ name, arguments: args, agent, signal, callId: ToolCallId(`insight-ui-${randomUUID()}`) })
    if (result.isError) {
      const message = result.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
      throw new RemoteError('gateway/bad-request', message || `${name} failed`, {})
    }
    return result.value as Value
  }
}

export default InsightController
