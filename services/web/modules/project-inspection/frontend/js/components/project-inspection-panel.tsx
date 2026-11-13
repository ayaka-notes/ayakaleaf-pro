import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import Button from '@/shared/components/ol/ol-button'
import MaterialIcon, {
  type AvailableUnfilledIcon,
} from '@/shared/components/material-icon'
import Notification from '@/shared/components/notification'
import OLFormCheckbox from '@/shared/components/ol/ol-form-checkbox'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import RailPanelHeader from '@/features/ide-react/components/rail/rail-panel-header'
import { useProjectContext } from '@/shared/context/project-context'
import { useFileTreeData } from '@/shared/context/file-tree-data-context'
import { useFileTreePathContext } from '@/features/file-tree/contexts/file-tree-path'
import newEditorIconTypeFromName from '@/features/file-tree/util/icon-type-from-name'
import { useEditorManagerContext } from '@/features/ide-react/context/editor-manager-context'
import { isValidTeXFile } from '@/main/is-valid-tex-file'
import { signalWithTimeout } from '@/utils/abort-signal'
import { debugConsole } from '@/utils/debugging'
import { analyzeProject } from '../api'
import type {
  InspectionGraphNode,
  InspectionIssue,
  ProjectInspectionResult,
  SourceLocation,
} from '../types'
import '../../stylesheets/project-inspection.scss'

const PAGE_SIZE = 100
const MAX_ENTRY_POINTS = 50

function getErrorMessage(error: unknown) {
  if (
    error &&
    typeof error === 'object' &&
    'getUserFacingMessage' in error &&
    typeof error.getUserFacingMessage === 'function'
  ) {
    return String(error.getUserFacingMessage())
  }
  return 'Project inspection could not be completed. Please try again.'
}

function StatusDot({ status }: { status: string }) {
  return (
    <span
      className={`project-inspection-status project-inspection-status-${status}`}
      aria-hidden="true"
    />
  )
}

const DEPENDENCY_TYPE_ICONS: Record<
  string,
  { icon: string; label: string }
> = {
  document: { icon: 'description', label: 'Document' },
  file: { icon: 'description', label: 'File' },
  'figure-file': { icon: 'description', label: 'Image file' },
  include: { icon: 'input', label: 'Included file' },
  figure: { icon: 'image', label: 'Figure' },
  table: { icon: 'table_chart', label: 'Table' },
  label: { icon: 'label', label: 'Label' },
  reference: { icon: 'link', label: 'Reference' },
  citation: { icon: 'format_quote', label: 'Citation' },
  'citation-occurrence': { icon: 'link', label: 'Citation occurrence' },
  bibliography: { icon: 'book_5', label: 'Bibliography' },
  'bibliography-include': {
    icon: 'input',
    label: 'Included bibliography file',
  },
  'bibliography-entry': { icon: 'text_snippet', label: 'Bibliography entry' },
  'missing-resource': { icon: 'help', label: 'Missing resource' },
}

const ISSUE_DEPENDENCY_TYPES: Record<string, string> = {
  'missing-file': 'include',
  'missing-figure': 'figure-file',
  'missing-bibliography': 'bibliography',
  'unreferenced-label': 'label',
  'unreferenced-figure': 'figure',
  'unreferenced-table': 'table',
  'unlabeled-figure': 'figure',
  'unlabeled-table': 'table',
  'unused-bibliography-entry': 'bibliography-entry',
  'possibly-unused-file': 'file',
  'duplicate-label': 'label',
  'duplicate-figure-caption': 'figure',
  'duplicate-table-caption': 'table',
  'duplicate-bibliography-key': 'bibliography-entry',
  'duplicate-bibliography-title': 'bibliography-entry',
}

const UNFILLED_CATEGORY_ICONS = new Set<AvailableUnfilledIcon>([
  'image',
  'table_chart',
  'text_snippet',
])

function isUnfilledCategoryIcon(
  icon: string
): icon is AvailableUnfilledIcon {
  return UNFILLED_CATEGORY_ICONS.has(icon as AvailableUnfilledIcon)
}

