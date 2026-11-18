// Vocabularies the rule-based scorer and resume reader share. Every entry is
// lower-case. Aliases map a spelling to its canonical skill so "k8s" in a
// resume and "Kubernetes" in a posting count as the same thing.

/** Canonical skill -> every spelling that means it (the canonical name included). */
export const SKILL_ALIASES: Record<string, string[]> = {
  python: ['python'], java: ['java'], go: ['go', 'golang'], rust: ['rust'], 'c++': ['c++', 'cpp'], c: ['c'],
  'c#': ['c#', 'csharp', '.net', 'dotnet'], javascript: ['javascript', 'js', 'es6'], typescript: ['typescript', 'ts'],
  ruby: ['ruby', 'rails', 'ruby on rails'], php: ['php', 'laravel'], kotlin: ['kotlin'], swift: ['swift'], scala: ['scala'],
  elixir: ['elixir'], haskell: ['haskell'], r: ['r'], sql: ['sql'],
  react: ['react', 'react.js', 'reactjs'], angular: ['angular'], vue: ['vue', 'vue.js', 'vuejs'], 'next.js': ['next.js', 'nextjs'],
  svelte: ['svelte'], 'node.js': ['node', 'node.js', 'nodejs'], django: ['django'], flask: ['flask'], fastapi: ['fastapi'],
  spring: ['spring', 'spring boot'], graphql: ['graphql'], grpc: ['grpc'], rest: ['rest', 'restful', 'rest apis'],
  websockets: ['websockets', 'websocket'], html: ['html', 'html5'], css: ['css', 'css3', 'tailwind', 'sass'],
  postgresql: ['postgres', 'postgresql'], mysql: ['mysql', 'mariadb'], mongodb: ['mongodb', 'mongo'], redis: ['redis'],
  elasticsearch: ['elasticsearch', 'opensearch'], cassandra: ['cassandra'], dynamodb: ['dynamodb'], sqlite: ['sqlite'],
  oracle: ['oracle db', 'oracle database'], snowflake: ['snowflake'], bigquery: ['bigquery'],
  kafka: ['kafka'], rabbitmq: ['rabbitmq'], spark: ['spark', 'apache spark', 'pyspark'], hadoop: ['hadoop'], flink: ['flink'],
  airflow: ['airflow'], dbt: ['dbt'], kubernetes: ['kubernetes', 'k8s'], docker: ['docker', 'containers'], terraform: ['terraform'],
  ansible: ['ansible'], helm: ['helm'], aws: ['aws', 'amazon web services', 'ec2', 's3', 'lambda'], gcp: ['gcp', 'google cloud'],
  // "github.com/…" in a contact line is not a skill claim, so only the bare word counts.
  azure: ['azure'], linux: ['linux', 'unix'], git: ['git'],
  'ci/cd': ['ci/cd', 'ci cd', 'jenkins', 'github actions', 'continuous integration'],
  prometheus: ['prometheus'], grafana: ['grafana'], datadog: ['datadog'],
  observability: ['observability', 'monitoring', 'tracing', 'opentelemetry'],
  'distributed systems': ['distributed systems', 'distributed system'], microservices: ['microservices', 'microservice'],
  'system design': ['system design', 'architecture'],
  networking: ['networking', 'tcp/ip', 'tcp', 'dns', 'http', 'bgp', 'load balancing'],
  security: ['security', 'appsec', 'infosec', 'cryptography', 'oauth', 'iam'],
  'machine learning': ['machine learning', 'ml', 'deep learning'], pytorch: ['pytorch', 'torch'], tensorflow: ['tensorflow', 'keras'],
  llm: ['llm', 'llms', 'large language models', 'generative ai', 'genai', 'rag'], nlp: ['nlp', 'natural language processing'],
  'computer vision': ['computer vision', 'opencv'], pandas: ['pandas', 'numpy', 'scikit-learn', 'sklearn'],
  'data engineering': ['data engineering', 'etl', 'data pipelines', 'data pipeline'],
  'data analysis': ['data analysis', 'analytics', 'tableau', 'power bi', 'looker'],
  android: ['android'], ios: ['ios', 'swiftui', 'objective-c'], 'react native': ['react native'], flutter: ['flutter', 'dart'],
  embedded: ['embedded', 'firmware', 'rtos'], kernel: ['kernel', 'device drivers'],
  dpdk: ['dpdk', 'packet processing', 'dataplane', 'data plane'],
  testing: ['testing', 'unit testing', 'test automation', 'selenium', 'cypress', 'playwright', 'pytest', 'jest'],
  agile: ['agile', 'scrum'], 'product management': ['product management', 'roadmap'], figma: ['figma', 'sketch'],
  blockchain: ['blockchain', 'solidity', 'web3', 'smart contracts'], payments: ['payments', 'payment systems', 'fintech'],
  'on-call': ['on-call', 'oncall', 'incident response'],
}

