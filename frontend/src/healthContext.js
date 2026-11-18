import { createContext, useContext } from 'react'

// { health, error, reload }. `health` is the body of GET /api/health, or null
// until it loads. Provided once by App so pages do not each refetch it.
export const HealthContext = createContext({ health: null, error: null, reload: () => {} })

export function useHealth() {
  return useContext(HealthContext)
}