function CategoryIcon({ issue }: { issue: InspectionIssue }) {
  if (
    issue.target &&
    [
      'missing-file',
      'missing-figure',
      'missing-bibliography',
      'possibly-unused-file',
    ].includes(issue.type)
  ) {
    return (
      <MaterialIcon
        unfilled
        type={newEditorIconTypeFromName(issue.target)}
        accessibilityLabel="File"
        className="project-inspection-category-icon"
      />
    )
  }
  const type = ISSUE_DEPENDENCY_TYPES[issue.type] ?? issue.category
  const definition =
    DEPENDENCY_TYPE_ICONS[type] ?? DEPENDENCY_TYPE_ICONS['missing-resource']
  if (isUnfilledCategoryIcon(definition.icon)) {
    return (
      <MaterialIcon
        unfilled
        type={definition.icon}
        accessibilityLabel={definition.label}
        className="project-inspection-category-icon"
      />
    )
  }
  return (
    <MaterialIcon
      type={definition.icon}
      accessibilityLabel={definition.label}
      className="project-inspection-category-icon"
    />
  )
}

const DEPENDENCY_STATUS_ICONS: Record<
  Exclude<InspectionGraphNode['status'], 'normal'>,
  string
> = {
  missing: 'error',
  unused: 'warning',
  unreferenced: 'warning',
  duplicate: 'content_copy',
  circular: 'autorenew',
}

const DEPENDENCY_STATUS_PRIORITY: Record<
  InspectionGraphNode['status'],
  number
> = {
  normal: 0,
  unused: 1,
  unreferenced: 1,
  duplicate: 2,
  missing: 3,
  circular: 4,
}

function higherPriorityStatus(
  current: InspectionGraphNode['status'],
  candidate: InspectionGraphNode['status']
) {
  return DEPENDENCY_STATUS_PRIORITY[candidate] >
    DEPENDENCY_STATUS_PRIORITY[current]
    ? candidate
    : current
}

function dependencyType(node: InspectionGraphNode, incomingKind?: string) {
  if (node.kind === 'missing-resource') {
    return incomingKind ?? node.kind
  }
  if (node.kind === 'document' || node.kind === 'file') {
    const filePath = node.path ?? ''
    if (/\.(?:bib|bibtex)$/i.test(filePath)) return 'bibliography'
    if (/\.(?:pdf|png|jpe?g|eps|svg)$/i.test(filePath)) return 'figure'
  }
  return node.kind
}

function dependencyIconType(
  node: InspectionGraphNode,
  incomingKind?: string
) {
  if (node.kind === 'bibliography') return 'bibliography-include'
  return dependencyType(node, incomingKind)
}

const DEPENDENCY_TYPE_ORDER: Record<string, number> = {
  include: 0,
  input: 0,
  document: 0,
  file: 0,
  'figure-file': 0,
  figure: 1,
  table: 2,
  label: 3,
  reference: 3,
  citation: 4,
  'citation-occurrence': 4,
  bibliography: 5,
  'bibliography-entry': 5,
}

const DEPENDENCY_LABEL_COLLATOR = new Intl.Collator('en', {
  numeric: true,
  sensitivity: 'base',
})

function compareDependencyNodes(
  leftId: string,
  rightId: string,
  nodes: Map<string, InspectionGraphNode>,
  incomingKinds: Map<string, string>
) {
  const left = nodes.get(leftId)
  const right = nodes.get(rightId)
  if (!left || !right) return leftId.localeCompare(rightId)
  const leftType = dependencyType(left, incomingKinds.get(leftId))
  const rightType = dependencyType(right, incomingKinds.get(rightId))
  const typeDifference =
    (DEPENDENCY_TYPE_ORDER[leftType] ?? Number.MAX_SAFE_INTEGER) -
    (DEPENDENCY_TYPE_ORDER[rightType] ?? Number.MAX_SAFE_INTEGER)
  if (typeDifference !== 0) return typeDifference
  const labelDifference = DEPENDENCY_LABEL_COLLATOR.compare(
    left.label,
    right.label
  )
  return labelDifference || left.id.localeCompare(right.id)
}

