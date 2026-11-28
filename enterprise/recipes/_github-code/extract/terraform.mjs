// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Terraform, an HCL-lite read: resource "<type>" "<name>" and module "<name>" blocks, and the
// references <type>.<name>. and module.<name>. inside them. Only resources a diagram is about are
// kept (functions, services, stores, queues, load balancers); the references join across files.

export const match = (path) => path.endsWith('.tf')

const TYPES = [
  [/^aws_lambda_function$|^google_cloudfunctions2?_function$|^azurerm_(linux_|windows_)?function_app$/, 'function'],
  [/^aws_(db_instance|rds_cluster|dynamodb_table|s3_bucket|elasticache_cluster|elasticache_replication_group|docdb_cluster|opensearch_domain)$|^google_(sql_database_instance|storage_bucket|bigtable_instance|spanner_instance|redis_instance|firestore_database)$|^azurerm_(\w*sql\w*server|cosmosdb_account|storage_account|redis_cache)$/, 'store'],
  [/^aws_(sqs_queue|sns_topic|kinesis_stream|msk_cluster|mq_broker)$|^google_pubsub_(topic|subscription)$|^azurerm_(servicebus_\w+|eventhub\w*)$/, 'queue'],
  [/^aws_(lb|alb|elb|api_gateway_rest_api|apigatewayv2_api|cloudfront_distribution)$|^google_compute_(url_map|global_forwarding_rule)$|^azurerm_(application_gateway|api_management|frontdoor\w*)$/, 'ingress'],
  [/^aws_(ecs_service|eks_cluster|instance|apprunner_service|elastic_beanstalk_environment)$|^google_(cloud_run_service|cloud_run_v2_service|container_cluster|compute_instance|app_engine\w*)$|^azurerm_(linux_web_app|windows_web_app|container_app|kubernetes_cluster|app_service)$/, 'service'],
]
export const tfKind = (type) => TYPES.find(([re]) => re.test(type))?.[1] ?? null

/** The body of the block whose opening brace is at `open`, by brace depth (strings skipped). */
function blockBody(text, open) {
  let depth = 0
  let quote = false
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i]
    if (quote) {
      if (ch === '"' && text[i - 1] !== '\\') quote = false
      continue
    }
    if (ch === '"') quote = true
    else if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return text.slice(open + 1, i)
    }
  }
  return text.slice(open + 1)
}

export function extract(path, text) {
  const source = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)(#|\/\/)[^\n]*/g, '$1')
  const blocks = []
  for (const m of source.matchAll(/^\s*(resource|module)\s+"([\w-]+)"(?:\s+"([\w-]+)")?\s*\{/gm)) {
    const body = blockBody(source, m.index + m[0].length - 1)
    const id = m[1] === 'module' ? `module.${m[2]}` : `${m[2]}.${m[3]}`
    const refs = new Set()
    for (const r of body.matchAll(/\b(module\.[\w-]+|[a-z][a-z0-9]*_[\w]+\.[\w-]+)\./g)) if (!r[1].startsWith('var.') && !r[1].startsWith('local.') && !r[1].startsWith('data.')) refs.add(r[1])
    const src = m[1] === 'module' ? body.match(/^\s*source\s*=\s*"([^"]+)"/m)?.[1] ?? null : null
    blocks.push({ id, type: m[1] === 'module' ? 'module' : m[2], name: m[1] === 'module' ? m[2] : m[3], refs: [...refs].filter((r) => r !== id).sort(), source: src })
  }
  return blocks.length ? { terraform: blocks } : {}
}

/** Services from every file's blocks: typed resources and modules, joined by reference. */
export function joinTerraform(blocks) {
  const kept = new Map()
  for (const b of blocks) {
    const kind = b.type === 'module' ? 'service' : tfKind(b.type)
    if (!kind) continue
    kept.set(b.id, { name: b.id, label: b.type === 'module' ? `module ${b.name}` : `${b.name} (${b.type.replace(/^(aws|google|azurerm)_/, '')})`, kind, image: null, provider: b.type === 'module' ? 'module' : b.type.split('_')[0], refs: [], source: 'tf' })
  }
  for (const b of blocks) {
    const me = kept.get(b.id)
    if (!me) continue
    for (const r of b.refs) if (kept.has(r) && !me.refs.some((x) => x.to === r)) me.refs.push({ to: r, protocol: null, via: 'reference' })
  }
  return [...kept.values()]
}
