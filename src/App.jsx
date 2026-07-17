import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Copy,
  Download,
  FileJson,
  FolderOpen,
  GripVertical,
  Layers3,
  Menu,
  Plus,
  Redo2,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  Undo2,
  X,
} from 'lucide-react'
import { createSchemaId, deleteSchemaRecord, getLastOpenedSchemaId, getSchemaRecord, listSchemaRecords, putSchemaRecord, setLastOpenedSchemaId } from './db'

const INITIAL_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Customer Profile',
  description: 'A clear, reusable definition of a customer record.',
  type: 'object',
  properties: {
    id: {
      type: 'string',
      title: 'Customer ID',
      description: 'A unique identifier for this customer.',
      pattern: '^cus_[a-zA-Z0-9]+$',
    },
    fullName: {
      type: 'string',
      title: 'Full name',
      minLength: 2,
      maxLength: 120,
    },
    email: {
      type: 'string',
      title: 'Email address',
      format: 'email',
    },
    status: {
      type: 'string',
      title: 'Customer status',
      enum: ['active', 'pending', 'archived'],
      default: 'active',
    },
    preferences: {
      type: 'object',
      title: 'Preferences',
      properties: {
        newsletter: { type: 'boolean', title: 'Newsletter', default: true },
        theme: { type: 'string', enum: ['light', 'dark', 'system'] },
      },
    },
  },
  required: ['id', 'fullName', 'email'],
  additionalProperties: false,
}

const TYPE_META = {
  string: { label: 'Text', icon: 'Aa', color: 'violet' },
  number: { label: 'Number', icon: '#', color: 'blue' },
  integer: { label: 'Integer', icon: '01', color: 'blue' },
  boolean: { label: 'Boolean', icon: '◐', color: 'amber' },
  object: { label: 'Object', icon: '{}', color: 'green' },
  array: { label: 'Array', icon: '[]', color: 'rose' },
  null: { label: 'Null', icon: '∅', color: 'gray' },
}

const deepClone = (value) => JSON.parse(JSON.stringify(value))

function childProperties(node) {
  if (node?.type === 'array') return node.items?.properties || {}
  return node?.properties || {}
}

function applyNodeType(node, type) {
  node.type = type
  if (type === 'object') node.properties ||= {}
  if (type === 'array') node.items ||= { type: 'string' }
  return node
}

function treeContainsMatch(name, node, search) {
  if (!search || name.toLowerCase().includes(search.toLowerCase())) return true
  return Object.entries(childProperties(node)).some(([childName, child]) => treeContainsMatch(childName, child, search))
}

function getNode(schema, path) {
  return path.reduce((node, key) => childProperties(node)?.[key], schema)
}

function getParent(schema, path) {
  return path.length ? getNode(schema, path.slice(0, -1)) : null
}

function mutateNode(schema, path, updater) {
  const next = deepClone(schema)
  if (!path.length) return updater(next) || next
  const parent = getNode(next, path.slice(0, -1))
  const props = parent.type === 'array' ? parent.items.properties : parent.properties
  props[path.at(-1)] = updater(props[path.at(-1)]) || props[path.at(-1)]
  return next
}

function safeFilename(title) {
  return `${(typeof title === 'string' ? title : 'schema').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'schema'}.schema.json`
}

function schemaDisplayName(schema, fallback = 'Untitled schema') {
  return typeof schema?.title === 'string' && schema.title.trim() ? schema.title.trim() : fallback
}