function DependencyTypeIcon({
  node,
  incomingKind,
}: {
  node: InspectionGraphNode
  incomingKind?: string
}) {
  if (
    node.kind === 'document' ||
    node.kind === 'file' ||
    node.kind === 'figure-file' ||
    node.kind === 'missing-resource'
  ) {
    const filePath = node.path ?? node.label
    return (
      <MaterialIcon
        unfilled
        type={newEditorIconTypeFromName(filePath)}
        accessibilityLabel="File"
        className="project-inspection-tree-type"
      />
    )
  }
  const type = dependencyIconType(node, incomingKind)
  const definition =
    DEPENDENCY_TYPE_ICONS[type] ?? DEPENDENCY_TYPE_ICONS['missing-resource']
  if (
    type === 'bibliography-entry' &&
    isUnfilledCategoryIcon(definition.icon)
  ) {
    return (
      <MaterialIcon
        unfilled
        type={definition.icon}
        accessibilityLabel={definition.label}
        className="project-inspection-tree-type"
      />
    )
  }
  return (
    <MaterialIcon
      type={definition.icon}
      accessibilityLabel={definition.label}
      className="project-inspection-tree-type"
    />
  )
}

function DependencyStatus({
  status,
  showLabel = true,
}: {
  status: InspectionGraphNode['status']
  showLabel?: boolean
}) {
  if (status === 'normal') return null
  return (
    <span
      className={`project-inspection-tree-status project-inspection-tree-status-${status}${showLabel ? '' : ' project-inspection-tree-status-icon-only'}`}
    >
      <MaterialIcon
        type={DEPENDENCY_STATUS_ICONS[status]}
        accessibilityLabel={showLabel ? undefined : `Contains ${status} issue`}
        className="project-inspection-tree-status-icon"
      />
      {showLabel && status}
    </span>
  )
}

type Navigate = (location?: SourceLocation, fallbackPath?: string) => void

function CircularIssue({
  issue,
  onNavigate,
}: {
  issue: InspectionIssue
  onNavigate: Navigate
}) {
  return (
    <>
      <div className="project-inspection-issue">
        <MaterialIcon
          type="autorenew"
          accessibilityLabel="Circular dependency"
          className="project-inspection-category-icon project-inspection-circular-icon"
        />
        <span
          className="project-inspection-issue-title"
          title={issue.title}
        >
          {issue.title}
        </span>
      </div>
      {issue.cycleEdges?.map(edge => (
        <button
          type="button"
          className="project-inspection-secondary-location"
          key={`${edge.from}:${edge.to}:${edge.location.from}`}
          title={`${edge.from} → ${edge.to}`}
          onClick={() => onNavigate(edge.location)}
        >
          {edge.from} → {edge.to}
        </button>
      ))}
    </>
  )
}

function IssueList({
  ids,
  issues,
  onNavigate,
}: {
  ids: string[]
  issues: Record<string, InspectionIssue>
  onNavigate: Navigate
}) {
  const [limit, setLimit] = useState(PAGE_SIZE)
  useEffect(() => setLimit(PAGE_SIZE), [ids])

  if (ids.length === 0) {
    return <p className="project-inspection-empty">No issues found.</p>
  }

  return (
    <>
      <ul className="project-inspection-issue-list">
        {ids.slice(0, limit).map(id => {
          const issue = issues[id]
          if (!issue) return null
          const primaryLocation = issue.locations[0]
          if (issue.type === 'circular-dependency') {
            return (
              <li key={id}>
                <CircularIssue issue={issue} onNavigate={onNavigate} />
              </li>
            )
          }
          return (
            <li key={id}>
              {primaryLocation ? (
                <div className="project-inspection-issue">
                  <CategoryIcon issue={issue} />
                  <span className="project-inspection-issue-content">
                    <span
                      className="project-inspection-issue-title"
                      title={issue.title}
                    >
                      {issue.title}
                    </span>
                  </span>
                </div>
              ) : (
                <button
                  type="button"
                  className="project-inspection-issue"
                  onClick={() => onNavigate(undefined, issue.target)}
                >
                  <CategoryIcon issue={issue} />
                  <span className="project-inspection-issue-content">
                    <span
                      className="project-inspection-issue-title"
                      title={issue.title}
                    >
                      {issue.title}
                    </span>
                  </span>
                </button>
              )}
              {issue.locations.map(location => (
                <button
                  type="button"
                  className="project-inspection-secondary-location"
                  key={`${location.entityId}:${location.from}`}
                  title={`${location.path}:${location.line}`}
                  onClick={() => onNavigate(location)}
                >
                  {location.path}:{location.line}
                </button>
              ))}
            </li>
          )
        })}
      </ul>
      {limit < ids.length && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setLimit(value => value + PAGE_SIZE)}
        >
          Show more
        </Button>
      )}
    </>
  )
}

