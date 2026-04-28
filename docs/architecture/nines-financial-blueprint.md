NINES Financial System Specification
Sections:
1. Purpose and Boundaries
2. Assumptions and Out-of-Scope
3. Glossary and Canonical Terms
4. Non-Negotiable Invariants
5. Domain Breakdown
6. Roles and Permissions
7. Account Model
8. Entity State Machines and Lifecycle Rules
9. Command Catalogue
10. Endpoint Catalogue
11. Event Catalogue and Async Contracts
12. Core Money Flows
13. DB Schema
14. Response Contracts and DTOs
15. Error Model
16. API / Service Boundaries
17. Security and Trust Boundaries
18. Failure Rules and Idempotency
19. Observability, Audit, and Reconciliation
20. Test Strategy and Required Coverage
21. Implementation Phases
22. Acceptance Criteria
This document defines the complete architecture, rules, and operational model for the NINES financial
system. Each section has been designed to ensure financial correctness, safety, auditability, and
scalability.
(Full detailed content should be pasted here if needed for final production use.)
1. Purpose and Boundaries
Purpose
nines-financial is the authoritative financial system for the Nines platform.
Its purpose is to manage, record, and enforce all money-related state and
transitions across:
• user wallets
• deposits and withdrawals
• bet placement and exposure
• parimutuel betting pools
• race settlement and payout distribution
• financial audit and reconciliation
This service guarantees that:
• every balance is explainable
• every financial action is traceable
• every payout is reproducible
• every state transition is controlled and validated
All financial state within Nines must originate from and be governed by this service.
Core Financial Model
The system is built on three foundational principles:
1. Ledger-backed accounting
All financial activity must be recorded through an append-only ledger model.
Balances must never be mutated directly.
2. Pool-based betting (parimutuel)
All bets are placed into shared pools per race and selection.
Payouts are determined by total pool distribution, not fixed odds.
3. Internal value representation
All internal financial values are represented in a consistent unit (USDC-
denominated minor units), regardless of external asset origin.
Primary Responsibilities
nines-financial owns and enforces the following:
1. Wallet and Balance Authority
• Maintain user balances (available, locked, pending where applicable)
• Ensure balances are derived from financial records
• Prevent invalid or inconsistent balance states
2. Ledger and Posting Engine
• Record all financial transactions using a structured ledger model
• Enforce balanced postings (debits = credits)
• Provide full auditability of all financial activity
3. Parimutuel Pool Management
• Create and manage pools per race
• Track total stake per selection
• Track total pool size
• Handle pool lifecycle:
• open
• frozen (betting closed)
• settled
• voided
4. Bet Intake and Exposure Accounting
• Validate and accept bets
• Lock user funds on bet placement
• Record bet participation in pools
• Track exposure per user and per pool
5. Settlement and Payout Distribution
• Consume final race results from the authorised race service
• Identify winning pool(s)
• Calculate:
• total pool
• house take
• distributable pool
• payout ratios
• Distribute winnings proportionally to bettors
• Handle:
• losing bets
• refunds
• void scenarios
• rounding rules and residual handling
6. Deposit Lifecycle Management
• Handle deposit intent creation
• Track external transaction references
• Confirm deposits after verification
• Credit internal balances through ledger postings
7. Withdrawal Lifecycle Management
• Handle withdrawal requests
• Enforce balance and state validation
• Manage withdrawal state transitions:
• requested
• approved
• broadcasted
• confirmed
• failed
• Record external transaction references
• Ensure withdrawals are auditable and reversible where applicable
8. External Asset Integration (Chain-Aware Design)
• Accept deposits from supported blockchain networks
• Track confirmations and external references
• Support withdrawal execution through external rails
• Abstract chain-specific logic behind defined boundaries
9. Financial Audit and Reconciliation
• Provide complete financial traceability
• Support reconstruction of balances from ledger history
• Enable reconciliation against external systems (blockchain, treasury)
• Detect and surface inconsistencies
10. Financial APIs for Trusted Services
Expose controlled APIs for:
• backend (betting + race integration)
• admin systems
• treasury operations
No external service may directly mutate financial state.
Explicit Non-Responsibilities
nines-financial must not own or directly implement:
1. Race Simulation and Game Logic
• No race execution
• No event generation
• No winner determination logic
It only consumes final authorised race results.
2. Frontend Rendering
• No UI
• No dashboards
• No user-facing presentation
3. Authentication and Identity
• No login or session management
• No identity provider integration
It trusts upstream authenticated callers.
4. Real-Time Gameplay Systems
• No WebSocket broadcasting
• No race timing loops
• No leaderboard rendering
5. Direct Balance Manipulation
• No admin shortcuts that bypass the ledger
• No manual balance editing
All changes must go through controlled financial flows.
System Position in Nines
The platform is structured as:
• nines-front-end → UI and user interaction
• nines-back-end → race engine and platform logic
• nines-admin → operations and monitoring
• nines-financial → money authority and accounting truth
Other services request financial actions.
Only nines-financial executes them.
Trusted Inputs
This service may accept inputs from:
• authorised backend services (bets, settlement triggers)
• authorised admin systems (approvals, operations)
• treasury systems (deposit confirmations, withdrawal execution updates)
• verified external transaction references
• final race result payloads from the race authority
All inputs must pass:
• validation
• state checks
• idempotency rules
Core Boundary Rule
Only nines-financial may create or modify financial state.
This includes:
• balances
• locked funds
• pool values
• payouts
• ledger records
All other services must treat this repo as the single source of truth.
Architecture Scope Commitments
The system must support:
Parimutuel Betting
• shared pools per race
• proportional payout distribution
• house take calculation
• deterministic settlement outcomes
Chain-Aware Financial Flows
• deposits from external blockchain transactions
• withdrawals to external addresses
• tracking of external transaction references
• adapter boundaries for supporting multiple chains
Implementation Scope vs Architecture Scope
The architecture must support:
• parimutuel pool logic
• chain-aware deposits and withdrawals
Initial implementation phases may:
• support a limited number of chains
• support a single stablecoin
• simplify operational flows
However:
The core design must not prevent future expansion without redesign.
Success Criteria for This Boundary
This repo is correctly scoped when:
• all balances are derived from ledger records
• all bets are reflected in pool accounting
• all payouts can be recomputed from stored data
• no external service can alter balances directly
• race systems can fail without corrupting financial truth
• deposits and withdrawals are fully traceable
• reconciliation between internal and external systems is possible
2.Assumptions and Out-of-Scope
Overview
This section defines:
• core assumptions the system is built on
• constraints for the initial implementation
• features explicitly excluded from the current scope
These boundaries exist to:
• reduce ambiguity
• guide implementation decisions
• prevent overengineering
• ensure consistency across the system
These assumptions may evolve over time, but any change must be intentional and
documented.
1. Core Assumptions
1.1 Internal Accounting Currency
• All internal financial values are represented in USDC-denominated minor
units
• External assets are converted into this internal representation before
aﬀecting balances
This ensures:
• consistent accounting
• simplified ledger logic
• deterministic settlement calculations
1.2 Parimutuel Betting Model
• All bets participate in shared pools per race and selection
• Payouts are calculated based on:
• total pool size
• total stake on winning selection
• house take
There are no fixed odds as final truth.
1.3 Single Authoritative Race Result Source
• Race results are provided by a single trusted race authority
• nines-financial does not determine winners
• Settlement depends entirely on this external input
1.4 Eventual External Settlement
• Deposits and withdrawals interact with external systems (blockchains)
• External confirmation is required before financial eﬀects are final
1.5 System is Event-Driven Compatible
• The system may operate in an event-driven environment
• All commands must be safe under:
• retries
• duplication
• delayed delivery
1.6 Financial State Must Be Reconstructable
• The system must be able to rebuild:
• wallet balances
• pool totals
• settlement outcomes
From stored records alone.
2. Implementation Constraints (Initial Phases)
These are not permanent limitations, but constraints for initial implementation.
2.1 Limited Asset Support
• Initial implementation may support:
• a single stablecoin (USDC)
• a limited set of deposit sources
2.2 Limited Chain Support
• Initial implementation may support:
• a single blockchain network
However:
• the system must be designed to support additional chains later
• chain-specific logic must not leak into the financial core
2.3 Simplified Treasury Operations
• Treasury operations may initially:
• be manual or semi-automated
• rely on trusted inputs
Advanced automation is not required in early phases.
2.4 Single Currency Pooling
• All pools operate in a single internal currency
• No cross-currency pools in initial implementation
2.5 No Advanced Risk or Compliance Systems
• No AML/KYC automation required in initial phase
• No fraud scoring engine required in initial phase
These may be layered later without aﬀecting the core financial model.
3. Explicit Out-of-Scope (Current Phase)
The following are explicitly not part of the current implementation scope.
3.1 Fixed Odds Betting Model
• Fixed odds betting is not supported
• All betting is parimutuel
3.2 Fiat Banking Integration
• No direct fiat deposits or withdrawals
• No banking rails (e.g. SWIFT, local bank APIs)
3.3 Multi-Currency Internal Accounting
• No support for multiple internal currencies
• No FX conversion inside the financial core
3.4 Advanced Treasury Optimisation
• No automated:
• liquidity routing
• yield strategies
• cross-chain arbitrage
• gas optimisation strategies
3.5 Decentralised Custody Logic
• No smart contract custody
• No on-chain betting logic
All accounting remains oﬀ-chain in controlled systems.
3.6 Real-Time Odds Engine
• No requirement for real-time odds calculation exposure
• Pool tracking exists, but real-time odds display is a frontend/backend
concern
3.7 Complex Bet Types
Not supported initially:
• multi-leg bets
• accumulators
• exotic bets (trifecta, exacta, etc.)
Only:
• single selection bets per race
3.8 Cross-Race or Cross-Pool Betting
• Bets are isolated to a single race
• No pooled betting across races
3.9 Manual Balance Overrides
• No admin ability to directly edit balances
• All corrections must go through ledger-backed flows
3.10 Automated Dispute Resolution
• No automated dispute system required in initial phase
• Disputes handled operationally if needed
4. Future-Compatible Design Requirements
Even though some features are out of scope, the system must be designed so that
adding them does not require a full rewrite.
4.1 Multi-Chain Support
• Must be possible to add new chains via adapter pattern
4.2 Additional Assets
• Must be possible to support additional deposit assets
• Internal accounting model must remain consistent
4.3 Expanded Bet Types
• System must not block introduction of:
• multi-leg bets
• pooled bet variants
4.4 Advanced Treasury Layer
• Treasury logic must be separable from financial core
4.5 Compliance Layer
• Must be possible to introduce:
• KYC
• AML checks
• transaction monitoring
Without breaking core flows
5. Guiding Principle
When in doubt:
• prefer simplicity in implementation
• preserve correctness in financial logic
• maintain extensibility at boundaries
3. Glossary and Canonical Terms
Overview
This section defines the canonical terminology used across the nines-financial
system.
All code, documentation, API contracts, database schema, and tests must use
these terms consistently.
If a concept is not defined here:
• it must not be assumed
• it must be clarified before implementation
1. Core Financial Concepts
Wallet
A container representing a user’s financial state within the system.
A wallet does not store balances directly.
Balances are derived from ledger records.
Available Balance
The portion of a wallet that can be used for:
• placing bets
• withdrawals
Available balance must never be negative.
Locked Balance
Funds reserved for active bets.
Locked funds:
• cannot be withdrawn
• cannot be reused
• are released or consumed during settlement
Total Balance
The sum of:
• available balance
• locked balance
Derived from ledger entries.
Ledger
An append-only record of all financial transactions.
The ledger is the source of truth for all financial state.
Ledger Transaction
A grouped financial operation consisting of multiple ledger entries.
Examples:
• bet placement
• deposit credit
• payout distribution
A transaction must always balance.
Ledger Entry
A single debit or credit within a ledger transaction.
Each entry:
• aﬀects one account
• has an amount
• has a direction (debit or credit)
Posting
The act of writing a ledger transaction and its entries.
2. Betting Concepts
Bet
A user’s stake on a specific selection within a race.
A bet includes:
• user reference
• race reference
• selection reference
• stake amount
• status
Stake
The amount of money committed by a user to a bet.
Selection
A specific outcome within a race (e.g. a horse).
Pool
A collection of all stakes for a given race.
Selection Pool
The portion of the total pool associated with a specific selection.
Total Pool
The sum of all valid stakes across all selections in a race.
Pool Lifecycle
The state of a betting pool:
• open (accepting bets)
• frozen (no more bets)
• settled (payouts calculated and applied)
• voided (invalidated and refunded)
3. Parimutuel Concepts
Parimutuel Betting
A betting system where:
• all bets are pooled
• winners share the total pool
• payouts depend on pool distribution
House Take
The percentage of the total pool retained by the platform.
Distributable Pool
Total pool minus house take.
This amount is distributed to winning bettors.
Winning Pool
The selection pool corresponding to the winning outcome.
Payout Ratio
The multiplier applied to a winning stake.
Calculated as:
• distributable pool ÷ total stake on winning selection
Payout
The amount returned to a winning bettor, including stake and profit.
Residual
Any remainder resulting from rounding during payout distribution.
Handled according to defined rules.
4. Settlement Concepts
Settlement
The process of resolving all bets for a race.
Includes:
• determining winners
• calculating payouts
• updating financial state
Settlement Run
A single execution of the settlement process for a race.
Must be idempotent.
Terminal Bet State
Final state of a bet:
• win
• loss
• void
• refunded
5. Deposit Concepts
Deposit
An incoming transfer of value into the system.
Deposit Intent
A record representing a pending deposit before confirmation.
Deposit Confirmation
Verification that an external transfer has occurred and is valid.
External Transaction Reference
A unique identifier from an external system (e.g. blockchain transaction hash).
6. Withdrawal Concepts
Withdrawal
An outgoing transfer of value from the system to an external destination.
Withdrawal Request
A user-initiated request to withdraw funds.
Withdrawal Lifecycle
The states of a withdrawal:
• requested
• approved
• broadcasted
• confirmed
• failed
Destination Address
The external address where funds are sent.
7. System Concepts
Idempotency Key
A unique identifier used to ensure a command is only processed once.
Command
A request to perform a financial action.
Examples:
• place bet
• confirm deposit
• settle race
Event
A record of something that has occurred.
Used for:
• communication between systems
• audit trails
Projection
A derived view of financial data based on ledger entries.
Examples:
• wallet balances
• pool totals
Actor
The entity initiating an action:
• user
• service
• admin
Reference ID
A unique identifier linking:
• commands
• transactions
• external systems
8. Time and Ordering Concepts
Cutoﬀ Time
The point after which bets are no longer accepted for a race.
Timestamp
A recorded point in time for a financial event.
Used for:
• ordering
• audit
• reconstruction
9. Financial Integrity Concepts
Balanced Transaction
A ledger transaction where total debits equal total credits.
Compensating Transaction
A new transaction used to correct a previous one.
Reconciliation
The process of verifying that:
• internal records
match
• external systems
Audit Trail
A complete history of financial activity.
Final Rule
All system components must:
• use these terms consistently
• avoid introducing synonyms
• avoid redefining concepts
If a new concept is introduced:
• it must be added to this glossary
• it must be clearly defined before use
4.Non-Negotiable Invariants
Overview
The following invariants define the fundamental rules of the financial system.
They must always hold true, regardless of:
• feature changes
• refactoring
• scaling
• failures
• retries
• partial outages
No code path, admin action, or system integration may violate these rules.
1. Ledger Integrity
1.1 Balanced Transactions
Every ledger transaction must balance:
• total debits = total credits
If a transaction does not balance:
• it must be rejected
• it must never be persisted
1.2 Append-Only Ledger
• Ledger entries are immutable
• Existing entries must never be updated or deleted
• Corrections must be made via new compensating transactions
1.3 Single Source of Truth
• All balances must be derived from ledger records
• No balance may exist without a corresponding ledger history
2. Balance Safety
2.1 No Direct Balance Mutation
• Wallet balances must never be directly updated
• All changes must flow through ledger postings
2.2 Funds Conservation
Across the system:
• Total funds in = Total funds out + House revenue + Locked funds
No money may be:
• created from nothing
• destroyed silently
2.3 Non-Negative Available Balance
• A user’s available balance must never go below zero
2.4 Locked Funds Protection
• Locked funds cannot be:
• withdrawn
• re-bet
• double-counted
3. Idempotency and Replay Safety
3.1 Idempotent Commands
All externally triggered commands must be idempotent.
Examples:
• placeBet
• confirmDeposit
• settleRace
• createWithdrawal
Repeated execution with the same idempotency key must:
• not duplicate financial eﬀects
• return consistent results
3.2 Deterministic Outcomes
Given the same:
• inputs
• race results
• pool state
The system must always produce the same:
• payouts
• ledger entries
3.3 Safe Retries
• Any operation may be retried safely
• Partial failures must not result in duplicated financial state
4. Parimutuel Pool Integrity
4.1 Pool Isolation
• Each race has its own pool
• Pools must not mix funds across races
4.2 Stake Accuracy
• Total pool = sum of all valid accepted bets
• Per-selection totals must be exact
4.3 Pool Freeze Rule
Once betting closes:
• no new bets may be accepted
• pool totals must not change
4.4 Settlement Finality
Once a pool is settled:
• results must not change
• payouts must not be recalculated
• new bets must not aﬀect the pool
4.5 Payout Conservation
• Total payouts + house take = total valid pool
No overpayment or underpayment is allowed beyond defined rounding rules.
5. Settlement Safety
5.1 Single Settlement Execution
• A race must not be settled more than once
5.2 Settlement Idempotency
• Re-running settlement must not duplicate payouts
5.3 Valid Result Dependency
• Settlement may only occur using authorised final race results
5.4 Complete Resolution
After settlement:
• all bets must be in a terminal state:
• win
• loss
• void
• refunded
6. Deposit Integrity
6.1 Verified Source Requirement
• Deposits must not be credited without a verified external reference
6.2 No Duplicate Credit
• A deposit transaction must not be credited more than once
6.3 Traceability
• Every credited deposit must reference:
• external transaction ID
• source address (where applicable)
7. Withdrawal Safety
7.1 Balance Validation
• Withdrawals must not exceed available balance
7.2 State Machine Enforcement
Withdrawals must follow valid transitions:
• requested → approved → broadcasted → confirmed
• or → failed
Invalid transitions must be rejected.
7.3 No Silent Loss
• Failed withdrawals must not result in lost funds
• Funds must be restored or remain accounted for
7.4 External Traceability
• Every withdrawal must have:
• external transaction reference
• destination address
8. State Transition Integrity
8.1 Valid State Changes Only
• Entities must only move through defined states
• Illegal transitions must be rejected
8.2 Atomic State + Ledger Changes
• State changes and ledger postings must succeed or fail together
8.3 No Partial Financial Eﬀects
• A command must not:
• partially update state
• partially post ledger entries
It must be all-or-nothing.
9. Time and Ordering
9.1 Event Ordering Consistency
• Financial events must be processed in a consistent order
9.2 Cutoﬀ Enforcement
• Bets after cutoﬀ must not enter the pool
9.3 Timestamp Integrity
• All financial records must include timestamps
• Ordering must be reconstructable
10. Auditability and Reconstruction
10.1 Full Traceability
It must be possible to trace:
• any balance
→ to ledger entries
→ to originating commands
→ to external references (if applicable)
10.2 Deterministic Replay
• The system must be able to reconstruct:
• wallet balances
• pool totals
• payouts
From stored data alone.
10.3 No Hidden State
• No financial state may exist outside:
• ledger
• explicitly defined derived projections
11. Rounding and Precision
11.1 Integer Representation
• All monetary values must be stored as integers (minor units)
11.2 Deterministic Rounding
• Rounding rules must be:
• explicit
• consistent
• reproducible
11.3 Residual Handling
• Any remainder from pool distribution must:
• be assigned deterministically
• or allocated to a defined account (e.g. house)
12. Security and Trust Boundaries
12.1 Authorised Actions Only
• All financial actions must be authenticated and authorised
12.2 No Trust in External Callers
• All inputs must be validated
• External systems are not trusted by default
12.3 Sensitive Operation Logging
• All financial actions must be logged with:
• actor
• timestamp
• reference ID
Final Rule
If any invariant is violated:
• the operation must fail
• the state must not be persisted
• the issue must be visible
5.Domain Breakdown
Overview
The nines-financial system is divided into distinct domains.
Each domain:
• has a clear responsibility
• owns specific data and logic
• exposes controlled interfaces
• must not leak responsibilities into other domains
This separation ensures:
• maintainability
• testability
• scalability
• financial safety
Top-Level Domain Structure
The system is divided into the following domains:
1. Accounting Core
2. Wallet Domain
3. Betting Domain
4. Pool Domain (Parimutuel)
5. Settlement Domain
6. Treasury Domain (Deposits & Withdrawals)
7. Audit & Reconciliation Domain
8. Shared / Infrastructure
1. Accounting Core
Responsibility
The financial backbone of the system.
Owns:
• ledger model
• posting rules
• financial integrity enforcement
Owns
• ledger transactions
• ledger entries
• posting engine
• account structures
• balancing validation
Does NOT Own
• business logic (bets, pools, settlement decisions)
• wallet presentation
Key Components
• LedgerTransaction entity
• LedgerEntry entity
• PostingEngine
• Account definitions
• Transaction validator
Key Rules
• every transaction must balance
• append-only
• no direct balance mutation
2. Wallet Domain
Responsibility
Represents user financial state.
Owns
• wallet entity
• balance projections (available, locked, total)
• wallet queries
Does NOT Own
• ledger logic
• bet logic
• settlement calculations
Key Components
• Wallet entity
• Balance projection service
• Wallet query service
Key Rules
• balances are derived, not stored directly
• no mutation without ledger
3. Betting Domain
Responsibility
Handles bet intake and validation.
Owns
• bet entity
• bet validation
• bet lifecycle (pre-settlement)
Does NOT Own
• payout calculation
• pool math
• ledger posting (delegates to accounting core)
Key Components
• Bet entity
• BetService (place bet, validate)
• BetRepository
Key Rules
• must validate funds before placing bet
• must lock funds via ledger
• must register bet with pool
4. Pool Domain (Parimutuel)
Responsibility
Manages shared betting pools.
Owns
• pool per race
• selection pools
• pool totals
• pool lifecycle
Does NOT Own
• wallet balances
• external race logic
• ledger posting
Key Components
• Pool entity
• SelectionPool entity
• PoolService
• Pool lifecycle manager
Key Rules
• pool totals must equal sum of bets
• pools are isolated per race
• no mutation after freeze
5. Settlement Domain
Responsibility
Resolves bets and distributes payouts.
Owns
• settlement execution
• payout calculation
• bet finalisation
Does NOT Own
• race result generation
• bet intake
Key Components
• SettlementService
• PayoutCalculator
• SettlementRun entity
Key Rules
• must be idempotent
• must use final race result
• must distribute full pool correctly
• must finalise all bets
6. Treasury Domain (Deposits & Withdrawals)
Responsibility
Handles interaction with external financial systems.
Owns
• deposits
• withdrawals
• external transaction tracking
• lifecycle states
Does NOT Own
• internal accounting rules
• pool logic
Key Components
• Deposit entity
• Withdrawal entity
• TreasuryService
• ChainAdapter interface
Key Rules
• no credit without verification
• no duplicate processing
• full traceability required
7. Audit & Reconciliation Domain
Responsibility
Ensures financial correctness and traceability.
Owns
• audit logs
• reconciliation processes
• discrepancy detection
Does NOT Own
• financial state mutation
Key Components
• AuditEvent entity
• ReconciliationService
• Reporting tools
Key Rules
• must be able to reconstruct state
• must detect inconsistencies
8. Shared / Infrastructure
Responsibility
Provides cross-cutting functionality.
Owns
• database access
• idempotency handling
• time utilities
• validation helpers
Does NOT Own
• business logic
Key Components
• Base repositories
• IdempotencyService
• TimeService
• Config
Domain Interaction Rules
1. Accounting Core is central
All domains must:
• use Accounting Core for financial eﬀects
• never bypass it
2. One-way dependency flow
Allowed direction:
Betting
Treasury
Wallet
→
Audit
→
→
Pool
→
Settlement
→
Accounting
Accounting (read)
All (read-only)
→
Accounting
3. No circular dependencies
Domains must not depend on each other in loops.
4. Clear boundaries
Each domain:
• owns its data
• exposes interfaces
• does not leak internal logic
Suggested Folder Structure
src/
domains/
accounting/
wallet/
betting/
pool/
settlement/
treasury/
audit/
infrastructure/
db/
idempotency/
time/
config/
interfaces/
api/
events/
application/
commands/
handlers/
Guiding Principle
If a piece of logic:
• aﬀects money → Accounting Core
• aﬀects bets → Betting Domain
• aﬀects pools → Pool Domain
• aﬀects payouts → Settlement Domain
• aﬀects external transfers → Treasury Domain
Final Rule
If you are unsure where something belongs:
👉 it does not belong in multiple domains
👉 it must be assigned to exactly one
6.Roles and Permissions
Overview
This section defines the actors that may interact with nines-financial and the
permissions granted to each.
The purpose of this section is to ensure that:
• financial actions are only performed by authorised actors
• read access is separated from write authority
• operational actions are controlled and auditable
• no actor can bypass accounting rules
Permissions must be enforced consistently across:
• API endpoints
• command handlers
• admin tooling
• background processes
• event consumers
No actor may perform an action unless it is explicitly allowed here.
1. Actor Types
The system recognises the following actor types:
1. User
2. Platform Backend Service
3. Admin Operator
4. Treasury Operator / Treasury Service
5. Settlement Service
6. Audit / Reconciliation Process
7. System Internal Process
Each actor has a defined scope of authority.
2. User
Description
A platform user who owns a wallet and places bets.
Allowed Actions
A user may:
• view their own wallet balances
• view their own transaction history
• create deposit intents where supported
• request withdrawals from their own wallet
• place bets using their own available funds
• view their own bet history
• view their own withdrawal and deposit status
Not Allowed
A user must not be able to:
• access another user’s wallet or transaction data
• approve or confirm withdrawals
• trigger settlement
• mutate pool state directly
• alter ledger records
• manually unlock funds
• override bet states
• bypass cutoﬀ rules
• bypass balance validation
Required Ownership Rule
A user may only act on resources they own, unless a resource is explicitly public
and read-only.
3. Platform Backend Service
Description
The trusted internal Nines backend responsible for race integration, bet
orchestration, and platform-level coordination.
Allowed Actions
The platform backend may:
• submit requests to place bets on behalf of authenticated users
• query wallet balances for authorised user-facing workflows
• submit authorised final race results for settlement
• query pool and settlement summaries where needed
• consume financial events exposed to trusted services
Not Allowed
The platform backend must not:
• directly edit balances
• directly write ledger entries
• force settlement outcomes outside defined commands
• approve withdrawals unless explicitly acting through a permitted
operational path
• alter financial history
Important Rule
The backend may request financial actions.
It may not perform financial actions outside nines-financial.
4. Admin Operator
Description
A human operator using nines-admin or approved operational tooling.
Allowed Actions
An admin operator may, depending on assigned permission level:
• view user wallets
• view transaction histories
• view deposits, withdrawals, bets, pools, and settlements
• review exceptions and discrepancies
• approve withdrawals
• trigger operational reconciliation jobs
• annotate disputes or exceptions
• trigger controlled compensating workflows if explicitly supported
Not Allowed
An admin operator must not:
• directly modify wallet balances
• directly modify ledger entries
• rewrite settlement outcomes without an explicit compensating process
• change financial state through hidden admin shortcuts
• impersonate system processes without audit trace
Audit Requirement
All admin actions that aﬀect financial state or financial workflow must be:
• authenticated
• authorised
• logged with actor identity
• timestamped
• traceable to a request or reference ID
5. Treasury Operator / Treasury Service
Description
A human operator or internal service responsible for managing external deposit
and withdrawal execution.
Allowed Actions
The treasury role may:
• confirm verified deposits
• update withdrawal lifecycle status
• attach external transaction references
• mark withdrawals as broadcasted or confirmed
• mark external movement failures
• query treasury-related operational data
Not Allowed
The treasury role must not:
• create arbitrary credits without verified source rules
• directly manipulate ledger entries outside approved commands
• bypass withdrawal state machine rules
• alter settled pool results
• modify user balances directly
Special Requirement
Treasury actions that create financial eﬀects must require:
• verified inputs
• full traceability
• idempotency protection
6. Settlement Service
Description
A trusted system actor responsible for running race settlement from final
authorised results.
This may be:
• an internal service account
• a dedicated background worker
• a controlled backend process
Allowed Actions
The settlement service may:
• initiate settlement for a race
• read pool state
• calculate payout distribution
• finalise bet states
• create settlement ledger postings
• write settlement records
Not Allowed
The settlement service must not:
• invent race outcomes
• settle from unoﬃcial data
• settle the same race twice with duplicated financial eﬀect
• modify unrelated financial records
Special Requirement
Settlement actions must require:
• authorised result source
• idempotency enforcement
• reproducible calculation inputs
7. Audit / Reconciliation Process
Description
A read-heavy operational role or process used to validate correctness and detect
discrepancies.
Allowed Actions
This role may:
• read wallets
• read ledger history
• read deposits and withdrawals
• read pools and settlements
• compare internal and external records
• produce reports or discrepancy findings
Not Allowed
This role must not:
• mutate financial state
• confirm deposits
• approve withdrawals
• trigger settlement
• repair discrepancies directly
Key Rule
Audit and reconciliation processes are read-only unless explicitly invoking a
separate approved remediation workflow.
8. System Internal Process
Description
An internal non-human process used for background tasks such as:
• retries
• projections
• asynchronous handlers
• notification side eﬀects
• cleanup and consistency checks
Allowed Actions
System internal processes may:
• process queued commands
• rebuild projections
• retry safe idempotent operations
• publish financial events
• run derived read-model maintenance
Not Allowed
System internal processes must not:
• introduce new business decisions outside defined command flows
• bypass state validation
• bypass idempotency rules
• perform privileged operator-only actions unless explicitly authorised as a
service account
9. Permission Categories
To keep the permission model consistent, permissions should be grouped into
categories.
9.1 Read Permissions
Examples:
• read own wallet
• read own bets
• read any wallet
• read pools
• read settlements
• read audit reports
9.2 Financial Command Permissions
Examples:
• place bet
• create deposit intent
• confirm deposit
• request withdrawal
• approve withdrawal
• mark withdrawal broadcasted
• mark withdrawal confirmed
• trigger settlement
9.3 Operational Permissions
Examples:
• run reconciliation
• view discrepancies
• annotate exceptions
• invoke compensating flow
9.4 Administrative Permissions
Examples:
• manage admin users
• assign treasury roles
• view sensitive operational metadata
10. Minimum Permission Principles
The system must enforce the following principles.
10.1 Least Privilege
Each actor receives only the minimum permissions required.
10.2 Separation of Duties
Where practical, sensitive financial workflows should be split across roles.
Examples:
• a user requests withdrawal
• treasury/admin approves it
• treasury/system marks it broadcasted and confirmed
10.3 No Hidden Superuser Behaviour
There must be no undocumented role that can silently bypass financial controls.
10.4 Read Does Not Imply Write
An actor with broad visibility does not automatically gain mutation rights.
10.5 Ownership Before Action
User-originated actions must confirm ownership of the relevant wallet, bet,
deposit, or withdrawal.
11. Sensitive Actions Requiring Extra Control
The following actions are high sensitivity and require strong protection:
• confirm deposit
• approve withdrawal
• mark withdrawal confirmed
• trigger settlement
• invoke compensating transaction flows
• mark a pool voided
• attach or modify external transaction references
• override failed operational status through approved remediation flow
These actions should require:
• authenticated service or privileged operator identity
• audit logging
• correlation/reference ID
• strict validation
• idempotency enforcement where applicable
12. Forbidden Capability Rule
No actor, including admins, may ever:
• directly edit balances
• directly edit ledger entries
• delete financial history
• silently rewrite a settled outcome
• bypass the state machine through database shortcuts
• bypass posting rules using manual patches outside defined remediation
procedures
If correction is needed, it must be done through:
• compensating transactions
• controlled remediation commands
• fully audited processes
13. Trust Boundary Rule
Permissions alone are not enough.
Even trusted actors must still be subject to:
• input validation
• state transition checks
• invariant enforcement
• idempotency rules
• audit logging
A trusted actor is allowed to request an action.
A trusted actor is not allowed to violate system laws.
Final Rule
If an action is not explicitly allowed for a role in this document:
• it must be denied by default
• it must not be implemented implicitly
• it must be clarified before being exposed
7.Account Model
Overview
The nines-financial ledger is built around a defined set of internal accounts.
These accounts represent the canonical places where value can exist while it is
inside the Nines financial system.
All financial actions must move value between defined accounts through
balanced ledger transactions.
No money movement may occur outside this model.
The goals of this account model are to ensure:
• traceability of all value
• clear separation of user funds, pool funds, house revenue, and external
movement states
• deterministic posting rules
• support for parimutuel settlement
• support for deposits, withdrawals, refunds, and corrections
• auditability and reconciliation
1. Account Model Principles
1.1 Every financial eﬀect is an account movement
There is no such thing as “just update the balance.”
Every eﬀect must be expressed as:
• one or more debits
• one or more credits
• across defined accounts
1.2 Accounts have specific meaning
Each account must have a single clear purpose.
Accounts must not be overloaded to mean multiple things.
1.3 User-visible balances are derived from account positions
A wallet’s:
• available balance
• locked balance
• total balance
must be derived from the user’s underlying account positions.
1.4 Parimutuel pool accounting must be representable
The account model must support:
• locking stakes
• isolating funds committed to bets
• moving settled losing stakes into the distributable pool
• allocating house take
• paying winners from the settled pool
1.5 External movement must be traceable
Deposits and withdrawals must pass through explicit accounts so that:
• pending external movement
• completed movement
• failed movement
can all be reasoned about clearly
2. Account Categories
The system uses the following high-level categories of accounts:
1. User Accounts
2. Pool and Settlement Accounts
3. House Accounts
4. Treasury / External Movement Accounts
5. Operational / Adjustment Accounts
3. User Accounts
These accounts represent value attributable to a specific user.
Each user wallet is represented through at least the following logical accounts.
3.1 User Available Funds Account
Represents funds the user can actively use.
Can be used for:
• placing bets
• requesting withdrawals
Cannot include:
• funds committed to active bets
• funds pending failed or unresolved movement states unless explicitly
released
3.2 User Locked Funds Account
Represents funds reserved for active accepted bets.
Used when:
• a bet is placed and accepted
• funds must be held until settlement or refund
Locked funds:
• are still attributable to the user
• are not spendable
• are not withdrawable
• are awaiting resolution through settlement or refund logic
3.3 Optional User Pending Withdrawal Reserve Account
Represents funds reserved for an approved withdrawal that has not yet left the
platform.
This account is useful if withdrawal flow needs a clear stage between:
• user available funds
• external broadcast / confirmation
This account may be included from the start to keep withdrawal state explicit.
4. Pool and Settlement Accounts
These accounts represent pooled race funds and settlement-stage value.
They are central to parimutuel logic.
4.1 Race Pool Holding Account
Represents the total stake collected for a specific race once bets have been
accepted and moved out of user-locked state into the race pool at settlement time,
or alternatively while stakes are being centrally accumulated depending on posting
design.
This account must be race-specific.
Purpose:
• isolate the total stake for one race
• support deterministic house take and payout calculations
• prevent cross-race contamination of funds
4.2 Race Selection Pool Tracking View
Per-selection totals must exist for calculation and audit purposes.
This may be implemented as:
• dedicated selection-level accounts
• or a race pool account plus precise per-selection bet records / projections
The canonical requirement is:
• total stake on each selection must be reconstructable exactly
If actual ledger account granularity is race + selection, then each selection may
have its own account.
4.3 Settlement Clearing Account
A temporary account used during settlement to coordinate value movement
between:
• losing stakes
• house take
• winner payouts
• refunds where required
Purpose:
• make settlement postings explicit
• support audit and compensating flows
• reduce ambiguity in payout distribution
5. House Accounts
These accounts represent value belonging to the platform rather than to users.
5.1 House Revenue Account
Represents retained platform revenue.
For parimutuel betting, this is typically the house take deducted from the total
pool before winner distribution.
Purpose:
• clearly separate platform revenue from player funds
• support reporting and reconciliation
• ensure house value is not mixed into race payout balances
5.2 Optional House Adjustment / Reserve Account
Used for:
• controlled remediation
• operational corrections
• explicitly approved platform-funded adjustments
This account must never be used as a shortcut for silent fixes.
Any use must be:
• rare
• explicit
• audited
• backed by compensating transactions
6. Treasury / External Movement Accounts
These accounts represent money entering or leaving the platform boundary.
6.1 Deposit Clearing Account
Represents value associated with a verified incoming deposit before or at the
moment it is credited into the user’s available balance.
Purpose:
• separate external arrival from internal user credit
• support idempotent deposit confirmation
• enable reconciliation against external transaction references
A typical deposit credit flow may pass through:
• deposit clearing
• then into user available funds
6.2 Withdrawal Reserve / Clearing Account
Represents value removed from the user’s spendable balance and reserved for
withdrawal processing.
Purpose:
• isolate funds awaiting external transfer
• prevent double spending
• keep withdrawal lifecycle financially explicit
6.3 External Settlement Reference Layer
External blockchain state itself is not a ledger account, but every deposit and
withdrawal must link to:
• chain/network
• external transaction reference
• source or destination address
• confirmation state
This external reference layer must be tightly linked to clearing accounts and
treasury records.
7. Operational / Adjustment Accounts
These accounts support controlled non-routine flows.
7.1 Refund Account Pattern
Refunds do not need a permanently separate account if they can be represented
as compensating movements through existing accounts.
However, if implementation clarity benefits from it, a refund clearing account may
be introduced.
Used for:
• voided races
• rejected bets after temporary reservation
• failed flows requiring explicit unwind
7.2 Compensation / Correction Account
Used only for audited correction flows.
Purpose:
• support reversal or remediation without mutating historical entries
• make exceptional corrections visible
This account must never hide operational mistakes.
8. Recommended Canonical Account Set
For the first full version of the system, the canonical logical accounts should be:
Per user
• user_available
• user_locked
• user_withdrawal_reserved (recommended)
Per race
• race_pool
• optionally race_selection_pool:<selectionId> if selection-level ledger
isolation is desired
• settlement_clearing
Platform-wide
• house_revenue
• deposit_clearing
• withdrawal_clearing
• adjustment_reserve or correction_account
This gives enough structure for:
• deposits
• withdrawals
• bet placement
• parimutuel settlement
• refunds
• corrections
9. Canonical Money Movements
This section defines the allowed conceptual movement of value.
9.1 Deposit Credit
From:
• deposit_clearing
To:
• user_available
Meaning:
• verified incoming value becomes spendable user balance
9.2 Bet Placement
From:
• user_available
To:
• user_locked
Meaning:
• user stake is reserved for an accepted bet
9.3 Withdrawal Request / Approval
From:
• user_available
To:
Meaning:
• user_withdrawal_reserved or withdrawal_clearing
• funds are no longer spendable and are reserved for external payout
9.4 Failed Withdrawal Release
From:
To:
• user_available
Meaning:
• user_withdrawal_reserved or withdrawal_clearing
• reserved withdrawal funds are returned to the user
9.5 Settlement of Losing Stakes
From:
• losing users’ user_locked
To:
• race_pool or settlement_clearing
Meaning:
• losing committed stake moves into distributable settlement value
9.6 Settlement of Winning Stakes
Winning users’ locked funds are resolved as part of payout flow.
Depending on posting design, this may involve:
• moving winning stake from user_locked into settlement processing
• then crediting full payout back to user_available
The important rule is that:
• the winner’s final payout must be fully explainable
• stake return and profit must be reproducible from stored records
9.7 House Take Allocation
From:
• race_pool or settlement_clearing
To:
• house_revenue
Meaning:
• the platform retains its percentage of the valid total pool
9.8 Winner Distribution
From:
• race_pool or settlement_clearing
To:
• winning users’ user_available
Meaning:
• winners receive their share of the distributable pool
9.9 Voided Race Refund
From:
• aﬀected users’ user_locked
To:
• aﬀected users’ user_available
Meaning:
• no winner distribution occurs, and stakes are returned
10. Account Ownership Rules
10.1 User accounts are user-scoped
Every user account must belong to exactly one user.
10.2 Race pool accounts are race-scoped
Every race pool account must belong to exactly one race.
10.3 House accounts are platform-scoped
House accounts must never be mixed with user-scoped balances.
10.4 Clearing accounts must be explicit
Deposit, withdrawal, and settlement clearing accounts must be clearly identifiable
and auditable.
11. Account Model Design Decisions Still to Lock
There are two important design decisions that should be made explicitly.
11.1 Selection-Level Accounts vs Projection-Only Selection
Totals
Two valid approaches exist:
Option A: Selection-level ledger accounts
Example:
• race_selection_pool:horse_1
• race_selection_pool:horse_2
Pros:
• extremely explicit
• easier direct audit per selection
Cons:
• more ledger complexity
• more accounts created per race
Option B: Single race pool account + selection totals from
bets/projections
Pros:
• simpler account model
• fewer accounts
Cons:
• selection totals depend more heavily on projections and bet records
For Nines, either can work, but the document should eventually lock one.
11.2 When the Stake Leaves User Locked
Two posting philosophies exist:
Option A: Keep active stakes in user_locked until settlement
Pros:
• simple user state while race is unresolved
• locked funds clearly remain attributable to the user until resolution
Option B: Move accepted stake from user_locked into race
pool before settlement closes
Pros:
• race pool reflects committed value earlier
• pool-ledger visibility becomes more direct
For your system, I think Option A is cleaner conceptually:
• bet placement = available → locked
• settlement = locked → pool / payout / refund logic
But this should be explicitly chosen.
12. Final Rule
Every ledger posting in the system must move value only between accounts that
are:
• defined in this model
• valid for the command being executed
• valid for the current state of the entities involved
If a posting requires an undefined account or an ambiguous destination:
• it must not be implemented
• the model must be updated first
8.Account Model (Revised
–
Selection-Level Pool Accounting)
Overview
The nines-financial ledger is built around a defined set of internal accounts that
represent all locations where value can exist within the system.
All financial activity must be expressed as movements between these accounts
using balanced ledger transactions.
This model is designed to:
• support parimutuel pool betting
• provide full auditability
• ensure deterministic settlement
• enable reconstruction of all balances and payouts
• maintain strict separation between:
• user funds
• race pool funds
• house revenue
• external movement states
1. Core Design Decision
1.1 Selection-Level Pool Accounts (Canonical)
Nines uses selection-level ledger accounts for parimutuel pool accounting.
For each race and each selection (horse), a dedicated ledger account exists:
race_selection_pool:<raceId>:<selectionId>
Implications
• Total stake per selection is directly represented in the ledger
• No projection is required to determine:
• how much was bet on a selection
• Settlement calculations can rely on ledger truth
• Audit and reconciliation are simplified
1.2 Race-Level Aggregation
The total pool for a race is derived as:
sum(all race_selection_pool:<raceId>:<selectionId>)
There is no requirement for a separate race_pool account if selection accounts are
used.
1.3 Settlement Uses Ledger Truth
Settlement must read:
• total pool (sum of all selection accounts)
• winning selection pool (single selection account)
No external calculation source is allowed to override these values.
2. Account Model Principles
2.1 All Value Moves Between Accounts
No direct mutation of balances is allowed.
Every financial eﬀect must be a ledger transaction.
2.2 Accounts Have Single Responsibility
Each account has one clear meaning and must not be reused for multiple
purposes.
2.3 User Balances Are Derived
Wallet balances are projections of:
• user_available
• user_locked
• optional withdrawal reserve
2.4 Pool Funds Are Isolated Per Selection
Funds for each selection must:
• be isolated
• not mix with other selections
• not mix across races
2.5 External Movements Are Explicit
Deposits and withdrawals must pass through dedicated accounts.
3. Account Categories
The system uses the following categories:
1. User Accounts
2. Selection Pool Accounts
3. Settlement Accounts
4. House Accounts
5. Treasury / External Accounts
6. Adjustment Accounts
4. User Accounts
Per user:
4.1 user_available
Spendable funds.
Used for:
• placing bets
• withdrawals
4.2 user_locked
Funds reserved for active bets.
• not spendable
• not withdrawable
• released during settlement or refund
4.3 user_withdrawal_reserved (recommended)
Funds reserved for withdrawal processing.
• removed from available
• awaiting external transfer
5. Selection Pool Accounts
5.1 race_selection_pool:<raceId>:<selectionId>
Represents total stake committed to a specific selection.
Characteristics
• one account per race per selection
• holds all committed stake for that selection
• immutable after pool freeze (no new inflows)
• used as the source of truth for settlement
5.2 Ownership Rules
• scoped to a single race
• scoped to a single selection
• must not receive funds after cutoﬀ
6. Settlement Accounts
6.1 settlement_clearing:<raceId>
A temporary account used during settlement.
Purpose
• aggregate losing stakes
• isolate settlement flows
• route funds to:
• house revenue
• winning payouts
6.2 Characteristics
• exists per race
• used only during settlement
• must net to zero after settlement completes
7. House Accounts
7.1 house_revenue
Represents platform earnings.
Sources
• house take from each race
7.2 Rules
• must never mix with user funds
• must be explicitly credited during settlement
7.3 adjustment_reserve (optional)
Used for:
• controlled corrections
• compensating transactions
Must be:
• audited
• rarely used
8. Treasury / External Accounts
8.1 deposit_clearing
Tracks incoming value before it becomes user balance.
8.2 withdrawal_clearing
Tracks outgoing value reserved for withdrawal.
8.3 Rules
• all external movement must pass through these
• must link to external transaction references
9. Canonical Money Movements
9.1 Deposit Credit
deposit_clearing → user_available
9.2 Bet Placement
user_available → user_locked
9.3 Settlement
–
At settlement start:
For each bet:
Move Stakes into Pools
user_locked → race_selection_pool:<raceId>:<selectionId>
9.4 Settlement
–
For losing selections:
Aggregate Losing Stakes
race_selection_pool:<losingSelections> → settlement_clearing
9.5 House Take
settlement_clearing → house_revenue
9.6 Winner Distribution
settlement_clearing → user_available (winners)
9.7 Withdrawal Request
user_available → user_withdrawal_reserved
9.8 Withdrawal Execution
user_withdrawal_reserved → withdrawal_clearing
9.9 Withdrawal Failure
withdrawal_clearing → user_available
9.10 Void / Refund
user_locked → user_available
10. Account Ownership Rules
10.1 User Accounts
Belong to exactly one user.
10.2 Selection Pool Accounts
Belong to exactly one:
• race
• selection
10.3 Settlement Accounts
Belong to exactly one race.
10.4 House Accounts
Belong to the platform.
10.5 Clearing Accounts
Must always be traceable and auditable.
11. Critical Behavioural Rules
11.1 No Post-Cutoﬀ Pool Mutation
Selection pool accounts must not receive funds after freeze.
11.2 Settlement Must Drain Pools
After settlement:
• all selection pool accounts must be empty
• all value must be redistributed or allocated
11.3 Settlement Must Balance
All settlement postings must result in:
total pool = payouts + house revenue
11.4 Full Traceability
It must be possible to trace:
• any payout
→ to settlement
→ to pool accounts
→ to original bets
12. Final Rule
Every ledger transaction must:
• move value only between defined accounts
• respect account ownership
• respect lifecycle state
• maintain balance
• preserve auditability
If a financial action cannot be expressed within this model:
👉 the model must be updated before implementation
9.Entity State Machines and Lifecycle Rules
Overview
The nines-financial system contains several core entities whose behaviour
depends on controlled state transitions.
Each entity must:
• begin in a defined initial state
• move only through valid transitions
• reject illegal transitions
• record terminal outcomes clearly
• preserve auditability across the full lifecycle
State transitions are part of the financial safety model.
No entity may skip steps, silently change status, or move through undefined paths.
1. Bet Lifecycle
Purpose
The bet lifecycle tracks a wager from creation through final resolution.
A bet must always be associated with:
• one user
• one race
• one selection
• one stake amount
States
1.1 pending
The bet request has been received but has not yet been accepted as a committed
financial bet.
Use cases:
• pre-validation
• short-lived command processing
• optional state if you persist bet requests before acceptance
This state may be omitted if bet creation and acceptance are atomic.
1.2 accepted
The bet is valid and committed.
Requirements:
• suﬃcient user available funds existed
• stake has been moved from user_available to user_locked
• race pool is still open
• selection is valid
• cutoﬀ has not passed
This is the main active bet state before settlement.
1.3 rejected
The bet request was not accepted.
Examples:
• insuﬃcient funds
• race not open
• invalid selection
• duplicate request
• cutoﬀ passed
Rejected bets must have no committed financial eﬀect.
This is a terminal state.
1.4 settled_win
The bet has been resolved as a winner.
Requirements:
• linked to a completed settlement run
• payout has been calculated
• payout has been posted
• user locked funds for this bet have been resolved
This is a terminal state.
1.5 settled_loss
The bet has been resolved as a loser.
Requirements:
• linked to a completed settlement run
• locked funds have been consumed into settlement
This is a terminal state.
1.6 voided
The bet was accepted but later invalidated.
Examples:
• race voided
• authorised cancellation of the market
• settlement cancelled before result finalisation
Requirements:
• user funds returned appropriately
• no payout distribution applied
This is a terminal state.
1.7 refunded
The accepted bet has been financially returned to the user.
In many implementations, voided and refunded may happen together, but
they are not the same concept:
• voided = business outcome
• refunded = financial outcome
You may choose to model:
• voided only, with refund implied
• or voided then refunded
For clarity, I recommend:
Recommended simplification
Use:
• accepted
• rejected
• settled_win
• settled_loss
• voided
And make refund handling part of the void processing record rather than a
separate public bet state.
Valid Transitions
pending -> accepted
pending -> rejected
accepted -> settled_win
accepted -> settled_loss
accepted -> voided
If pending is not persisted:
create request -> accepted
create request -> rejected
Invalid Transitions
Examples:
• rejected -> accepted
• settled_win -> settled_loss
• settled_loss -> accepted
• voided -> settled_win
• accepted -> accepted with duplicate financial eﬀect
All invalid transitions must be rejected.
Lifecycle Rules
1.8 Acceptance rule
A bet cannot enter accepted unless:
• funds are available
• pool is open
• race is bettable
• command is authorised
• idempotency checks pass
1.9 Terminal state rule
Once a bet is in:
• rejected
• settled_win
• settled_loss
• voided
it must not transition to another state except through an explicitly defined
compensating/remediation process.
1.10 Settlement dependency rule
A bet may not enter a settled state unless:
• the pool is frozen
• a valid race result exists
• settlement has been authorised
2. Pool Lifecycle
Purpose
The pool lifecycle controls whether a race is accepting bets, frozen for settlement,
settled, or void.
Because Nines uses selection-level pool accounts, the pool lifecycle applies to the
race as a whole, while the funds are tracked per selection.
States
2.1 open
The race pool is active and accepting bets.
Requirements:
• race is bettable
• cutoﬀ has not passed
• settlement has not started
2.2 frozen
Betting is closed.
Requirements:
• no further bets may be accepted
• selection pool totals are final for that race
• settlement may begin from this state
This is the most important transition boundary in parimutuel logic.
2.3 settled
The pool has been fully resolved.
Requirements:
• winning selection determined from authorised result
• house take allocated
• payouts distributed
• all accepted bets finalised
• selection pool accounts drained appropriately
This is a terminal state.
2.4 voided
The pool was invalidated.
Examples:
• race cancelled
• race result unavailable or invalid
• authorised market void
Requirements:
• all accepted bets must be unwound or refunded
• no normal winner settlement occurs
This is a terminal state.
Valid Transitions
open -> frozen
frozen -> settled
frozen -> voided
open -> voided
Invalid Transitions
Examples:
• settled -> open
• settled -> voided
• voided -> settled
• frozen -> open
Lifecycle Rules
2.5 Cutoﬀ enforcement
Once a pool enters frozen:
• no new accepted bets may be created
• no stake totals may increase
• pool composition is final
2.6 Settlement entry rule
Settlement may only begin from frozen.
2.7 Terminal pool rule
A settled or voided pool must not accept further lifecycle changes outside
audited remediation flows.
3. Deposit Lifecycle
Purpose
Tracks incoming value from external sources until it becomes credited user
balance or fails.
States
3.1 intent_created
A deposit intent exists.
This may include:
• expected asset
• expected chain
• wallet association
• reference metadata
At this stage:
• no balance is credited
3.2 pending_confirmation
An external deposit is expected or observed, but not yet final.
Examples:
• tx seen but not confirmed
• external verification in progress
3.3 confirmed
The deposit has been verified and credited.
Requirements:
• verified external reference
• no duplicate credit
• ledger posting completed
This is a terminal success state.
3.4 failed
The deposit did not complete successfully.
Examples:
• invalid transaction
• wrong asset
• wrong destination
• abandoned or expired intent
This is a terminal state.
3.5 rejected
Optional state if the deposit is explicitly denied before confirmation.
You may choose to merge this into failed, but keeping rejected can help
distinguish:
• operational failure
from
• validation refusal
For simplicity, failed alone is acceptable.
Valid Transitions
intent_created -> pending_confirmation
intent_created -> failed
pending_confirmation -> confirmed
pending_confirmation -> failed
If intents are not used:
observed external deposit -> pending_confirmation ->
confirmed/failed
Lifecycle Rules
3.6 Credit rule
A deposit must not enter confirmed unless:
• external reference is verified
• duplicate credit checks pass
• ledger posting succeeds
3.7 Finality rule
A confirmed deposit must not be confirmed again.
4. Withdrawal Lifecycle
Purpose
Tracks outgoing value from user request to external completion or failure.
This is one of the most sensitive state machines in the system.
States
4.1 requested
The user has requested a withdrawal.
Requirements:
• suﬃcient available balance
• valid destination details
• request accepted for processing
At this point, funds should be reserved from spendable balance.
4.2 approved
The withdrawal has passed operational or automated approval checks.
This may be:
• admin approved
• treasury approved
• rules-engine approved
Funds remain reserved.
4.3 broadcasted
The withdrawal has been sent to the external rail.
Requirements:
• external transaction reference exists
• destination is fixed
• amount is fixed
4.4 confirmed
The external transfer is considered complete.
Requirements:
• suﬃcient external confirmation rules met
• withdrawal is finalised internally
This is a terminal success state.
4.5 failed
The withdrawal did not complete.
Examples:
• broadcast failed
• external rejection
• confirmation timeout
• manual failure decision
Requirements:
• reserved funds remain accounted for
• system must explicitly define whether funds are returned to user or remain
in investigation flow
For your spec, I recommend:
• failed means the normal withdrawal flow did not complete
• a separate financial reversal/release process returns funds if appropriate
This is terminal for the withdrawal request itself.
4.6 cancelled
Optional state if user/admin can cancel before broadcast.
This is useful if you want explicit pre-broadcast cancellation.
If supported:
• funds must be returned to available balance
• cancellation must be audited
This is a terminal state.
I recommend including it because it is practical.
Valid Transitions
requested -> approved
requested -> cancelled
approved -> broadcasted
approved -> failed
broadcasted -> confirmed
broadcasted -> failed
Invalid Transitions
Examples:
• requested -> confirmed
• broadcasted -> approved
• confirmed -> failed
• cancelled -> approved
Lifecycle Rules
4.7 Reservation rule
A withdrawal must not enter requested unless funds are reserved from user
spendable balance.
4.8 Approval rule
Only authorised admin/treasury/system roles may move:
• requested -> approved
4.9 Broadcast rule
A withdrawal must not enter broadcasted without an external transaction
reference.
4.10 Confirmation rule
A withdrawal must not enter confirmed without satisfying external finality rules.
4.11 Failure handling rule
A failed withdrawal must never result in silent loss of user funds.
A defined financial outcome must exist:
• funds returned
• or funds held in an explicit investigation/remediation path
5. Settlement Run Lifecycle
Purpose
Tracks the execution status of a settlement process for a race.
This is separate from pool state because you may want operational visibility into
settlement execution itself.
States
5.1 pending
Settlement has been created or scheduled but has not started execution.
5.2 running
Settlement calculation and postings are in progress.
5.3 completed
Settlement finished successfully.
Requirements:
• payouts posted
• house take posted
• bets finalised
• pool marked settled
This is a terminal success state.
5.4 failed
Settlement execution did not complete successfully.
Requirements:
• no partial unresolved financial state may remain
• rerun must be safe via idempotency and compensation controls
This is terminal for that run instance, though a new run or retry may be allowed by
system rules.
Valid Transitions
pending -> running
running -> completed
running -> failed
Lifecycle Rules
5.5 Single active run rule
A race must not have multiple concurrent active settlement runs.
5.6 Completion rule
A settlement run may only enter completed if:
• all financial postings succeeded
• all accepted bets reached terminal outcomes
• the pool entered settled
5.7 Failure rule
A failed settlement run must be visible and auditable.
6. Optional Treasury Movement Lifecycle
This is useful if you want to track the actual external transfer object separately
from deposit/withdrawal business records.
You do not have to include this now, but the system can later support:
• created
• pending
• broadcasted
• confirmed
• failed
This is especially useful if treasury becomes more complex later.
For now, deposit and withdrawal entities may be enough.
7. Cross-Entity Lifecycle Rules
These rules bind the diﬀerent state machines together.
7.1 Bet vs Pool
A bet may only enter accepted if the pool is open.
7.2 Settlement vs Pool
Settlement may only begin if the pool is frozen.
7.3 Bet vs Settlement
Accepted bets must resolve to:
• settled_win
• settled_loss
• or voided
when the related pool resolves.
7.4 Withdrawal vs Wallet
A withdrawal may only enter requested if the wallet has suﬃcient available
funds.
7.5 Deposit vs Wallet
A wallet may only receive deposit credit when the deposit reaches confirmed.
7.6 Pool Terminality
If a pool is settled or voided, no new accepted bets may exist for that race.
8. General Lifecycle Enforcement Rules
8.1 No silent state changes
All state changes must be explicit and auditable.
8.2 No skipped transitions
Entities must not jump between non-adjacent states unless explicitly defined.
8.3 State + ledger atomicity
Where a transition has financial eﬀect, the state change and ledger posting must
succeed or fail together.
8.4 Terminal states are final
Once an entity reaches a terminal state, no further normal transition is allowed.
8.5 Remediation is separate
If correction is needed after a terminal outcome, it must happen through:
• compensating transactions
• remediation flows
• explicit audited processes
Not through silent status rewriting.
9. Recommended Canonical State Sets
To keep implementation clean, I recommend the following canonical sets:
Bet
• accepted
• rejected
• settled_win
• settled_loss
• voided
Pool
• open
• frozen
• settled
• voided
Deposit
• intent_created
• pending_confirmation
• confirmed
• failed
Withdrawal
• requested
• approved
• broadcasted
• confirmed
• failed
• cancelled
Settlement Run
• pending
• running
• completed
• failed
That keeps the model serious without becoming bloated.
Final Rule
If a state transition is not explicitly defined as valid in this document:
• it must be rejected
• it must not be implemented implicitly
• it must not be forced through operational shortcuts
10.Endpoint Catalogue
Overview
This section defines the canonical HTTP endpoints exposed by nines-financial.
These endpoints are intended for:
• authenticated users through trusted upstream services
• trusted internal platform services
• admin and treasury tooling
• operational and audit processes
This catalogue defines:
• method and path
• purpose
• allowed caller
• request shape
• response shape
• financial eﬀect
• lifecycle eﬀect
• idempotency requirements
• important validation rules
If an endpoint is not defined here, it must not be assumed to exist.
1. Wallet Endpoints
These endpoints expose user financial state and history.
1.1 Get Wallet Balance
Endpoint
GET /wallets/{userId}/balance
Purpose
Return the current wallet balance view for a user.
Allowed Callers
• user, for own wallet only
• platform backend
• admin
• audit/reconciliation process
Response
• userId
• availableBalance
• lockedBalance
• withdrawalReservedBalance
• totalBalance
• currency
Financial Eﬀect
None
Lifecycle Eﬀect
None
Validation Rules
• user can only read own wallet
• wallet values must come from ledger-backed projections
1.2 Get Wallet Transaction History
Endpoint
GET /wallets/{userId}/transactions
Purpose
Return paginated financial transaction history for a user.
Allowed Callers
• user, for own wallet only
• platform backend
• admin
• audit/reconciliation process
Query Parameters
• cursor or page
• limit
• fromDate
• toDate
• transactionType
• status
Response
List of:
• transactionReference
• transactionType
• amount
• direction
• status
• relatedEntityType
• relatedEntityId
• createdAt
Financial Eﬀect
None
Lifecycle Eﬀect
None
1.3 Get Wallet Ledger View
Endpoint
GET /wallets/{userId}/ledger
Purpose
Return ledger-level entries aﬀecting a user.
Allowed Callers
• admin
• audit/reconciliation process
• treasury if required
• not normally exposed directly to standard user clients unless intentionally
allowed
Response
List of:
• ledgerTransactionId
• ledgerEntryId
• accountCode
• amount
• debitOrCredit
• referenceId
• timestamp
Financial Eﬀect
None
Lifecycle Eﬀect
None
2. Deposit Endpoints
These endpoints manage deposit lifecycle.
2.1 Create Deposit Intent
Endpoint
POST /deposits/intents
Purpose
Create a deposit intent for a user.
Allowed Callers
• user through trusted backend
• platform backend
Request
• userId
• chain
• asset
• expectedAmount optional
• sourceAddress optional
• metadata optional
Response
• depositId
• status
• depositAddress or destination details if relevant
• chain
• asset
• createdAt
Financial Eﬀect
None
Lifecycle Eﬀect
• creates deposit in intent_created
Idempotency
Recommended
Validation Rules
• valid user
• supported chain
• supported asset
2.2 Mark Deposit Pending Confirmation
Endpoint
POST /deposits/{depositId}/pending-confirmation
Purpose
Move deposit into pending confirmation once external tx is detected.
Allowed Callers
• treasury service
• treasury operator
• verified deposit listener
Request
• externalTransactionReference
• observedAmount
• sourceAddress
• blockReference optional
• metadata optional
Response
• depositId
• status
• externalTransactionReference
Financial Eﬀect
None
Lifecycle Eﬀect
• intent_created -> pending_confirmation
Idempotency
Required
2.3 Confirm Deposit
Endpoint
POST /deposits/{depositId}/confirm
Purpose
Confirm a verified deposit and credit user funds.
Allowed Callers
• treasury service
• treasury operator
Request
• externalTransactionReference
• confirmedAmount
• chain
• asset
• confirmedAt
• metadata optional
Response
• depositId
• status
• creditedAmount
• walletBalanceSnapshot optional
• ledgerTransactionReference
Financial Eﬀect
• deposit_clearing -> user_available
Lifecycle Eﬀect
• pending_confirmation -> confirmed
Idempotency
Required
Validation Rules
• deposit not already confirmed
• verified external reference
• asset and chain supported
• duplicate tx reference check passes
2.4 Fail Deposit
Endpoint
POST /deposits/{depositId}/fail
Purpose
Mark a deposit as failed.
Allowed Callers
• treasury service
• treasury operator
Request
• failureReasonCode
• failureMessage optional
• externalTransactionReference optional
Response
• depositId
• status
Financial Eﬀect
None unless an explicit compensating flow is needed
Lifecycle Eﬀect
• intent_created -> failed
• or pending_confirmation -> failed
2.5 Get Deposit
Endpoint
GET /deposits/{depositId}
Purpose
Return deposit detail.
Allowed Callers
• user, own deposit only
• platform backend
• treasury
• admin
• audit
Response
• depositId
• userId
• status
• chain
• asset
• amount fields
• externalTransactionReference
• timestamps
• failure details if applicable
Financial Eﬀect
None
3. Bet Endpoints
These endpoints manage bet placement and retrieval.
3.1 Place Bet
Endpoint
POST /bets
Purpose
Create and accept a bet for a user on a race selection.
Allowed Callers
• platform backend on behalf of authenticated user
Request
• userId
• raceId
• selectionId
• stakeAmount
• requestReference optional
• idempotencyKey
Response
• betId
• status
• raceId
• selectionId
• stakeAmount
• acceptedAt
• walletBalanceSnapshot optional
Financial Eﬀect
• user_available -> user_locked
Lifecycle Eﬀect
• creates bet in accepted
• or rejects request with no accepted financial eﬀect
Idempotency
Required
Validation Rules
• user owns wallet
• suﬃcient available balance
• pool is open
• race is bettable
• valid selection
• cutoﬀ not passed
3.2 Get Bet
Endpoint
GET /bets/{betId}
Purpose
Return bet detail.
Allowed Callers
• user, own bet only
• platform backend
• admin
• audit
Response
• betId
• userId
• raceId
• selectionId
• stakeAmount
• status
• createdAt
• settledAt optional
• payoutAmount optional
Financial Eﬀect
None
3.3 Get User Bets
Endpoint
GET /users/{userId}/bets
Purpose
Return a user’s bets.
Allowed Callers
• user, own bets only
• platform backend
• admin
• audit
Query Parameters
• raceId optional
• status optional
• fromDate optional
• toDate optional
• page/cursor
Financial Eﬀect
None
4. Pool Endpoints
These endpoints expose pool state and manage lifecycle transitions.
4.1 Get Pool Summary
Endpoint
GET /races/{raceId}/pool
Purpose
Return pool summary for a race.
Allowed Callers
• platform backend
• admin
• audit
Response
• raceId
• poolStatus
• totalPoolAmount
• selectionTotals[]
• selectionId
• public exposure only if intentionally allowed through upstream systems
• totalStake
• cutoﬀTime
• settledAt optional
Financial Eﬀect
None
4.2 Freeze Pool
Endpoint
POST /races/{raceId}/pool/freeze
Purpose
Freeze betting for a race.
Allowed Callers
• platform backend
• authorised system process
Request
• raceId
• freezeReason optional
• eﬀectiveAt
Response
• raceId
• poolStatus
Financial Eﬀect
None directly
Lifecycle Eﬀect
• open -> frozen
Idempotency
Required
Validation Rules
• pool currently open
• cutoﬀ reached or authorised operational trigger
4.3 Void Pool
Endpoint
POST /races/{raceId}/pool/void
Purpose
Void a race pool and initiate refund handling.
Allowed Callers
• authorised admin
• settlement service
• authorised backend process
Request
• reasonCode
• reasonMessage optional
• referenceId
Response
• raceId
• poolStatus
• voidReference
Financial Eﬀect
• triggers refund or unwind flows for accepted bets
Lifecycle Eﬀect
• open -> voided
• or frozen -> voided
Idempotency
Required
5. Settlement Endpoints
These endpoints resolve races financially.
5.1 Start Settlement
Endpoint
POST /settlements/races/{raceId}
Purpose
Start settlement for a frozen race using final authorised result.
Allowed Callers
• settlement service
• platform backend if explicitly authorised
Request
• raceId
• winningSelectionId
• oﬃcialResultReference
• resultTimestamp
• settlementReference
• idempotencyKey
Response
• settlementRunId
• raceId
• status
• poolStatus
• summary optional
Financial Eﬀect
May produce full settlement postings:
• user_locked -> race_selection_pool:<raceId>:<selectionId>
• losing selection pools -> settlement_clearing:<raceId>
• settlement_clearing:<raceId> -> house_revenue
• settlement_clearing:<raceId> -> user_available
Lifecycle Eﬀect
• creates settlement run
• moves pool frozen -> settled
• moves accepted bets to terminal states
Idempotency
Required
Validation Rules
• pool must be frozen
• race not already settled
• oﬃcial result must be authorised
• winning selection must be valid for race
5.2 Get Settlement Summary
Endpoint
GET /settlements/races/{raceId}
Purpose
Return settlement summary for a race.
Allowed Callers
• platform backend
• admin
• audit
• treasury if required
Response
• settlementRunId
• raceId
• winningSelectionId
• totalPoolAmount
• winningPoolAmount
• houseTakeAmount
• distributablePoolAmount
• payoutRatio
• roundingResidual
• completedAt
• status
Financial Eﬀect
None
5.3 Get Settlement Run
Endpoint
GET /settlements/runs/{settlementRunId}
Purpose
Return operational detail for one settlement run.
Allowed Callers
• admin
• audit
• settlement service operators
Financial Eﬀect
None
6. Withdrawal Endpoints
These endpoints manage outgoing user funds.
6.1 Create Withdrawal Request
Endpoint
POST /withdrawals
Purpose
Create a withdrawal request and reserve user funds.
Allowed Callers
• user through trusted backend
• platform backend
Request
• userId
• amount
• chain
• asset
• destinationAddress
• requestReference optional
• idempotencyKey
Response
• withdrawalId
• status
• reservedAmount
• createdAt
Financial Eﬀect
• user_available -> user_withdrawal_reserved
Lifecycle Eﬀect
• creates withdrawal in requested
Idempotency
Required
Validation Rules
• suﬃcient available balance
• valid supported chain
• valid supported asset
• valid destination address
6.2 Approve Withdrawal
Endpoint
POST /withdrawals/{withdrawalId}/approve
Purpose
Approve a requested withdrawal for broadcast.
Allowed Callers
• treasury operator
• authorised admin
• treasury service
Request
• approvalReference
• approvedBy
• notes optional
Response
• withdrawalId
• status
Financial Eﬀect
None directly beyond reserved state already held
Lifecycle Eﬀect
• requested -> approved
Idempotency
Required
6.3 Cancel Withdrawal
Endpoint
POST /withdrawals/{withdrawalId}/cancel
Purpose
Cancel a requested withdrawal before broadcast and return funds.
Allowed Callers
• user, if policy allows and still in cancellable state
• treasury operator
• admin
Request
• reasonCode
• notes optional
Response
• withdrawalId
• status
Financial Eﬀect
• user_withdrawal_reserved -> user_available
Lifecycle Eﬀect
• requested -> cancelled
Idempotency
Required
6.4 Mark Withdrawal Broadcasted
Endpoint
POST /withdrawals/{withdrawalId}/broadcast
Purpose
Record that withdrawal has been sent externally.
Allowed Callers
• treasury service
• treasury operator
Request
• externalTransactionReference
• chain
• broadcastedAt
• feeAmount optional
• metadata optional
Response
• withdrawalId
• status
• externalTransactionReference
Financial Eﬀect
May optionally move:
• user_withdrawal_reserved -> withdrawal_clearing
depending on final posting design
Lifecycle Eﬀect
• approved -> broadcasted
Idempotency
Required
6.5 Confirm Withdrawal
Endpoint
POST /withdrawals/{withdrawalId}/confirm
Purpose
Mark external withdrawal as complete.
Allowed Callers
• treasury service
• treasury operator
Request
• externalTransactionReference
• confirmedAt
• confirmationMetadata optional
Response
• withdrawalId
• status
Financial Eﬀect
Completes external withdrawal accounting
Lifecycle Eﬀect
• broadcasted -> confirmed
Idempotency
Required
6.6 Fail Withdrawal
Endpoint
POST /withdrawals/{withdrawalId}/fail
Purpose
Mark withdrawal as failed.
Allowed Callers
• treasury service
• treasury operator
• authorised admin
Request
• failureReasonCode
• failureMessage optional
• externalTransactionReference optional
Response
• withdrawalId
• status
Financial Eﬀect
Must result in explicit accounting outcome, typically:
• user_withdrawal_reserved -> user_available
or
• withdrawal_clearing -> user_available
depending on where value currently sits
Lifecycle Eﬀect
• approved -> failed
• or broadcasted -> failed
Idempotency
Required
6.7 Get Withdrawal
Endpoint
GET /withdrawals/{withdrawalId}
Purpose
Return withdrawal detail.
Allowed Callers
• user, own withdrawal only
• platform backend
• treasury
• admin
• audit
Financial Eﬀect
None
6.8 Get User Withdrawals
Endpoint
GET /users/{userId}/withdrawals
Purpose
Return a user’s withdrawals.
Allowed Callers
• user, own only
• platform backend
• admin
• audit
Financial Eﬀect
None
7. Audit and Reconciliation Endpoints
These endpoints support operational correctness.
7.1 Run Reconciliation
Endpoint
POST /reconciliation/runs
Purpose
Start a reconciliation job.
Allowed Callers
• audit process
• admin
• treasury operator
Request
• scope
• dateRange optional
• chain optional
• referenceId
Response
• reconciliationRunId
• status
• startedAt
Financial Eﬀect
None directly
7.2 Get Reconciliation Run
Endpoint
GET /reconciliation/runs/{runId}
Purpose
Return reconciliation results.
Allowed Callers
• admin
• audit
• treasury
Financial Eﬀect
None
7.3 Get Discrepancies
Endpoint
GET /reconciliation/discrepancies
Purpose
Return current discrepancy records.
Allowed Callers
• admin
• audit
• treasury
Financial Eﬀect
None
7.4 Get Audit Events
Endpoint
GET /audit/events
Purpose
Return financial audit trail events.
Allowed Callers
• admin
• audit
Query Parameters
• actorType
• actorId
• entityType
• entityId
• fromDate
• toDate
Financial Eﬀect
None
8. Admin / Operational Endpoints
These endpoints are sensitive and should remain tightly restricted.
8.1 Get Race Financial Summary
Endpoint
GET /admin/races/{raceId}/financial-summary
Purpose
Return a full financial summary for one race.
Allowed Callers
• admin
• audit
• settlement operator
Response
• pool totals by selection
• total pool
• house take
• payout ratio
• winner distribution summary
• settlement run detail
• discrepancy flags if any
Financial Eﬀect
None
8.2 Trigger Compensating Flow
This should exist only if you explicitly support operational remediation.
Endpoint
POST /admin/remediation/compensations
Purpose
Trigger a controlled compensating transaction workflow.
Allowed Callers
• very limited admin role
• finance operator role if ever created
Financial Eﬀect
Potentially yes, but only through explicit compensating transactions
Lifecycle Eﬀect
Depends on remediation type
Special Rule
This must never be a shortcut for manual balance editing.
9. Endpoint Design Rules
9.1 No Direct Balance Mutation Endpoint
No endpoint may exist for:
• editing wallet balances directly
• editing ledger entries directly
• changing settlement result directly without compensation flow
9.2 Idempotent Write Endpoints
The following must require idempotency protection:
• place bet
• confirm deposit
• freeze pool
• void pool
• start settlement
• create withdrawal
• approve withdrawal
• cancel withdrawal
• mark withdrawal broadcasted
• confirm withdrawal
• fail withdrawal
9.3 Read and Write Separation
Read endpoints must not produce financial side eﬀects.
9.4 Ownership Enforcement
User-facing endpoints must verify ownership before returning or mutating
resources.
9.5 Trusted Caller Rule
Internal endpoints that aﬀect money must only be callable by authenticated trusted
services or privileged operators.
10. Suggested Endpoint Groups
For implementation clarity, endpoints can be grouped as:
• /wallets
• /deposits
• /bets
• /races/{raceId}/pool
• /settlements
• /withdrawals
• /reconciliation
• /audit
• /admin
This grouping should map cleanly to controllers or route modules.
Final Rule
If an endpoint:
• changes financial state
• changes lifecycle state
• or can indirectly aﬀect balances
then it must have:
• explicit caller rules
• explicit validation rules
• explicit idempotency rules
• explicit auditability
11.Event Catalogue and Async Contracts
Overview
nines-financial may participate in asynchronous communication with other trusted
services and internal background processes.
This section defines the canonical event model for the financial system, including:
• events emitted by nines-financial
• events consumed by nines-financial
• required payload expectations
• delivery and idempotency rules
• ordering and replay expectations
• error-handling rules for async consumers
Async communication must never weaken financial correctness.
If an event is duplicated, delayed, reordered, or retried, the system must still
remain safe.
1. Event Design Principles
1.1 Events describe facts
An event must describe something that has happened, not an instruction
disguised as an event.
Good example:
• bet.accepted
Bad example:
• pleaseSettleRaceNow
1.2 Commands change state, events report state change
Endpoints, handlers, or internal commands are used to request actions.
Events are used to communicate the outcome of those actions.
1.3 Financial correctness does not depend on event delivery
alone
Core financial state must be committed transactionally inside nines-financial.
Events are downstream communication and integration mechanisms.
They must not be the only source of financial truth.
1.4 All consumed events must be idempotent
If the same external event is delivered multiple times, the consumer must not
create duplicate financial eﬀects.
1.5 Event payloads must contain enough context to audit
Each event must contain stable identifiers and references so downstream systems
can reason about what occurred.
2. Canonical Event Envelope
All events should follow a standard envelope shape.
2.1 Required Envelope Fields
Every emitted and consumed event should include:
• eventId
• eventType
• eventVersion
• occurredAt
• producedBy
• correlationId
• causationId
• entityType
• entityId
• payload
2.2 Field Meaning
eventId
Used for:
• deduplication
• audit
• replay tracking
Globally unique identifier for this event instance.
eventType
Stable canonical event name.
Example:
• financial.bet.accepted
eventVersion
Schema version for the event payload.
Allows event evolution without silent breakage.
occurredAt
Timestamp representing when the underlying fact occurred.
producedBy
Service or component that emitted the event.
Example:
• nines-financial
correlationId
Identifier linking multiple actions across a single flow.
Example:
• deposit request flow
• bet placement flow
• settlement flow
causationId
Identifier of the command or prior event that directly caused this event.
entityType
The primary entity represented by the event.
Example:
• bet
• deposit
• withdrawal
• pool
• settlement_run
entityId
Identifier of that entity.
payload
Event-specific data.
3. Events Emitted by nines-financial
These are facts produced after internal state transitions succeed.
3.1 Wallet Events
3.1.1 financial.wallet.balance_changed
Emitted when a wallet’s balance projection changes as the result of a financial
transaction.
Trigger
• deposit confirmation
• bet acceptance
• settlement payout
• withdrawal reservation
• withdrawal failure release
• refund/void handling
Payload
• userId
• currency
• availableBalance
• lockedBalance
• withdrawalReservedBalance
• totalBalance
• reasonType
• reasonReference
Notes
This is a notification event, not the source of truth.
3.2 Deposit Events
3.2.1 financial.deposit.intent_created
Emitted when a deposit intent is created.
Payload
• depositId
• userId
• chain
• asset
• expectedAmount optional
• status
3.2.2 financial.deposit.pending_confirmation
Emitted when a deposit is observed and awaiting final confirmation.
Payload
• depositId
• userId
• chain
• asset
• externalTransactionReference
• observedAmount
• status
3.2.3 financial.deposit.confirmed
Emitted after a verified deposit is credited.
Payload
• depositId
• userId
• chain
• asset
• creditedAmount
• externalTransactionReference
• ledgerTransactionReference
• status
Financial Meaning
Funds have entered the user’s internal available balance.
3.2.4 financial.deposit.failed
Emitted when a deposit fails or is rejected.
Payload
• depositId
• userId
• status
• failureReasonCode
• externalTransactionReference optional
3.3 Bet Events
3.3.1 financial.bet.accepted
Emitted when a bet is successfully accepted.
Payload
• betId
• userId
• raceId
• selectionId
• stakeAmount
• status
• ledgerTransactionReference
Financial Meaning
Funds have moved from:
• user_available
to
• user_locked
3.3.2 financial.bet.rejected
Emitted when a bet request is rejected.
Payload
• userId
• raceId
• selectionId
• stakeAmount
• status
• reasonCode
• requestReference optional
Financial Meaning
No accepted bet was created and no committed stake was reserved.
3.3.3 financial.bet.voided
Emitted when an accepted bet is voided.
Payload
• betId
• userId
• raceId
• selectionId
• stakeAmount
• status
• voidReasonCode
• ledgerTransactionReference optional
3.3.4 financial.bet.settled_win
Emitted when a bet settles as a winner.
Payload
• betId
• userId
• raceId
• selectionId
• stakeAmount
• payoutAmount
• settlementRunId
• status
• ledgerTransactionReference
3.3.5 financial.bet.settled_loss
Emitted when a bet settles as a loser.
Payload
• betId
• userId
• raceId
• selectionId
• stakeAmount
• settlementRunId
• status
• ledgerTransactionReference optional
3.4 Pool Events
3.4.1 financial.pool.opened
Optional event if pool creation is modelled explicitly.
Payload
• raceId
• status
• openedAt
3.4.2 financial.pool.frozen
Emitted when betting closes for a race.
Payload
• raceId
• status
• frozenAt
• totalPoolAmount
• selectionTotals
Notes
Selection totals may be included if stable and useful downstream.
3.4.3 financial.pool.voided
Emitted when a pool is voided.
Payload
• raceId
• status
• reasonCode
• voidedAt
3.4.4 financial.pool.settled
Emitted when a pool is fully settled.
Payload
• raceId
• status
• winningSelectionId
• totalPoolAmount
• winningPoolAmount
• houseTakeAmount
• distributablePoolAmount
• payoutRatio
• roundingResidual
• settlementRunId
• settledAt
3.5 Settlement Events
3.5.1 financial.settlement.started
Emitted when settlement execution begins.
Payload
• settlementRunId
• raceId
• winningSelectionId
• oﬃcialResultReference
• status
3.5.2 financial.settlement.completed
Emitted when settlement execution completes successfully.
Payload
• settlementRunId
• raceId
• winningSelectionId
• totalPoolAmount
• houseTakeAmount
• distributablePoolAmount
• payoutRatio
• status
• completedAt
3.5.3 financial.settlement.failed
Emitted when settlement execution fails.
Payload
• settlementRunId
• raceId
• status
• failureReasonCode
• failureMessage optional
3.6 Withdrawal Events
3.6.1 financial.withdrawal.requested
Emitted when a withdrawal request is created.
Payload
• withdrawalId
• userId
• amount
• chain
• asset
• destinationAddress
• status
3.6.2 financial.withdrawal.approved
Emitted when a withdrawal is approved.
Payload
• withdrawalId
• userId
• amount
• approvedBy
• status
3.6.3 financial.withdrawal.cancelled
Emitted when a withdrawal is cancelled before broadcast.
Payload
• withdrawalId
• userId
• amount
• reasonCode
• status
3.6.4 financial.withdrawal.broadcasted
Emitted when a withdrawal is sent externally.
Payload
• withdrawalId
• userId
• amount
• chain
• asset
• externalTransactionReference
• status
3.6.5 financial.withdrawal.confirmed
Emitted when a withdrawal is externally confirmed.
Payload
• withdrawalId
• userId
• amount
• chain
• asset
• externalTransactionReference
• status
• confirmedAt
3.6.6 financial.withdrawal.failed
Emitted when a withdrawal fails.
Payload
• withdrawalId
• userId
• amount
• status
• failureReasonCode
• externalTransactionReference optional
3.7 Audit and Reconciliation Events
3.7.1 financial.reconciliation.started
Emitted when a reconciliation run starts.
3.7.2 financial.reconciliation.completed
Emitted when a reconciliation run completes.
Payload
• reconciliationRunId
• status
• discrepancyCount
• completedAt
3.7.3 financial.discrepancy.detected
Emitted when a discrepancy is identified.
Payload
• discrepancyId
• scope
• severity
• entityType
• entityId
• reasonCode
4. Events Consumed by nines-financial
These are events produced by trusted external or sibling services and consumed
asynchronously by nines-financial.
These consumers must all be idempotent.
4.1 Race Events
4.1.1 race.pool.freeze_requested
Produced by:
• platform backend
• race lifecycle service
Meaning
The betting window for a race should now close.
Expected Consumer Behaviour
• validate race/pool exists
• transition pool open -> frozen if valid
• ignore duplicate delivery safely
Notes
This may map internally to the same logic as POST /races/{raceId}/pool/freeze
4.1.2 race.result.finalised
Produced by:
• race authority
• race backend
Meaning
Oﬃcial final race outcome is available.
Payload
• raceId
• winningSelectionId
• oﬃcialResultReference
• resultTimestamp
Expected Consumer Behaviour
• validate pool is frozen
• start settlement if not already completed
• reject unoﬃcial or duplicate conflicting result
4.1.3 race.voided
Produced by:
• race authority
• platform backend
Meaning
The race outcome is invalid or the event is cancelled.
Expected Consumer Behaviour
• void pool if not terminal
• trigger refund logic for accepted bets
• ignore duplicate redelivery safely
4.2 Treasury / Blockchain Events
4.2.1 treasury.deposit.detected
Produced by:
• treasury listener
• blockchain observer
Meaning
An incoming external deposit has been observed.
Expected Consumer Behaviour
• match to deposit intent or create appropriate tracking path
• move deposit into pending_confirmation if valid
• do not credit user funds yet
4.2.2 treasury.deposit.confirmed
Produced by:
• treasury listener
• chain adapter service
Meaning
A deposit is confirmed according to external finality rules.
Expected Consumer Behaviour
• verify not already credited
• confirm deposit
• credit user funds
• emit financial.deposit.confirmed
4.2.3 treasury.withdrawal.broadcasted
Produced by:
• treasury service
Meaning
The withdrawal tx has been sent externally.
Expected Consumer Behaviour
• move withdrawal approved -> broadcasted
• attach external reference
• remain idempotent
4.2.4 treasury.withdrawal.confirmed
Produced by:
• treasury service
• chain adapter
Meaning
The external withdrawal is considered complete.
Expected Consumer Behaviour
• move withdrawal broadcasted -> confirmed
• remain idempotent
• avoid duplicate completion eﬀects
4.2.5 treasury.withdrawal.failed
Produced by:
• treasury service
• chain adapter
Meaning
The external withdrawal did not complete.
Expected Consumer Behaviour
• transition withdrawal to failed
• execute defined fund return or investigation path
• emit financial.withdrawal.failed
5. Internal Async Events
These may be emitted and consumed entirely within the financial service boundary
for projections, notifications, and background tasks.
5.1 Projection Refresh Events
Examples:
• financial.projection.wallet_refresh_requested
• financial.projection.pool_refresh_requested
Used for:
• rebuilding read models
• async cache refresh
• dashboard updates
These must not be required for ledger correctness.
5.2 Notification Events
Examples:
• financial.notification.user_payout_ready
• financial.notification.withdrawal_status_changed
These are side-eﬀect events for messaging and UI, not financial truth.
5.3 Audit Stream Events
A financial event stream may be mirrored into audit tooling for:
• operator review
• compliance support
• debugging
• analytics
This stream must not become the only source of truth.
6. Async Contract Rules
6.1 Consumer Idempotency
Every event consumer must safely handle:
• duplicate delivery
• replay delivery
• retry delivery
This usually requires:
• eventId deduplication
• or deterministic entity-state checks
• or both
6.2 At-Least-Once Delivery Compatibility
The system must assume events may be delivered at least once, not exactly once.
6.3 Out-of-Order Delivery Tolerance
Where possible, consumers must tolerate out-of-order delivery.
Examples:
• receiving a repeated confirmation after terminal state reached
• receiving stale broadcast event after confirmed state already applied
Invalid backwards transitions must be ignored or rejected safely.
6.4 No Blind Trust in Event Payloads
Consumed events must still be validated against internal state.
Examples:
• only settle if pool is frozen
• only confirm deposit if not already confirmed
• only confirm withdrawal if broadcasted
6.5 Eventual Consistency Is Allowed for Read Models
Read projections, dashboards, and notifications may be eventually consistent.
Financial truth must not be eventually consistent in a way that allows double spend
or duplicate payout.
7. Ordering Rules
7.1 Per-Entity Ordering Preferred
For entities like:
• withdrawal
• deposit
• settlement run
processing should preserve order where practical.
7.2 Terminal State Protection
If an entity is already terminal:
• later stale events must not reopen or rewrite the lifecycle
7.3 Pool and Settlement Ordering
The intended ordering is:
• pool frozen
• oﬃcial race result finalised
• settlement started
• settlement completed
• pool settled
• bet terminal events emitted
If events arrive diﬀerently, the consumer must still preserve correct internal
sequencing.
8. Replay and Recovery Rules
8.1 Event Replay Must Be Safe
Replaying emitted or consumed events must not create duplicate financial eﬀects.
8.2 State Recovery Uses Database Truth
Recovery after crash or restart must rely on:
• persisted entities
• ledger records
• idempotency records
Not on whether an event was “probably sent.”
8.3 Emission Retry Must Be Supported
If event publication fails after state commit, the system must have a reliable way to
retry emission without repeating the financial transaction.
This strongly suggests:
• outbox pattern
or
• equivalent durable event publication mechanism
9. Recommended Delivery Pattern
For financial reliability, emitted events should use a durable outbox approach.
9.1 Outbox Pattern Recommendation
When internal state changes successfully:
• persist business state
• persist ledger state
• persist outbox event records
in the same transaction
Then publish asynchronously from the outbox.
Why
This prevents:
• committed money state with lost events
• event publication race conditions
• hard-to-debug downstream inconsistencies
9.2 Consumer Tracking Recommendation
Consumed event handlers should track:
• eventId
• eventType
• processedAt
• processing outcome
This helps:
• dedupe
• audit retries
• support replay analysis
10. Versioning Rules
10.1 Events Must Be Versioned
Every event type must include an explicit version.
10.2 Breaking Changes Require New Version
If payload meaning changes incompatibly, emit a new version.
Do not silently repurpose old fields.
10.3 Stable Event Names
Event names should remain stable and descriptive.
Recommended naming pattern:
financial.<entity>.<past_tense_action>
Examples:
• financial.bet.accepted
• financial.deposit.confirmed
• financial.pool.frozen
11. Forbidden Async Patterns
The following are not allowed:
• using events as the only record of financial truth
• applying financial eﬀects from unaudited fire-and-forget handlers
• assuming exactly-once delivery
• assuming consumer success means publisher success
• letting duplicate events create duplicate payouts, credits, or reservations
12. Final Rule
If an async handler can cause:
• a balance change
• a lifecycle transition
• a payout
• a deposit credit
• a withdrawal completion
then it must have:
• explicit idempotency protection
• explicit state validation
• explicit auditability
• safe retry behaviour
12.Core Money Flows
Overview
This section defines the canonical end-to-end money flows in nines-financial.
Each flow describes:
• trigger
• actors involved
• preconditions
• state transitions
• ledger movements
• emitted events
• failure handling
• idempotency expectations
These flows are the operational backbone of the system.
If implementation behaviour diﬀers from these flows, the implementation is wrong
unless the document is updated first.
1. Deposit Flow
Purpose
Bring externally transferred value into a user’s internal wallet balance.
Actors
• user
• platform backend
• treasury service / chain listener
• nines-financial
Preconditions
• user exists
• supported chain and asset are used
• destination or routing details are valid
• deposit has not already been credited
Flow
Step 1
—
Create deposit intent
A user initiates a deposit through the platform.
Action:
• create deposit record
State:
• deposit → intent_created
Ledger eﬀect:
• none
Event:
• financial.deposit.intent_created
Step 2
—
Detect external deposit
Treasury listener or chain-aware service observes an incoming external
transaction.
Action:
• attach observed external transaction reference
• move deposit to pending confirmation
State:
• intent_created -> pending_confirmation
Ledger eﬀect:
• none
Event:
• financial.deposit.pending_confirmation
Step 3
—
Confirm external finality
Treasury service confirms the external transaction satisfies required confirmation
rules.
Validation:
• deposit not already confirmed
• external transaction reference is valid
• no duplicate credit exists
• amount and asset are acceptable
Action:
• confirm deposit
• credit user funds
State:
• pending_confirmation -> confirmed
Ledger movement:
• deposit_clearing -> user_available
Event:
• financial.deposit.confirmed
• financial.wallet.balance_changed
Failure Paths
Invalid or unsupported deposit
State:
• deposit → failed
Ledger eﬀect:
• none
Event:
• financial.deposit.failed
Duplicate confirmation attempt
Result:
• no duplicate credit
• existing confirmed result returned or duplicate safely ignored
Idempotency Rule
Deposit confirmation must be idempotent by:
• depositId
• externalTransactionReference
• command idempotency key if present
2. Bet Placement Flow
Purpose
Reserve a user’s funds for participation in a parimutuel race selection.
Actors
• user
• platform backend
• nines-financial
Preconditions
• user wallet exists
• pool for race exists and is open
• selection is valid for the race
• user has suﬃcient available balance
• cutoﬀ has not passed
Flow
Step 1
—
Submit bet request
The platform backend submits a bet placement request on behalf of an
authenticated user.
Validation:
• request is authorised
• idempotency key is present
• stake amount is valid
• race and selection are valid
Step 2
—
Validate spendable balance
System verifies:
• user_available >= stakeAmount
If not:
• reject bet
State:
• bet → rejected
Ledger eﬀect:
• none
Event:
• financial.bet.rejected
Step 3
—
Accept bet and reserve funds
If validation passes:
Action:
• create bet record
• move funds from spendable balance into locked balance
State:
• bet → accepted
Ledger movement:
• user_available -> user_locked
Event:
• financial.bet.accepted
• financial.wallet.balance_changed
Important Note
At this stage, funds are locked, not yet moved into selection pool accounts.
Selection pool accounts are populated during settlement processing from
accepted bets.
This preserves a clean model:
• active bet exposure remains in user_locked
• settlement transforms exposure into pool resolution
Failure Paths
Pool not open
• reject bet
• no ledger movement
Cutoﬀ passed
• reject bet
• no ledger movement
Duplicate request
• return prior accepted or rejected result safely
• no duplicate locked funds
Idempotency Rule
Bet placement must be idempotent by:
• caller idempotency key
• userId
• request reference where applicable
3. Pool Freeze Flow
Purpose
Close betting for a race and lock the pool composition before settlement.
Actors
• platform backend
• race lifecycle service
• nines-financial
Preconditions
• pool exists
• pool is open
Flow
Step 1
—
Freeze pool
Action:
• mark pool closed to new bets
State:
• open -> frozen
Ledger eﬀect:
• none
Event:
• financial.pool.frozen
Postconditions
• no new accepted bets allowed
• accepted bet set is final
• selection totals are final by reference to accepted bets
• settlement may now begin
Failure Paths
Pool already frozen
• return existing terminal or current frozen state
• no duplicate side eﬀect
Idempotency Rule
Pool freeze must be idempotent by raceId and lifecycle command reference.
4. Settlement Flow
Purpose
Resolve a frozen parimutuel race using final authorised race result.
This is the most important financial flow in the system.
Actors
• settlement service
• race authority / backend
• nines-financial
Preconditions
• pool is frozen
• race result is authorised
• race not already settled
• accepted bets exist or empty-settlement path is explicitly supported
Flow
Step 1
—
Start settlement run
Action:
• create settlement run
State:
• settlement run → pending -> running
Event:
• financial.settlement.started
Step 2
—
Load accepted bets
System loads all bets in accepted state for the race.
These bets determine:
• total pool
• selection totals
• winning bettors
• losing bettors
Validation:
• all bets belong to same race
• all selections valid for race
• no already-settled accepted bets for this race
Step 3
—
Move accepted stake into selection pool accounts
For each accepted bet:
Ledger movement:
• user_locked -> race_selection_pool:<raceId>:<selectionId>
Purpose:
• make the parimutuel pool explicit in the ledger
• populate selection-level ledger truth
At the end of this step:
• sum of all selection pool accounts = total valid race pool
Step 4
—
Identify winning selection
System uses authorised final result to identify:
• winning selection
• winning selection pool amount
• total pool amount
Derived values:
• totalPool = sum of all selection pool accounts
• winningPool = balance of winning selection pool account
Step 5
—
For each losing selection account:
Move losing selection pools into settlement clearing
Ledger movement:
• race_selection_pool:<raceId>:<losingSelectionId> ->
settlement_clearing:<raceId>
Purpose:
• centralise losing stake value for house take and winner distribution
Step 6
—
Move winning selection pool into settlement
calculation context
There are two valid accounting styles here. For this spec, use the clearer one:
Move winning selection pool into settlement clearing as well.
Ledger movement:
• race_selection_pool:<raceId>:<winningSelectionId> ->
settlement_clearing:<raceId>
Now:
• settlement_clearing:<raceId> holds the entire total pool
This makes:
• house take allocation
• payout distribution
explicit and easy to audit
Step 7
—
Calculate house take
Compute:
• houseTakeAmount = totalPool * houseTakeRule
Ledger movement:
• settlement_clearing:<raceId> -> house_revenue
Purpose:
• isolate platform revenue from player funds
Step 8
—
Calculate distributable pool
Compute:
• distributablePool = totalPool - houseTakeAmount
Compute payout ratio:
• payoutRatio = distributablePool / winningPool
Rounding policy:
• must use deterministic minor-unit rules
• any residual must be handled deterministically
Step 9
—
Distribute payouts to winners
For each winning bet:
Compute:
• winnerPayoutAmount = deterministic share of distributablePool based on
stake proportion
Ledger movement:
• settlement_clearing:<raceId> -> user_available
State:
• winning bets → settled_win
Event:
• financial.bet.settled_win
Step 10
—
Finalise losing bets
State:
• losing bets → settled_loss
Event:
• financial.bet.settled_loss
No separate loser payout exists because losing value was already moved into
clearing and distributed.
Step 11
—
Close settlement
Validation:
• settlement clearing fully resolved except any explicitly allowed residual
handling result
• selection pool accounts drained to zero
• all accepted bets terminal
• pool totals consistent
State:
• pool → settled
• settlement run → completed
Event:
• financial.pool.settled
• financial.settlement.completed
• financial.wallet.balance_changed for aﬀected winners
Important Settlement Accounting Rule
This flow assumes gross distributable payout already includes the winner’s
returned stake because the whole pool, including winning stakes, enters
settlement clearing before house take and payout distribution.
That is the cleanest model for parimutuel accounting.
Failure Paths
Race already settled
• do not rerun financial eﬀect
• return prior completed result or reject safely
Settlement calculation failure before commit
• no partial settlement should persist
• settlement run may transition to failed
Post-commit event emission failure
• settlement remains committed
• outbox retry handles event publication
Idempotency Rule
Settlement must be idempotent by:
• raceId
• oﬃcial result reference
• settlement reference / idempotency key
5. Void Pool / Refund Flow
Purpose
Return user funds when a race or pool is invalidated.
Actors
• admin
• settlement service
• platform backend
• nines-financial
Preconditions
• pool is open or frozen
• race outcome invalid or pool must be voided
• race not already settled
Flow
Step 1
—
Void pool
State:
• pool → voided
Event:
• financial.pool.voided
Step 2
—
Identify accepted bets
Load all accepted bets for the race.
Step 3
—
Return locked stake
For each accepted bet:
Ledger movement:
• user_locked -> user_available
State:
• bet → voided
Event:
• financial.bet.voided
• financial.wallet.balance_changed
Postconditions
• all aﬀected bets terminal
• no pool settlement occurs
• no house take occurs
• no payout ratio occurs
Idempotency Rule
Pool void must be idempotent by raceId and void reference.
6. Withdrawal Request Flow
Purpose
Reserve user funds for withdrawal.
Actors
• user
• platform backend
• nines-financial
Preconditions
• wallet exists
• suﬃcient available balance
• supported chain and asset
• destination address valid
Flow
Step 1
—
Submit withdrawal request
Validation:
• user ownership
• available balance suﬃcient
• amount valid
• withdrawal destination valid
Step 2
—
Reserve funds
Action:
• create withdrawal record
State:
• withdrawal → requested
Ledger movement:
• user_available -> user_withdrawal_reserved
Event:
• financial.withdrawal.requested
• financial.wallet.balance_changed
Failure Paths
Insuﬃcient funds
• reject request
• no ledger movement
Invalid destination
• reject request
• no ledger movement
Idempotency Rule
Withdrawal request must be idempotent by caller idempotency key and request
reference.
7. Withdrawal Approval Flow
Purpose
Approve a requested withdrawal for execution.
Actors
• treasury operator
• admin
• treasury service
• nines-financial
Preconditions
• withdrawal is requested
Flow
Step 1
—
Approve withdrawal
State:
• requested -> approved
Ledger eﬀect:
• none
Event:
• financial.withdrawal.approved
Failure Paths
Already approved or terminal
• no duplicate side eﬀect
• return current state or reject safely
Idempotency Rule
Approval must be idempotent by withdrawalId and approval reference.
8. Withdrawal Broadcast Flow
Purpose
Record that an approved withdrawal has been sent externally.
Actors
• treasury service
• treasury operator
• nines-financial
Preconditions
• withdrawal is approved
• external transaction reference available
Flow
Step 1
—
Mark withdrawal broadcasted
State:
• approved -> broadcasted
Optional ledger movement, if you want the clearing step explicit here:
• user_withdrawal_reserved -> withdrawal_clearing
I recommend yes, because it makes external movement explicit.
Event:
• financial.withdrawal.broadcasted
Idempotency Rule
Broadcast handling must be idempotent by withdrawalId and
externalTransactionReference.
9. Withdrawal Confirmation Flow
Purpose
Finalise an externally completed withdrawal.
Actors
• treasury service
• treasury operator
• nines-financial
Preconditions
• withdrawal is broadcasted
• external confirmation rules satisfied
Flow
Step 1
—
Confirm withdrawal
State:
• broadcasted -> confirmed
Ledger eﬀect:
• if clearing was used at broadcast stage, withdrawal_clearing is now
considered externally completed and closed through the treasury boundary
record
• no return to user balance
Event:
• financial.withdrawal.confirmed
Postconditions
• withdrawal complete
• user no longer owns those funds internally
• external reference recorded
Idempotency Rule
Withdrawal confirmation must be idempotent by withdrawalId and
externalTransactionReference.
10. Withdrawal Failure Flow
Purpose
Handle a withdrawal that did not complete.
Actors
• treasury service
• treasury operator
• admin
• nines-financial
Preconditions
• withdrawal is approved or broadcasted
Flow
Case A
—
Failure before broadcast clearing move
If funds are still in user_withdrawal_reserved:
Ledger movement:
• user_withdrawal_reserved -> user_available
Case B
—
Failure after broadcast clearing move
If funds already moved to withdrawal_clearing:
Ledger movement:
• withdrawal_clearing -> user_available
State:
• withdrawal → failed
Event:
• financial.withdrawal.failed
• financial.wallet.balance_changed
Postconditions
• no silent loss
• user funds explicitly accounted for
• failure reason preserved
Idempotency Rule
Withdrawal failure handling must be idempotent by withdrawalId and failure
reference.
11. Reconciliation Flow
Purpose
Verify internal financial records match external and derived truth.
Actors
• audit process
• admin
• treasury operator
• nines-financial
Preconditions
• reconciliation scope defined
• relevant data sources available
Flow
Step 1
State:
Event:
—
Start reconciliation run
• reconciliation run created
• financial.reconciliation.started
Step 2
—
Compare records
Examples:
• deposits vs external tx references
• withdrawals vs external confirmations
• wallet balances vs ledger-derived projections
• settlement totals vs pool totals
• house take totals vs expected calculations
Step 3
—
Record discrepancies
If mismatch found:
• create discrepancy records
• emit financial.discrepancy.detected
Step 4
Event:
—
Complete run
• financial.reconciliation.completed
Financial Eﬀect
None directly
12. Cross-Flow Rules
12.1 No flow may bypass the ledger
Any balance-aﬀecting flow must produce defined ledger postings.
12.2 No flow may bypass lifecycle rules
Each flow must respect the entity state machines.
12.3 No flow may bypass idempotency
Any externally triggered money-aﬀecting flow must be safe under retry.
12.4 Every terminal result must be explainable
For every deposit, bet, settlement, withdrawal, or refund, the system must be able
to answer:
• what happened
• when
• why
• which ledger transaction(s) represent it
13. Final Rule
If a money-aﬀecting operation cannot be described as:
• a valid lifecycle transition
• plus valid ledger movements
• plus valid events
• plus safe retry behaviour
then it must not be implemented until the flow is defined here.
13.DB Schema
Overview
The nines-financial database schema must support:
• append-only ledger accounting
• wallet balance reconstruction
• bet lifecycle management
• parimutuel pool accounting using selection-level accounts
• settlement execution and auditability
• deposit and withdrawal lifecycle tracking
• idempotency protection
• reconciliation and discrepancy tracking
• durable async event publication
The schema should favour:
• correctness over cleverness
• explicit relationships
• immutable financial records
• strong constraints
• reproducible settlement data
1. Schema Design Principles
1.1 Financial truth is persisted
All money-aﬀecting actions must be represented in durable records.
1.2 Ledger records are append-only
Ledger transactions and ledger entries must never be updated to alter historical
meaning.
1.3 Lifecycle entities are explicit
Bets, pools, deposits, withdrawals, and settlement runs must each have their own
lifecycle records.
1.4 Derived balances are reconstructable
Wallet balances must be derivable from ledger entries and account mappings.
1.5 Idempotency is first-class
Externally triggered commands must be protected by durable idempotency
records.
1.6 Async publication is durable
If events are emitted, outbox storage must be persisted transactionally with state
changes.
2. Core Table Groups
The schema is organised into these groups:
1. wallet and account tables
2. ledger tables
3. betting and pool tables
4. settlement tables
5. treasury tables
6. idempotency and async tables
7. audit and reconciliation tables
3. Wallet and Account Tables
These tables define wallet ownership and ledger account structure.
3.1 wallets
Purpose
Represents the financial wallet belonging to a user.
Important columns
• wallet_id PK
• user_id unique not null
• currency_code not null
• status not null
• created_at not null
• updated_at not null
Notes
• one wallet per user for v1
• currency_code should likely be USDC
• wallet status may be useful for future holds or restrictions
Constraints
• unique(user_id)
Indexes
• unique index on user_id
3.2 ledger_accounts
Purpose
Defines every internal ledger account.
This includes:
• user accounts
• selection pool accounts
• settlement clearing accounts
• house accounts
• deposit/withdrawal clearing accounts
• adjustment accounts
Important columns
• ledger_account_id PK
• account_code unique not null
• account_type not null
• owner_type not null
• owner_id nullable
• wallet_id nullable
• race_id nullable
• selection_id nullable
• currency_code not null
• status not null
• created_at not null
Example account codes
• user_available:<walletId>
• user_locked:<walletId>
• user_withdrawal_reserved:<walletId>
• race_selection_pool:<raceId>:<selectionId>
• settlement_clearing:<raceId>
• house_revenue
• deposit_clearing
• withdrawal_clearing
• adjustment_reserve
Constraints
• unique(account_code)
• account type must align with ownership fields
• race selection pool accounts require both race_id and selection_id
• wallet-owned accounts require wallet_id
Indexes
• unique index on account_code
• index on (wallet_id, account_type)
• index on (race_id, account_type)
• index on (race_id, selection_id, account_type)
4. Ledger Tables
These are the core financial truth tables.
4.1 ledger_transactions
Purpose
Represents a grouped financial transaction.
Examples:
• deposit credit
• bet acceptance
• withdrawal reservation
• settlement payout
• void refund
• compensating correction
Important columns
• ledger_transaction_id PK
• transaction_type not null
• reference_id unique not null
• correlation_id nullable
• causation_id nullable
• entity_type nullable
• entity_id nullable
• description nullable
• posted_at not null
• created_by_actor_type not null
• created_by_actor_id nullable
• created_at not null
Constraints
• unique(reference_id)
Indexes
• unique index on reference_id
• index on (entity_type, entity_id)
• index on transaction_type
• index on posted_at
• index on correlation_id
4.2 ledger_entries
Purpose
Represents individual debits and credits within a ledger transaction.
Important columns
• ledger_entry_id PK
• ledger_transaction_id FK not null
• ledger_account_id FK not null
• entry_type not null // debit or credit
• amount_minor bigint not null
• currency_code not null
• entry_sequence not null
• created_at not null
Constraints
• amount_minor > 0
• valid enum for entry_type
• transaction currency consistency enforced at application level or DB
constraint layer if practical
Indexes
• index on ledger_transaction_id
• index on ledger_account_id
• index on (ledger_account_id, created_at)
Critical rule
Balance checks happen at transaction creation time. The DB should not rely only
on application goodwill.
5. Betting and Pool Tables
These tables represent bets and pool lifecycle.
5.1 race_pools
Purpose
Represents the pool lifecycle for a race.
Even though pool funds live in selection-level ledger accounts, the race pool entity
still owns:
• pool status
• cutoﬀ
• freeze state
• settlement linkage
Important columns
• race_pool_id PK
• race_id unique not null
• status not null
• cutoﬀ_at not null
• opened_at nullable
• frozen_at nullable
• settled_at nullable
• voided_at nullable
• void_reason_code nullable
• created_at not null
• updated_at not null
Constraints
• unique(race_id)
Indexes
• unique index on race_id
• index on status
• index on cutoﬀ_at
5.2 pool_selections
Purpose
Defines valid selections for a race pool.
This table is useful so the financial system knows:
• which selections are valid
• which selection account should exist
Important columns
• pool_selection_id PK
• race_pool_id FK not null
• race_id not null
• selection_id not null
• selection_status not null
• created_at not null
Constraints
• unique(race_id, selection_id)
Indexes
• unique index on (race_id, selection_id)
• index on race_pool_id
5.3 bets
Purpose
Represents an accepted or rejected user bet.
Important columns
• bet_id PK
• user_id not null
• wallet_id not null
• race_id not null
• selection_id not null
• stake_amount_minor bigint not null
• status not null
• request_reference nullable
• idempotency_key nullable
• accepted_ledger_transaction_id nullable
• settlement_run_id nullable
• payout_amount_minor nullable
• void_reason_code nullable
• created_at not null
• updated_at not null
• accepted_at nullable
• settled_at nullable
• voided_at nullable
• rejected_at nullable
• rejection_reason_code nullable
Constraints
• stake_amount_minor > 0
• status must be valid enum
• accepted bets should have accepted timestamp
• terminal statuses should have relevant terminal timestamp
Indexes
• index on user_id
• index on (race_id, status)
• index on (race_id, selection_id)
• index on wallet_id
• index on settlement_run_id
• unique index on (user_id, idempotency_key) where not null if you want per-
user idempotency
• unique index on request_reference where not null if that is treated as unique
Notes
Even rejected bets may be worth persisting for audit.
6. Settlement Tables
These tables support settlement execution and reproducibility.
6.1 settlement_runs
Purpose
Represents one settlement attempt/execution for a race.
Important columns
• settlement_run_id PK
• race_id not null
• race_pool_id not null
• status not null
• winning_selection_id nullable
• oﬃcial_result_reference not null
• house_take_bps not null
• house_take_amount_minor nullable
• total_pool_amount_minor nullable
• winning_pool_amount_minor nullable
• distributable_pool_amount_minor nullable
• payout_ratio_numerator nullable
• payout_ratio_denominator nullable
• rounding_residual_minor nullable
• idempotency_key nullable
• started_at nullable
• completed_at nullable
• failed_at nullable
• failure_reason_code nullable
• created_at not null
Constraints
• one completed settlement per race
• no concurrent active runs for same race
• oﬃcial result reference should be stable
Indexes
• index on race_id
• index on (race_id, status)
• unique index on (race_id) where status = completed
• unique index on (race_id, idempotency_key) where not null
6.2 settlement_payouts
Purpose
Represents per-bet payout outcomes for a settlement run.
This makes payout audit easy without forcing payout inspection entirely through
ledger joins.
Important columns
• settlement_payout_id PK
• settlement_run_id FK not null
• bet_id FK not null
• user_id not null
• race_id not null
• selection_id not null
• stake_amount_minor not null
• payout_amount_minor not null
• profit_amount_minor not null
• is_winner not null
• ledger_transaction_id nullable
• created_at not null
Constraints
• unique(settlement_run_id, bet_id)
Indexes
• unique index on (settlement_run_id, bet_id)
• index on bet_id
• index on user_id
• index on race_id
7. Treasury Tables
These tables track deposits and withdrawals.
7.1 deposits
Purpose
Tracks incoming funds from external systems.
Important columns
• deposit_id PK
• user_id not null
• wallet_id not null
• status not null
• chain not null
• asset not null
• expected_amount_minor nullable
• observed_amount_minor nullable
• credited_amount_minor nullable
• source_address nullable
• destination_address nullable
• external_transaction_reference nullable
• block_reference nullable
• idempotency_key nullable
• confirmed_ledger_transaction_id nullable
• failure_reason_code nullable
• created_at not null
• updated_at not null
• pending_confirmation_at nullable
• confirmed_at nullable
• failed_at nullable
Constraints
• a confirmed deposit must have external transaction reference
• credited deposit must not exist twice for same external reference on same
chain/asset
Indexes
• index on user_id
• index on wallet_id
• index on status
• unique index on (chain, asset, external_transaction_reference) where not
null
• unique index on (user_id, idempotency_key) where not null
7.2 withdrawals
Purpose
Tracks outgoing withdrawal requests and lifecycle.
Important columns
• withdrawal_id PK
• user_id not null
• wallet_id not null
• status not null
• chain not null
• asset not null
• amount_minor not null
• destination_address not null
• request_reference nullable
• idempotency_key nullable
• external_transaction_reference nullable
• approval_reference nullable
• failure_reason_code nullable
• reserved_ledger_transaction_id nullable
• broadcast_ledger_transaction_id nullable
• release_ledger_transaction_id nullable
• requested_at nullable
• approved_at nullable
• broadcasted_at nullable
• confirmed_at nullable
• failed_at nullable
• cancelled_at nullable
• created_at not null
• updated_at not null
Constraints
• amount_minor > 0
• confirmed withdrawal must have external transaction reference
• approved/broadcasted/confirmed states require prior valid state path
Indexes
• index on user_id
• index on wallet_id
• index on status
• unique index on (chain, external_transaction_reference) where not null
• unique index on (user_id, idempotency_key) where not null
• unique index on request_reference where not null
8. Idempotency and Async Tables
These tables make retries safe and publication durable.
8.1 idempotency_keys
Purpose
Stores externally supplied idempotency records and processing outcomes.
Important columns
• idempotency_key_id PK
• scope not null
• idempotency_key not null
• request_hash nullable
• entity_type nullable
• entity_id nullable
• response_snapshot nullable/json
• status not null
• created_at not null
• updated_at not null
• completed_at nullable
Suggested scopes
• bet_place
• deposit_confirm
• pool_freeze
• pool_void
• settlement_start
• withdrawal_create
• withdrawal_approve
• withdrawal_broadcast
• withdrawal_confirm
• withdrawal_fail
Constraints
• unique(scope, idempotency_key)
Indexes
• unique index on (scope, idempotency_key)
• index on (entity_type, entity_id)
8.2 outbox_events
Purpose
Durably stores events to be published asynchronously after successful transaction
commit.
Important columns
• outbox_event_id PK
• event_id unique not null
• event_type not null
• event_version not null
• entity_type not null
• entity_id not null
• correlation_id nullable
• causation_id nullable
• payload_json not null
• publish_status not null
• publish_attempt_count not null default 0
• last_publish_attempt_at nullable
• published_at nullable
• created_at not null
Constraints
• unique(event_id)
Indexes
• unique index on event_id
• index on publish_status
• index on (entity_type, entity_id)
• index on created_at
8.3 consumed_events
Purpose
Tracks processed inbound events for dedupe and audit.
Important columns
• consumed_event_id PK
• source_name not null
• event_id not null
• event_type not null
• entity_type nullable
• entity_id nullable
• processing_status not null
• processed_at nullable
• failure_reason_code nullable
• created_at not null
Constraints
• unique(source_name, event_id)
Indexes
• unique index on (source_name, event_id)
• index on processing_status
• index on (entity_type, entity_id)
9. Audit and Reconciliation Tables
These tables support operational trust and investigations.
9.1 audit_events
Purpose
Stores an explicit audit trail of important actions.
Important columns
• audit_event_id PK
• actor_type not null
• actor_id nullable
• action_type not null
• entity_type not null
• entity_id not null
• reference_id nullable
• details_json nullable
• created_at not null
Indexes
• index on (entity_type, entity_id)
• index on actor_type
• index on action_type
• index on created_at
9.2 reconciliation_runs
Purpose
Tracks reconciliation job executions.
Important columns
• reconciliation_run_id PK
• scope not null
• status not null
• started_at nullable
• completed_at nullable
• failure_reason_code nullable
• summary_json nullable
• created_by_actor_type not null
• created_by_actor_id nullable
• created_at not null
Indexes
• index on status
• index on scope
• index on created_at
9.3 reconciliation_discrepancies
Purpose
Stores discrepancies found during reconciliation.
Important columns
• discrepancy_id PK
• reconciliation_run_id FK not null
• severity not null
• scope not null
• entity_type nullable
• entity_id nullable
• reason_code not null
• details_json nullable
• status not null
• created_at not null
• resolved_at nullable
Indexes
• index on reconciliation_run_id
• index on status
• index on severity
• index on (entity_type, entity_id)
10. Optional Projection Tables
These are not financial truth, but can help performance.
10.1 wallet_balance_projections
Purpose
Fast read model for wallet balances.
Important columns
• wallet_id PK
• available_balance_minor
• locked_balance_minor
• withdrawal_reserved_balance_minor
• total_balance_minor
• as_of_ledger_entry_id or as_of_timestamp
• updated_at
Rule
This table is disposable and rebuildable from ledger truth.
10.2 pool_projections
Purpose
Fast read model for race pool totals.
Important columns
• race_id
• selection_id
• total_stake_minor
• pool_status
• updated_at
Constraint
• unique(race_id, selection_id)
Rule
Also rebuildable and non-authoritative.
11. Suggested Enum Domains
These can be DB enums or controlled varchar values.
wallet_status
• active
• restricted
• closed
bet_status
• accepted
• rejected
• settled_win
• settled_loss
• voided
pool_status
• open
• frozen
• settled
• voided
deposit_status
• intent_created
• pending_confirmation
• confirmed
• failed
withdrawal_status
• requested
• approved
• broadcasted
• confirmed
• failed
• cancelled
settlement_run_status
• pending
• running
• completed
• failed
outbox_publish_status
• pending
• published
• failed
consumed_event_processing_status
• processing
• processed
• failed
• ignored_duplicate
12. Relationship Summary
High-level relationships:
• wallets 1:many ledger_accounts
• ledger_transactions 1:many ledger_entries
• race_pools 1:many pool_selections
• race_pools 1:many bets
• settlement_runs 1:many settlement_payouts
• wallets 1:many deposits
• wallets 1:many withdrawals
• reconciliation_runs 1:many reconciliation_discrepancies
13. Critical Constraints to Enforce
13.1 One wallet per user
Must be unique in v1.
13.2 One selection definition per race/selection pair
No duplicate selection row for same race.
13.3 One completed settlement per race
Prevents duplicate settlement finality.
13.4 No duplicate deposit credit for same external tx
Must be unique.
13.5 No duplicate withdrawal external tx reference
Must be unique.
13.6 Idempotency key uniqueness by scope
Must be durable.
13.7 Outbox event uniqueness
Must prevent duplicate event records for same event id.
14. Data Retention and Mutation Rules
14.1 Never delete ledger rows casually
Ledger is financial history.
14.2 Avoid updating historical meaning
Lifecycle entities may update status, but ledger rows should not be repurposed.
14.3 Prefer compensating rows over destructive edits
Especially for money-aﬀecting corrections.
14.4 Projection tables may be rebuilt
They are performance helpers, not truth.
15. Recommended First Migration Order
To make implementation smoother, the schema can be introduced in this order:
1. wallets
2. ledger_accounts
3. ledger_transactions
4. ledger_entries
5. race_pools
6. pool_selections
7. bets
8. settlement_runs
9. settlement_payouts
10. deposits
11. withdrawals
12. idempotency_keys
13. outbox_events
14. consumed_events
15. audit_events
16. reconciliation_runs
17. reconciliation_discrepancies
18. optional projection tables
16. Final Rule
If a financial concept exists in the system, it must have one of these forms:
• authoritative persisted entity
• authoritative ledger record
• explicitly non-authoritative projection
Nothing important should live as vague in-memory state only.
14.Response Contracts and DTOs
Overview
This section defines the canonical request and response shapes used by nines-
financial.
These contracts apply to:
• HTTP endpoints
• internal service DTOs where relevant
• test fixtures
• admin and treasury integrations
The goals are:
• consistency across all endpoints
• explicit typing
• safe validation
• stable integration boundaries
• compatibility with idempotent write flows
All monetary values must be represented in integer minor units.
All timestamps should be represented in a standard machine-safe format such as
ISO 8601 UTC strings.
1. General Contract Rules
1.1 Common response structure
Successful responses should follow a consistent pattern:
{
"success": true,
"data": {}
}
Error responses should follow a separate canonical error model, which we will
define in the next section.
1.2 Common metadata shape
For list and paginated endpoints, responses may include:
{
"success": true,
"data": [],
"meta": {
"nextCursor": "string or null",
"limit": 50,
"totalCount": 123
}
}
Use cursor pagination where practical for transaction-heavy resources.
1.3 Canonical money representation
All money fields must use:
• integer minor units
• explicit currency code
Recommended shape:
{
"amountMinor": 1250,
"currency": "USDC"
}
For contracts where currency is already implied by the resource, raw integer fields
may still be acceptable, but explicit money objects are safer and clearer.
1.4 Canonical reference fields
Where relevant, responses should expose:
• referenceId
• correlationId
• ledgerTransactionReference
• externalTransactionReference
These fields help with support, audit, and reconciliation.
1.5 Stable status fields
Lifecycle entities must expose their current status explicitly.
Examples:
• status: "accepted"
• status: "confirmed"
• status: "broadcasted"
2. Shared DTO Building Blocks
These are reusable shapes referenced throughout later DTOs.
2.1 Money DTO
{
"amountMinor": 5000,
"currency": "USDC"
}
Fields
• amountMinor: integer
• currency: string
2.2 Balance DTO
{
"available": { "amountMinor": 8000, "currency": "USDC" },
"locked": { "amountMinor": 2000, "currency": "USDC" },
"withdrawalReserved": { "amountMinor": 0, "currency": "USDC" },
"total": { "amountMinor": 10000, "currency": "USDC" }
}
2.3 Audit Reference DTO
{
"referenceId": "ref_123",
"correlationId": "corr_456",
"causationId": "cause_789"
}
2.4 Timestamp DTO Pattern
Use explicit fields such as:
• createdAt
• updatedAt
• acceptedAt
• confirmedAt
• settledAt
All timestamps should be ISO 8601 UTC strings.
2.5 Actor DTO
{
"actorType": "admin",
"actorId": "admin_123"
}
Useful for admin and audit contracts.
3. Wallet DTOs
3.1 Wallet Balance Response DTO
Used by:
• GET /wallets/{userId}/balance
{
"success": true,
"data": {
"walletId": "wal_123",
"userId": "usr_123",
"currency": "USDC",
"balances": {
"available": { "amountMinor": 8000, "currency": "USDC" },
"locked": { "amountMinor": 2000, "currency": "USDC" },
"withdrawalReserved": { "amountMinor": 0, "currency": "USDC" },
"total": { "amountMinor": 10000, "currency": "USDC" }
},
"status": "active",
"updatedAt": "2026-04-11T01:23:45Z"
}
}
3.2 Wallet Transaction Summary DTO
Used in transaction history lists.
{
"transactionReference": "ltx_123",
"transactionType": "bet_acceptance",
"direction": "debit",
"amount": { "amountMinor": 2000, "currency": "USDC" },
"status": "posted",
"relatedEntityType": "bet",
"relatedEntityId": "bet_123",
"createdAt": "2026-04-11T01:23:45Z"
}
3.3 Wallet Ledger Entry DTO
Used by:
• GET /wallets/{userId}/ledger
{
"ledgerTransactionId": "ltx_123",
"ledgerEntryId": "le_123",
"accountCode": "user_available:wal_123",
"entryType": "debit",
"amount": { "amountMinor": 2000, "currency": "USDC" },
"referenceId": "ref_123",
"postedAt": "2026-04-11T01:23:45Z"
}
4. Deposit DTOs
4.1 Create Deposit Intent Request DTO
Used by:
• POST /deposits/intents
{
"userId": "usr_123",
"chain": "ethereum",
"asset": "USDC",
"expectedAmountMinor": 10000,
"sourceAddress": "0xabc...",
"metadata": {}
}
Rules
• expectedAmountMinor may be optional depending on product design
• metadata must be treated as optional and bounded
4.2 Deposit Response DTO
Used by:
• GET /deposits/{depositId}
• create / update deposit lifecycle responses
{
"success": true,
"data": {
"depositId": "dep_123",
"userId": "usr_123",
"walletId": "wal_123",
"status": "pending_confirmation",
"chain": "ethereum",
"asset": "USDC",
"expectedAmount": { "amountMinor": 10000, "currency": "USDC" },
"observedAmount": { "amountMinor": 10000, "currency": "USDC" },
"creditedAmount": null,
"sourceAddress": "0xabc...",
"destinationAddress": "0xdef...",
"externalTransactionReference": "0xtxhash",
"createdAt": "2026-04-11T01:23:45Z",
"pendingConfirmationAt": "2026-04-11T01:30:00Z",
"confirmedAt": null,
"failedAt": null,
"failureReasonCode": null
}
}
4.3 Confirm Deposit Request DTO
Used by:
• POST /deposits/{depositId}/confirm
{
"externalTransactionReference": "0xtxhash",
"confirmedAmountMinor": 10000,
"chain": "ethereum",
"asset": "USDC",
"confirmedAt": "2026-04-11T01:35:00Z",
"metadata": {}
}
4.4 Confirm Deposit Response DTO
{
"success": true,
"data": {
"depositId": "dep_123",
"status": "confirmed",
"creditedAmount": { "amountMinor": 10000, "currency": "USDC" },
"ledgerTransactionReference": "ltx_123",
"walletBalanceSnapshot": {
"available": { "amountMinor": 20000, "currency": "USDC" },
"locked": { "amountMinor": 0, "currency": "USDC" },
"withdrawalReserved": { "amountMinor": 0, "currency": "USDC" },
"total": { "amountMinor": 20000, "currency": "USDC" }
},
"confirmedAt": "2026-04-11T01:35:00Z"
}
}
5. Bet DTOs
5.1 Place Bet Request DTO
Used by:
• POST /bets
{
"userId": "usr_123",
"raceId": "race_123",
"selectionId": "horse_4",
"stakeAmountMinor": 2500,
"requestReference": "req_123"
}
Idempotency key should be supplied via header or explicitly if your API style
prefers it.
Recommended:
• Idempotency-Key header
5.2 Bet Response DTO
Used by:
• POST /bets
• GET /bets/{betId}
{
"success": true,
"data": {
"betId": "bet_123",
"userId": "usr_123",
"walletId": "wal_123",
"raceId": "race_123",
"selectionId": "horse_4",
"stakeAmount": { "amountMinor": 2500, "currency": "USDC" },
"status": "accepted",
"requestReference": "req_123",
"payoutAmount": null,
"rejectionReasonCode": null,
"voidReasonCode": null,
"acceptedAt": "2026-04-11T02:00:00Z",
"settledAt": null,
"createdAt": "2026-04-11T02:00:00Z",
"updatedAt": "2026-04-11T02:00:00Z"
}
}
5.3 Bet List Item DTO
{
"betId": "bet_123",
"raceId": "race_123",
"selectionId": "horse_4",
"stakeAmount": { "amountMinor": 2500, "currency": "USDC" },
"status": "settled_win",
"payoutAmount": { "amountMinor": 9300, "currency": "USDC" },
"createdAt": "2026-04-11T02:00:00Z",
"settledAt": "2026-04-11T02:20:30Z"
}
6. Pool DTOs
6.1 Pool Summary Response DTO
Used by:
• GET /races/{raceId}/pool
{
"success": true,
"data": {
"raceId": "race_123",
"poolStatus": "frozen",
"totalPoolAmount": { "amountMinor": 150000, "currency": "USDC" },
"selectionTotals": [
{
"selectionId": "horse_1",
"totalStake": { "amountMinor": 30000, "currency": "USDC" }
},
{
"selectionId": "horse_2",
"totalStake": { "amountMinor": 45000, "currency": "USDC" }
}
],
"cutoﬀAt": "2026-04-11T02:29:30Z",
"frozenAt": "2026-04-11T02:29:30Z",
"settledAt": null
}
}
6.2 Freeze Pool Request DTO
Used by:
• POST /races/{raceId}/pool/freeze
{
"eﬀectiveAt": "2026-04-11T02:29:30Z",
"freezeReason": "scheduled_cutoﬀ"
}
6.3 Pool Lifecycle Response DTO
Used by:
• freeze
• void
• other pool lifecycle mutations
{
"success": true,
"data": {
"raceId": "race_123",
"poolStatus": "frozen",
"updatedAt": "2026-04-11T02:29:30Z"
}
}
7. Settlement DTOs
7.1 Start Settlement Request DTO
Used by:
• POST /settlements/races/{raceId}
{
"winningSelectionId": "horse_4",
"oﬃcialResultReference": "result_123",
"resultTimestamp": "2026-04-11T02:50:00Z",
"settlementReference": "settle_ref_123"
}
7.2 Settlement Summary Response DTO
Used by:
• GET /settlements/races/{raceId}
{
"success": true,
"data": {
"settlementRunId": "setrun_123",
"raceId": "race_123",
"status": "completed",
"winningSelectionId": "horse_4",
"totalPoolAmount": { "amountMinor": 150000, "currency": "USDC" },
"winningPoolAmount": { "amountMinor": 25000, "currency": "USDC" },
"houseTakeAmount": { "amountMinor": 7500, "currency": "USDC" },
"distributablePoolAmount": { "amountMinor": 142500, "currency": "USDC" },
"payoutRatio": {
"numerator": 142500,
"denominator": 25000
},
"roundingResidual": { "amountMinor": 0, "currency": "USDC" },
"completedAt": "2026-04-11T02:50:05Z"
}
}
7.3 Settlement Run Detail DTO
Used by:
• GET /settlements/runs/{settlementRunId}
{
"success": true,
"data": {
"settlementRunId": "setrun_123",
"raceId": "race_123",
"status": "completed",
"winningSelectionId": "horse_4",
"oﬃcialResultReference": "result_123",
"houseTakeBps": 500,
"houseTakeAmount": { "amountMinor": 7500, "currency": "USDC" },
"totalPoolAmount": { "amountMinor": 150000, "currency": "USDC" },
"winningPoolAmount": { "amountMinor": 25000, "currency": "USDC" },
"distributablePoolAmount": { "amountMinor": 142500, "currency": "USDC" },
"payoutRatio": {
"numerator": 142500,
"denominator": 25000
},
"roundingResidual": { "amountMinor": 0, "currency": "USDC" },
"startedAt": "2026-04-11T02:50:00Z",
"completedAt": "2026-04-11T02:50:05Z",
"failedAt": null,
"failureReasonCode": null
}
}
8. Withdrawal DTOs
8.1 Create Withdrawal Request DTO
Used by:
• POST /withdrawals
{
"userId": "usr_123",
"amountMinor": 5000,
"chain": "ethereum",
"asset": "USDC",
"destinationAddress": "0xabc...",
"requestReference": "wd_req_123"
}
8.2 Withdrawal Response DTO
Used by:
• POST /withdrawals
• GET /withdrawals/{withdrawalId}
{
"success": true,
"data": {
"withdrawalId": "wd_123",
"userId": "usr_123",
"walletId": "wal_123",
"status": "requested",
"amount": { "amountMinor": 5000, "currency": "USDC" },
"chain": "ethereum",
"asset": "USDC",
"destinationAddress": "0xabc...",
"externalTransactionReference": null,
"failureReasonCode": null,
"requestedAt": "2026-04-11T03:10:00Z",
"approvedAt": null,
"broadcastedAt": null,
"confirmedAt": null,
"failedAt": null,
"cancelledAt": null,
"createdAt": "2026-04-11T03:10:00Z",
"updatedAt": "2026-04-11T03:10:00Z"
}
}
8.3 Approve Withdrawal Request DTO
Used by:
• POST /withdrawals/{withdrawalId}/approve
{
"approvalReference": "apr_123",
"approvedBy": "admin_123",
"notes": "manual review passed"
}
8.4 Broadcast Withdrawal Request DTO
Used by:
• POST /withdrawals/{withdrawalId}/broadcast
{
"externalTransactionReference": "0xtxhash",
"chain": "ethereum",
"broadcastedAt": "2026-04-11T03:20:00Z",
"feeAmountMinor": 50,
"metadata": {}
}
8.5 Confirm Withdrawal Request DTO
Used by:
• POST /withdrawals/{withdrawalId}/confirm
{
"externalTransactionReference": "0xtxhash",
"confirmedAt": "2026-04-11T03:30:00Z",
"confirmationMetadata": {}
}
8.6 Fail Withdrawal Request DTO
Used by:
• POST /withdrawals/{withdrawalId}/fail
{
"failureReasonCode": "CHAIN_REJECTED",
"failureMessage": "transaction dropped",
"externalTransactionReference": "0xtxhash"
}
9. Reconciliation DTOs
9.1 Run Reconciliation Request DTO
Used by:
• POST /reconciliation/runs
{
"scope": "withdrawals",
"dateRange": {
"from": "2026-04-01T00:00:00Z",
"to": "2026-04-11T23:59:59Z"
},
"chain": "ethereum",
"referenceId": "recon_123"
}
9.2 Reconciliation Run Response DTO
{
"success": true,
"data": {
"reconciliationRunId": "reconrun_123",
"scope": "withdrawals",
"status": "completed",
"startedAt": "2026-04-11T04:00:00Z",
"completedAt": "2026-04-11T04:03:00Z",
"discrepancyCount": 2
}
}
9.3 Reconciliation Discrepancy DTO
{
"discrepancyId": "disc_123",
"severity": "high",
"scope": "withdrawals",
"entityType": "withdrawal",
"entityId": "wd_123",
"reasonCode": "MISSING_CONFIRMATION",
"status": "open",
"createdAt": "2026-04-11T04:02:00Z"
}
10. Audit DTOs
10.1 Audit Event DTO
Used by:
• GET /audit/events
{
"auditEventId": "aud_123",
"actor": {
"actorType": "admin",
"actorId": "admin_123"
},
"actionType": "withdrawal_approved",
"entityType": "withdrawal",
"entityId": "wd_123",
"referenceId": "apr_123",
"details": {},
"createdAt": "2026-04-11T03:12:00Z"
}
11. Admin DTOs
11.1 Race Financial Summary DTO
Used by:
• GET /admin/races/{raceId}/financial-summary
{
"success": true,
"data": {
"raceId": "race_123",
"poolStatus": "settled",
"winningSelectionId": "horse_4",
"totalPoolAmount": { "amountMinor": 150000, "currency": "USDC" },
"selectionTotals": [
{
"selectionId": "horse_1",
"totalStake": { "amountMinor": 30000, "currency": "USDC" }
},
{
"selectionId": "horse_4",
"totalStake": { "amountMinor": 25000, "currency": "USDC" }
}
],
"houseTakeAmount": { "amountMinor": 7500, "currency": "USDC" },
"distributablePoolAmount": { "amountMinor": 142500, "currency": "USDC" },
"settlementRunId": "setrun_123",
"discrepancyFlags": []
}
}
12. DTO Validation Rules
12.1 Reject unknown critical enum values
Fields like:
• status
• chain
• asset
• entryType
must be validated against known allowed values.
12.2 Minor units must be integers
Money fields must not accept floats.
12.3 Required lifecycle fields must align with status
Examples:
• confirmed withdrawal should include confirmedAt
• confirmed deposit should include confirmedAt
• settled bet should include settledAt
12.4 Sensitive fields may be role-filtered
Certain fields may be omitted depending on caller type.
Examples:
• raw ledger references
• internal reconciliation details
• internal audit annotations
13. Recommended Type Naming
For implementation consistency, use type names like:
• MoneyDto
• BalanceDto
• WalletBalanceResponseDto
• WalletTransactionSummaryDto
• CreateDepositIntentRequestDto
• DepositResponseDto
• ConfirmDepositRequestDto
• PlaceBetRequestDto
• BetResponseDto
• PoolSummaryResponseDto
• StartSettlementRequestDto
• SettlementSummaryResponseDto
• CreateWithdrawalRequestDto
• WithdrawalResponseDto
• RunReconciliationRequestDto
• AuditEventDto
That keeps DTO naming very readable.
14. Final Rule
If an endpoint exists, it must have:
• a canonical request DTO if it accepts input
• a canonical response DTO
• clear field typing
• explicit lifecycle-aware status fields
• explicit money representation
No endpoint should “just return whatever the service gives back.”
15. Error model
Purpose
The error model defines how NINES Financial reports, classifies, records, and
reacts to failures across API, domain, ledger, wallet, treasury, settlement, and
reconciliation operations.
Its job is to make failures:
• predictable for clients
• safe for money movement
• diagnosable by operators
• replayable where appropriate
• impossible to confuse with successful financial state changes
The error model must favour financial correctness over convenience.
If the system is unsure, it must fail safely, preserve evidence, and avoid duplicate
movement of value.
Core principles
15.1 No silent failures
Any failure that aﬀects balances, commands, state transitions, settlement
outcomes, treasury movement, or external transfer tracking must be:
• returned to the caller when synchronous
• emitted as an operational event when asynchronous
• written to audit storage
• traceable by correlation ID, command ID, and account/user identifiers
where applicable
A failure must never disappear into logs only.
15.2 No partial financial success without explicit state
A command that touches money must never end in an ambiguous state such as
“maybe debited” or “probably settled”.
If a process cannot finish atomically, the system must leave the entity in an explicit
intermediate state such as:
• PENDING
• PROCESSING
• POSTING_REQUIRED
• SETTLEMENT_PENDING
• WITHDRAWAL_REVIEW
• REVERSAL_REQUIRED
• RECONCILIATION_REQUIRED
This ensures unfinished work is visible and recoverable.
15.3 Domain errors are not infrastructure errors
The system must clearly separate:
• domain/business rule failures
• validation failures
• authentication/authorisation failures
• dependency/integration failures
• concurrency/idempotency conflicts
• internal unexpected faults
These categories must not be collapsed into generic 500 responses internally,
even if external clients receive simplified messaging.
15.4 Errors do not mutate financial truth unless explicitly designed to
An error response must not itself imply that ledger state changed.
Ledger, balance, and settlement changes only occur through successful posting
rules or explicit compensating entries.
If posting does not complete, the system must preserve the prior financial truth or
move into an explicit compensating state.
Error categories
15.5 Validation errors
Validation errors occur when a request is malformed, incomplete, incorrectly typed,
or structurally invalid.
Examples:
• missing required fields
• invalid wallet address format
• unsupported currency code
• invalid amount precision
• malformed UUID / command ID / idempotency key
• DTO schema mismatch
• invalid enum value
• invalid timestamp format
Characteristics:
• detected before domain execution
• no financial side eﬀects
• safe to return immediately
• usually client-correctable
Suggested code family:
• VALIDATION_ERROR
• INVALID_REQUEST
• INVALID_AMOUNT
• INVALID_CURRENCY
• INVALID_ADDRESS
• MISSING_FIELD
HTTP mapping usually:
• 400 Bad Request
15.6 Authentication errors
Authentication errors occur when the caller identity is missing, expired, invalid, or
unverifiable.
Examples:
• missing bearer token
• expired session token
• invalid API signature
• invalid service credentials
• unverifiable webhook signature
Characteristics:
• no domain execution
• no financial side eﬀects
• security event may be recorded
Suggested code family:
• UNAUTHENTICATED
• TOKEN_EXPIRED
• INVALID_SIGNATURE
• WEBHOOK_SIGNATURE_INVALID
HTTP mapping usually:
• 401 Unauthorized
15.7 Authorisation errors
Authorisation errors occur when the caller is authenticated but lacks permission for
the requested action.
Examples:
• player attempts admin reconciliation endpoint
• operator attempts treasury approval without treasury role
• service attempts settlement write outside allowed domain boundary
• admin attempts privileged action without second approval where required
Characteristics:
• no financial mutation
• should be auditable
• may trigger security review if unusual
Suggested code family:
• FORBIDDEN
• INSUFFICIENT_ROLE
• APPROVAL_REQUIRED
• SCOPE_DENIED
HTTP mapping usually:
• 403 Forbidden
15.8 Domain rule errors
Domain rule errors occur when the request is valid in shape, but invalid against
business rules.
Examples:
• betting window closed
• race not open for intake
• account suspended
• insuﬃcient available balance
• withdrawal below minimum
• user not age/KYC eligible for requested action
• bet selection invalid for race state
• treasury reserve would fall below required floor
• settlement attempted for race not yet final
• reversal attempted on immutable finalised object
Characteristics:
• expected errors
• no code bug implied
• should be common enough to document well
• may or may not have side eﬀects depending on workflow design, but must
remain consistent
Suggested code family:
• BETTING_CLOSED
• INSUFFICIENT_FUNDS
• ACCOUNT_RESTRICTED
• WITHDRAWAL_NOT_ALLOWED
• RACE_NOT_SETTLABLE
• INVALID_STATE_TRANSITION
• TREASURY_LIMIT_EXCEEDED
• KYC_REQUIRED
• REGULATORY_HOLD
HTTP mapping usually:
• 409 Conflict when state/business conflict
• 422 Unprocessable Entity when request is valid but cannot be accepted
• occasionally 403 for policy restrictions
15.9 Not found errors
Returned when the referenced resource does not exist, is not visible to the caller,
or cannot be resolved.
Examples:
• account not found
• wallet not found
• race not found
• command not found
• ledger entry not found
• idempotency record not found
• withdrawal request not found
Characteristics:
• no side eﬀects
• may be intentionally vague for security-sensitive resources
Suggested code family:
• NOT_FOUND
• ACCOUNT_NOT_FOUND
• RACE_NOT_FOUND
• COMMAND_NOT_FOUND
HTTP mapping usually:
• 404 Not Found
15.10 Idempotency and duplicate request errors
These occur when a caller replays a command or sends a logically duplicate
command.
Examples:
• same deposit credit command submitted twice
• same withdrawal request retried with changed payload
• same bet placement command resent
• duplicate settlement job for same race and stage
Sub-cases:
1. safe replay
Same idempotency key and same request fingerprint
→ return original result
2. conflicting replay
Same idempotency key but diﬀerent payload
→ reject as conflict
3. duplicate business command
Diﬀerent key, but command already exists and uniqueness constraint catches
it
→ reject or return existing resource according to contract
Suggested code family:
• IDEMPOTENT_REPLAY
• IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD
• DUPLICATE_COMMAND
• ALREADY_PROCESSED
HTTP mapping usually:
• 200 or 201 for safe replay of completed command
• 409 Conflict for conflicting replay
• 202 Accepted if prior request still processing and contract supports polling
15.11 Concurrency and optimistic locking errors
These occur when two processes attempt incompatible changes at the same time.
Examples:
• simultaneous bet placements consume same available balance
• settlement worker and manual operator try to update same settlement
batch
• two withdrawal approvals race each other
• wallet ledger projection version mismatch
Characteristics:
• expected in distributed systems
• must never corrupt ledger truth
• require versioning, row locks, unique constraints, or atomic posting rules
Suggested code family:
• VERSION_CONFLICT
• CONCURRENT_MODIFICATION
• LOCK_NOT_ACQUIRED
• STALE_WRITE_REJECTED
HTTP mapping usually:
• 409 Conflict
15.12 Dependency and integration errors
These occur when an external or internal dependency fails to behave as required.
Examples:
• blockchain RPC unavailable
• custody provider timeout
• FX/quote provider unavailable
• message bus publish failure
• email/notification provider unavailable
• downstream compliance service unavailable
• DB connection pool exhaustion
• read replica lag too high for safe use
Characteristics:
• may or may not have caused external side eﬀects
• must be treated very carefully if money movement could have occurred
externally
• often require transition into a pending or review state instead of a hard fail
Suggested code family:
• DEPENDENCY_UNAVAILABLE
• RPC_TIMEOUT
• PROVIDER_ERROR
• BUS_PUBLISH_FAILED
• DATABASE_UNAVAILABLE
• READ_MODEL_UNAVAILABLE
HTTP mapping usually:
• 503 Service Unavailable
• 504 Gateway Timeout
• occasionally 502 Bad Gateway
15.13 Internal invariant breach errors
These represent situations that should never happen if the system is correct.
Examples:
• ledger entries do not balance
• account balance projection negative without allowed hold model
• settlement payout total exceeds authorised pool without explicit subsidy
rule
• immutable object changed after finalisation
• two winners marked final in a single-winner race
• event sequence regression
• checksum mismatch for financial aggregate
Characteristics:
• highest severity
• operational page required
• processing should stop for aﬀected entity or batch
• may require manual intervention and incident review
Suggested code family:
• INVARIANT_BREACH
• LEDGER_IMBALANCE
• BALANCE_PROJECTION_MISMATCH
• SETTLEMENT_TOTAL_INVALID
• DATA_CORRUPTION_SUSPECTED
HTTP mapping:
• usually 500 Internal Server Error externally
• internally treated as critical domain incident, not just generic server error
15.14 Fraud, risk, and compliance errors
These are policy-driven denials or holds based on risk controls.
Examples:
• suspicious withdrawal velocity
• wallet linked to sanctions screening hit
• chargeback-linked deposit source
• device/account abuse signals
• duplicate identity evidence
• manual review threshold triggered
Characteristics:
• may intentionally reveal limited detail
• may move entity into review rather than reject outright
• must be heavily audited
Suggested code family:
• RISK_REVIEW_REQUIRED
• WITHDRAWAL_HELD
• COMPLIANCE_BLOCK
• FRAUD_SIGNAL_DETECTED
• SANCTIONS_REVIEW_REQUIRED
HTTP mapping usually:
• 403 Forbidden
• 409 Conflict
• 422 Unprocessable Entity
• or 202 Accepted if moved into review workflow
Standard error shape
15.15 Canonical response structure
Every non-success response should follow a consistent structure.
Example:
{
"error": {
"code": "INSUFFICIENT_FUNDS",
"message": "Available balance is lower than the requested
stake.",
"category": "DOMAIN_RULE",
"retryable": false,
"userActionable": true,
"correlationId": "cor_01HXYZ...",
"idempotencyKey": "idem_01HXYZ...",
"details": {
"accountId": "acc_123",
"requestedAmount": "25.00",
"availableAmount": "12.40",
"currency": "NINES_UNIT"
}
}
}
Recommended fields:
• code
stable machine-readable application code
• message
human-readable summary suitable for logs and possibly UI
• category
one of the canonical error families
• retryable
whether the exact same request may succeed later without modification
• userActionable
whether the end user can do something about it
• correlationId
required for tracing
• idempotencyKey
included when relevant
• details
safe structured metadata only
Optional fields:
• fieldErrors
• resourceId
• currentState
• expectedState
• nextAllowedActions
• reviewStatus
• docsHint
Sensitive internal details must never leak in public responses.
Public vs internal error detail
15.16 External API response rules
External or user-facing APIs should expose:
• stable code
• safe message
• retryability guidance where appropriate
• correlation ID
• field-level details for validation failures only where safe
They should not expose:
• raw SQL errors
• stack traces
• internal table names
• dependency credentials
• fraud detection heuristics
• risk scoring internals
• sensitive compliance reasoning
• exact security rule triggers when that would weaken controls
15.17 Internal service error detail
Internal service-to-service responses may include more structured detail, such as:
• dependency name
• downstream response code
• lock token / version mismatch data
• transition guard failure details
• reconciliation discrepancy IDs
• provider reference IDs
Even internally, secrets and private keys must never be emitted.
Retry semantics
15.18 Retryable vs non-retryable classification
Every error should be classifiable as one of:
Retryable immediately
• transient DB timeout
• message bus temporary outage
• lock contention in controlled workflows
Retryable later
• dependency unavailable
• rate limit reached
• review pending
• race not yet final for settlement
Not retryable without change
• insuﬃcient funds
• invalid request
• forbidden action
• invalid state transition
• unsupported asset
Do not auto-retry
• invariant breach
• suspected duplicate external transfer
• ambiguous external settlement state
• fraud/compliance hold
This classification is important for workers, APIs, admin tools, and reconciliation
jobs.
Financial safety handling rules
15.19 Ambiguous external movement rule
If the system cannot determine whether an external movement happened, it must
not assume failure.
Examples:
• withdrawal broadcast submitted but provider timed out before returning
hash
• custody API accepted request but confirmation response lost
• deposit callback received but persistence failed after provider ack
In these cases the entity must move to a state like:
• AWAITING_PROVIDER_CONFIRMATION
• EXTERNAL_STATUS_UNKNOWN
• MANUAL_REVIEW_REQUIRED
This prevents accidental duplicate sends or double credits.
15.20 Ledger posting failure rule
If a business event should create ledger entries and posting fails, one of two things
must happen:
1. the entire transaction rolls back and no financial state changes are committed
2. the aggregate enters an explicit POSTING_REQUIRED or equivalent
repairable state with full audit evidence
There must never be a committed domain state that claims money moved when
corresponding ledger entries do not exist.
15.21 Projection mismatch rule
If a read model or balance projection does not match canonical ledger truth:
• ledger remains source of truth
• user-facing spendable actions may be restricted temporarily
• reconciliation event must be emitted
• projection rebuild or repair process must be triggered
• discrepancy must be auditable
Batch and async error handling
15.22 Batch command outcomes
For batch operations such as settlement, reconciliation, or treasury sweeps, the
system must distinguish:
• whole batch failed before execution
• partially executed with per-item outcomes
• completed with exceptions requiring follow-up
• completed but downstream notification/publish failed
A batch result should include:
• batch status
• per-item status
• counts by outcome
• failed item reasons
• whether compensating action is required
Batch APIs must not hide partial failures behind a single generic success.
15.23 Async job failure rules
Async workflows must support:
• retry count
• next retry time
• terminal failure state
• dead-letter or failed-job storage
• operator-visible failure reason
• correlation to originating command
Examples:
• SETTLEMENT_JOB_FAILED
• WITHDRAWAL_CONFIRMATION_POLL_FAILED
• RECONCILIATION_IMPORT_FAILED
Retries must be bounded and policy-driven.
Error code design rules
15.24 Error code requirements
Error codes should be:
• stable over time
• machine-readable
• specific enough for clients and dashboards
• not overloaded with multiple meanings
• documented in the API spec
Recommended structure:
CATEGORY_SPECIFIC_REASON
Examples:
• VALIDATION_INVALID_AMOUNT
• AUTH_INVALID_TOKEN
• DOMAIN_INSUFFICIENT_FUNDS
• DOMAIN_BETTING_CLOSED
• CONFLICT_VERSION_MISMATCH
• DEPENDENCY_RPC_TIMEOUT
• INVARIANT_LEDGER_IMBALANCE
Or a flatter style if you want cleaner public codes:
• INVALID_AMOUNT
• INSUFFICIENT_FUNDS
• BETTING_CLOSED
• VERSION_CONFLICT
• RPC_TIMEOUT
• LEDGER_IMBALANCE
Either is fine, but choose one system and stick to it.
Minimum canonical financial error set
15.25 Suggested baseline codes
For v1, I’d strongly recommend at least these:
Validation
• INVALID_REQUEST
• MISSING_FIELD
• INVALID_AMOUNT
• INVALID_CURRENCY
• INVALID_ADDRESS
Auth / permissions
• UNAUTHENTICATED
• FORBIDDEN
• INSUFFICIENT_ROLE
Domain
• INSUFFICIENT_FUNDS
• BETTING_CLOSED
• ACCOUNT_RESTRICTED
• KYC_REQUIRED
• REGULATORY_HOLD
• INVALID_STATE_TRANSITION
• RACE_NOT_SETTLABLE
• WITHDRAWAL_NOT_ALLOWED
Idempotency / concurrency
• ALREADY_PROCESSED
• IDEMPOTENCY_CONFLICT
• VERSION_CONFLICT
• CONCURRENT_MODIFICATION
Dependencies
• DEPENDENCY_UNAVAILABLE
• RPC_TIMEOUT
• PROVIDER_ERROR
• DATABASE_UNAVAILABLE
Critical
• INVARIANT_BREACH
• LEDGER_IMBALANCE
• BALANCE_PROJECTION_MISMATCH
• EXTERNAL_STATUS_UNKNOWN
Risk
• RISK_REVIEW_REQUIRED
• WITHDRAWAL_HELD
• COMPLIANCE_BLOCK
Operator handling expectations
15.26 What operators must be able to see
For any serious financial error, operators should be able to inspect:
• error code and category
• first seen / last seen
• aﬀected entity IDs
• aﬀected user/account/wallet/race IDs
• correlation ID
• command ID / idempotency key
• current entity state
• retry history
• dependency involved
• whether customer funds may be at risk
• whether manual action is required
• linked audit trail entries
• linked ledger entries or missing-posting markers
This is critical for admin portal design later.
Non-negotiable rules for this section
15.27 Hard rules
• No raw exceptions are exposed to public clients
• No money-moving workflow may end in an untracked ambiguous state
• All financial errors must be traceable by correlation ID
• Idempotent replay must be supported for write commands
• Invariant breaches must page operators and halt unsafe continuation
• Ledger truth outranks projections and caches
• Ambiguous external transfer state must go to review, never blind retry
• Partial success must be represented explicitly, never implied away
16. API / service boundaries
Purpose
This section defines how the NINES Financial system is split into services, what
each service is responsible for, and how they are allowed to communicate.
The goal is:
• clear ownership of money movement
• strong isolation of risk
• predictable APIs
• no accidental cross-domain logic leaks
• ability to scale and secure critical parts independently
This is where we draw hard lines so nothing sketchy slips through later.
16.1 High-level service architecture
For V1, the system is divided into four core financial services:
1. Bet Intake & Orchestration Service
2. Accounting Core (Ledger) Service
3. Settlement Service
4. Treasury & External Movement Service
Optional but strongly recommended:
1. Read / Query Service (aggregated views)
2. Admin / Operator Service
16.2 Core rule: single writer per domain
Each domain has one and only one service that is allowed to mutate its data.
Domain Owner Service
Bets Bet Intake
Ledger Accounting Core
Settlements Settlement Service
External funds Treasury
No other service is allowed to write into that domain directly.
16.3 Communication rules
Allowed communication patterns
Synchronous (API calls)
Used for:
• validation checks
• command execution
• immediate responses to user actions
Asynchronous (events)
Used for:
• state propagation
• settlement triggers
• reconciliation
• notifications
• analytics
Forbidden patterns
• ❌ Direct database access across services
• ❌ Sharing internal models or tables
• ❌ Calling another service’s private/internal endpoints
• ❌ Writing to another service’s domain state
• ❌ “Shortcut logic” to skip services for convenience
If you break this, you lose financial integrity.
16.4 Service definitions
16.4.1 Bet Intake & Orchestration Service
Responsibilities
• accept bet requests
• validate race state
• validate user eligibility
• request balance checks
• orchestrate ledger reservation or debit
• create bet records
• emit bet events
What it does NOT do
• does not hold balances
• does not settle bets
• does not move real funds
• does not write ledger entries directly
Dependencies
• Accounting Core (for balance + posting)
• Race engine (read-only)
• User/account service (read-only)
Example endpoints
• POST /bets
• GET /bets/:id
• GET /bets?userId=
Outgoing events
• bet.placed
• bet.rejected
• bet.cancelled
16.4.2 Accounting Core (Ledger Service)
This is the most important service in the entire system.
Responsibilities
• maintain double-entry ledger
• enforce financial invariants
• compute balances
• process all debits and credits
• guarantee idempotency
• provide balance queries
What it does NOT do
• no business logic about betting rules
• no race logic
• no external fund movement
• no UI concerns
Core rule
👉 All money movement must pass through this service
No exceptions.
Example endpoints
• POST /ledger/commands
• GET /accounts/:id/balance
• GET /ledger/entries
• POST /ledger/reversal
Outgoing events
• ledger.posted
• ledger.failed
• balance.updated
16.4.3 Settlement Service
Responsibilities
• process race results
• determine winners and payouts
• calculate settlement amounts
• orchestrate ledger credits/debits
• mark bets as settled
• emit settlement events
What it does NOT do
• no direct balance manipulation
• no external transfers
• no race simulation
Dependencies
• Race results (read-only)
• Bet Intake (read-only)
• Accounting Core (for posting)
Example endpoints
• POST /settlements/races/:raceId
• GET /settlements/:id
Outgoing events
• settlement.started
• settlement.completed
• settlement.failed
16.4.4 Treasury & External Movement Service
This is where real money risk lives.
Responsibilities
• deposits
• withdrawals
• crypto / fiat conversion
• custody provider integration
• blockchain interaction
• external transfer tracking
• treasury asset management
What it does NOT do
• no betting logic
• no settlement calculation
• no direct ledger mutation without Accounting Core
Dependencies
• Accounting Core (for posting)
• external providers (RPC, custody, FX)
Example endpoints
• POST /deposits
• POST /withdrawals
• GET /withdrawals/:id
• GET /treasury/balances
Outgoing events
• deposit.received
• deposit.confirmed
• withdrawal.requested
• withdrawal.sent
• withdrawal.confirmed
• withdrawal.failed
16.4.5 Read / Query Service (optional but recommended)
Responsibilities
• aggregate data for UI
• provide fast queries
• build leaderboards, history, stats
• expose safe public data
Rules
• read-only
• eventually consistent
• no financial authority
16.4.6 Admin / Operator Service
Responsibilities
• manual overrides (controlled)
• reconciliation tools
• monitoring dashboards
• fraud review workflows
• audit access
Rules
• must respect permissions
• all actions must be audited
• cannot bypass ledger rules
16.5 API boundary rules
16.5.1 External vs internal APIs
External APIs (public)
• used by frontend, mobile, third parties
• simplified responses
• strict validation
• rate limited
• no sensitive data
Internal APIs
• used between services
• richer data structures
• trusted network
• still authenticated and authorised
16.5.2 Command vs query separation
Commands (write operations):
• mutate state
• must be idempotent
• go through owning service only
Queries (read operations):
• no side eﬀects
• may use read models
• can be served by query service
16.5.3 No cross-domain writes
Example:
• Settlement service must NOT update ledger tables
• Bet service must NOT update settlement state
• Treasury must NOT modify bets
Instead:
👉 call the owning service API or emit an event
16.6 Event boundary rules
16.6.1 Events are facts, not commands
Events must describe what already happened, not what should happen.
Good:
• bet.placed
• ledger.posted
• withdrawal.confirmed
Bad:
• process.settlement
• update.balance
16.6.2 Events are immutable
• cannot be edited
• cannot be deleted
• must be versioned if schema changes
16.6.3 Consumers must be idempotent
Every service consuming events must handle:
• duplicate delivery
• out-of-order delivery
• delayed delivery
16.7 Data ownership rules
Each service owns its own database schema.
Example:
• Bet DB → only Bet service writes
• Ledger DB → only Accounting writes
• Treasury DB → only Treasury writes
Other services:
• must use APIs
• or consume events
• or use read models
16.8 Security boundaries between services
Even internally:
• services must authenticate with each other
• use service-to-service tokens or mTLS
• enforce role-based access
• log all cross-service calls
High-risk services (Ledger, Treasury) should have:
• stricter access control
• reduced surface area
• network isolation where possible
16.9 Failure isolation
A failure in one service must not corrupt another domain.
Examples:
• Treasury outage must not break betting
• Settlement delay must not aﬀect deposits
• Ledger must remain consistent even if everything else is down
16.10 Versioning strategy
APIs must support:
• versioned endpoints (/v1/...)
• backward compatibility during rollout
• schema evolution for events
Breaking changes must be:
• explicitly versioned
• deployed safely
• coordinated across services
16.11 Scaling boundaries
Each service must be independently scalable:
• Bet Intake → high throughput
• Ledger → consistency-focused scaling
• Settlement → batch / compute heavy
• Treasury → latency + external dependency bound
16.12 Non-negotiable rules
• Ledger is the single source of financial truth
• No service bypasses Accounting Core for balance mutation
• No direct DB access across services
• All write operations must be idempotent
• Events must be immutable and replay-safe
• External money movement must go through Treasury only
• Settlement must never directly modify balances
• Admin tools must not bypass service boundaries
• Every financial action must be traceable across services
16.13 Mental model (important)
Think of it like this:
• Bet service = decides what should happen
• Ledger service = decides what actually happened financially
• Settlement service = decides who deserves what
• Treasury service = moves real-world money
If those lines ever blur → bugs, exploits, or money loss.
17. Security and trust boundaries
Purpose
This section defines:
• who and what the system trusts
• where trust must stop
• how money, identity, and actions are protected
• how attackers are contained even if parts of the system fail
The goal is:
👉 No single failure should allow loss of funds or corruption of financial truth
17.1 Trust model (foundational)
Zero implicit trust
The system must assume:
• clients can be malicious
• networks can be intercepted
• services can be compromised
• inputs can be forged
• events can be duplicated or delayed
Nothing is trusted unless explicitly verified.
Trust is layered
Trust must be established at multiple levels:
1. Identity (who is calling)
2. Authorization (are they allowed)
3. Integrity (data not tampered)
4. Replay protection (not reused maliciously)
5. Domain validation (makes sense in business rules)
17.2 Trust boundaries (hard lines)
Boundary 1
—
Client
↔
Backend
Untrusted
→
Everything from:
• browser
• mobile app
• scripts
• bots
is untrusted
Trusted edge
Requirements
• strict input validation
• authentication required for all sensitive endpoints
• rate limiting
• request size limits
• schema validation
• no trust in client-calculated values (balances, odds, payouts)
Boundary 2
—
Public API
↔
Internal Services
Semi-trusted
→
trusted
Even inside your system:
• services must authenticate
• requests must be signed or token-based
• roles must be enforced
Requirements
• service-to-service auth (JWT or mTLS)
• scoped permissions per service
• no “god mode” services
• audit every cross-service call
Boundary 3
—
Internal Services
↔
Ledger
Critical trust boundary
Ledger is high trust / high protection
Rules
• only specific services can call ledger write endpoints
• all ledger writes must be:
• authenticated
• authorised
• idempotent
• validated
Protection level
• strongest access controls
• minimal exposed surface
• strict input contracts
Boundary 4
—
System
↔
Examples:
• blockchain RPC
• custody providers
• FX providers
• banking rails
These are untrusted dependencies
Requirements
• verify all responses
External Providers
• handle timeouts and ambiguity safely
• never assume success without confirmation
• track provider reference IDs
• protect against replay or spoofed callbacks
Boundary 5
—
Admin
↔
System
Admins are high risk actors
They can:
• override flows
• move funds indirectly
• access sensitive data
Requirements
• strict RBAC
• multi-step approvals for critical actions
• full audit logging
• no silent actions
• session tracking
17.3 Identity and authentication
Users
• JWT or session-based auth
• short-lived tokens
• refresh tokens securely handled
• optional MFA (recommended for withdrawals)
Services
• service accounts
• signed tokens or mTLS
• rotated credentials
• scoped permissions
External callbacks (webhooks)
Must verify:
• signature
• timestamp
• source authenticity
Never trust raw webhook payloads.
17.4 Authorization (RBAC)
Roles should be explicit and enforced everywhere.
Example roles
• player
• admin
• operator
• finance_operator
• treasury_operator
• system_service
Rules
• deny by default
• allow only what is required
• sensitive actions require elevated roles
• some actions require dual approval
17.5 Financial security rules
17.5.1 Ledger protection
• only Accounting Core can mutate ledger
• all writes must be double-entry
• all writes must be idempotent
• no direct DB writes outside service
17.5.2 Balance integrity
• balances derived from ledger, not stored blindly
• no negative balances unless explicitly allowed
• no hidden adjustments
17.5.3 Withdrawal safety
• withdrawal requests must be:
• authenticated
• authorised
• validated
• optionally MFA-protected
• large withdrawals:
• trigger review
• may require manual approval
17.5.4 Deposit safety
• deposits must be:
• confirmed (not just seen)
• matched to user
• idempotent
17.6 Idempotency and replay protection
Every write operation must include:
• idempotency key
• request fingerprint
Protection against
• double-clicks
• network retries
• malicious replay
• duplicate webhook delivery
17.7 Data integrity and tamper protection
Rules
• all critical records must include:
• timestamps
• correlation IDs
• origin source
• optional but strong:
• hashing of ledger batches
• checksum validation
• event signatures
17.8 Event security
Requirements
• events must be immutable
• consumers must verify:
• schema
• source
• events must not be trusted blindly
Attack prevention
• duplicate event handling
• out-of-order handling
• poisoned message protection
17.9 Secrets management
Never store secrets in:
• source code
• logs
• client-side apps
Use
• environment variables
• secret managers (AWS Secrets Manager etc.)
• rotation policies
17.10 Rate limiting and abuse protection
Protect against:
• bot betting floods
• brute force login attempts
• API scraping
• denial of service
Controls
• per-user rate limits
• per-IP rate limits
• endpoint-specific limits
• adaptive throttling
17.11 Fraud and risk controls
System must support:
• withdrawal velocity limits
• abnormal betting detection
• multi-account detection signals
• flagged wallet addresses
• behavioural anomaly detection
Actions
• block
• hold
• review
• escalate
17.12 Audit requirements
Every critical action must be logged:
• who performed it
• what was done
• when
• from where
• why (if applicable)
Must cover
• ledger writes
• withdrawals
• deposits
• settlements
• admin actions
• permission changes
17.13 Failure containment
If a breach or anomaly occurs:
• isolate aﬀected accounts
• freeze suspicious activity
• prevent further movement
• preserve audit trail
17.14 Least privilege principle
Every component must have:
• only the access it needs
• nothing more
Examples:
• Bet service cannot access treasury
• Treasury cannot modify bets
• Read service cannot write anything
17.15 Network security (high level)
• services should run in private networks where possible
• only required endpoints exposed publicly
• use HTTPS everywhere
• internal traﬃc encrypted where possible
17.16 Non-negotiable rules
• Ledger cannot be bypassed
• No client input is trusted
• All write operations must be idempotent
• External money movement must be verified, not assumed
• Admin actions must be auditable
• Secrets must never be exposed
• No service has unlimited access
• Replay attacks must be prevented
• Ambiguous financial state must trigger safe handling
17.17 Mental model
Think of it like this:
• Client
=
attacker until proven otherwise
• Ledger
=
vault
• Treasury
=
bank connection
• Admin
=
controlled risk, not trusted authority
• Events
=
rumours that must be verified
If this section is done right, you can:
• survive bugs
• survive outages
• survive bad actors
• scale safely
18. Failure rules and idempotency
Purpose
This section defines how NINES Financial behaves when things go wrong and how
it prevents the same command from producing duplicate financial eﬀects.
The goal is simple:
a user, operator, worker, network retry, webhook replay, or crashed service
must not be able to cause double credits, double debits, duplicate
settlements, or repeated withdrawals.
Failure handling must favour correctness over speed.
If the system is uncertain, it must stop, preserve evidence, and move into a
recoverable state.
18.1 Core principles
Fail safe, not fast
When the system cannot guarantee correctness, it must prefer:
• rejection
• pending state
• manual review
• retry later
over guessing.
A guessed success or guessed failure is dangerous in a financial system.
Every write command must be idempotent
Any command that can mutate state must be safely repeatable.
This includes:
• deposits
• withdrawals
• bet placement
• bet cancellation if supported
• settlement execution
• reversals
• adjustments
• treasury transfers
• wallet linking flows where they aﬀect financial permissions
The same command repeated multiple times must produce one financial outcome,
not many.
External uncertainty must never trigger blind retry
If an external provider may already have accepted or executed a request, the
system must not automatically send it again unless it has definitive proof that no
prior eﬀect occurred.
This is especially important for:
• blockchain broadcasts
• custody withdrawal requests
• bank payout instructions
• provider callbacks
Canonical truth beats delivery outcome
A command is not considered financially eﬀective because a client received a 200
response.
A command is financially eﬀective only if canonical domain state and ledger state
confirm it.
A timeout after success must still be safely replayable.
18.2 Failure classification
Failures should be treated diﬀerently depending on where they happen.
Pre-execution failure
The command failed before domain mutation began.
Examples:
• invalid request
• authentication failure
• authorisation failure
• validation failure
Rule:
No side eﬀects. Safe to retry after correction if applicable.
In-transaction failure
The command failed during domain processing before commit completed.
Examples:
• DB error during bet creation
• ledger posting failure before transaction commit
• optimistic lock conflict
Rule:
The whole transaction must roll back, or the entity must enter an explicit repairable
state if rollback across the full workflow is not possible.
No invisible partial success.
Post-commit response failure
The command committed successfully, but the caller did not receive confirmation.
Examples:
• API timed out after DB commit
• network dropped after success response started
• worker crashed after posting but before acknowledgement
Rule:
A replay of the same idempotent command must return the original result or
current authoritative outcome, not re-execute the financial eﬀect.
External-side-eﬀect ambiguity
The internal system cannot confirm whether the external action happened.
Examples:
• withdrawal request sent to provider, then timeout
• blockchain broadcast submitted, hash not returned
• deposit callback processing partially failed after provider already sent event
Rule:
Never assume failure.
Move the entity to an explicit uncertainty state such as:
• EXTERNAL_STATUS_UNKNOWN
• AWAITING_PROVIDER_CONFIRMATION
• MANUAL_REVIEW_REQUIRED
Then reconcile using provider evidence.
Async propagation failure
The canonical write succeeded, but downstream events or read model updates
failed.
Examples:
• ledger posted but event bus publish failed
• withdrawal status saved but query model not updated
• settlement completed but notification failed
Rule:
Canonical write remains source of truth.
Downstream projection and event publication must be repaired separately.
Do not roll back canonical money truth because a notification or projection failed.
18.3 Idempotency model
18.3.1 Command identity
Every mutating command must carry a stable idempotency identity.
Recommended inputs:
• idempotencyKey
• command type
• caller identity
• request fingerprint
• target aggregate or business key where applicable
A command should be identifiable as “the same intended action” even if delivery
happens more than once.
18.3.2 Request fingerprint
The system should store not just the idempotency key, but also a fingerprint of the
eﬀective request payload.
This fingerprint should include the fields that define the action, for example:
• user/account
• amount
• currency
• race ID
• selection
• destination wallet
• asset
• command type
This allows the system to distinguish:
• genuine replay of the same request
• accidental or malicious reuse of the same key with a diﬀerent payload
18.3.3 Canonical replay rules
When an idempotency key is seen again:
Same key + same fingerprint + prior success
Return the original success result or the current authoritative representation of that
command.
Do not re-execute.
Same key + same fingerprint + still processing
Return a processing response, such as current status or accepted/pending.
Do not start a second execution.
Same key + diﬀerent fingerprint
Reject as idempotency conflict.
This must never be allowed to silently overwrite or branch into a second financial
eﬀect.
Diﬀerent key + duplicate business intent
Where the business domain has its own uniqueness rules, the system may still
reject.
Examples:
• same provider deposit reference already credited
• same settlement batch already completed
• same external transfer reference already processed
Idempotency keys are not the only duplicate defence.
Business uniqueness constraints matter too.
18.4 Where idempotency must be enforced
API layer
Public write endpoints must require or generate idempotency keys for sensitive
commands.
At minimum this should apply to:
• place bet
• request withdrawal
• request deposit credit finalisation
• operator adjustment
• reversal
• settlement trigger
• treasury movement initiation
Service layer
Even if an API forgot to enforce it, internal command handlers must still defend
against duplicate execution.
The final defence must not live only at the edge.
Database layer
Critical uniqueness must also be enforced in persistence, for example with unique
indexes on:
• idempotency key per command scope
• provider transaction reference
• settlement run reference
• ledger posting reference
• withdrawal request reference
This protects against concurrency and programming mistakes.
Consumer layer
Event consumers and webhook handlers must also be idempotent.
A duplicate event delivery must not produce duplicate money movement.
18.5 Domain-specific failure and idempotency rules
18.5.1 Bet placement
A place-bet command must be idempotent.
If the same command is retried because the client timed out:
• the system must not place two bets
• the system must not reserve or debit funds twice
• the original bet record should be returned if already created
If two distinct requests race for the same funds:
• normal balance and locking rules apply
• one may succeed and the other fail with insuﬃcient funds or version conflict
The system must distinguish duplicate retry from genuinely separate competing
bets.
18.5.2 Deposit crediting
Deposit crediting must be idempotent against the external deposit identity, not just
the API request.
Examples of uniqueness anchors:
• blockchain tx hash plus output/index
• provider transfer ID
• bank transaction reference
If the same deposit signal arrives multiple times:
• credit once
• record duplicates
• return prior result where appropriate
A repeated callback must never create repeated balance.
18.5.3 Withdrawal initiation
Withdrawal initiation must be idempotent at the internal request level.
If the same withdrawal request is retried:
• only one withdrawal entity should exist for that intended command
• available funds should be reserved once
• provider initiation should happen once unless safely proven otherwise
If provider execution state is unknown:
• do not resubmit blindly
• reconcile first
This is one of the highest-risk areas in the system.
18.5.4 Settlement execution
Settlement for a given race and settlement version must be idempotent.
If the settlement trigger is called twice:
• the race must not be settled twice
• winning bets must not be paid twice
• losing bets must not be processed twice
• the original settlement result should be returned, or the system should
indicate it is already settled
Recommended uniqueness anchor:
• settlement scope, such as raceId + settlementVersion + settlementType
18.5.5 Reversals and adjustments
Reversals must reference the original posting or command they are correcting.
A reversal must itself be idempotent.
The system must prevent:
• reversing the same posting twice
• adjusting the same incident repeatedly without approval
• creating free-floating financial corrections without traceable cause
Every adjustment must be attributable.
18.6 State transition failure rules
Each aggregate should only move through valid states.
If a failure happens mid-workflow, the state must remain safe and explicit.
General rule
No aggregate may end in an undefined or implied state.
It must be either:
• unchanged
• committed to a valid new state
• placed in a known recovery state
Recovery state examples
For withdrawals:
• REQUESTED
• FUNDS_RESERVED
• SUBMITTED_TO_PROVIDER
• AWAITING_CONFIRMATION
• EXTERNAL_STATUS_UNKNOWN
• FAILED
• COMPLETED
• MANUAL_REVIEW_REQUIRED
For settlements:
• PENDING
• CALCULATING
• POSTING
• COMPLETED
• FAILED
• REQUIRES_RETRY
• REQUIRES_MANUAL_REVIEW
For deposits:
• DETECTED
• PENDING_CONFIRMATION
• CONFIRMED
• CREDIT_POSTING_PENDING
• CREDITED
• CREDIT_FAILED
• REVIEW_REQUIRED
These recovery states are what stop the system from becoming “maybe done”.
18.7 Transaction rules
Atomic where possible
If domain state and ledger state are updated in the same service boundary and
same database boundary, they should commit atomically.
Example:
• create bet
• reserve/debit balance
• write ledger entries
• persist idempotency record
All in one transaction where practical.
Explicit orchestration where atomicity is impossible
Where workflows cross service or provider boundaries, atomicity is not possible.
In those cases, the system must use:
• explicit command state
• durable step markers
• retry tracking
• compensating logic where allowed
• reconciliation
Never pretend a distributed workflow is atomic when it is not.
18.8 Retry rules
Safe automatic retry
Automatic retries are acceptable only for steps proven to be safe and idempotent.
Examples:
• transient lock acquisition failure
• transient event publish failure to outbox processor
• temporary read model update failure
• polling for provider status
Conditional retry
Retry may be allowed after checking current authoritative state.
Examples:
• provider timeout where status can be queried first
• settlement worker restart after crash
• webhook redelivery after prior unknown outcome
Never auto-retry blindly
Do not blindly retry:
• external sends
• withdrawal broadcasts
• reversal creation
• manual adjustment creation
• anything that could duplicate money movement
These require state inspection first.
Bounded retries
All automatic retry mechanisms must be bounded by policy, with:
• retry count
• backoﬀ strategy
• terminal failure state
• escalation path
Infinite retries are not acceptable.
18.9 Concurrency rules
Idempotency alone is not enough.
The system must also handle two diﬀerent commands hitting the same resources
at once.
Controls should include:
• optimistic version checks
• row-level locking where appropriate
• uniqueness constraints
• balance reservation rules
• serialized settlement scope ownership where needed
Example:
Two separate bet commands for the same user balance are not duplicates.
They are competing valid commands.
The system must process them safely so the account cannot overspend.
18.10 Outbox and event publication rule
When canonical state changes and an event must be published, the preferred
pattern is:
• commit canonical state
• persist event in an outbox within the same transaction
• publish asynchronously from outbox
• mark outbox item as delivered when confirmed
This avoids the classic failure where DB commit succeeds but bus publish fails
and nobody knows what happened.
The event system must be at-least-once, and consumers must therefore be
idempotent.
18.11 Webhook handling rules
All inbound external callbacks must be treated as replayable and untrusted.
Rules:
• verify signature
• record provider event ID if available
• enforce idempotent processing
• link processing to the associated deposit, withdrawal, or provider object
• preserve raw payload for audit where allowed
A repeated webhook must not change money twice.
18.12 Manual intervention rules
When automatic recovery is unsafe, the workflow must escalate.
Manual intervention states should be used when:
• external status is ambiguous
• invariant mismatch detected
• duplicate external reference conflicts exist
• provider response cannot be reconciled
• customer funds may be at risk
Manual handling must still be controlled:
• role-restricted
• fully audited
• action-based, not free-form
• preferably using approved repair commands rather than DB edits
18.13 Database constraints as safety rails
Application logic is not enough by itself.
Persistence must defend the system too.
Recommended safety constraints include:
• unique idempotency key within scope
• unique external provider reference
• unique reversal per original posting where required
• unique settlement scope execution
• foreign keys across linked financial objects
• check constraints for valid amounts and state assumptions where practical
The database should help make invalid duplication impossible.
18.14 Required stored evidence for replay safety
To support correct replays, the system should persist:
• idempotency key
• request fingerprint
• command status
• resulting resource ID
• response snapshot or response reference where appropriate
• correlation ID
• timestamps
• caller identity
• error code if failed in a terminal way
Without this, idempotent replay becomes guesswork.
18.15 Non-negotiable rules
• No mutating financial command without idempotency protection
• No duplicate deposit crediting
• No duplicate settlement payout
• No duplicate withdrawal execution
• No blind retry after ambiguous external execution
• No undefined post-failure state
• Canonical truth must survive client timeout and worker crash
• Event consumers and webhook handlers must be idempotent
• Database constraints must back up application logic
• Manual repair must happen through audited flows, not silent edits
18.16 Practical mental model
Think of every financial command like this:
“If this exact thing gets delivered 5 times, crashes halfway, times out once,
and comes back tomorrow, can the system still prove exactly what happened
and avoid doing it twice?”
If the answer is not clearly yes, the design is not ready.
18.17 Suggested V1 implementation stance
For V1, I would strongly recommend:
• mandatory idempotency keys on all write endpoints
• idempotency table with request fingerprint and final outcome
• unique business references for deposit, withdrawal, settlement, and ledger
posting
• outbox pattern for event publication
• explicit recovery states for all multi-step workflows
• no blind automatic retry for external sends
• operator repair flows through admin commands only
• atomic ledger plus domain writes wherever they share a DB boundary
That gives you a serious base without going insane.
19. Observability, audit, and reconciliation
Purpose
This section defines how NINES Financial:
• observes system health in real time
• records every critical action
• traces any operation end-to-end
• detects financial inconsistencies
• proves correctness of balances and flows
The goal is:
👉 At any moment, you can explain every dollar, every action, and every state
transition.
19.1 Three pillars
This section is built on three separate but connected systems:
1. Observability
Real-time system visibility
“What is happening right now?”
2. Audit
Immutable historical record
“What happened and who did it?”
3. Reconciliation
Financial correctness verification
“Is everything still correct?”
19.2 Observability
19.2.1 Structured logging
All services must emit structured logs (not plain text).
Each log entry should include:
• timestamp
• service name
• environment
• log level
• correlation ID
• request ID
• user ID (if applicable)
• account ID (if applicable)
• command ID / idempotency key
• event ID (if applicable)
• message
• structured metadata
Example
{
"timestamp": "2026-04-14T10:01:22Z",
"service": "ledger",
"level": "ERROR",
"correlationId": "cor_123",
"accountId": "acc_456",
"commandId": "cmd_789",
"errorCode": "LEDGER_IMBALANCE",
"message": "Ledger posting failed due to imbalance",
"details": {
"debit": "100.00",
"credit": "95.00"
}
}
19.2.2 Correlation and tracing
Every request must carry a correlation ID across services.
This allows:
• tracing a bet from API → ledger → settlement → payout
• debugging failures across service boundaries
• linking logs, events, and audit entries
Rule
• correlation ID must be generated at entry point
• propagated to all downstream calls
• included in logs, events, and audit records
19.2.3 Metrics
Each service must expose metrics for monitoring.
Core metrics
API level
• request rate
• error rate
• latency (p50, p95, p99)
Financial domain metrics
• bets placed per minute
• settlement duration
• deposits per interval
• withdrawals per interval
• failed withdrawals
• pending withdrawals
• reconciliation mismatches
System health
• DB latency
• queue depth
• event lag
• retry counts
• dead-letter queue size
19.2.4 Alerts
Alerts must be defined for critical conditions.
Examples
• ledger imbalance detected
• reconciliation mismatch above threshold
• withdrawal failures spike
• dependency unavailable
• queue backlog too high
• settlement taking too long
Severity levels
• Critical → immediate action required
• Warning → degraded but operational
• Info → tracking only
19.2.5 Dashboards
Operators must have dashboards showing:
• system health
• financial flow summaries
• real-time activity
• pending states (withdrawals, settlements)
• error trends
19.3 Audit
19.3.1 Audit vs logs
Logs are for debugging.
Audit is for truth.
Audit records must be:
• immutable
• complete
• structured
• queryable
19.3.2 What must be audited
Every financial or sensitive action:
• ledger postings
• deposits
• withdrawals
• bet placement
• settlement execution
• reversals and adjustments
• admin actions
• permission changes
19.3.3 Audit record structure
Each audit record should include:
• audit ID
• timestamp
• actor (user, service, admin)
• actor role
• action type
• target entity
• before state (if applicable)
• after state
• correlation ID
• command ID
• reason or context
• source IP or service identity
Example
{
"auditId": "aud_123",
"timestamp": "2026-04-14T10:05:00Z",
"actor": "user_456",
"role": "player",
"action": "BET_PLACED",
"target": "bet_789",
"after": {
"amount": "25.00",
"selection": "horse_3"
},
"correlationId": "cor_123"
}
19.3.4 Immutability
Audit records:
• must never be edited
• must never be deleted
• must be append-only
If corrections are needed:
• create a new audit entry
• reference the original
19.3.5 Admin audit rules
Admin actions must include:
• explicit reason
• actor identity
• approval chain (if required)
• full traceability
No silent admin actions allowed.
19.4 Reconciliation
This is where you prove:
👉 ledger
=
reality
19.4.1 Types of reconciliation
Internal reconciliation
Check consistency within the system.
Examples:
• ledger entries balance
• account balances match ledger
• settlements match expected totals
External reconciliation
Match system state against external providers.
Examples:
• deposits vs blockchain transactions
• withdrawals vs provider confirmations
• treasury balances vs actual holdings
19.4.2 Ledger reconciliation
The ledger must always satisfy:
• total debits = total credits
• no missing entries
• no orphaned entries
Checks
• batch balancing
• running totals
• checksum validation
• periodic full ledger scan
19.4.3 Account balance reconciliation
Balances must match:
• sum of ledger entries
• minus holds where applicable
Rule
If mismatch occurs:
• ledger is source of truth
• projection must be rebuilt
• discrepancy must be recorded
19.4.4 Settlement reconciliation
For each race:
• total stakes
• total payouts
• house take (if applicable)
must balance exactly.
Rule
No settlement is valid if:
• payouts exceed allowed total
• payouts are missing
• winners are misapplied
19.4.5 Deposit reconciliation
System deposits must match:
• external transaction list
• confirmations
• credited amounts
Rule
• no deposit credited without confirmation
• no confirmed deposit left uncredited
19.4.6 Withdrawal reconciliation
Withdrawals must match:
• internal requests
• provider execution
• confirmed transactions
Rule
• no withdrawal marked complete without confirmation
• no confirmed withdrawal missing from system
19.4.7 Treasury reconciliation
Treasury must track:
• total user liabilities
• total assets held
• reserves
Rule
Assets must always cover liabilities (within defined model).
19.4.8 Reconciliation jobs
System must run:
• periodic reconciliation jobs
• event-triggered reconciliation
• on-demand admin reconciliation
Outputs
• success
• mismatch detected
• discrepancy report
• required action
19.4.9 Discrepancy handling
When mismatch is found:
1. record discrepancy
2. identify scope
3. freeze aﬀected entities if needed
4. prevent further damage
5. investigate
6. resolve via controlled adjustment
19.4.10 Reconciliation audit trail
Every reconciliation must produce:
• report ID
• timestamp
• scope
• results
• discrepancies
• actions taken
19.5 Data retention
• logs → short to medium term
• audit → long-term (years)
• reconciliation reports → long-term
• financial records → retained per regulatory requirements
19.6 Non-negotiable rules
• Every financial action must be auditable
• Ledger must always balance
• Audit logs must be immutable
• Correlation IDs must trace across services
• Reconciliation must run regularly
• Discrepancies must be detectable and actionable
• External and internal state must be provably aligned
• No silent failures in financial flows
19.7 Mental model
Think of this like:
• Observability
=
live CCTV
• Audit
=
permanent court record
• Reconciliation
=
accountant checking the books
If all three are strong:
👉 you can trust the system
👉 you can debug anything
👉 you can survive incidents
20. Test strategy and required coverage
Purpose
This section defines how NINES Financial is tested and what level of coverage is
required before a component can be considered production-ready.
The goal is:
• prove financial correctness
• prove safety under failure
• prove idempotency
• prove state transitions
• prove reconciliation ability
• reduce the chance of silent money bugs reaching production
Testing here is not just about “does the endpoint return 200”.
It is about proving:
• no money is created accidentally
• no money is destroyed accidentally
• no workflow can run twice and double-pay
• no invalid transition can slip through
• no service boundary breaks financial truth
20.1 Testing principles
Financial correctness over superficial coverage
A high line coverage number is not enough.
The test strategy must prioritise:
• invariant protection
• money movement correctness
• failure handling
• idempotency
• concurrency safety
• auditability
• reconciliation outcomes
A financially critical module with 95 percent line coverage can still be unsafe if the
wrong things were not tested.
Test the system at multiple levels
The test strategy must include all of the following:
• unit tests
• component or service tests
• integration tests
• contract tests
• end-to-end flow tests
• failure and chaos-style tests
• reconciliation tests
• migration and persistence tests
Each layer catches diﬀerent classes of failure.
Production-like testing matters
Tests must run against infrastructure and workflows close enough to reality to
expose real financial risks.
That means testing things like:
• real database transactions
• unique constraints
• retries
• duplicate event delivery
• provider callback replay
• worker restarts
• timeout behaviour
Mock-only financial confidence is not enough.
20.2 Test pyramid for NINES Financial
20.2.1 Unit tests
Unit tests verify isolated domain logic and helper behaviour.
Examples:
• payout calculation
• fee calculation
• state transition guards
• amount validation
• currency precision rules
• role permission checks
• request fingerprint generation
• idempotency decision logic
• ledger balancing helpers
Unit tests should be fast and numerous, but they are not suﬃcient on their own.
20.2.2 Service or component tests
These test a single service with its important dependencies, usually using a real
database and realistic persistence rules.
Examples:
• bet placement handler with DB transaction
• ledger posting service with real unique constraints
• withdrawal command handler with state persistence
• settlement orchestration within service boundary
These tests should verify:
• domain writes
• rollback behaviour
• transaction boundaries
• DB-backed invariants
• persistence of audit and idempotency records
20.2.3 Integration tests
Integration tests verify multiple parts working together.
Examples:
• bet service calling accounting core
• settlement service posting payouts through ledger
• treasury service ingesting deposit confirmation and crediting user
• webhook handler updating withdrawal state and publishing event
These should use real or near-real adapters wherever possible.
20.2.4 Contract tests
Contract tests verify that service-to-service APIs and event schemas stay
compatible.
Examples:
• request and response DTO compatibility
• event schema version compatibility
• required fields and enum behaviour
• internal API expectations between services
This is important because a financial failure can come from one service silently
changing a payload shape.
20.2.5 End-to-end tests
These verify complete financial workflows from entry to final state.
Examples:
• deposit → balance available → bet → race settles → withdrawal
• duplicate withdrawal request returns original outcome
• repeated provider callback credits once only
• failed external step moves entity into review state
• reconciliation catches a forced mismatch
These are the tests that prove the business actually works.
20.3 Required coverage areas
20.3.1 Domain invariants
All non-negotiable financial invariants must have explicit tests.
Examples:
• ledger debits equal credits
• no invalid negative spendable balance
• no duplicate settlement for same scope
• no duplicate deposit credit
• no duplicate withdrawal execution
• no invalid entity transition
• no payout beyond allowed settlement result
• no reversal without original reference
• no admin action without audit
These should not be tested only indirectly.
They should have dedicated tests.
20.3.2 Idempotency
Idempotency must have extensive test coverage.
At minimum test:
• same idempotency key plus same payload returns same outcome
• same idempotency key plus diﬀerent payload is rejected
• client timeout followed by retry does not duplicate eﬀect
• worker retry does not duplicate eﬀect
• duplicate event delivery does not duplicate eﬀect
• duplicate webhook delivery does not duplicate eﬀect
This is one of the most important areas in the whole system.
20.3.3 State machines and lifecycle rules
Every entity with lifecycle states must have transition tests.
Examples:
• deposit state transitions
• withdrawal state transitions
• bet state transitions
• settlement state transitions
• review and failure state transitions
Tests must verify:
• allowed transitions succeed
• forbidden transitions fail
• failure states are explicit
• recovery states behave correctly
A good rule is that every state machine should have a transition matrix test suite.
20.3.4 Concurrency and race conditions
The system must be tested under competing operations.
Examples:
• two bets attempting to spend the same balance
• duplicate settlement jobs starting at once
• repeated withdrawal approval attempts
• concurrent webhook processing for same provider event
• replay and original request arriving nearly simultaneously
Tests should verify:
• one wins, one fails where appropriate
• no overspend
• no duplicate posting
• no corrupted final state
20.3.5 Failure handling
Failure rules must be tested deliberately, not just accidentally.
Examples:
• DB failure during transaction
• timeout after commit but before response
• crash after provider submission but before local state update
• event bus unavailable after canonical write
• projection update failure
• dependency timeout during withdrawal flow
Tests must verify:
• rollback where required
• explicit pending or review state where required
• no hidden partial success
• replay safety afterward
20.3.6 Reconciliation
Reconciliation must be tested as a first-class feature.
Examples:
• balance projection mismatch detected
• provider transaction missing from local state
• local deposit record duplicated against same provider reference
• treasury liabilities exceed tracked assets
• settlement totals do not match expected pool totals
Tests must verify:
• discrepancy is detected
• report is produced
• aﬀected entities can be identified
• unsafe continuation is blocked where needed
20.3.7 Audit and observability
Tests must verify the system leaves evidence.
Examples:
• audit record created on bet placement
• audit record created on admin adjustment
• correlation ID propagated through service chain
• structured logs emitted with required identifiers
• reconciliation run creates report artifact
Financial systems are not fully tested if they work but cannot explain themselves.
20.4 Coverage by domain
20.4.1 Bet Intake and Orchestration
Required tests:
• valid bet placement
• insuﬃcient funds rejection
• betting closed rejection
• suspended account rejection
• idempotent retry returns same bet
• concurrent bet overspend prevention
• audit record creation
• event emission or outbox persistence
• rollback if ledger step fails
20.4.2 Accounting Core
Required tests:
• balanced double-entry posting
• unbalanced posting rejected
• balance computation correctness
• reversal rules
• adjustment rules
• idempotent command processing
• unique reference enforcement
• transaction rollback on failure
• projection rebuild from ledger
• invariant breach escalation
This is the most heavily tested service.
20.4.3 Settlement
Required tests:
• winning payouts correct
• losing bets settled correctly
• duplicate settlement blocked
• settlement versioning respected
• partial failure enters explicit recovery state
• payout posting through ledger only
• audit and event creation
• settlement reconciliation totals correct
20.4.4 Treasury and External Movement
Required tests:
• deposit detection and confirmation
• deposit credited once only
• withdrawal request lifecycle
• ambiguous provider result enters review state
• external callback replay handled safely
• asset conversion rules if applicable
• treasury reconciliation against provider data
• no blind duplicate send after uncertainty
This service needs strong integration and failure testing.
20.5 Test data strategy
Test data must be realistic and intentionally cover edge cases.
Include:
• minimum and maximum amounts
• precision edge cases
• unsupported assets
• stale state versions
• duplicate references
• repeated webhooks
• delayed events
• restricted accounts
• regulatory hold states
• empty and overfull batches
Use deterministic fixtures where possible so results are reproducible.
20.6 Database and migration testing
Schema changes are financial risk and must be tested.
Required:
• migration up tests
• migration rollback tests where supported
• constraint verification
• index and uniqueness verification
• seed or fixture compatibility
• backward compatibility for live data assumptions
No migration aﬀecting financial tables should ship untested.
20.7 API and event contract testing
Every public and internal contract must be tested for stability.
Required:
• DTO shape validation
• enum compatibility
• required field enforcement
• error response format
• event schema validation
• version compatibility checks
This matters because broken contracts can create silent financial failure between
services.
20.8 Environment test stages
Recommended release path:
Local
Fast unit and service tests during development
CI
Full unit, service, integration, contract, and migration tests on every PR
Pre-production or staging
End-to-end flows, provider sandbox tests, reconciliation runs, failure drills
Production safeguards
Smoke checks, monitors, read-only reconciliation, controlled rollout checks
No financial feature should jump from local success straight to production.
20.9 Required failure-injection testing
The system should include deliberate fault injection for critical flows.
Examples:
• drop response after commit
• duplicate same message delivery
• force DB timeout
• force dependency timeout
• crash worker between steps
• replay webhook multiple times
• disable event bus publish after canonical commit
These tests are important because real incidents rarely happen in the neat places.
20.10 Coverage expectations
Avoid pretending one percentage solves everything, but set minimum
expectations.
Recommended baseline:
• very high coverage for pure domain logic
• explicit tests for every non-negotiable invariant
• explicit tests for every state transition family
• explicit tests for every idempotent write flow
• explicit tests for every reconciliation job
• explicit tests for every admin money-aﬀecting action
If you want numeric guidance for v1:
• domain and financial core logic: aim 90 percent or higher
• service handlers in critical domains: aim 80 percent or higher
• critical workflow integration paths: all major paths covered
• no known untested invariant in ledger, settlement, or treasury flows
The important thing is not the number.
The important thing is whether the dangerous paths are covered.
20.11 Release gates for financial changes
A financial change should not merge or release unless:
• relevant unit tests pass
• relevant service and integration tests pass
• contract tests pass
• migrations validated
• reconciliation tests pass if aﬀected
• idempotency tests pass if aﬀected
• no failing critical observability or audit tests
• reviewers confirm invariants still hold
For especially sensitive changes, require manual review from the financial system
owner.
20.12 Manual test requirements
Some things should also be manually exercised in staging, especially early on.
Examples:
• operator review flows
• admin adjustment flows
• dashboard and audit visibility
• provider sandbox interactions
• ambiguous external state handling
• emergency freeze or hold behaviour
Manual testing is not a replacement for automation, but it is useful for operational
workflows.
20.13 Non-negotiable rules
• no financial domain ships without automated tests
• no idempotent write flow ships untested
• no state machine ships without transition tests
• no ledger invariant is left to assumption
• no provider integration ships without replay and timeout tests
• no reconciliation logic ships without mismatch detection tests
• no admin money-aﬀecting action ships without audit tests
• no migration touching financial truth ships untested
20.14 Practical mental model
Ask this for every feature:
What happens if it is called twice, called late, called concurrently, times out
after success, crashes halfway through, or receives the same external signal
three times?
If you do not have a test for that, you do not yet trust that feature.
20.15 Recommended v1 implementation stance
For v1, I would strongly recommend you require automated coverage for these
exact areas before real money:
• deposit crediting
• withdrawal initiation and confirmation
• ledger posting and reversal
• bet placement and funds reservation
• settlement execution
• reconciliation jobs
• admin adjustments
• webhook replay handling
• outbox publication safety
• migration safety for financial tables
That gives you a serious base without demanding enterprise-level perfection on
day one.
21. Implementation phases
Purpose
This section defines the order in which NINES Financial should be built so that:
• the riskiest foundations are done first
• each phase leaves the system in a coherent state
• later phases build on proven financial truth
• complexity is introduced in controlled layers
• real-money capability is not opened before the safety rails exist
The goal is:
build the minimum correct financial core first, then layer capability on top of it
without breaking trust.
21.1 Delivery principles
Build foundations before convenience
Do not start with dashboards, advanced treasury logic, or broad asset support.
Start with:
• canonical ledger
• account model
• idempotent command handling
• deposit and withdrawal state models
• audit trail
• reconciliation basics
If the money core is weak, every feature built on top of it is unstable.
Deliver in slices that are operationally meaningful
Each phase should produce something that is:
• internally coherent
• testable
• reviewable
• safe to extend
Do not build half a ledger in one phase and half a withdrawal flow in another if
neither can stand on its own.
Open risk gradually
The order should roughly be:
1. record financial truth
2. protect financial truth
3. move internal money safely
4. move external money safely
5. automate and scale
6. harden operations
21.2 Recommended phase model
I would break V1 into seven phases.
Phase 0
—
Foundation and architecture lock
Purpose
Define the structure before writing real money logic.
This phase is about avoiding architectural drift and hidden assumptions.
Scope
• finalise bounded contexts
• finalise canonical terms
• define service ownership
• define entity lifecycles
• define command model
• define error model
• define security and trust boundaries
• define DTO and event conventions
• choose persistence strategy
• choose idempotency strategy
• choose audit strategy
• choose deployment environments for dev, staging, prod
Outputs
• approved financial architecture document
• initial repo structure
• migration strategy
• coding standards for financial modules
• shared package decisions if any
• base testing strategy agreed
• correlation ID and observability conventions agreed
Exit criteria
• no unresolved ambiguity around ledger ownership
• no unresolved ambiguity around settlement ownership
• no unresolved ambiguity around external fund movement ownership
• phase 1 can begin without re-arguing the architecture
Phase 1
—
Accounting core and canonical financial truth
Purpose
Build the heart of the system first.
Before bets, deposits, or withdrawals do anything meaningful, you need the
system that records financial truth.
Scope
Build the Accounting Core with:
• chart of accounts or equivalent account structure
• double-entry ledger
• posting engine
• idempotent financial commands
• balance computation rules
• holds and spendable balance model if included in v1
• reversal mechanism
• adjustment mechanism with strict controls
• audit record creation for ledger-aﬀecting commands
• basic reconciliation checks for ledger balancing
Key deliverables
• ledger tables
• posting engine
• account balance projection or read model
• idempotency table and command store
• reversal flow
• core invariants enforced in code and DB constraints
• foundational tests for posting, replay, rollback, reversal
Why this comes first
Because every other domain will eventually ask:
• did money move?
• what is the balance?
• can this be reversed?
• what is the source of truth?
This phase answers that.
Exit criteria
• ledger postings are balanced and provable
• balance reads are correct
• duplicate commands do not duplicate eﬀect
• reversals are traceable and safe
• financial truth survives retry and timeout cases
Phase 2
—
Internal wallet and account capability
Purpose
Build the user-facing financial container before connecting real external money.
This lets you prove internal money movement safely first.
Scope
• account creation and linking
• wallet or balance container model
• user-account permissions
• internal holds or reserved balance model
• account status controls
• spendable vs restricted balance rules
• account lifecycle states
• player-facing balance query endpoints
• admin-visible account inspection tools
• basic restriction and freeze controls
Key deliverables
• account APIs
• account state machine
• balance display DTOs
• account restriction logic
• audit coverage for account-aﬀecting actions
Why this comes next
Because betting, deposits, settlement, and withdrawals all need somewhere to
land.
You want the internal financial container stable before connecting external
payment rails.
Exit criteria
• users can have a canonical account
• balance states are well-defined
• account restrictions are enforced correctly
• no unauthorised access to account state
Phase 3
—
Bet intake and internal stake flow
Purpose
Connect the game to the financial core, but only for internal financial movement
first.
At this phase, the system should be able to accept stakes and record them safely
against user balances.
Scope
• place-bet command
• bet entity and lifecycle
• stake reservation or debit logic
• race eligibility validation
• betting window rules
• insuﬃcient funds handling
• bet queries
• bet events and outbox
• audit for bet placement and rejection
• concurrency protection on balance usage
Key deliverables
• bet service endpoints
• bet storage
• ledger-linked stake movement
• idempotent bet placement
• duplicate request protection
• failed bet rollback behaviour
Important note
At this stage, you can use:
• internal seeded balances
• admin-funded test balances
• sandbox deposit simulations
You do not need real crypto or fiat movement yet.
That is deliberate.
Exit criteria
• one bet command results in one bet only
• funds are reserved or debited exactly once
• invalid bets cannot consume balance
• concurrent spend attempts cannot overspend
• all bet flows are auditable
Phase 4
—
Settlement and result-driven payout
Purpose
Close the loop on the game economy.
Now that stakes can enter the system, this phase makes outcomes financially real.
Scope
• settlement trigger for a race
• settlement entity and lifecycle
• payout calculation
• losing bet closure
• winning bet payout posting through ledger
• settlement idempotency
• race-level settlement uniqueness
• settlement audit
• settlement reconciliation checks
• failed settlement recovery states
Key deliverables
• settlement service endpoints
• settlement posting logic
• payout calculation rules
• settlement reports
• duplicate settlement prevention
• recovery flow for failed or partial settlement steps
Why here and not earlier
Because there is no point moving to real deposits and withdrawals if you have not
proven that your internal economic loop works correctly.
You want:
balance in → bet placed → race settled → balance out internally
before:
real crypto in → real crypto out
Exit criteria
• each race settles once per settlement scope
• winners are paid exactly once
• losers are finalised correctly
• settlement totals reconcile
• failed settlement states are visible and recoverable
Phase 5
—
External deposit rails
Purpose
Introduce external money into the system safely.
This phase should start with the simpler direction first: incoming value.
Deposits are generally safer than withdrawals because you are crediting after
confirmation rather than pushing funds outward.
Scope
• deposit entity and lifecycle
• provider or chain integration for inbound funds
• confirmation policy
• deposit reference uniqueness rules
• deposit crediting through ledger
• duplicate callback protection
• deposit reconciliation jobs
• provider callback verification
• manual review path for ambiguous deposits
Key deliverables
• deposit APIs and internal records
• provider adapters
• confirmation handling
• deposit-credit posting flow
• duplicate deposit protection
• deposit reconciliation reporting
Suggested V1 stance
Keep this narrow at first:
• one stable settlement asset
• one deposit rail
• one confirmation model
• no multi-chain explosion yet
For example, one stablecoin rail is much safer than trying to support several assets
at once in early phases.
Exit criteria
• confirmed deposits credit exactly once
• duplicate callbacks do not duplicate credit
• unmatched or ambiguous deposits go to review
• deposit records reconcile against provider data
Phase 6
—
External withdrawal rails
Purpose
Add the most dangerous capability last among the core money flows.
Withdrawals are where the system can actually lose funds quickly.
Scope
• withdrawal request flow
• withdrawal state machine
• balance hold or reserve for outgoing transfer
• destination validation
• policy checks and risk controls
• provider submission flow
• provider confirmation handling
• ambiguous provider response handling
• manual review workflow
• withdrawal reconciliation
• optional approval steps for higher-risk withdrawals
Key deliverables
• withdrawal APIs
• withdrawal persistence
• reserve and release logic
• provider integration
• external status polling or callback handling
• review and escalation states
• duplicate send protection
• audit and operator visibility
Hard rule for this phase
Do not launch withdrawals until all of the following already exist:
• strong ledger truth
• idempotency
• audit
• reconciliation
• clear review states
• admin/operator visibility
If any of those are weak, withdrawals are too dangerous.
Exit criteria
• one withdrawal request can only result in one outward transfer
• ambiguous provider outcomes do not trigger blind resubmission
• failed withdrawals release or retain funds according to explicit rules
• completed withdrawals reconcile to provider truth
• operator can inspect and resolve stuck cases
Phase 7
—
Operational hardening and advanced controls
Purpose
Turn the system from “works” into “operationally durable”.
This is where you add the controls that reduce long-term risk and operator pain.
Scope
• advanced reconciliation tooling
• discrepancy case management
• admin portal financial tooling
• treasury reporting
• fraud and risk controls
• approval workflows
• manual adjustment controls
• operational dashboards
• alerts and paging
• richer audit search
• backfill and replay tools
• disaster recovery drills
• load and failure drills
• environment promotion controls
Key deliverables
• admin and operator workflows
• reconciliation dashboard
• discrepancy review queue
• financial incident playbooks
• production monitoring
• runbooks for stuck deposits, withdrawals, and settlements
Exit criteria
• operators can diagnose incidents quickly
• discrepancies are visible and actionable
• sensitive actions are gated and audited
• system can survive routine failures without panic
21.3 Recommended release sequence inside the phases
If you want the leanest sensible V1 path, I would do it in this order:
1. Architecture lock
2. Ledger core
3. Accounts and internal balances
4. Bet placement and stake movement
5. Settlement and payout
6. Deposit rail
7. Withdrawal rail
8. Hardening and admin operations
That gives you a clean staircase.
21.4 What should stay out until later
To keep early delivery sane, I would keep these out of initial implementation unless
they are absolutely required:
• multiple stablecoins at launch
• broad multi-chain abstraction
• full treasury portfolio management
• complex auto-conversion routing
• advanced aﬃliate or partner revenue flows
• cross-region active-active finance writes
• automated risk scoring sophistication
• large manual adjustment surface area
• broad admin superpowers
• complex bonus or promo wallet logic
These can all come later once the core truth layer is proven.
21.5 Dependency map between phases
The phases depend on each other like this:
• Phase 0 enables everything
• Phase 1 is the dependency for all money truth
• Phase 2 depends on Phase 1
• Phase 3 depends on Phases 1 and 2
• Phase 4 depends on Phases 1, 2, and 3
• Phase 5 depends on Phases 1, 2, and core observability
• Phase 6 depends on Phases 1 through 5
• Phase 7 depends on everything before it
This matters because it shows where you cannot safely skip ahead.
21.6 Suggested team focus by phase
If you are doing this in a small team, the practical focus per phase is roughly:
Phase 0
Architecture and ownership
Phase 1
Ledger and core financial persistence
Phase 2
Accounts, balances, permissions
Phase 3
Betting integration with financial controls
Phase 4
Settlement correctness
Phase 5
Inbound external funds
Phase 6
Outbound external funds
Phase 7
Ops, admin, reconciliation maturity
This helps avoid context chaos.
21.7 Suggested proof points after each phase
At the end of each phase, you should be able to demo one clear proof.
After Phase 1
“We can record and replay financial truth safely.”
After Phase 2
“We can manage user financial accounts safely.”
After Phase 3
“We can accept a bet and charge it exactly once.”
After Phase 4
“We can settle a race and pay winners exactly once.”
After Phase 5
“We can credit confirmed deposits exactly once.”
After Phase 6
“We can execute a withdrawal without duplicate outward movement.”
After Phase 7
“We can detect, investigate, and repair financial issues operationally.”
Those proof points are useful because they force clarity.
21.8 Non-negotiable implementation rules
• do not build withdrawals before ledger, audit, and reconciliation basics exist
• do not support multiple asset rails before one rail is stable
• do not bypass ledger for speed
• do not launch real-money flows before idempotency is proven
• do not rely on manual ops as the primary safety model
• do not add convenience features that weaken financial truth
• do not merge phases conceptually if it makes ownership blurry
21.9 Practical recommendation for NINES specifically
For NINES, I would be even more opinionated:
First real target
Get to:
• ledger core
• user accounts
• internal balance model
• bet placement
• settlement
with fake or sandbox funding first
That gives you a closed-loop proof of the game economy.
Second target
Add one external deposit rail.
Third target
Add one external withdrawal rail with very conservative controls.
That is much safer than trying to go straight to the full crypto-financial vision in one
jump.
21.10 Mental model
Think of the phases like building a fortress:
• Phase 0 = blueprint
• Phase 1 = vault
• Phase 2 = rooms and access
• Phase 3 = letting value enter the game loop
• Phase 4 = resolving outcomes correctly
• Phase 5 = opening the intake gate
• Phase 6 = opening the exit gate
• Phase 7 = guards, cameras, alarms, and repair crews
Open the exit gate too early and the fortress gets robbed.
22. Acceptance criteria
Purpose
This section defines the conditions that must be met before NINES Financial can
be considered:
• functionally correct
• financially safe
• operationally viable
• ready for real money
The goal is:
👉 You can confidently say: “we can take deposits, run bets, settle outcomes,
and allow withdrawals without risking loss, duplication, or untraceable state.”
22.1 Acceptance philosophy
Not feature complete
—
risk complete
You are not checking:
• “did we build everything?”
You are checking:
• “can this system lose money, duplicate money, or hide money?”
If the answer is “maybe” → not ready.
Proof over assumption
Every acceptance item must be:
• demonstrable
• testable
• observable
No “it should work”.
Worst-case mindset
Acceptance must consider:
• retries
• crashes
• duplicate events
• delayed events
• bad actors
• operator mistakes
• external failures
If the system survives those → it is ready.
22.2 Global system criteria
These must all be true across the entire system.
22.2.1 Financial correctness
• all ledger postings are balanced
• no unbalanced transaction can be committed
• balances are derived correctly from ledger
• no negative spendable balance occurs unless explicitly allowed
• all financial movements are traceable to a command and audit record
22.2.2 Idempotency
• every write endpoint supports idempotency
• duplicate requests do not create duplicate financial eﬀects
• duplicate event deliveries do not create duplicate eﬀects
• duplicate webhook deliveries do not create duplicate eﬀects
• replay after timeout returns consistent results
22.2.3 State integrity
• all entities have explicit states
• no entity can end in an undefined or ambiguous state
• invalid state transitions are rejected
• failure states are visible and recoverable
22.2.4 Auditability
• every financial action produces an audit record
• audit records include actor, action, target, and timestamp
• audit records are immutable
• audit records can be queried by correlation ID, user, or entity
22.2.5 Observability
• all services emit structured logs
• correlation IDs are propagated end-to-end
• key financial flows are traceable across services
• metrics exist for core flows
• alerts are configured for critical failures
22.2.6 Reconciliation
• ledger reconciliation runs successfully
• account balances reconcile to ledger
• settlement totals reconcile per race
• deposits reconcile against provider data
• withdrawals reconcile against provider data
• discrepancies are detectable and reportable
22.2.7 Security
• all endpoints require authentication where appropriate
• role-based access control is enforced
• no service has unnecessary privileges
• secrets are not exposed
• admin actions are audited
• external callbacks are verified
22.3 Domain-specific acceptance criteria
22.3.1 Accounting Core
System is acceptable only if:
• double-entry ledger is enforced
• all postings are idempotent
• reversal mechanism works and is traceable
• unique references prevent duplicate posting
• balance calculations are correct under all tested scenarios
• invariant breaches are detected and handled
22.3.2 Accounts and balances
• users can access only their own accounts
• balance states (available, reserved, restricted) are correct
• account restrictions are enforced
• account lifecycle transitions behave correctly
22.3.3 Bet placement
• placing a bet results in exactly one bet record
• funds are reserved or debited exactly once
• insuﬃcient funds prevents bet
• betting window rules are enforced
• duplicate requests do not create multiple bets
• concurrent bets cannot overspend balance
22.3.4 Settlement
• each race is settled exactly once per settlement scope
• winners are paid correctly
• losers are finalised correctly
• payouts match calculated results
• duplicate settlement attempts do not re-run payouts
• settlement totals reconcile
22.3.5 Deposits
• confirmed deposits are credited exactly once
• duplicate provider callbacks do not duplicate credit
• unconfirmed deposits are not credited
• unmatched deposits are flagged for review
• deposit records reconcile with provider
22.3.6 Withdrawals
• one withdrawal request results in at most one external transfer
• funds are reserved before transfer
• ambiguous provider outcomes do not trigger duplicate sends
• failed withdrawals release or retain funds correctly
• completed withdrawals match provider confirmation
• withdrawal records reconcile
22.4 Failure scenario acceptance
The system must behave correctly under these tested scenarios:
22.4.1 Retry scenarios
• client retries after timeout → no duplicate eﬀect
• worker retries after failure → no duplicate eﬀect
• duplicate webhook delivery → no duplicate eﬀect
22.4.2 Crash scenarios
• crash before commit → no eﬀect
• crash after commit before response → replay returns correct result
• crash mid-workflow → entity enters valid recovery state
22.4.3 Concurrency scenarios
• simultaneous bets cannot overspend
• simultaneous settlement triggers do not double-settle
• simultaneous withdrawal actions do not duplicate execution
22.4.4 External failure scenarios
• provider timeout does not cause duplicate send
• missing callback does not cause silent failure
• inconsistent provider data is detected via reconciliation
22.5 Operational readiness
22.5.1 Monitoring
• dashboards show system health
• critical alerts are configured and tested
• operators can detect failures quickly
22.5.2 Admin capability
• operators can view:
• accounts
• bets
• settlements
• deposits
• withdrawals
• operators can:
• investigate discrepancies
• review flagged cases
• perform controlled adjustments
22.5.3 Incident handling
• runbooks exist for:
• failed deposits
• failed withdrawals
• settlement issues
• reconciliation mismatches
• system supports safe recovery actions
22.6 Testing acceptance
Before release:
• all required unit tests pass
• all service and integration tests pass
• all idempotency tests pass
• all reconciliation tests pass
• all migration tests pass
• critical flows covered by end-to-end tests
• no known failing financial invariant tests
22.7 Deployment readiness
• environment separation exists (dev, staging, prod)
• staging environment tested with realistic flows
• migrations are safe and verified
• secrets are configured securely
• rollback strategy exists
22.8 Go / No-Go checklist
Before enabling real money, you should be able to answer YES to all:
• Can we prove no duplicate deposits?
• Can we prove no duplicate withdrawals?
• Can we prove no duplicate settlement payouts?
• Can we trace every financial action end-to-end?
• Can we detect and report mismatches?
• Can we recover from failure without losing money?
• Can we prevent unauthorised access or actions?
• Can we safely retry any operation?
• Can operators resolve stuck or ambiguous cases?
If any answer is NO → do not go live.
22.9 Soft launch recommendation
Even if all criteria are met:
Start with:
• limited users
• capped balances
• capped withdrawals
• increased monitoring
• manual oversight
Gradually expand once real-world behaviour is proven.
22.10 Non-negotiable rules
• no real-money launch without passing acceptance criteria
• no bypass of ledger or audit for speed
• no untested financial flow in production
• no silent failure paths
• no uncontrolled admin actions
• no ambiguity in money movement
22.11 Final mental model
If someone asked you:
👉 “Can you prove where every dollar came from and where it went?”
👉 “Can this system accidentally pay someone twice?”
👉 “What happens if everything retries at once?”
You should be able to answer:
👉 clearly
👉 confidently
👉 with evidence
1
1