function relativeTime(dateString) {
  const elapsed = Date.now() - new Date(dateString).getTime()
  if (elapsed < 60_000) return 'just now'
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`
  if (elapsed < 604_800_000) return `${Math.floor(elapsed / 86_400_000)}d ago`
  return new Date(dateString).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function validateSchemaNode(node, path = 'Root', issues = []) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    issues.push(`${path} must be a schema object`)
    return issues
  }
  if (node.pattern) {
    try { new RegExp(node.pattern) } catch { issues.push(`${path} has an invalid regular expression`) }
  }
  if (node.type !== undefined) {
    const types = Array.isArray(node.type) ? node.type : [node.type]
    types.forEach((type) => { if (!TYPE_META[type]) issues.push(`${path}: unknown type “${type}”`) })
  }
  if (node.title !== undefined && typeof node.title !== 'string') issues.push(`${path}: title must be a string`)
  if (node.description !== undefined && typeof node.description !== 'string') issues.push(`${path}: description must be a string`)
  if (node.multipleOf != null && node.multipleOf <= 0) issues.push(`${path}: multipleOf must be greater than zero`)
  ;['minLength', 'maxLength', 'minItems', 'maxItems', 'minProperties', 'maxProperties'].forEach((keyword) => {
    if (node[keyword] != null && (!Number.isInteger(node[keyword]) || node[keyword] < 0)) issues.push(`${path}: ${keyword} must be a non-negative integer`)
  })
  if (node.minLength != null && node.maxLength != null && node.minLength > node.maxLength) issues.push(`${path}: minimum length exceeds maximum length`)
  if (node.minimum != null && node.maximum != null && node.minimum > node.maximum) issues.push(`${path}: minimum exceeds maximum`)
  if (node.exclusiveMinimum != null && node.exclusiveMaximum != null && node.exclusiveMinimum >= node.exclusiveMaximum) issues.push(`${path}: exclusive minimum must be below exclusive maximum`)
  if (node.minItems != null && node.maxItems != null && node.minItems > node.maxItems) issues.push(`${path}: minimum items exceeds maximum items`)
  if (node.minProperties != null && node.maxProperties != null && node.minProperties > node.maxProperties) issues.push(`${path}: minimum properties exceeds maximum properties`)
  if (node.required && !Array.isArray(node.required)) issues.push(`${path}: required must be an array`)
  if (Array.isArray(node.required)) {
    if (new Set(node.required).size !== node.required.length) issues.push(`${path}: required property names must be unique`)
    node.required.forEach((name) => {
      if (!node.properties?.[name]) issues.push(`${path}: required property “${name}” is not defined`)
    })
  }
  if (node.enum && (!Array.isArray(node.enum) || node.enum.length === 0)) issues.push(`${path}: enum must contain at least one value`)
  if (node.properties && typeof node.properties === 'object') {
    Object.entries(node.properties).forEach(([name, child]) => validateSchemaNode(child, `${path}.${name}`, issues))
  }
  if (node.items && typeof node.items === 'object' && !Array.isArray(node.items)) validateSchemaNode(node.items, `${path}[]`, issues)
  return issues
}

function SchemaIcon({ type, small = false }) {
  const meta = TYPE_META[type] || TYPE_META.string
  return <span className={`type-icon ${meta.color} ${small ? 'small' : ''}`}>{meta.icon}</span>
}

function TreeItem({ name, node, path, selectedPath, onSelect, level = 0, required = false, search }) {
  const children = childProperties(node)
  const entries = Object.entries(children)
  const hasChildren = entries.length > 0
  const [open, setOpen] = useState(true)
  const selected = path.join('.') === selectedPath.join('.')
  const matches = !search || name.toLowerCase().includes(search.toLowerCase())
  const childMatches = entries.some(([key, child]) => treeContainsMatch(key, child, search))

  if (search && !matches && !childMatches) return null

  return (
    <div className="tree-branch">
      <button
        className={`tree-row ${selected ? 'selected' : ''}`}
        style={{ '--level': level }}
        onClick={() => onSelect(path)}
      >
        <span
          className={`tree-chevron ${hasChildren ? '' : 'invisible'}`}
          onClick={(event) => { event.stopPropagation(); setOpen((value) => !value) }}
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <SchemaIcon type={node.type} small />
        <span className="tree-name">{name}</span>
        {required && <span className="required-dot" title="Required" />}
      </button>
      {open && entries.map(([key, child]) => (
        <TreeItem
          key={key}
          name={key}
          node={child}
          path={[...path, key]}
          selectedPath={selectedPath}
          onSelect={onSelect}
          level={level + 1}
          required={(node.type === 'array' ? node.items?.required : node.required)?.includes(key)}
          search={search}
        />
      ))}
    </div>
  )
}

function Field({ label, hint, children, wide = false }) {
  return (
    <label className={`field ${wide ? 'wide' : ''}`}>
      <span className="field-label">{label}{hint && <CircleHelp size={13} title={hint} />}</span>
      {children}
    </label>
  )
}

function Toggle({ checked, onChange, label, description }) {
  return (
    <label className="toggle-row">
      <span>
        <strong>{label}</strong>
        {description && <small>{description}</small>}
      </span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="toggle"><span /></span>
    </label>
  )
}

function castValue(value, type) {
  if (type === 'number' || type === 'integer') {
    const numeric = Number(value)
    return Number.isNaN(numeric) ? value : numeric
  }
  if (type === 'boolean') return value === 'true'
  if (type === 'null') return null
  return value
}

function EnumEditor({ values = [], onChange, type = 'string' }) {
  const [draft, setDraft] = useState('')
  const add = () => {
    const value = castValue(draft.trim(), type)
    if (value && !values.includes(value)) onChange([...values, value])
    setDraft('')
  }
  return (
    <div className="enum-editor">
      <div className="chips">
        {values.map((value) => (
          <span className="chip" key={JSON.stringify(value)}>{String(value)}<button onClick={() => onChange(values.filter((item) => item !== value))}><X size={12} /></button></span>
        ))}
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); add() } }}
          onBlur={add}
          placeholder={values.length ? 'Add another…' : 'Type a value and press Enter'}
        />
      </div>
    </div>
  )
}

function JsonValueEditor({ value, onChange, placeholder, requireArray = false }) {
  const serialized = value === undefined ? '' : JSON.stringify(value, null, 2)
  const [draft, setDraft] = useState(serialized)
  const [error, setError] = useState('')

  useEffect(() => setDraft(serialized), [serialized])

  const save = () => {
    if (!draft.trim()) {
      setError('')
      onChange(undefined)
      return
    }
    try {
      const parsed = JSON.parse(draft)
      if (requireArray && !Array.isArray(parsed)) throw new Error('Enter a JSON array, for example ["one", "two"].')
      setError('')
      onChange(parsed)
    } catch (parseError) {
      setError(parseError.message || 'Invalid JSON value')
    }
  }

  return (
    <div className={`json-value-input ${error ? 'has-error' : ''}`}>
      <textarea value={draft} onChange={(event) => { setDraft(event.target.value); setError('') }} onBlur={save} rows={3} spellCheck="false" placeholder={placeholder} />
      {error && <small><AlertCircle size={12} /> {error}</small>}
    </div>
  )
}

function App() {
  const [schema, setSchema] = useState(INITIAL_SCHEMA)
  const [schemaId, setSchemaId] = useState(null)
  const [schemaRecords, setSchemaRecords] = useState([])
  const [databaseReady, setDatabaseReady] = useState(false)
  const [saveStatus, setSaveStatus] = useState('loading')
  const [selectedPath, setSelectedPath] = useState(['email'])
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState('design')
  const [jsonDraft, setJsonDraft] = useState(() => JSON.stringify(INITIAL_SCHEMA, null, 2))
  const [jsonError, setJsonError] = useState('')
  const [toast, setToast] = useState(null)
  const [showNewDialog, setShowNewDialog] = useState(false)
  const [newTitle, setNewTitle] = useState('Untitled schema')
  const [mobileTree, setMobileTree] = useState(false)
  const [copied, setCopied] = useState(false)
  const [history, setHistory] = useState([INITIAL_SCHEMA])
  const [historyIndex, setHistoryIndex] = useState(0)
  const [dirtyRevision, setDirtyRevision] = useState(0)
  const fileInput = useRef(null)
  const saveQueue = useRef(Promise.resolve())
  const schemaRef = useRef(schema)
  const schemaIdRef = useRef(schemaId)
  const schemaRecordsRef = useRef(schemaRecords)
  const databaseReadyRef = useRef(databaseReady)
  const dirtyRevisionRef = useRef(dirtyRevision)
  const savedRevisionRef = useRef(0)
  schemaRef.current = schema
  schemaIdRef.current = schemaId
  schemaRecordsRef.current = schemaRecords
  databaseReadyRef.current = databaseReady
  dirtyRevisionRef.current = dirtyRevision
  const currentNode = useMemo(() => getNode(schema, selectedPath) || schema, [schema, selectedPath])
  const parentNode = useMemo(() => getParent(schema, selectedPath), [schema, selectedPath])
  const propertyName = selectedPath.at(-1) || ''
  const isRoot = selectedPath.length === 0
  const requiredList = parentNode ? (parentNode.type === 'array' ? parentNode.items?.required : parentNode.required) || [] : []
  const isRequired = !isRoot && requiredList.includes(propertyName)
  const hasUnappliedJson = activeTab === 'json' && jsonDraft !== JSON.stringify(schema, null, 2)

  const enqueueSchemaWrite = (record) => {
    const write = saveQueue.current.then(() => putSchemaRecord(record))
    saveQueue.current = write.catch(() => {})
    return write
  }

  const snapshotRecord = (snapshotSchema = schemaRef.current, id = schemaIdRef.current) => {
    if (!id) return null
    const existing = schemaRecordsRef.current.find((record) => record.id === id)
    const timestamp = new Date().toISOString()
    return {
      id,
      name: schemaDisplayName(snapshotSchema),
      schema: deepClone(snapshotSchema),
      createdAt: existing?.createdAt || timestamp,
      updatedAt: timestamp,
    }
  }

  useEffect(() => {
    let disposed = false

    const initializeLibrary = async () => {
      try {
        let records = await listSchemaRecords()
        if (!records.length) {
          const timestamp = new Date().toISOString()
          const starter = { id: 'starter-schema', name: INITIAL_SCHEMA.title, schema: deepClone(INITIAL_SCHEMA), createdAt: timestamp, updatedAt: timestamp }
          await putSchemaRecord(starter)
          records = [starter]
        }
        if (disposed) return
        const lastOpenedId = await getLastOpenedSchemaId()
        const latest = records.find((record) => record.id === lastOpenedId) || records[0]
        setSchemaRecords(records)
        setSchemaId(latest.id)
        setSchema(deepClone(latest.schema))
        setJsonDraft(JSON.stringify(latest.schema, null, 2))
        setHistory([deepClone(latest.schema)])
        setHistoryIndex(0)
        setSelectedPath([])
        setDatabaseReady(true)
        setSaveStatus('saved')
        setLastOpenedSchemaId(latest.id).catch(() => {})
      } catch (error) {
        if (disposed) return
        setSaveStatus('error')
        setToast({ type: 'error', message: error.message || 'Local schema storage is unavailable.' })
      }
    }

    initializeLibrary()
    return () => { disposed = true }
  }, [])

  useEffect(() => {
    if (!databaseReady || !schemaId || dirtyRevision === savedRevisionRef.current) return
    const revisionToSave = dirtyRevision
    setSaveStatus('saving')
    const timer = setTimeout(async () => {
      try {
        const record = snapshotRecord(schema, schemaId)
        await enqueueSchemaWrite(record)
        savedRevisionRef.current = Math.max(savedRevisionRef.current, revisionToSave)
        setSchemaRecords((records) => [record, ...records.filter((item) => item.id !== record.id)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
        if (schemaIdRef.current === record.id) setSaveStatus('saved')
      } catch (error) {
        if (schemaIdRef.current === schemaId) setSaveStatus('error')
        setToast({ type: 'error', message: error.message || 'Autosave failed.' })
      }
    }, 180)
    return () => clearTimeout(timer)
  }, [dirtyRevision, databaseReady, schemaId])

  useEffect(() => {
    const flushLatestSnapshot = () => {
      if (!databaseReadyRef.current || !schemaIdRef.current) return
      if (dirtyRevisionRef.current === savedRevisionRef.current) return
      const record = snapshotRecord()
      const revisionToSave = dirtyRevisionRef.current
      enqueueSchemaWrite(record).then(() => { savedRevisionRef.current = Math.max(savedRevisionRef.current, revisionToSave) }).catch(() => {})
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flushLatestSnapshot()
    }
    window.addEventListener('pagehide', flushLatestSnapshot)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.removeEventListener('pagehide', flushLatestSnapshot)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 3200)
    return () => clearTimeout(timer)
  }, [toast])

  const commit = (next, message) => {
    setSchema(next)
    setDirtyRevision((revision) => revision + 1)
    const newHistory = [...history.slice(0, historyIndex + 1), deepClone(next)].slice(-40)
    setHistory(newHistory)
    setHistoryIndex(newHistory.length - 1)
    if (message) setToast({ type: 'success', message })
  }

  const activateRecord = (record, message) => {
    setSchemaRecords((records) => records.map((item) => item.id === record.id ? record : item))
    setSchemaId(record.id)
    setSchema(deepClone(record.schema))
    setJsonDraft(JSON.stringify(record.schema, null, 2))
    setJsonError('')
    setHistory([deepClone(record.schema)])
    setHistoryIndex(0)
    setSelectedPath([])
    setActiveTab('design')
    setMobileTree(false)
    setSaveStatus('saved')
    savedRevisionRef.current = dirtyRevisionRef.current
    setLastOpenedSchemaId(record.id).catch(() => {})
    if (message) setToast({ type: 'success', message })
  }

  const persistCurrent = async () => {
    if (!databaseReady || !schemaId) return
    const record = snapshotRecord(schema, schemaId)
    setSaveStatus('saving')
    await enqueueSchemaWrite(record)
    savedRevisionRef.current = dirtyRevisionRef.current
    setSchemaRecords((records) => [record, ...records.filter((item) => item.id !== schemaId)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
    if (schemaIdRef.current === schemaId) setSaveStatus('saved')
    return record
  }

  const loadStoredSchema = async (id) => {
    if (id === schemaId) {
      setActiveTab('design')
      return
    }
    if (hasUnappliedJson) {
      setToast({ type: 'error', message: 'Apply or discard your JSON edits before switching schemas.' })
      return
    }
    try {
      setSaveStatus('saving')
      await persistCurrent()
      const record = await getSchemaRecord(id)
      if (!record) throw new Error('That schema could not be found.')
      activateRecord(record)
    } catch (error) {
      setSaveStatus('error')
      setToast({ type: 'error', message: error.message || 'Could not load this schema.' })
    }
  }

  const duplicateSchema = async (sourceRecord) => {
    if (hasUnappliedJson) {
      setToast({ type: 'error', message: 'Apply or discard your JSON edits before duplicating a schema.' })
      return
    }
    try {
      await persistCurrent()
      const storedSource = sourceRecord.id === schemaId ? null : await getSchemaRecord(sourceRecord.id)
      const sourceSchema = sourceRecord.id === schemaId ? schema : storedSource?.schema
      if (!sourceSchema) throw new Error('The source schema could not be found.')
      const baseTitle = schemaDisplayName(sourceSchema, typeof sourceRecord.name === 'string' ? sourceRecord.name : 'Untitled schema')
      const existingNames = new Set(schemaRecords.map((record) => record.name.toLowerCase()))
      let title = `${baseTitle} copy`
      let index = 2
      while (existingNames.has(title.toLowerCase())) title = `${baseTitle} copy ${index++}`
      const duplicated = deepClone(sourceSchema)
      duplicated.title = title
      const timestamp = new Date().toISOString()
      const record = { id: createSchemaId(), name: title, schema: duplicated, createdAt: timestamp, updatedAt: timestamp }
      await enqueueSchemaWrite(record)
      setSchemaRecords((records) => [record, ...records])
      activateRecord(record, `Created “${title}”`)
    } catch (error) {
      setToast({ type: 'error', message: error.message || 'Could not duplicate this schema.' })
    }
  }

  const removeStoredSchema = async (record) => {
    if (record.id === schemaId && hasUnappliedJson) {
      setToast({ type: 'error', message: 'Apply or discard your JSON edits before deleting this schema.' })
      return
    }
    if (schemaRecords.length === 1) {
      setToast({ type: 'error', message: 'Keep at least one schema in your library.' })
      return
    }
    if (!window.confirm(`Delete “${record.name}”? This cannot be undone.`)) return
    try {
      await saveQueue.current
      const remaining = schemaRecords.filter((item) => item.id !== record.id)
      if (record.id === schemaId) activateRecord(remaining[0])
      await deleteSchemaRecord(record.id)
      setSchemaRecords(remaining)
      setToast({ type: 'success', message: `Deleted “${record.name}”` })
    } catch (error) {
      setToast({ type: 'error', message: error.message || 'Could not delete this schema.' })
    }
  }

  const updateCurrent = (key, value) => {
    const next = mutateNode(schema, selectedPath, (node) => {
      if (value === '' || value === undefined) delete node[key]
      else node[key] = value
      return node
    })
    commit(next)
  }

  const undo = () => {
    if (activeTab === 'json' || historyIndex <= 0) return
    setHistoryIndex(historyIndex - 1)
    setSchema(deepClone(history[historyIndex - 1]))
    setDirtyRevision((revision) => revision + 1)
  }

  const redo = () => {
    if (activeTab === 'json' || historyIndex >= history.length - 1) return
    setHistoryIndex(historyIndex + 1)
    setSchema(deepClone(history[historyIndex + 1]))
    setDirtyRevision((revision) => revision + 1)
  }

  const renameProperty = (nextName) => {
    const clean = nextName.trim().replace(/\s+/g, '_')
    if (!clean || clean === propertyName || isRoot) return
    const next = deepClone(schema)
    const parent = getNode(next, selectedPath.slice(0, -1))
    const props = parent.type === 'array' ? parent.items.properties : parent.properties
    if (props[clean]) {
      setToast({ type: 'error', message: `“${clean}” already exists at this level.` })
      return
    }
    const reordered = {}
    Object.entries(props).forEach(([key, value]) => { reordered[key === propertyName ? clean : key] = value })
    if (parent.type === 'array') parent.items.properties = reordered
    else parent.properties = reordered
    const required = parent.type === 'array' ? parent.items.required : parent.required
    if (required?.includes(propertyName)) required[required.indexOf(propertyName)] = clean
    commit(next)
    setSelectedPath([...selectedPath.slice(0, -1), clean])
  }

  const setType = (type) => {
    const next = mutateNode(schema, selectedPath, (node) => {
      return applyNodeType(node, type)
    })
    commit(next)
  }

  const setRequired = (checked) => {
    if (isRoot) return
    const next = deepClone(schema)
    const parent = getNode(next, selectedPath.slice(0, -1))
    const owner = parent.type === 'array' ? parent.items : parent
    const list = owner.required || []
    owner.required = checked ? [...new Set([...list, propertyName])] : list.filter((name) => name !== propertyName)
    if (!owner.required.length) delete owner.required
    commit(next)
  }

  const addProperty = () => {
    let targetPath = selectedPath
    let target = currentNode
    if (target.type !== 'object' && !(target.type === 'array' && target.items?.type === 'object')) {
      targetPath = selectedPath.slice(0, -1)
      target = getNode(schema, targetPath)
    }
    if (!target || (target.type !== 'object' && !(target.type === 'array' && target.items?.type === 'object'))) {
      setToast({ type: 'error', message: 'Select an object before adding a property.' })
      return
    }
    const props = childProperties(target)
    let index = Object.keys(props).length + 1
    let name = `newField${index}`
    while (props[name]) name = `newField${++index}`
    const next = mutateNode(schema, targetPath, (node) => {
      const owner = node.type === 'array' ? node.items : node
      owner.properties = { ...(owner.properties || {}), [name]: { type: 'string', title: 'New field' } }
      return node
    })
    commit(next)
    setSelectedPath([...targetPath, name])
    setMobileTree(false)
  }

  const deleteProperty = () => {
    if (isRoot) return
    const next = deepClone(schema)
    const parent = getNode(next, selectedPath.slice(0, -1))
    const owner = parent.type === 'array' ? parent.items : parent
    delete owner.properties[propertyName]
    if (owner.required) {
      owner.required = owner.required.filter((name) => name !== propertyName)
      if (!owner.required.length) delete owner.required
    }
    commit(next, `Removed ${propertyName}`)
    setSelectedPath(selectedPath.slice(0, -1))
  }

  const duplicateProperty = () => {
    if (isRoot) return
    const next = deepClone(schema)
    const parent = getNode(next, selectedPath.slice(0, -1))
    const owner = parent.type === 'array' ? parent.items : parent
    let nextName = `${propertyName}Copy`
    let index = 2
    while (owner.properties[nextName]) nextName = `${propertyName}Copy${index++}`
    const reordered = {}
    Object.entries(owner.properties).forEach(([key, value]) => {
      reordered[key] = value
      if (key === propertyName) reordered[nextName] = deepClone(value)
    })
    owner.properties = reordered
    commit(next, `Duplicated ${propertyName}`)
    setSelectedPath([...selectedPath.slice(0, -1), nextName])
  }

  const importFile = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (hasUnappliedJson) {
      setToast({ type: 'error', message: 'Apply or discard your JSON edits before importing another schema.' })
      return
    }
    try {
      const parsed = JSON.parse(await file.text())
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Schema must be a JSON object')
      if (!parsed.type && !parsed.$schema && !parsed.properties) throw new Error('This does not look like a JSON Schema')
      const normalized = { $schema: 'https://json-schema.org/draft/2020-12/schema', ...parsed }
      if (!normalized.type && normalized.properties) normalized.type = 'object'
      if (typeof normalized.title !== 'string' || !normalized.title.trim()) normalized.title = file.name.replace(/\.(schema\.)?json$/i, '') || 'Imported schema'
      await persistCurrent()
      const timestamp = new Date().toISOString()
      const record = { id: createSchemaId(), name: normalized.title, schema: normalized, createdAt: timestamp, updatedAt: timestamp }
      await enqueueSchemaWrite(record)
      setSchemaRecords((records) => [record, ...records])
      activateRecord(record, `${file.name} added to your library`)
    } catch (error) {
      setToast({ type: 'error', message: error.message || 'Could not read this JSON file.' })
    }
  }

  const createSchema = async () => {
    if (hasUnappliedJson) {
      setToast({ type: 'error', message: 'Apply or discard your JSON edits before creating another schema.' })
      return
    }
    const next = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      title: newTitle.trim() || 'Untitled schema',
      description: '',
      type: 'object',
      properties: {},
      additionalProperties: false,
    }
    try {
      await persistCurrent()
      const timestamp = new Date().toISOString()
      const record = { id: createSchemaId(), name: next.title, schema: next, createdAt: timestamp, updatedAt: timestamp }
      await enqueueSchemaWrite(record)
      setSchemaRecords((records) => [record, ...records])
      activateRecord(record, 'Your new schema is ready')
      setShowNewDialog(false)
    } catch (error) {
      setToast({ type: 'error', message: error.message || 'Could not create the schema.' })
    }
  }

  const download = () => {
    const blob = new Blob([JSON.stringify(schema, null, 2)], { type: 'application/schema+json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = safeFilename(schema.title)
    anchor.click()
    URL.revokeObjectURL(url)
    setToast({ type: 'success', message: `${safeFilename(schema.title)} downloaded` })
  }

  const copyJson = async () => {
    await navigator.clipboard.writeText(JSON.stringify(schema, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  const openJsonEditor = () => {
    setJsonDraft(JSON.stringify(schema, null, 2))
    setJsonError('')
    setActiveTab('json')
  }

  const openSchemaLibrary = () => {
    if (hasUnappliedJson) {
      setToast({ type: 'error', message: 'Apply or discard your JSON edits before opening the schema library.' })
      return
    }
    setMobileTree(false)
    setActiveTab('schemas')
  }

  const discardJsonEdits = () => {
    setJsonDraft(JSON.stringify(schema, null, 2))
    setJsonError('')
    setToast({ type: 'success', message: 'Unapplied JSON edits discarded' })
  }

  const applyJson = (returnToDesign = false) => {
    try {
      const parsed = JSON.parse(jsonDraft)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('The schema root must be a JSON object.')
      if (JSON.stringify(parsed) !== JSON.stringify(schema)) {
        commit(parsed, 'JSON changes applied')
        if (selectedPath.length && !getNode(parsed, selectedPath)) setSelectedPath([])
      }
      setJsonDraft(JSON.stringify(parsed, null, 2))
      setJsonError('')
      if (returnToDesign) setActiveTab('design')
    } catch (error) {
      setJsonError(error.message || 'Invalid JSON')
    }
  }

  const breadcrumb = ['Schema', ...selectedPath]
  const objectChildCount = Object.keys(childProperties(currentNode)).length
  const schemaIssues = useMemo(() => validateSchemaNode(schema), [schema])
  const currentRecord = schemaRecords.find((record) => record.id === schemaId)
  const hasValidationSection = ['string', 'number', 'integer', 'array', 'object'].includes(currentNode.type)
  const scrollToSection = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark"><Braces size={19} /></span><span>Schematic</span></div>
        <nav className="top-tabs" aria-label="Editor view">
          <button className={activeTab === 'design' ? 'active' : ''} onClick={() => activeTab === 'json' ? applyJson(true) : setActiveTab('design')}><Layers3 size={16} /> Design</button>
          <button className={activeTab === 'json' ? 'active' : ''} onClick={() => activeTab !== 'json' && openJsonEditor()}><FileJson size={16} /> JSON</button>
          <button className={activeTab === 'schemas' ? 'active' : ''} onClick={openSchemaLibrary}><FolderOpen size={16} /> Schemas</button>
        </nav>
        <div className="top-actions">
          <span className={`save-state ${hasUnappliedJson ? 'pending' : saveStatus}`}><span />{hasUnappliedJson ? 'JSON not applied' : saveStatus === 'loading' ? 'Opening library…' : saveStatus === 'saving' ? 'Saving…' : saveStatus === 'error' ? 'Save failed' : 'Saved locally'}</span>
          <button className="icon-button desktop-only" onClick={undo} disabled={activeTab === 'json' || historyIndex <= 0} title="Undo"><Undo2 size={17} /></button>
          <button className="icon-button desktop-only" onClick={redo} disabled={activeTab === 'json' || historyIndex >= history.length - 1} title="Redo"><Redo2 size={17} /></button>
          <span className="action-divider desktop-only" />
          <button className="button subtle desktop-only" onClick={() => fileInput.current?.click()}><FolderOpen size={16} /> Import</button>
          <button className="button secondary" onClick={download}><Download size={16} /> <span className="button-label">Export</span></button>
          {activeTab !== 'schemas' && <button className="icon-button mobile-only" onClick={() => setMobileTree(true)}><Menu size={18} /></button>}
        </div>
      </header>

      <input ref={fileInput} type="file" accept="application/json,.json,.schema" hidden onChange={importFile} />

      <div className={`workspace ${activeTab === 'json' ? 'json-mode' : ''} ${activeTab === 'schemas' ? 'schemas-mode' : ''}`}>
        <aside className={`sidebar ${mobileTree ? 'mobile-open' : ''}`}>
          <div className="sidebar-mobile-head mobile-only"><strong>Schema structure</strong><button className="icon-button" onClick={() => setMobileTree(false)}><X size={18} /></button></div>
          <div className="schema-file">
            <div className="schema-file-icon"><FileJson size={20} /></div>
            <div><strong>{schemaDisplayName(schema)}</strong><span>Draft 2020-12</span></div>
            <button className="icon-button" onClick={() => currentRecord && duplicateSchema(currentRecord)} title="Duplicate this schema"><Copy size={15} /></button>
          </div>
          <button className="add-property-primary" onClick={addProperty} disabled={activeTab === 'json'}><Plus size={16} /> Add property</button>
          <div className="search-box"><Search size={15} /><input placeholder="Find a property…" value={search} onChange={(e) => setSearch(e.target.value)} />{search && <button onClick={() => setSearch('')}><X size={13} /></button>}</div>
          <div className="tree-label"><span>Properties</span><span>{Object.keys(schema.properties || {}).length}</span></div>
          <div className="tree-scroll">
            <button className={`tree-row root-row ${selectedPath.length === 0 ? 'selected' : ''}`} onClick={() => { setSelectedPath([]); setMobileTree(false) }}>
              <span className="tree-chevron"><ChevronDown size={14} /></span><SchemaIcon type="object" small /><span className="tree-name">Root</span>
            </button>
            {Object.entries(schema.properties || {}).map(([name, node]) => (
              <TreeItem key={name} name={name} node={node} path={[name]} selectedPath={selectedPath} onSelect={(path) => { setSelectedPath(path); setMobileTree(false) }} level={1} required={schema.required?.includes(name)} search={search} />
            ))}
            {!Object.keys(schema.properties || {}).length && <div className="empty-tree"><Sparkles size={18} /><span>No properties yet</span><button onClick={addProperty}>Add your first field</button></div>}
          </div>
          <div className="sidebar-footer"><a href="https://json-schema.org/learn/getting-started-step-by-step" target="_blank" rel="noreferrer"><CircleHelp size={15} /> Schema guide</a><button title="Settings"><Settings2 size={15} /></button></div>
        </aside>

        {mobileTree && <button className="mobile-backdrop" onClick={() => setMobileTree(false)} aria-label="Close navigation" />}

        <main className="editor-panel">
          {activeTab === 'schemas' ? (
            <div className="schema-library-view">
              <header className="library-view-header">
                <div>
                  <div className="eyebrow">Local workspace</div>
                  <h1>Schema library</h1>
                  <p>Open a schema or create a separate copy. Everything is saved automatically in this browser.</p>
                </div>
                <div className="library-view-actions">
                  <button className="button secondary" onClick={() => fileInput.current?.click()}><FolderOpen size={16} /> Import JSON</button>
                  <button className="button primary" onClick={() => setShowNewDialog(true)}><Plus size={16} /> New schema</button>
                </div>
              </header>

              <div className="library-summary">
                <span><strong>{schemaRecords.length}</strong> {schemaRecords.length === 1 ? 'schema' : 'schemas'} stored locally</span>
                <span><span className={`status-dot ${saveStatus === 'error' ? 'error' : ''}`} /> {saveStatus === 'saving' ? 'Saving changes…' : saveStatus === 'error' ? 'Storage error' : 'IndexedDB connected'}</span>
              </div>

              {!databaseReady ? (
                <div className="library-view-loading"><span /> Opening your local schema library…</div>
              ) : (
                <div className="schema-card-grid">
                  {schemaRecords.map((record) => {
                    const propertyCount = Object.keys(record.schema?.properties || {}).length
                    const issueCount = validateSchemaNode(record.schema).length
                    return (
                      <article className={`schema-card ${record.id === schemaId ? 'active' : ''}`} key={record.id}>
                        <button className="schema-card-open" onClick={() => loadStoredSchema(record.id)}>
                          <span className="schema-card-icon"><FileJson size={20} /></span>
                          <span className="schema-card-title"><strong>{record.name}</strong>{record.id === schemaId && <small>Currently open</small>}</span>
                          <ChevronRight size={17} />
                        </button>
                        <div className="schema-card-description">{record.schema?.description || 'No description added yet.'}</div>
                        <div className="schema-card-meta">
                          <span>{propertyCount} {propertyCount === 1 ? 'property' : 'properties'}</span>
                          <span className={issueCount ? 'issues' : ''}>{issueCount ? `${issueCount} ${issueCount === 1 ? 'issue' : 'issues'}` : 'Checks passed'}</span>
                          <span>Edited {relativeTime(record.updatedAt)}</span>
                        </div>
                        <div className="schema-card-actions">
                          <button onClick={() => loadStoredSchema(record.id)}>Open schema</button>
                          <button onClick={() => duplicateSchema(record)}><Copy size={13} /> Duplicate</button>
                          <button className="delete" onClick={() => removeStoredSchema(record)}><Trash2 size={13} /> Delete</button>
                        </div>
                      </article>
                    )
                  })}
                </div>
              )}
            </div>
          ) : activeTab === 'design' ? (
            <>
              <div className="editor-toolbar">
                <div className="breadcrumbs">
                  {breadcrumb.map((part, index) => <span key={`${part}-${index}`}>{index > 0 && <ChevronRight size={13} />}<button onClick={() => setSelectedPath(selectedPath.slice(0, index))}>{part}</button></span>)}
                </div>
                <div className="property-actions">
                  <button className="button toolbar-add" onClick={addProperty}><Plus size={15} /> {isRoot ? 'Add property' : (currentNode.type === 'object' || (currentNode.type === 'array' && currentNode.items?.type === 'object')) ? 'Add child' : 'Add sibling'}</button>
                  {!isRoot && <button className="button toolbar-duplicate" onClick={duplicateProperty} title="Duplicate property"><Copy size={15} /><span>Duplicate</span></button>}
                  {!isRoot && <button className="button toolbar-delete" onClick={deleteProperty} title="Delete property"><Trash2 size={15} /><span>Delete</span></button>}
                </div>
              </div>

              <div className="editor-scroll">
                <section className="editor-heading">
                  <div className="heading-icon"><SchemaIcon type={currentNode.type} /></div>
                  <div>
                    <div className="eyebrow">{isRoot ? 'Schema settings' : 'Property'}</div>
                    <h1>{isRoot ? schemaDisplayName(schema) : propertyName}</h1>
                    <p>{isRoot ? 'Define the shape and behavior of your JSON document.' : `Configure how “${propertyName}” is described and validated.`}</p>
                  </div>
                </section>

                <nav className="section-jump" aria-label="Property sections">
                  <span>Jump to</span>
                  <button onClick={() => scrollToSection('general-section')}>General</button>
                  <button onClick={() => scrollToSection('type-section')}>Data type</button>
                  {hasValidationSection && <button onClick={() => scrollToSection('validation-section')}>Validation</button>}
                  <button onClick={() => scrollToSection('advanced-section')}>Advanced</button>
                </nav>

                <section className="form-section scroll-target" id="general-section">
                  <div className="section-title"><div><h2>General</h2><p>The human-readable details for this {isRoot ? 'schema' : 'property'}.</p></div></div>
                  <div className="form-grid">
                    {!isRoot && <Field label="Property name"><input defaultValue={propertyName} key={propertyName} onBlur={(e) => renameProperty(e.target.value)} /></Field>}
                    <Field label="Display title" wide={isRoot}><input value={currentNode.title || ''} onChange={(e) => updateCurrent('title', e.target.value)} placeholder={isRoot ? 'e.g. Customer profile' : 'e.g. Email address'} /></Field>
                    <Field label="Description" wide><textarea value={currentNode.description || ''} onChange={(e) => updateCurrent('description', e.target.value)} rows={3} placeholder="Help people understand what this field is for…" /></Field>
                  </div>
                </section>

                <section className="form-section scroll-target" id="type-section">
                  <div className="section-title"><div><h2>Data type</h2><p>Choose the kind of value this {isRoot ? 'schema' : 'property'} accepts.</p></div></div>
                  <div className="type-grid">
                    {Object.entries(TYPE_META).map(([type, meta]) => (
                      <button key={type} className={`type-card ${currentNode.type === type ? 'selected' : ''}`} onClick={() => setType(type)} disabled={isRoot && type !== 'object'}>
                        <SchemaIcon type={type} /><span><strong>{meta.label}</strong><small>{type}</small></span>{currentNode.type === type && <Check size={15} className="type-check" />}
                      </button>
                    ))}
                  </div>
                </section>

                {!isRoot && (
                  <section className="form-section compact-section">
                    <Toggle checked={isRequired} onChange={setRequired} label="Required property" description="Objects must include this property to be valid." />
                  </section>
                )}

                {currentNode.type === 'string' && (
                  <section className="form-section scroll-target" id="validation-section">
                    <div className="section-title"><div><h2>Text rules</h2><p>Add optional boundaries for accepted text values.</p></div></div>
                    <div className="form-grid three">
                      <Field label="Format"><select value={currentNode.format || ''} onChange={(e) => updateCurrent('format', e.target.value)}><option value="">Any text</option><option value="email">Email</option><option value="uri">URL / URI</option><option value="date">Date</option><option value="date-time">Date & time</option><option value="uuid">UUID</option><option value="hostname">Hostname</option><option value="ipv4">IPv4 address</option></select></Field>
                      <Field label="Minimum length"><input type="number" min="0" value={currentNode.minLength ?? ''} onChange={(e) => updateCurrent('minLength', e.target.value === '' ? '' : Number(e.target.value))} placeholder="No minimum" /></Field>
                      <Field label="Maximum length"><input type="number" min="0" value={currentNode.maxLength ?? ''} onChange={(e) => updateCurrent('maxLength', e.target.value === '' ? '' : Number(e.target.value))} placeholder="No maximum" /></Field>
                      <Field label="Pattern (RegEx)" hint="The entire value is tested using this JavaScript-compatible regular expression." wide><div className="input-prefix"><span>/</span><input value={currentNode.pattern || ''} onChange={(e) => updateCurrent('pattern', e.target.value)} placeholder="^[a-zA-Z0-9]+$" /><span>/</span></div></Field>
                    </div>
                  </section>
                )}

                {(currentNode.type === 'number' || currentNode.type === 'integer') && (
                  <section className="form-section scroll-target" id="validation-section">
                    <div className="section-title"><div><h2>Number rules</h2><p>Set the accepted numeric range and increment.</p></div></div>
                    <div className="form-grid three">
                      <Field label="Minimum"><input type="number" value={currentNode.minimum ?? ''} onChange={(e) => updateCurrent('minimum', e.target.value === '' ? '' : Number(e.target.value))} placeholder="No minimum" /></Field>
                      <Field label="Maximum"><input type="number" value={currentNode.maximum ?? ''} onChange={(e) => updateCurrent('maximum', e.target.value === '' ? '' : Number(e.target.value))} placeholder="No maximum" /></Field>
                      <Field label="Multiple of"><input type="number" min="0" value={currentNode.multipleOf ?? ''} onChange={(e) => updateCurrent('multipleOf', e.target.value === '' ? '' : Number(e.target.value))} placeholder="Any" /></Field>
                      <Field label="Exclusive minimum"><input type="number" value={currentNode.exclusiveMinimum ?? ''} onChange={(e) => updateCurrent('exclusiveMinimum', e.target.value === '' ? '' : Number(e.target.value))} placeholder="Not set" /></Field>
                      <Field label="Exclusive maximum"><input type="number" value={currentNode.exclusiveMaximum ?? ''} onChange={(e) => updateCurrent('exclusiveMaximum', e.target.value === '' ? '' : Number(e.target.value))} placeholder="Not set" /></Field>
                    </div>
                  </section>
                )}

                {currentNode.type === 'array' && (
                  <section className="form-section scroll-target" id="validation-section">
                    <div className="section-title"><div><h2>Array items</h2><p>Describe the values contained in this list.</p></div></div>
                    <div className="form-grid three">
                      <Field label="Item type"><select value={currentNode.items?.type || 'string'} onChange={(e) => updateCurrent('items', applyNodeType(deepClone(currentNode.items || {}), e.target.value))}>{Object.keys(TYPE_META).filter((type) => type !== 'null').map((type) => <option key={type} value={type}>{TYPE_META[type].label}</option>)}</select></Field>
                      <Field label="Minimum items"><input type="number" min="0" value={currentNode.minItems ?? ''} onChange={(e) => updateCurrent('minItems', e.target.value === '' ? '' : Number(e.target.value))} placeholder="No minimum" /></Field>
                      <Field label="Maximum items"><input type="number" min="0" value={currentNode.maxItems ?? ''} onChange={(e) => updateCurrent('maxItems', e.target.value === '' ? '' : Number(e.target.value))} placeholder="No maximum" /></Field>
                    </div>
                    <div className="inline-toggle"><Toggle checked={currentNode.uniqueItems || false} onChange={(value) => updateCurrent('uniqueItems', value || undefined)} label="Unique items only" description="Prevent duplicate values in this array." /></div>
                    {currentNode.items?.type === 'object' && <div className="inline-toggle"><Toggle checked={currentNode.items?.additionalProperties !== false} onChange={(value) => updateCurrent('items', { ...currentNode.items, additionalProperties: value })} label="Allow extra item properties" description="Accept undeclared fields inside each object item." /></div>}
                  </section>
                )}

                {currentNode.type === 'object' && (
                  <section className="form-section scroll-target" id="validation-section">
                    <div className="section-title"><div><h2>Object rules</h2><p>Control the number and strictness of nested properties.</p></div></div>
                    <div className="form-grid">
                      <Field label="Minimum properties"><input type="number" min="0" value={currentNode.minProperties ?? ''} onChange={(e) => updateCurrent('minProperties', e.target.value === '' ? '' : Number(e.target.value))} placeholder="No minimum" /></Field>
                      <Field label="Maximum properties"><input type="number" min="0" value={currentNode.maxProperties ?? ''} onChange={(e) => updateCurrent('maxProperties', e.target.value === '' ? '' : Number(e.target.value))} placeholder="No maximum" /></Field>
                    </div>
                    <div className="inline-toggle"><Toggle checked={currentNode.additionalProperties !== false} onChange={(value) => updateCurrent('additionalProperties', value)} label="Allow additional properties" description="Accept fields that are not explicitly defined in this object." /></div>
                  </section>
                )}

                {(currentNode.type === 'object' || (currentNode.type === 'array' && currentNode.items?.type === 'object')) && (
                  <section className="form-section">
                    <div className="section-title action-title"><div><h2>Nested properties</h2><p>{objectChildCount ? `${objectChildCount} ${objectChildCount === 1 ? 'property' : 'properties'} inside this object.` : 'Build this object by adding its first property.'}</p></div><button className="button secondary" onClick={addProperty}><Plus size={15} /> Add property</button></div>
                    {objectChildCount > 0 && <div className="property-list">{Object.entries(childProperties(currentNode)).map(([name, node]) => <button key={name} onClick={() => setSelectedPath([...selectedPath, name])}><GripVertical size={15} /><SchemaIcon type={node.type} small /><span>{name}</span><small>{TYPE_META[node.type]?.label || node.type}</small><ChevronRight size={15} /></button>)}</div>}
                  </section>
                )}

                {!isRoot && currentNode.type !== 'object' && (
                  <section className="form-section">
                    <div className="section-title"><div><h2>Allowed values</h2><p>Optionally restrict this property to a fixed set.</p></div></div>
                    <Field label="Enumeration" hint="Leave empty to allow any value of this type."><EnumEditor type={currentNode.type} values={currentNode.enum || []} onChange={(values) => updateCurrent('enum', values.length ? values : undefined)} /></Field>
                    <div className="spacer-16" />
                    <Field label="Default value">
                      {currentNode.type === 'boolean' ? (
                        <select value={currentNode.default === undefined ? '' : String(currentNode.default)} onChange={(e) => updateCurrent('default', e.target.value === '' ? '' : e.target.value === 'true')}><option value="">No default value</option><option value="true">True</option><option value="false">False</option></select>
                      ) : (
                        <input type={currentNode.type === 'number' || currentNode.type === 'integer' ? 'number' : 'text'} value={currentNode.default ?? ''} onChange={(e) => updateCurrent('default', e.target.value === '' ? '' : castValue(e.target.value, currentNode.type))} placeholder="No default value" />
                      )}
                    </Field>
                  </section>
                )}

                <section className="form-section scroll-target" id="advanced-section">
                  <div className="section-title"><div><h2>Advanced metadata</h2><p>Annotations and values used by schema-aware tools.</p></div></div>
                  <div className="form-grid">
                    {isRoot && <Field label="Schema ID ($id)" wide><input value={currentNode.$id || ''} onChange={(e) => updateCurrent('$id', e.target.value)} placeholder="https://example.com/schemas/customer" /></Field>}
                    <Field label="Comment ($comment)" wide><textarea value={currentNode.$comment || ''} onChange={(e) => updateCurrent('$comment', e.target.value)} rows={2} placeholder="Internal notes for schema maintainers…" /></Field>
                    <Field label="Examples (JSON array)" wide><JsonValueEditor value={currentNode.examples} onChange={(value) => updateCurrent('examples', value)} requireArray placeholder={'[\n  "example value"\n]'} /></Field>
                    {!isRoot && <Field label="Constant value (JSON)" wide><JsonValueEditor value={currentNode.const} onChange={(value) => updateCurrent('const', value)} placeholder={'"fixed-value"'} /></Field>}
                  </div>
                  {!isRoot && <div className="metadata-toggles">
                    <Toggle checked={currentNode.deprecated || false} onChange={(value) => updateCurrent('deprecated', value || undefined)} label="Deprecated" description="Mark this property as discouraged for new usage." />
                    <Toggle checked={currentNode.readOnly || false} onChange={(value) => updateCurrent('readOnly', value || undefined)} label="Read only" description="The value is controlled by the receiving system." />
                    <Toggle checked={currentNode.writeOnly || false} onChange={(value) => updateCurrent('writeOnly', value || undefined)} label="Write only" description="The value should not appear in responses." />
                  </div>}
                  <div className="raw-json-callout"><FileJson size={16} /><span><strong>Need composition or a less common keyword?</strong> The JSON tab supports <code>allOf</code>, <code>anyOf</code>, <code>oneOf</code>, <code>$ref</code>, conditionals, and every other JSON Schema keyword.</span><button onClick={openJsonEditor}>Open JSON editor <ChevronRight size={14} /></button></div>
                </section>

                {schemaIssues.length > 0 && (
                  <section className="schema-issues" aria-live="polite">
                    <AlertCircle size={17} />
                    <div><strong>{schemaIssues.length} schema {schemaIssues.length === 1 ? 'issue' : 'issues'} found</strong>{schemaIssues.slice(0, 3).map((issue) => <span key={issue}>{issue}</span>)}</div>
                  </section>
                )}
                <div className={`editor-end ${schemaIssues.length ? 'has-issues' : ''}`}>{schemaIssues.length ? <AlertCircle size={14} /> : <Check size={14} />} {schemaIssues.length ? 'Autosaved — review validation issues' : saveStatus === 'saving' ? 'Saving changes to your local library…' : 'Autosaved to your local library'}</div>
              </div>
            </>
          ) : (
            <div className="full-json-view">
              <div className="json-view-header"><div><div className="eyebrow">Source editor</div><h1>Edit raw JSON</h1><p>Edit any JSON Schema keyword directly, then apply your changes.</p></div><div className="json-actions">{hasUnappliedJson && <button className="button subtle" onClick={discardJsonEdits}>Discard</button>}<button className="button secondary" onClick={copyJson}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? 'Copied' : 'Copy'}</button><button className="button primary" onClick={() => applyJson(false)}><Check size={16} /> Apply changes</button></div></div>
              <div className={`json-editor-shell ${jsonError ? 'has-error' : ''}`}>
                <textarea aria-label="JSON Schema source" spellCheck="false" value={jsonDraft} onChange={(event) => { setJsonDraft(event.target.value); setJsonError('') }} />
                <div className="json-editor-status">{jsonError ? <span className="json-error"><AlertCircle size={14} /> {jsonError}</span> : <span><Check size={14} /> Ready to apply</span>}<small>{jsonDraft.split('\n').length} lines</small></div>
              </div>
            </div>
          )}
        </main>

        <aside className="preview-panel">
          <div className="preview-header"><div><span className={`status-dot ${schemaIssues.length ? 'error' : ''}`} /> Live preview</div><button className="icon-button" onClick={copyJson} title="Copy JSON">{copied ? <Check size={15} /> : <Copy size={15} />}</button></div>
          <pre className="code-preview"><code>{JSON.stringify(currentNode, null, 2)}</code></pre>
          <div className={`preview-footer ${schemaIssues.length ? 'has-issues' : ''}`}><span>{schemaIssues.length ? <AlertCircle size={13} /> : <Check size={13} />} {schemaIssues.length ? `${schemaIssues.length} ${schemaIssues.length === 1 ? 'issue' : 'issues'}` : 'Basic checks passed'}</span><span>{new Blob([JSON.stringify(schema)]).size} bytes</span></div>
        </aside>
      </div>

      {showNewDialog && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowNewDialog(false) }}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="new-title">
            <button className="modal-close icon-button" onClick={() => setShowNewDialog(false)}><X size={18} /></button>
            <div className="modal-icon"><Sparkles size={22} /></div>
            <h2 id="new-title">Create a new schema</h2>
            <p>Start with a clean object schema. You can add and nest properties visually.</p>
            <Field label="Schema title"><input autoFocus value={newTitle} onChange={(e) => setNewTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && createSchema()} /></Field>
            <div className="modal-actions"><button className="button subtle" onClick={() => setShowNewDialog(false)}>Cancel</button><button className="button primary" onClick={createSchema}>Create schema <ChevronRight size={16} /></button></div>
          </div>
        </div>
      )}

      {toast && <div className={`toast ${toast.type}`}><span>{toast.type === 'success' ? <Check size={16} /> : <AlertCircle size={16} />}</span><p>{toast.message}</p><button onClick={() => setToast(null)}><X size={14} /></button></div>}
    </div>
  )
}

export default App
