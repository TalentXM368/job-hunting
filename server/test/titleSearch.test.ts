// Ported from tests/test_search.py: same inputs, same expected results.

import { describe, expect, it } from 'vitest'
import { matchesTargetTitle, titleSearch } from '../src/lib/titleSearch.js'

const job = (title: string, description = 'Go') => ({ title, description })
const titles = (jobs: { title: string }[]) => jobs.map((j) => j.title)

describe('titleSearch', () => {
  it('an empty query filters nothing and reports mode "all"', () => {
    const jobs = [job('Backend Engineer'), job('SDE II')]
    expect(titleSearch(jobs, '')).toEqual({ jobs, mode: 'all' })
    expect(titleSearch(jobs, '  ?! ').mode).toBe('all')
  })

  it('an exact title query returns only that title', () => {
    const res = titleSearch([job('Backend Engineer'), job('SDE II'), job('Frontend Engineer')], 'Backend Engineer')
    expect(titles(res.jobs)).toEqual(['Backend Engineer'])
    expect(res.mode).toBe('exact')
  })

  it('does not match a partial word', () => {
    expect(titleSearch([job('JavaScript Engineer')], 'Java').jobs).toEqual([])
  })

  it('"python developer" does not match unrelated engineering roles', () => {
    const jobs = [
      job('Python Developer', 'Python backend role'),
      job('Infrastructure Engineer', 'Python automation for cloud infra'),
      job('Platform Engineer', 'Python for tooling'),
    ]
    expect(titles(titleSearch(jobs, 'python developer').jobs)).toEqual(['Python Developer'])
  })

  it('"developer" matches an "engineer" title, but not through the description', () => {
    const jobs = [
      job('Python Engineer', 'Python backend role'),
      job('Infrastructure Engineer', 'We are looking for a Python Developer.'),
    ]
    expect(titles(titleSearch(jobs, 'python developer').jobs)).toEqual(['Python Engineer'])
  })

  it('"AIML Engg" matches AI/ML titles only', () => {
    const jobs = [
      job('AI/ML Engineer', 'Build ML systems'),
      job('Machine Learning Engineer', 'Train models'),
      job('Platform Engineer', 'AI systems for infra'),
      job('Python Developer', 'Python backend role'),
    ]
    expect(titles(titleSearch(jobs, 'AIML Engg').jobs)).toEqual(['AI/ML Engineer', 'Machine Learning Engineer'])
  })

  it('a title hit wins over description-only mentions', () => {
    const jobs = [
      job('Python Developer', 'Python backend role'),
      job('IT Software Engineer, Infrastructure', 'We are looking for a Python Developer to build infrastructure automation.'),
      job('API Developer', 'We are looking for a Python Developer to work on our API platform.'),
      job('Platform Engineer', 'Python for tooling'),
    ]
    expect(titles(titleSearch(jobs, 'python developer').jobs)).toEqual(['Python Developer'])
  })

  it('description-only matches are labelled related, never exact', () => {
    const jobs = [
      job('IT Software Engineer, Infrastructure', 'We are looking for a Python Developer to build infrastructure automation.'),
      job('Platform Engineer', 'Python Developer role supporting platform tooling.'),
    ]
    const res = titleSearch(jobs, 'python developer')
    expect(res.mode).toBe('related')
    expect(res.jobs).toHaveLength(2)
  })

  it('the related tier prefers roles whose description mentions the skill', () => {
    const jobs = [
      job('Frontend Engineer', 'React and TypeScript only.'),
      job('Backend Engineer, Payments', 'Python services. Python testing. Python tooling.'),
      job('Infrastructure Engineer', 'Go and Python for automation.'),
      job('Engineering Manager', 'Lead a team shipping Java.'),
    ]
    const res = titleSearch(jobs, 'python developer')
    expect(res.mode).toBe('related')
    expect(titles(res.jobs)).toEqual(['Backend Engineer, Payments', 'Infrastructure Engineer'])
  })

  it('the related tier falls back to every same-family role when none mention the skill', () => {
    const res = titleSearch([job('Frontend Engineer', 'React'), job('Platform Engineer', 'Go')], 'python developer')
    expect(res.mode).toBe('related')
    expect(res.jobs).toHaveLength(2)
  })

  it('a shared role word alone is not a fuzzy match', () => {
    const jobs = [
      job('Capacity Engineer', 'Go and networking.'),
      job('Research Engineer', 'C++ and CUDA.'),
      job('Frontend Engineer', 'React and TypeScript.'),
    ]
    const res = titleSearch(jobs, 'react engineer')
    expect(res.mode).toBe('related')
    expect(titles(res.jobs)).toEqual(['Frontend Engineer'])
  })

  it('the fuzzy tier tolerates typos', () => {
    const res = titleSearch([job('Backend Engineer'), job('Frontend Engineer'), job('Data Analyst')], 'backnd enginer')
    expect(res.mode).toBe('fuzzy')
    expect(titles(res.jobs)).toEqual(['Backend Engineer'])
  })

  it('the fuzzy tier matches most of a longer query', () => {
    const res = titleSearch([job('Backend Engineer'), job('Data Analyst')], 'backend python engineer')
    expect(res.mode).toBe('fuzzy')
    expect(titles(res.jobs)).toEqual(['Backend Engineer'])
  })

  it('exact matches are not diluted by fuzzy ones', () => {
    const res = titleSearch([job('Backend Engineer'), job('Backend Enginer Intern')], 'backend engineer')
    expect(res.mode).toBe('exact')
    expect(titles(res.jobs)).toEqual(['Backend Engineer'])
  })

  it('"SDE" with no SDE titles falls back to software engineer roles', () => {
    const res = titleSearch([job('Software Engineer II'), job('Data Analyst')], 'SDE')
    expect(['fuzzy', 'related']).toContain(res.mode)
    expect(titles(res.jobs)).toEqual(['Software Engineer II'])
  })

  it('the SDE alias matches the spelled-out title but not an embedded substring', () => {
    expect(titleSearch([job('SDEvelopment Engineer')], 'SDE').jobs).toEqual([])
    const res = titleSearch([job('Software Development Engineer, Core Infra'), job('Data Analyst')], 'sde')
    expect(res.mode).toBe('exact')
    expect(titles(res.jobs)).toEqual(['Software Development Engineer, Core Infra'])
  })

  it('a query with no role word searches the description too', () => {
    const jobs = [job('Platform Engineer', 'We use Kafka heavily.'), job('Data Analyst', 'SQL')]
    const res = titleSearch(jobs, 'kafka')
    expect(res.mode).toBe('exact')
    expect(titles(res.jobs)).toEqual(['Platform Engineer'])
    expect(titleSearch(jobs, 'cobol')).toEqual({ jobs: [], mode: 'none' })
  })
})

describe('matchesTargetTitle', () => {
  it('accepts a title that has every word of a target, in any order', () => {
    expect(matchesTargetTitle('Software Engineer, Backend', ['Backend Engineer'])).toBe(true)
    expect(matchesTargetTitle('Senior Backend Developer', ['Backend Engineer'])).toBe(true)
    expect(matchesTargetTitle('Software Development Engineer, Core Infra', ['SDE'])).toBe(true)
  })

  it('rejects titles missing a word, and partial words', () => {
    expect(matchesTargetTitle('Frontend Engineer', ['Backend Engineer'])).toBe(false)
    expect(matchesTargetTitle('JavaScript Engineer', ['Java Engineer'])).toBe(false)
    expect(matchesTargetTitle('Backend Engineer', [])).toBe(false)
    expect(matchesTargetTitle('Backend Engineer', ['  '])).toBe(false)
  })
})
