// HermesCo - core domain types.
// An autonomous Hermes agent that EARNS and SPENDS under a human-in-the-loop
// Treasury with hard caps, so the business can never lose money.

export type ProposalType = "earn" | "spend";

// Ledger entries also record human capital deposits (real money funding the
// Treasury), which are not agent proposals.
export type LedgerType = ProposalType | "deposit";

export type ProposalStatus =
  | "pending" // awaiting human decision
  | "approved" // human approved, about to execute
  | "denied" // human (or policy) rejected
  | "executed" // money moved (or recorded)
  | "failed"; // execution failed / refused by a hard cap

export type RiskLevel = "safe" | "review" | "blocked";

export interface Proposal {
  id: string;
  workspaceId: string;
  type: ProposalType;
  title: string;
  description: string;
  amountUsd: number; // positive magnitude
  counterparty: string; // customer (earn) or vendor (spend)
  status: ProposalStatus;
  autoApproved: boolean;
  risk: RiskLevel;
  safetyReason: string;
  stripeRef?: string; // payment link url / payment intent id
  stripeKind?: string; // "payment_link" | "payment_intent"
  createdAt: number;
  decidedAt?: number;
  decidedBy?: string; // "policy" | "human"
  executedAt?: number;
  error?: string;
}

export interface LedgerEntry {
  id: string;
  workspaceId: string;
  proposalId?: string;
  type: LedgerType;
  amountUsd: number; // signed: earn/deposit positive, spend negative
  description: string;
  stripeRef?: string;
  at: number;
}

// The hard caps - the "can't lose money" guarantee. Enforced at execution time,
// not just at proposal time, so even a human-approved move cannot breach them.
export interface Budget {
  startingCapitalUsd: number;
  maxSpendPerActionUsd: number; // single-spend hard cap (inviolable)
  autoApproveUnderUsd: number; // spends strictly below this auto-approve
  dailySpendCapUsd: number; // total spend per day hard cap
  minReserveUsd: number; // balance may never drop below this
}

export interface TreasuryState {
  workspaceId: string;
  budget: Budget;
  balanceUsd: number; // deposits + revenue - expense
  depositsUsd: number; // sum of human capital deposits
  revenueUsd: number; // sum of earns (money the agent made)
  expenseUsd: number; // sum of spends (magnitude)
  netProfitUsd: number; // revenue - expense (deposits are capital, not profit)
  spentTodayUsd: number;
  pendingCount: number;
  proposals: Proposal[]; // newest first
  ledger: LedgerEntry[]; // newest first
  stripeMode: "test" | "live" | "none";
  backend: "convex" | "memory"; // durable Convex store vs in-process fallback
}

// A Job is the unit of real work HermesCo sells. A customer (a person, or
// another agent) brings a brief; HermesCo quotes it (Stripe payment link), takes
// real payment, spends real compute (under the hard caps, Nemotron-screened) to
// provision a Fly machine, runs the real job on it, returns the real deliverable,
// and books profit = price minus compute cost. Nothing here is simulated.
export type JobStatus =
  | "quoted" // payment link created, awaiting the customer's payment
  | "paid" // customer paid, revenue credited, ready to fulfill
  | "delivering" // running on the agent's Fly machine right now
  | "delivered" // real deliverable returned, compute cost booked
  | "failed"; // execution failed or a hard cap refused the compute spend

export interface Job {
  id: string; // job_xxxx
  workspaceId: string;
  service: string; // service catalog key (see services.ts)
  serviceName: string; // human label snapshot
  brief: string; // the customer's task spec (a URL, a repo, a script, ...)
  priceUsd: number;
  paymentLinkId: string; // Stripe payment link id (plink_...)
  paymentLinkUrl: string; // shareable buy.stripe.com link
  status: JobStatus;
  customer?: string; // email Stripe confirms paid the link
  stripeSessionId?: string; // the paid Checkout session
  spendProposalId?: string; // the Treasury proposal that paid for compute
  machineId?: string; // Fly machine (or Daytona sandbox) that did the work
  computeCostUsd?: number; // real compute booked as a Treasury spend
  deliverable?: string; // the real output (stdout / artifact summary)
  artifactPath?: string; // path to the artifact on the machine
  createdAt: number;
  paidAt?: number;
  deliveredAt?: number;
  error?: string;
}

export type AgentEventKind =
  | "thought"
  | "tool_call"
  | "tool_result"
  | "message"
  | "proposal"
  | "awaiting_approval"
  | "error";

export interface AgentEvent {
  kind: AgentEventKind;
  text?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  proposalId?: string;
  at: number;
}

export interface AgentTurnResult {
  events: AgentEvent[];
  assistant: string; // final message to the human ("" if paused for approval)
  awaitingApproval: boolean;
  state: TreasuryState;
}
