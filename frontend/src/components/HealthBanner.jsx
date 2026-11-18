import { useHealth } from '../healthContext'
import Notice from './Notice'

// Tells the recruiter up front what the LLM is and is not doing, instead of
// letting them find out from a button. Rules and templates always work.
export default function HealthBanner() {
  const { health, error } = useHealth()

  if (error) {
    return <Notice tone="error" className="rc-banner">Could not read the server status: {error}</Notice>
  }
  if (!health?.llm) return null

  const { configured, scorer } = health.llm
  if (!configured) {
    return (
      <Notice tone="info" className="rc-banner">
        No LLM key configured. Matching, resume reading and kits run on rules and templates; the AI verification, extraction and drafting buttons are off.
      </Notice>
    )
  }
  if (scorer === 'rules') {
    return (
      <Notice tone="info" className="rc-banner">
        Scoring mode is rules only: matches are never sent to the LLM unless you ask for AI verification on a run.
      </Notice>
    )
  }
  return null
}
