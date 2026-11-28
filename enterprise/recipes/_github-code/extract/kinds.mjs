// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// What a service is, from its image or name: a data store, a queue, or a service of ours. And
// the protocol a connection string names.

const STORES = /\b(postgres(?:ql)?|postgis|mysql|mariadb|mongo(?:db)?|redis|valkey|memcached|elasticsearch|opensearch|cassandra|scylla|clickhouse|minio|dynamodb|cockroach(?:db)?|couchdb|neo4j|influxdb|timescale(?:db)?|sqlite|mssql|sqlserver|oracle)\b/i
const QUEUES = /\b(kafka|rabbitmq|nats|activemq|pulsar|redpanda|sqs|zookeeper|kinesis|pubsub|nsq|beanstalkd)\b/i

/** service | store | queue, from an image name and the service's own name. */
export function kindOf(image, name = '') {
  const words = `${image ?? ''} ${name}`.replace(/[/:._-]+/g, ' ')
  if (QUEUES.test(words)) return 'queue'
  if (STORES.test(words)) return 'store'
  return 'service'
}

const SCHEMES = {
  postgres: 'sql', postgresql: 'sql', mysql: 'sql', mariadb: 'sql', mssql: 'sql', sqlserver: 'sql',
  mongodb: 'mongo', 'mongodb+srv': 'mongo', redis: 'redis', rediss: 'redis', amqp: 'amqp', amqps: 'amqp',
  kafka: 'kafka', nats: 'nats', http: 'http', https: 'http', grpc: 'grpc', ws: 'ws', wss: 'ws',
}
/** The protocol a value names (postgres://… → sql), or null. */
export function protocolOf(value) {
  const scheme = `${value ?? ''}`.match(/^([a-z][a-z0-9+.-]*):\/\//i)?.[1]?.toLowerCase()
  return scheme ? SCHEMES[scheme] ?? null : null
}

/** The protocol a connection to a service of this kind most likely speaks. */
export function defaultProtocol(kind, image = '') {
  if (kind === 'store') return /redis|valkey|memcached/i.test(image) ? 'redis' : /mongo/i.test(image) ? 'mongo' : /elastic|opensearch/i.test(image) ? 'http' : 'sql'
  if (kind === 'queue') return /kafka|redpanda/i.test(image) ? 'kafka' : /nats/i.test(image) ? 'nats' : 'amqp'
  return null
}
