const AGENT_PROFILES = [
  { tier: "Base", price: "Invite", period: null, operations: "core chat and memory" },
  { tier: "Extended", price: "Invite", period: null, operations: "sandbox and channel connectors" },
  { tier: "Full", price: "Invite", period: null, operations: "all capabilities and recovery tooling" },
];

export default function AgentsPricingTable() {
  return (
    <section className="agents-section" aria-labelledby="agents-pricing">
      <div className="agents-section-head">
        <p className="land-label agents-label">Section 3</p>
        <h2 id="agents-pricing" className="agents-h2">Access Profiles</h2>
      </div>

      <div className="agents-pricing-grid" role="list">
        {AGENT_PROFILES.map((plan) => (
          <article key={plan.tier} className="agents-price-col" role="listitem">
            <p className="agents-price-tier">{plan.tier}</p>
            <p className="agents-price-amt">
              {plan.price}
              {plan.period && <span>{plan.period}</span>}
            </p>
            <p className="agents-price-ops">{plan.operations}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
