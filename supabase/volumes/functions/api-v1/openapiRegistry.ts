import { resourceDefinitions, type ApiFieldType, type ApiResourceDefinition } from './resourceRegistry.ts'

type OpenApiDocument = {
  components: { parameters: Record<string, unknown>; schemas: Record<string, unknown> }
  paths: Record<string, Record<string, any>>
}

const mutationMethods = ['post', 'patch', 'delete'] as const

function methodSet(definition: ApiResourceDefinition) {
  return definition.methods?.map((method) => method.toUpperCase()) ?? (definition.fields.length > 0 ? ['GET', 'POST', 'PATCH', 'DELETE'] : ['GET'])
}

function permission(definition: ApiResourceDefinition, action: string) {
  if (definition.permissionResource === 'roles') return 'system.roles.manage'
  if (definition.permissionResource === 'permissions') return 'system.permissions.read'
  if (definition.permissionResource === 'audit') return 'system.audit.list'
  return `${definition.domain ?? 'teaching'}.${definition.permissionResource}.${action}`
}

function fieldSchema(type?: ApiFieldType) {
  if (type === 'uuid') return { type: 'string', format: 'uuid', nullable: true }
  if (type === 'integer') return { type: 'integer', nullable: true }
  if (type === 'number') return { type: 'number', nullable: true }
  if (type === 'boolean') return { type: 'boolean', nullable: true }
  if (type === 'array') return { type: 'array', nullable: true, items: {} }
  if (type === 'object') return { type: 'object', nullable: true, additionalProperties: true }
  if (type === 'date') return { type: 'string', format: 'date', nullable: true }
  if (type === 'date-time') return { type: 'string', format: 'date-time', nullable: true }
  return { type: 'string', nullable: true }
}

function requestSchema(definition: ApiResourceDefinition, create: boolean) {
  return {
    type: 'object',
    additionalProperties: false,
    ...(create && definition.required?.length ? { required: definition.required } : {}),
    properties: Object.fromEntries(definition.fields.map((field) => [field, fieldSchema(definition.fieldTypes?.[field])])),
  }
}

function responseSchema() {
  return { '$ref': '#/components/schemas/ApiEnvelope' }
}

function operationId(resource: string, action: string) {
  // Keep compatibility aliases distinct. For example, both `class_sessions`
  // and `class-sessions` are valid routes but must not share an operationId.
  const identifier = resource.replace(/_/g, 'Underscore').replace(/-/g, 'Dash')
  return `${identifier}_${action}`
}

export function applyResourceOpenApi(document: OpenApiDocument, commonErrors: Record<string, unknown>) {
  document.components.parameters.Search = { name: 'search', in: 'query', schema: { type: 'string', maxLength: 200 } }
  for (const [resource, definition] of Object.entries(resourceDefinitions) as [string, ApiResourceDefinition][]) {
    const methods = methodSet(definition)
    const collectionPath = `/${resource}`
    const itemPath = `/${resource}/{id}`
    const collection: Record<string, any> = document.paths[collectionPath] ?? {}
    const item: Record<string, any> = document.paths[itemPath] ?? {}
    if (methods.includes('GET')) {
      const filters = (definition.filterable ?? []).map((field) => ({ name: `filter[${field}]`, in: 'query', schema: fieldSchema(definition.fieldTypes?.[field]) }))
      collection.get = {
        ...collection.get,
        operationId: operationId(resource, 'list'),
        security: [{ bearerAuth: [] }],
        parameters: [
          { '$ref': '#/components/parameters/Limit' },
          { '$ref': '#/components/parameters/Offset' },
          { '$ref': '#/components/parameters/Sort' },
          { '$ref': '#/components/parameters/Search' },
          ...filters,
        ],
        'x-permission': permission(definition, 'list'),
        responses: { '200': { description: `${resource} collection`, content: { 'application/json': { schema: responseSchema() } } }, ...commonErrors },
      }
      item.get = {
        ...item.get,
        operationId: operationId(resource, 'get'),
        security: [{ bearerAuth: [] }],
        'x-permission': permission(definition, 'read'),
        parameters: [{ '$ref': '#/components/parameters/ResourceId' }],
        responses: { '200': { description: `${resource} item`, content: { 'application/json': { schema: responseSchema() } } }, ...commonErrors },
      }
    }
    if (methods.includes('POST')) {
      collection.post = {
        ...collection.post,
        operationId: operationId(resource, 'create'),
        security: [{ bearerAuth: [] }],
        'x-permission': permission(definition, 'create'),
        'x-idempotency-required': true,
        parameters: [{ '$ref': '#/components/parameters/IdempotencyKey' }],
        requestBody: { required: true, content: { 'application/json': { schema: requestSchema(definition, true) } } },
        responses: { '201': { description: `${resource} created`, content: { 'application/json': { schema: responseSchema() } } }, ...commonErrors },
      }
    }
    for (const method of mutationMethods) {
      if (method === 'post') continue
      const upper = method.toUpperCase()
      if (!methods.includes(upper)) continue
      const action = method === 'patch' ? 'update' : 'delete'
      item[method] = {
        ...item[method],
        operationId: operationId(resource, action),
        security: [{ bearerAuth: [] }],
        'x-permission': permission(definition, action),
        'x-idempotency-required': true,
        parameters: [{ '$ref': '#/components/parameters/ResourceId' }, { '$ref': '#/components/parameters/IdempotencyKey' }],
        requestBody: method === 'delete' ? undefined : { required: true, content: { 'application/json': { schema: requestSchema(definition, false) } } },
        responses: { '200': { description: `${resource} ${action}d`, content: { 'application/json': { schema: responseSchema() } } }, ...commonErrors },
      }
    }
    document.paths[collectionPath] = collection
    if (methods.some((method) => ['GET', 'PATCH', 'DELETE'].includes(method))) document.paths[itemPath] = item
  }
}
