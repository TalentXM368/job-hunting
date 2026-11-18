import { NavLink } from 'react-router-dom'

// Link-based tabs so the open tab lives in the URL and can be shared.
// items: [{ to, label, count?, end? }]
export default function Tabs({ items, label }) {
  return (
    <nav className="rc-tabs" aria-label={label}>
      {items.map((item) => (
        <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `rc-tab ${isActive ? 'active' : ''}`}>
          {item.label}
          {item.count ? <span className="jh-chip-count">{item.count}</span> : null}
        </NavLink>
      ))}
    </nav>
  )
}