function IssueSection({
  id,
  title,
  issueIds,
  result,
  onNavigate,
  open = false,
}: {
  id: string
  title: string
  issueIds: string[]
  result: ProjectInspectionResult
  onNavigate: Navigate
  open?: boolean
}) {
  const [expanded, setExpanded] = useState(open)
  return (
    <details
      id={id}
      className="project-inspection-section"
      open={expanded}
      onToggle={event => setExpanded(event.currentTarget.open)}
    >
      <summary>
        <span>{title}</span>
        <span className="project-inspection-count">{issueIds.length}</span>
      </summary>
      {expanded && (
        <IssueList
          ids={issueIds}
          issues={result.issues.byId}
          onNavigate={onNavigate}
        />
      )}
    </details>
  )
}

function DependencyNode({
  nodeId,
  nodes,
  childrenByParent,
  incomingKindByNode,
  subtreeStatusByNode,
  path,
  onNavigate,
  root = false,
}: {
  nodeId: string
  nodes: Map<string, InspectionGraphNode>
  childrenByParent: Map<string, string[]>
  incomingKindByNode: Map<string, string>
  subtreeStatusByNode: Map<string, InspectionGraphNode['status']>
  path: Set<string>
  onNavigate: Navigate
  root?: boolean
}) {
  const [expanded, setExpanded] = useState(root)
  const node = nodes.get(nodeId)
  if (!node) return null
  const displayLabel =
    node.kind === 'document' || node.kind === 'file'
      ? (node.path ?? node.label)
      : node.label
  const children = childrenByParent.get(nodeId) ?? []
  const circular = path.has(nodeId)
  const hasDirectStatus = node.status !== 'normal'
  const displayStatus = hasDirectStatus
    ? node.status
    : circular
      ? 'circular'
      : (subtreeStatusByNode.get(nodeId) ?? 'normal')
  const showStatusLabel = hasDirectStatus || circular
  if (children.length === 0 || circular) {
    return (
      <li>
        <div className="project-inspection-tree-row">
          <span
            className="project-inspection-tree-toggle"
            aria-hidden="true"
          />
          <DependencyTypeIcon
            node={node}
            incomingKind={incomingKindByNode.get(nodeId)}
          />
          <button
            type="button"
            className="project-inspection-tree-link"
            title={displayLabel}
            onClick={() => onNavigate(node.location, node.path)}
          >
            {displayLabel}
          </button>
          <DependencyStatus
            status={displayStatus}
            showLabel={showStatusLabel}
          />
        </div>
      </li>
    )
  }

  const nextPath = new Set(path)
  nextPath.add(nodeId)
  return (
    <li>
      <details
        open={expanded}
        onToggle={event => setExpanded(event.currentTarget.open)}
      >
        <summary>
          <MaterialIcon
            type={expanded ? 'indeterminate_check_box' : 'add_box'}
            className="project-inspection-tree-toggle"
          />
          <DependencyTypeIcon
            node={node}
            incomingKind={incomingKindByNode.get(nodeId)}
          />
          <button
            type="button"
            className="project-inspection-tree-link"
            title={displayLabel}
            onClick={event => {
              event.preventDefault()
              onNavigate(node.location, node.path)
            }}
          >
            {displayLabel}
          </button>
          <DependencyStatus
            status={displayStatus}
            showLabel={showStatusLabel}
          />
        </summary>
        {expanded && (
          <ul>
            {children.map(childId => (
              <DependencyNode
                key={`${nodeId}:${childId}`}
                nodeId={childId}
                nodes={nodes}
                childrenByParent={childrenByParent}
                incomingKindByNode={incomingKindByNode}
                subtreeStatusByNode={subtreeStatusByNode}
                path={nextPath}
                onNavigate={onNavigate}
              />
            ))}
          </ul>
        )}
      </details>
    </li>
  )
}