/** Spelling -> canonical skill. */
export const SKILL_LOOKUP: Map<string, string> = new Map(
  Object.entries(SKILL_ALIASES).flatMap(([canon, spellings]) => spellings.map((s) => [s, canon] as [string, string])),
)

/** Domains a resume or posting can be tagged with, by phrases that signal them. */
export const DOMAIN_SIGNALS: Record<string, string[]> = {
  'backend services': ['backend', 'back-end', 'server-side', 'apis'],
  frontend: ['frontend', 'front-end', 'ui engineering', 'web ui'],
  'distributed systems': ['distributed systems', 'high availability', 'low latency', 'scalab'],
  'platform infrastructure': ['platform', 'infrastructure', 'devops', 'sre', 'site reliability', 'cloud infrastructure'],
  'data engineering': ['data engineering', 'data pipeline', 'etl', 'data warehouse', 'lakehouse'],
  'machine learning': ['machine learning', 'deep learning', 'model training', 'llm'],
  security: ['security', 'appsec', 'threat', 'vulnerab'],
  mobile: ['mobile', 'android', 'ios app'],
  networking: ['networking', 'network engineer', 'tcp', 'cdn', 'edge network'],
  'payments and fintech': ['payments', 'fintech', 'banking', 'ledger', 'trading'],
  'developer tools': ['developer tools', 'devtools', 'developer experience', 'sdk'],
  'embedded systems': ['embedded', 'firmware', 'kernel', 'hardware'],
}

/**
 * Seniority on one scale, for both postings and candidates:
 * 1 intern/new grad, 2 junior, 3 mid, 4 senior, 5 staff and above, 6 management.
 */
export const LEVEL_NAMES = ['', 'intern', 'junior', 'mid-level', 'senior', 'staff-level', 'management'] as const

const LEVEL_PATTERNS: [RegExp, number][] = [
  [/\b(intern|internship|apprentice|trainee|co-op|new\s*grad|graduate|entry[\s-]level|campus)\b/i, 1],
  [/\b(junior|jr\.?|associate|engineer\s+i|software\s+engineer\s+1)\b/i, 2],
  [/\b(vp|vice\s+president|director|head\s+of|chief|cto|ceo|manager|management|engineering\s+lead)\b/i, 6],
  [/\b(staff|principal|distinguished|fellow|architect|tech\s+lead|technical\s+lead|lead\s+(?:software\s+)?engineer)\b/i, 5],
  [/\b(senior|sr\.?|sde\s*(?:iii|3)|engineer\s+iii|software\s+engineer\s+3)\b/i, 4],
]

/** Level implied by a title, or null when it says nothing about level. */
export function titleLevel(title: string): number | null {
  for (const [re, level] of LEVEL_PATTERNS) {
    if (re.test(title)) return level
  }
  if (/\b(ii|2)\b/i.test(title) && /\b(engineer|developer|sde|analyst|scientist)\b/i.test(title)) return 3
  return null
}

/** Level from a candidate's stated seniority word or, failing that, years. */
export function candidateLevel(seniority: string | null | undefined, years: number | null | undefined): number | null {
  const s = (seniority ?? '').toLowerCase()
  if (/intern|new[\s-]?grad|graduate|entry/.test(s)) return 1
  if (/junior/.test(s)) return 2
  if (/\bmid/.test(s)) return 3
  if (/senior/.test(s)) return 4
  if (/staff|principal|lead|architect/.test(s)) return 5
  if (/manager|director|head/.test(s)) return 6
  if (years == null) return null
  if (years < 1) return 1
  if (years < 2) return 2
  if (years < 5) return 3
  if (years < 8) return 4
  return 5
}

const SKILL_DISPLAY: Record<string, string> = {
  go: 'Go', 'c++': 'C++', c: 'C', 'c#': 'C#', javascript: 'JavaScript', typescript: 'TypeScript', php: 'PHP', sql: 'SQL',
  'next.js': 'Next.js', 'node.js': 'Node.js', fastapi: 'FastAPI', graphql: 'GraphQL', grpc: 'gRPC', rest: 'REST',
  websockets: 'WebSockets', html: 'HTML', css: 'CSS', postgresql: 'PostgreSQL', mysql: 'MySQL', mongodb: 'MongoDB',
  elasticsearch: 'Elasticsearch', dynamodb: 'DynamoDB', sqlite: 'SQLite', bigquery: 'BigQuery', rabbitmq: 'RabbitMQ',
  dbt: 'dbt', 'ci/cd': 'CI/CD', aws: 'AWS', gcp: 'GCP', datadog: 'Datadog', pytorch: 'PyTorch', tensorflow: 'TensorFlow',
  llm: 'LLMs', nlp: 'NLP', ios: 'iOS', dpdk: 'DPDK', 'on-call': 'on-call',
}

/** The human spelling of a canonical skill: "postgresql" -> "PostgreSQL", "data engineering" -> "Data Engineering". */
export function displaySkill(canonical: string): string {
  return SKILL_DISPLAY[canonical] ?? canonical.replace(/\b[a-z]/g, (ch) => ch.toUpperCase())
}
