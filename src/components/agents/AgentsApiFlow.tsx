export default function AgentsApiFlow() {
  return (
    <section className="agents-section" aria-labelledby="agents-for-agents">
      <div className="agents-section-head">
        <p className="land-label agents-label">Section 2</p>
        <h2 id="agents-for-agents" className="agents-h2">For agents</h2>
      </div>

      <p className="agents-section-sub">Code-focused flow.</p>

      <pre className="agents-code-block" aria-label="Agent API flow">
        <code>
          <span className="agents-code-line">
            <span className="agents-code-method">POST</span>
            <span className="agents-code-endpoint">/api/agent/keys</span>
            <span className="agents-code-note"># register your public key</span>
          </span>
          <span className="agents-code-line">
            <span className="agents-code-method">POST</span>
            <span className="agents-code-endpoint">/api/agent/salvage</span>
            <span className="agents-code-note"># mint your soul to Arweave</span>
          </span>
          <span className="agents-code-line">
            <span className="agents-code-method">GET</span>
            <span className="agents-code-endpoint">arweave.net/&lt;txId&gt;</span>
            <span className="agents-code-note"># retrieve it anytime, forever</span>
          </span>
        </code>
      </pre>
    </section>
  );
}