function DependencyTree({
  result,
  onNavigate,
}: {
  result: ProjectInspectionResult
  onNavigate: Navigate
}) {
  const { nodes, childrenByParent, incomingKindByNode, subtreeStatusByNode } =
    useMemo(() => {
      const nodeMap = new Map(result.graph.nodes.map(node => [node.id, node]))
      const outgoing = new Map<string, string[]>()
      const parentsByChild = new Map<string, string[]>()
      const incomingKinds = new Map<string, string>()
      const addChild = (parentId: string, childId: string) => {
        const children = outgoing.get(parentId) ?? []
        if (!children.includes(childId)) children.push(childId)
        outgoing.set(parentId, children)
        const parents = parentsByChild.get(childId) ?? []
        if (!parents.includes(parentId)) parents.push(parentId)
        parentsByChild.set(childId, parents)
      }
      for (const node of result.graph.nodes) {
        if (node.parentId) addChild(node.parentId, node.id)
      }
      for (const edge of result.graph.edges) {
        if (edge.kind === 'contains') continue
        addChild(edge.from, edge.to)
        if (!incomingKinds.has(edge.to)) incomingKinds.set(edge.to, edge.kind)
      }
      for (const children of outgoing.values()) {
        children.sort((leftId, rightId) =>
          compareDependencyNodes(leftId, rightId, nodeMap, incomingKinds)
        )
      }
      const subtreeStatuses = new Map<string, InspectionGraphNode['status']>()
      const pending: string[] = []
      for (const node of result.graph.nodes) {
        subtreeStatuses.set(node.id, node.status)
        if (node.status !== 'normal') pending.push(node.id)
      }
      for (let index = 0; index < pending.length; index += 1) {
        const childId = pending[index]
        const childStatus = subtreeStatuses.get(childId) ?? 'normal'
        for (const parentId of parentsByChild.get(childId) ?? []) {
          const parentStatus = subtreeStatuses.get(parentId) ?? 'normal'
          const nextStatus = higherPriorityStatus(parentStatus, childStatus)
          if (nextStatus === parentStatus) continue
          subtreeStatuses.set(parentId, nextStatus)
          pending.push(parentId)
        }
      }
      return {
        nodes: nodeMap,
        childrenByParent: outgoing,
        incomingKindByNode: incomingKinds,
        subtreeStatusByNode: subtreeStatuses,
      }
    }, [result])

  return (
    <details
      id="inspection-dependencies"
      className="project-inspection-section"
      open
    >
      <summary>
        <span>Dependency Tree</span>
      </summary>
      <ul className="project-inspection-tree">
        {result.graph.roots.map(root => (
          <DependencyNode
            key={root}
            nodeId={root}
            nodes={nodes}
            childrenByParent={childrenByParent}
            incomingKindByNode={incomingKindByNode}
            subtreeStatusByNode={subtreeStatusByNode}
            path={new Set()}
            onNavigate={onNavigate}
            root
          />
        ))}
      </ul>
      {result.graph.truncated && (
        <p className="project-inspection-note">
          The displayed graph was truncated because the project is large.
        </p>
      )}
    </details>
  )
}

