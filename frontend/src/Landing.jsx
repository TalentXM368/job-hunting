import Logo from './Logo'
import { COMPANY, PRODUCTS } from './products'

function ProductCard({ product }) {
  const ready = Boolean(product.href)
  const inner = (
    <>
      <div className="lp-icon">{product.initials}</div>
      <h2>{product.name}</h2>
      <p>{product.description}</p>
      <span className={ready ? 'lp-cta' : 'lp-cta lp-cta-muted'}>
        {ready ? 'Open product' : 'Link pending'}
      </span>
    </>
  )

  if (!ready) {
    return <article className="lp-card lp-card-static">{inner}</article>
  }

  const internal = product.href.startsWith('#')
  return (
    <a
      className="lp-card"
      href={product.href}
      target={internal ? undefined : '_blank'}
      rel={internal ? undefined : 'noreferrer'}
    >
      {inner}
    </a>
  )
}

export default function Landing() {
  return (
    <div className="lp">
      <header className="lp-nav">
        <div className="lp-nav-inner">
          <a className="lp-brand" href="#/">
            <Logo />
            <span className="lp-brand-name">{COMPANY.name}</span>
          </a>
          <a className="lp-nav-link" href="#products">
            Products
          </a>
        </div>
      </header>

      <main className="lp-main">
        <div className="lp-wrap">
          <section className="lp-hero">
            <p className="lp-kicker">{COMPANY.name}</p>
            <h1>{COMPANY.tagline}</h1>
            <p>Open SourcingXM or Job Hunting to get started.</p>
          </section>

          <section id="products">
            <h2 className="lp-section-title">Products</h2>
            <div className="lp-grid">
              {PRODUCTS.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          </section>
        </div>
      </main>

      <footer className="lp-footer">
        <div className="lp-wrap">{COMPANY.name}</div>
      </footer>
    </div>
  )
}
