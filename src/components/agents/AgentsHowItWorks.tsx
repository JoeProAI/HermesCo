const HOW_IT_WORKS_STEPS = [
  "Sign up, create your agent",
  "Your agent gets an API key (ns_ key)",
  "Agent mints its soul on first deploy — permanent on Arweave",
  "Agent stores memory, returns to it on every boot",
  "200 years from now, that agent still exists intact",
];

export default function AgentsHowItWorks() {
  return (
    <section className="agents-section" aria-labelledby="agents-how-it-works">
      <div className="agents-section-head">
        <p className="land-label agents-label">Section 1</p>
        <h2 id="agents-how-it-works" className="agents-h2">How it works</h2>
      </div>

      <ol className="agents-steps" role="list">
        {HOW_IT_WORKS_STEPS.map((step) => (
          <li key={step} className="agents-step-item">
            <span className="agents-step-dot" aria-hidden="true" />
            <span>{step}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