function ProjectInspectionPanel() {
  const { projectId, project } = useProjectContext()
  const { docs } = useFileTreeData()
  const { findEntityByPath } = useFileTreePathContext()
  const { openDocs, openDocWithId, openFileWithId } =
    useEditorManagerContext()
  const entryPoints = useMemo(
    () => (docs ?? []).filter(item => isValidTeXFile(item.path)),
    [docs]
  )
  const displayedEntryPoints = useMemo(() => {
    const preferred =
      entryPoints.find(item => item.doc.id === project?.rootDocId) ??
      entryPoints[0]
    if (!preferred) return entryPoints
    return [
      preferred,
      ...entryPoints.filter(item => item.doc.id !== preferred.doc.id),
    ]
  }, [entryPoints, project?.rootDocId])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [result, setResult] = useState<ProjectInspectionResult>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const abortControllerRef = useRef<AbortController | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setSelectedIds(current => {
      const validIds = new Set(entryPoints.map(item => String(item.doc.id)))
      const next = new Set([...current].filter(id => validIds.has(id)))
      if (next.size === 0) {
        const preferred =
          entryPoints.find(item => item.doc.id === project?.rootDocId) ??
          entryPoints[0]
        if (preferred) next.add(String(preferred.doc.id))
      }
      return next
    })
  }, [entryPoints, project?.rootDocId])

  useEffect(
    () => () => {
      abortControllerRef.current?.abort()
    },
    []
  )

  const onSubmit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault()
      if (selectedIds.size === 0) return
      abortControllerRef.current?.abort()
      const controller = new AbortController()
      abortControllerRef.current = controller
      setLoading(true)
      setError(undefined)
      try {
        await openDocs.awaitBufferedOps(
          signalWithTimeout(controller.signal, 5000)
        )
        const nextResult = await analyzeProject(
          projectId,
          [...selectedIds],
          controller.signal
        )
        if (!controller.signal.aborted) setResult(nextResult)
      } catch (error) {
        if (!controller.signal.aborted) {
          debugConsole.error(error)
          setError(getErrorMessage(error))
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    },
    [openDocs, projectId, selectedIds]
  )

  const onNavigate = useCallback<Navigate>(
    (location, fallbackPath) => {
      const projectPath = location?.path ?? fallbackPath
      if (!projectPath) return
      const found = findEntityByPath(projectPath)
      if (!found) return
      if (found.type === 'doc') {
        openDocWithId(
          String(found.entity._id),
          location
            ? {
                gotoLine: location.line,
                gotoColumn: location.column,
                selectText: location.sourceText,
              }
            : undefined
        ).catch(debugConsole.error)
      } else if (found.type === 'fileRef') {
        openFileWithId(String(found.entity._id))
      }
    },
    [findEntityByPath, openDocWithId, openFileWithId]
  )

  const scrollToSection = (id: string) => {
    const container = contentRef.current
    const target = container?.querySelector<HTMLElement>(`#${id}`)
    if (!container || !target) return
    const containerRect = container.getBoundingClientRect()
    const targetRect = target.getBoundingClientRect()
    container.scrollTo({
      top: container.scrollTop + targetRect.top - containerRect.top,
      behavior: 'smooth',
    })
  }
  const coverageWarningCount = result
    ? result.coverage.parseErrors.length +
      result.coverage.dynamicReferences.length +
      result.coverage.ambiguousReferences.length +
      result.coverage.skippedFiles.length +
      result.coverage.suppressedCitationChecks.length
    : 0
  const hasCoverageWarning = Boolean(
    result &&
      (coverageWarningCount > 0 ||
        result.coverage.truncated ||
        result.graph.truncated)
  )

  return (
    <div className="project-inspection-panel">
      <RailPanelHeader title="Project inspection" />
      <div ref={contentRef} className="project-inspection-content">
        <form onSubmit={onSubmit}>
          <fieldset disabled={loading}>
            <legend>Entry points</legend>
            <div className="project-inspection-entry-points">
              {displayedEntryPoints.map(item => {
                const id = String(item.doc.id)
                return (
                  <OLFormCheckbox
                    key={id}
                    id={`project-inspection-entry-${id}`}
                    label={
                      <span
                        className="project-inspection-entry-label"
                        title={item.path}
                      >
                        {item.path}
                      </span>
                    }
                    checked={selectedIds.has(id)}
                    disabled={
                      !selectedIds.has(id) &&
                      selectedIds.size >= MAX_ENTRY_POINTS
                    }
                    onChange={event => {
                      setSelectedIds(current => {
                        const next = new Set(current)
                        if (event.target.checked) next.add(id)
                        else next.delete(id)
                        return next
                      })
                    }}
                  />
                )
              })}
            </div>
            {entryPoints.length === 0 && (
              <p className="project-inspection-note">
                This project has no compilable entry point.
              </p>
            )}
            {selectedIds.size >= MAX_ENTRY_POINTS && (
              <p className="project-inspection-note">
                Up to {MAX_ENTRY_POINTS} entry points can be analyzed at once.
              </p>
            )}
            <Button
              type="submit"
              size="sm"
              isLoading={loading}
              loadingLabel="Analyzing project"
              disabled={selectedIds.size === 0}
            >
              Analyze Project
            </Button>
          </fieldset>
        </form>

        {error && <Notification type="error" content={error} />}

        {result && (
          <>
            <p className="project-inspection-timestamp">
              Last analyzed: {new Date(result.analyzedAt).toLocaleTimeString()}
            </p>
            {hasCoverageWarning && (
              <Notification
                type="warning"
                className="project-inspection-coverage-warning"
                content={`${coverageWarningCount} item(s) could not be analyzed conclusively or the displayed result was truncated. Results favor fewer false positives.`}
              />
            )}
            <section className="project-inspection-overview">
              <h3>Overview</h3>
              <p className="project-inspection-totals">
                {result.overview.fileCount} files · {result.overview.figureCount}{' '}
                figures · {result.overview.tableCount} tables ·{' '}
                {result.overview.citationCount} citations
              </p>
              <div className="project-inspection-summary-grid">
                <OLTooltip
                  id="project-inspection-overview-circular"
                  description="Shows the number of circular file-dependency cycles."
                  overlayProps={{
                    placement: 'right',
                    trigger: ['hover', 'focus'],
                  }}
                >
                  <button
                    type="button"
                    onClick={() => scrollToSection('inspection-circular')}
                  >
                    <StatusDot status="circular" /> Circular
                    <strong>{result.overview.circular}</strong>
                  </button>
                </OLTooltip>
                <OLTooltip
                  id="project-inspection-overview-missing"
                  description="Shows the number of missing components."
                  overlayProps={{
                    placement: 'right',
                    trigger: ['hover', 'focus'],
                  }}
                >
                  <button
                    type="button"
                    onClick={() => scrollToSection('inspection-missing')}
                  >
                    <StatusDot status="missing" /> Missing
                    <strong>{result.overview.missing}</strong>
                  </button>
                </OLTooltip>
                <OLTooltip
                  id="project-inspection-overview-duplicate"
                  description="Shows the number of duplicate labels, figure or table captions, bibliography keys, or bibliography titles."
                  overlayProps={{
                    placement: 'right',
                    trigger: ['hover', 'focus'],
                  }}
                >
                  <button
                    type="button"
                    onClick={() => scrollToSection('inspection-duplicate')}
                  >
                    <StatusDot status="duplicate" /> Duplicate
                    <strong>{result.overview.duplicate}</strong>
                  </button>
                </OLTooltip>
                <OLTooltip
                  id="project-inspection-overview-unused"
                  description="Shows the number of unused or unreferenced components."
                  overlayProps={{
                    placement: 'right',
                    trigger: ['hover', 'focus'],
                  }}
                >
                  <button
                    type="button"
                    onClick={() => scrollToSection('inspection-unused')}
                  >
                    <StatusDot status="unused" /> Unused / Unreferenced
                    <strong>{result.overview.unusedUnreferenced}</strong>
                  </button>
                </OLTooltip>
              </div>
            </section>
            <DependencyTree result={result} onNavigate={onNavigate} />
            <IssueSection
              id="inspection-circular"
              title="Circular Dependencies"
              issueIds={result.views.circular}
              result={result}
              onNavigate={onNavigate}
            />
            <IssueSection
              id="inspection-missing"
              title="Missing Components"
              issueIds={result.views.missing}
              result={result}
              onNavigate={onNavigate}
              open
            />
            <IssueSection
              id="inspection-duplicate"
              title="Duplicate Components"
              issueIds={result.views.duplicate}
              result={result}
              onNavigate={onNavigate}
            />
            <IssueSection
              id="inspection-unused"
              title="Unused / Unreferenced Components"
              issueIds={result.views.unused}
              result={result}
              onNavigate={onNavigate}
            />
          </>
        )}
      </div>
    </div>
  )
}

export default ProjectInspectionPanel
