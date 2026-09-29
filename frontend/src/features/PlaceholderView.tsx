interface PlaceholderViewProps {
  eyebrow: string;
  title: string;
  description: string;
  items: string[];
}

export function PlaceholderView({ eyebrow, title, description, items }: PlaceholderViewProps) {
  return (
    <section className="panel roadmap-panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <h2>{title}</h2>
        </div>
        <span className="badge muted">Migration surface</span>
      </div>
      <p className="roadmap-copy">{description}</p>
      <div className="feature-grid">
        {items.map((item) => (
          <div className="feature-card" key={item}>
            <span className="feature-mark">✓</span>
            <span>{item}</span>
          </div>
        ))}
      </div>
      <div className="notice">
        This page is intentionally reserved in the standalone shell now. The backend feature remains
        available in the fallback Gradio UI until its typed Studio adapter is added.
      </div>
    </section>
  );
}
