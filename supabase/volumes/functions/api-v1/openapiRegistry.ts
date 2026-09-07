import { resourceDefinitions, type ApiResourceDefinition } from './resourceRegistry.ts'

type OpenApiDocument = {
  components: { parameters: Record<string, unknown>; schemas: Record<string, unknown> }
  paths: Record<string, Record<string, any>>
}

const mutationMethods = ['post', 'patch', 'delete'] as const

function methodSet(definition: ApiResourceDefinition) {
  if (definition.methods) return definition.methods.map((method) => method.toUpperCase())
  return definition.fields.length > 0 ? ['GET', 'POST', 'PATCH', 'DELETE'] : ['GET']
}

function permission(definition: ApiResourceDefinition, action: string) {
  return `${definition.domain ?? 'teaching'}.${definition.permissionResource}.${action}`
}

function responseSchema() {
  return { '$ref': '#/components/schemas/ApiEnvelope' }
}

function requestSchema(definition: ApiResourceDefinition) {
  return {
    type: 'object',
    additionalProperties: false,
    properties: Object.fromEntries(definition.fields.map((field) => [field, {}])),
  }
}

export function applyResourceOpenApi(document: OpenApiDocument, commonErrors: Record<string, unknown>) {
  document.components.parameters.Search = { name: 'search', in: 'query', schema: { type: 'string', maxLength: 200 } }
  for (const [resource, definition] of Object.entries(resourceDefinitions)) {
    const methods = methodSet(definition)
    const collectionPath = `/${resource}`
    const itemPath = `/${resource}/{id}`
    const collection: Record<string, any> = document.paths[collectionPath] ?? {}
    const item: Record<string, any> = document.paths[itemPath] ?? {}
    if (methods.includes('GET')) {
      collection.get = {
        ...collection.get,
        parameters: [
          { '$ref': '#/components/parameters/Limit' },
          { '$ref': '#/components/parameters/Offset' },
          { '$ref': '#/components/parameters/Sort' },
          { '$ref': '#/components/parameters/Search' },
        ],
        'x-permission': permission(definition, 'list'),
        responses: { '200': { description: `${resource} collection`, content: { 'application/json': { schema: responseSchema() } } }, ...commonErrors },
      }
      item.get = {
        ...item.get,
        'x-permission': permission(definition, 'read'),
        responses: { '200': { description: `${resource} item`, content: { 'application/json': { schema: responseSchema() } } }, ...commonErrors },
      }
    }
    if (methods.includes('POST')) {
      collection.post = {
        ...collection.post,
        'x-permission': permission(definition, 'create'),
        'x-idempotency-required': true,
        parameters: [{ '$ref': '#/components/parameters/IdempotencyKey' }],
        requestBody: { required: true, content: { 'application/json': { schema: requestSchema(definition) } } },
        responses: { '201': { description: `${resource} created`, content: { 'application/json': { schema: responseSchema() } } }, ...commonErrors },
      }
    }
    for (const method of mutationMethods) {
      const upper = method.toUpperCase()
      if (!methods.includes(upper)) continue
      item[method] = {
        ...item[method],
        'x-permission': permission(definition, method),
        'x-idempotency-required': true,
        parameters: [{ '$ref': '#/components/parameters/IdempotencyKey' }],
        requestBody: method === 'delete' ? undefined : { required: true, content: { 'application/json': { schema: requestSchema(definition) } } },
        responses: { '200': { description: `${resource} ${method}d`, content: { 'application/json': { schema: responseSchema() } } }, ...commonErrors },
      }
    }
    document.paths[collectionPath] = collection
    document.paths[itemPath] = item
  }
}
