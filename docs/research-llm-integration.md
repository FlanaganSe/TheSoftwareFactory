# Research: LLM Integration, Agent Patterns, and AI-Assisted Coding

**Date:** 2026-03-18
**Scope:** OpenRouter integration, agent architecture, code generation, evidence generation, prompt engineering, SDK selection, cost optimization, observability, and self-healing guardrails for the Software Factory control plane.

**PRD References:** R-017 (Provider Routing), R-013 (Cost Tracking), R-008 (Evidence Packet), R-014 (Code Understanding), R-024 (Self-Healing Guardrails), R-025 (Circuit Breaker), R-023 (Context System & Trust Classification), Section 5.4 (Agent Topology)

---

## 1. OpenRouter Integration

### 1.1 API Surface

OpenRouter implements the OpenAI-compatible API specification. The primary endpoint is:

```
POST https://openrouter.ai/api/v1/chat/completions
```

Authentication is via Bearer token in the `Authorization` header. The API accepts the standard OpenAI request format with `messages`, `model`, `stream`, `tools`, `response_format`, `max_tokens`, `temperature`, etc.

**Generation Stats Endpoint** (critical for R-013 cost tracking):

```
GET https://openrouter.ai/api/v1/generation?id=$GENERATION_ID
```

Returns comprehensive metadata per generation:
- `total_cost` (USD), `usage` (USD), `cache_discount`, `upstream_inference_cost`
- `tokens_prompt`, `tokens_completion` (standardized)
- `native_tokens_prompt`, `native_tokens_completion`, `native_tokens_reasoning`, `native_tokens_cached`
- `latency` (ms), `generation_time` (ms)
- `model`, `provider_name`, `finish_reason`
- `created_at` (ISO 8601), `streamed` (boolean)

This endpoint is the primary mechanism for per-call cost and token tracking. The response `usage` field also contains token counts and cost inline, but the generation endpoint provides richer metadata after the fact.

**Source:** https://openrouter.ai/docs/api/api-reference/generations/get-generation

### 1.2 Streaming

Set `stream: true` for SSE responses. Final chunk includes `usage` stats (token counts). OpenRouter sends occasional comment payloads (`": OPENROUTER PROCESSING"`) to prevent timeouts -- these should be ignored per SSE spec.

Aborting a stream stops billing on supported providers. On unsupported providers, the model continues and full billing applies. This is important for budget enforcement (R-013): aborting a stream does not guarantee cost savings on all providers.

**Source:** https://openrouter.ai/docs/api/reference/streaming

### 1.3 Error Handling

| Code | Meaning | Recommended Action |
|------|---------|-------------------|
| 400 | Bad request (invalid params) | Fix request |
| 401 | Invalid credentials | Refresh API key |
| 402 | Insufficient credits | Add credits, pause task |
| 403 | Content flagged by moderation | Log, skip, notify |
| 408 | Request timeout | Retry with backoff |
| 429 | Rate limited | Exponential backoff with jitter, respect `Retry-After` |
| 502 | Model/provider down | Map to PRD R-017 pause-and-notify |
| 503 | No provider matches requirements | Adjust routing or pause |

Mid-stream errors arrive as SSE events with `finish_reason: "error"` (HTTP status remains 200 since headers are already sent). Pre-stream errors return standard JSON with the error code as HTTP status.

Provider error details are in `error.metadata.raw`. Moderation errors include `error.metadata.reasons` and `error.metadata.flagged_input`.

**Source:** https://openrouter.ai/docs/api/reference/errors-and-debugging

### 1.4 Rate Limits

Rate limits are dynamic, tied to account balance:
- Free tier: 50 requests/day (1000/day if 10+ credits purchased)
- Paid tier: $1 balance = 1 RPS, up to 500 RPS maximum

**Retry strategy:** Read `Retry-After` header. Use exponential backoff with randomized jitter. Implement client-side token-bucket or leaky-bucket limiter. Limit max retries and surface clear errors.

**Source:** https://openrouter.ai/docs/api/reference/limits

### 1.5 Provider Routing

OpenRouter's default routing uses price-based load balancing:
1. Filter providers without outages in last 30 seconds
2. Weight by inverse square of pricing (cheaper = more likely)
3. Remaining providers as fallback chain

**Critical for R-017 (pause-on-failure, no silent failover):**
- Set `allow_fallbacks: false` to disable automatic failover
- Use `provider.order` to specify a single provider
- Set `provider.only` to whitelist specific providers

This maps directly to the PRD requirement: "pause and notify by default, no silent auto-failover." Configure OpenRouter with `allow_fallbacks: false` and a single provider. On 502/503, the factory pauses and notifies.

Additional routing controls:
- `provider.require_parameters`: Route only to providers supporting all request params (e.g., `tools`)
- `provider.data_collection`: Control training data usage
- `provider.zdr`: Enforce Zero Data Retention (relevant for governance)
- `provider.quantizations`: Filter by quantization level

**Source:** https://openrouter.ai/docs/guides/routing/provider-selection

### 1.6 Prompt Caching

Anthropic models support prompt caching via OpenRouter. Add `cache_control` to messages. OpenRouter uses provider-sticky routing to maximize cache hits. Default cache lifetime: 5 minutes, refreshed on each cache hit.

**Caveat:** Community reports indicate caching through OpenRouter may be less reliable than direct Anthropic API calls. Monitor `cache_discount` in generation stats.

**Source:** https://openrouter.ai/docs/guides/best-practices/prompt-caching

### 1.7 Model Selection (2026 Landscape)

**Top models for coding tasks (SWE-bench Verified):**

| Model | SWE-bench Verified | Best For |
|-------|-------------------|----------|
| Claude Opus 4.6 | 80.8% | Bug fixing, agentic coding, general |
| Gemini 3.1 Pro | 80.6% | Code generation, bug fixing |
| MiniMax M2.5 | 80.2% | Bug fixing |
| GPT-5.4 | ~80% | Code generation, agentic coding |
| Claude Sonnet 4.6 | ~78% | Budget-conscious coding, agentic |
| Kimi K2.5 | Top tier | Code generation specifically |

**Open-source leaders:** Kimi-Dev-72B, Qwen3-Coder-480B-A35B, DeepSeek-V3

**Practical recommendation for model routing (R-017):**
- **Planning/understanding**: Claude Opus 4.6 or Gemini 3.1 Pro (strongest reasoning)
- **Code generation**: Claude Sonnet 4.6 or GPT-5.4 (good quality, lower cost)
- **Simple tasks** (commit messages, summaries): GPT-5.2-mini or Gemini Flash (cheap, fast)
- **Evidence annotation**: Claude Sonnet 4.6 (structured output, reliable)

**Source:** https://onyx.app/insights/best-llms-for-coding-2026, https://llm-stats.com/leaderboards/best-ai-for-coding

---

## 2. Agent Architecture for Coding Tasks

### 2.1 Architectural Patterns

The PRD specifies a single worker agent (Section 5.4). Two dominant patterns apply:

**ReAct (Reasoning + Acting):**
The agent alternates between thought/reasoning steps and action/tool-use steps. Each cycle: observe environment -> reason about next step -> act via tool invocation -> observe result -> repeat.

Strengths: Adaptive, handles unexpected situations, natural tool use.
Weaknesses: Higher token cost (reasoning at every step), can get stuck in loops.

**Plan-and-Execute:**
The agent first generates a multi-step plan, then executes each step sequentially. Uses significantly fewer tokens because it avoids repeated re-planning.

Strengths: Lower token cost, maintains long-term goal focus, plan is inspectable (good for evidence).
Weaknesses: Less adaptive to unexpected results, plan may become stale.

**Recommendation for the factory:** Hybrid approach. Use plan-and-execute for the outer loop (aligned with PRD workflow steps 3-8: understand -> plan -> implement -> validate -> evidence). Within implementation, use a ReAct-style tool loop for the actual coding work. The plan is a first-class artifact (visible in evidence, R-008). If the agent deviates significantly from the plan, it re-plans (with iteration limits per R-024).

### 2.2 The Agent Loop Structure

Aligned with the PRD core workflow (Section 6.1):

```
1. UNDERSTAND  -- Query code index, build context window
2. PLAN        -- Generate execution plan (structured output)
3. IMPLEMENT   -- ReAct tool loop:
                  a. Read relevant files
                  b. Reason about changes needed
                  c. Write/edit files
                  d. Run tests/lint/typecheck
                  e. Observe results
                  f. If failures: reason about fix, edit, re-validate
                  g. Repeat until passing or iteration limit
4. VALIDATE    -- Deterministic validator bundle (outside agent)
5. EVIDENCE    -- LLM generates evidence annotations
```

Steps 3 and 5 are where LLM calls happen most. Steps 1-2 are lower-cost (planning model). Step 4 is deterministic (no LLM).

### 2.3 Tool Definitions

The agent needs these core tools for coding tasks:

| Tool | Purpose | Notes |
|------|---------|-------|
| `file_read` | Read file contents | Path policy enforcement (R-010) |
| `file_write` | Write/create file | Path policy enforcement, protected file check (R-011) |
| `file_edit` | Edit specific region of file | Search/replace format preferred |
| `search_codebase` | Search code index | Uses R-014 code index |
| `run_command` | Execute shell command | Sandboxed (R-006), command allowlist |
| `list_files` | List directory contents | For exploration |
| `search_text` | Grep/ripgrep search | For finding references |

Each tool must:
- Validate inputs against path policies before execution
- Log the call to the audit trail (R-012)
- Track cost/tokens if it involves an LLM sub-call
- Respect the circuit breaker (R-025)

### 2.4 Context Window Management

**The repo map approach (from Aider):** Build a compressed representation of the codebase using tree-sitter AST parsing. The repo map includes file names, function signatures, class definitions, and a dependency graph. A graph-ranking algorithm (PageRank-style) weights symbols by how often they are referenced. The map dynamically sizes based on available context budget (default: ~1000 tokens).

**Aider achieves 4.3-6.5% context utilization** (ratio of context tokens used to tokens available) while maintaining good architectural awareness. Cursor uses hybrid semantic-lexical indexing at 14.7% utilization.

**Practical context window structure (ordered by priority):**

```
1. System prompt + instructions     (top -- rules never get buried)
2. Repo map (compressed)            (bird's eye view)
3. Task objective + constraints      (what to do)
4. Execution plan                    (how to do it)
5. Relevant file contents           (working context)
6. Tool call history (recent)       (what happened so far)
7. Previous attempt results          (if iterating)
```

Research shows information position matters ("lost-in-the-middle" effect). Place non-negotiable rules and constraints at the start. Place current working context at the end. Bury reference material in the middle.

Moving instruction files from middle to beginning reduced code style violations by 35-40% in one study.

**Sources:** https://aider.chat/docs/repomap.html, https://www.faros.ai/blog/context-engineering-for-developers, https://blog.kilo.ai/p/ai-coding-assistants-for-large-codebases

---

## 3. Code Generation Quality

### 3.1 Edit Formats

Five primary approaches exist in production:

| Format | How It Works | Strengths | Weaknesses |
|--------|-------------|-----------|------------|
| **Search/Replace blocks** | Find-and-replace with delimiters | Balance of precision and resilience; avoids line numbers | Pattern matching can fail on duplicate code |
| **Patch-based** (Codex style) | Structured patches with context matching | Progressive matching (exact -> whitespace-tolerant) | Complex format |
| **Unified diff** | Standard diff with +/- notation | Familiar, reduces lazy generation | Too algorithmically complex for some LLMs |
| **Whole file** | LLM returns entire file | Simple, no matching issues | Slow and costly for large files; risks clobbering |
| **AI-assisted apply** (Cursor) | Separate trained model merges edits | Handles imprecise edits well | Requires a second model |

**Key finding:** Format choice can swing benchmark performance from 26% to 59% (GPT-4 Turbo). The format matters as much as the model.

**Practical recommendations:**
- **Files under 400 lines:** Whole file rewrite outperforms diff-based approaches
- **Files over 400 lines:** Search/replace blocks are most reliable
- **Avoid line numbers** in edit formats -- they cause off-by-one errors
- **Implement layered matching:** Start with exact match, fall back to whitespace-tolerant, then fuzzy
- **Design error messages for diagnosis:** When a match fails, report what was expected vs found

**For the factory:** Use search/replace blocks as the primary format. Implement progressive matching (exact -> whitespace-normalized -> fuzzy). Log match failures to the audit trail. For small new files, use whole-file generation.

**Sources:** https://fabianhertwig.com/blog/coding-assistants-file-edits/, https://aider.chat/docs/more/edit-formats.html, https://www.morphllm.com/edit-formats/diff-format-explained

### 3.2 Providing Good Context

From the context engineering research:

1. **Semantic search over embeddings** to find conceptually related code
2. **AST-based chunking** at function and class boundaries (tree-sitter)
3. **Hybrid search** combining keyword matching with semantic similarity (improves factual correctness ~8% over vector-only)
4. **Reranking** to prioritize most relevant results

**What to include:** Function signatures from related modules, architectural configs, current working files, type definitions, test patterns.

**What to exclude:** Unrelated services, migration histories, verbose docs outside scope, content excluded by path policy (R-010).

**Format optimization:**
- YAML/XML are more token-efficient than JSON
- Markdown with clear headers aids navigation
- Code blocks with language tags enable syntax-aware parsing
- Tables outperform prose for comparative data

### 3.3 Handling Large Files

For files that do not fit in context:
1. Use tree-sitter to extract only the relevant functions/classes
2. Include function signatures of surrounding code for type context
3. Use search/replace blocks targeting specific regions
4. If the entire file is needed, consider splitting the task into sub-tasks

---

## 4. Evidence Generation

### 4.1 Diff Annotation

Use an LLM to annotate the diff with inline explanations. The diff is a compact representation of changes -- typically much smaller than the full repository. Feed the structured diff to the model with a schema for annotations.

**Structured output approach using Zod:**

```typescript
const DiffAnnotation = z.object({
  file: z.string(),
  hunk_index: z.number(),
  annotation: z.string().describe("What this change does and why"),
  risk_level: z.enum(["low", "medium", "high"]),
  affected_consumers: z.array(z.string()).describe("Functions/modules that depend on this")
});
```

Use `response_format` with JSON schema enforcement (supported by OpenRouter) to guarantee structured output. Always validate with Zod at runtime even when the provider guarantees schema compliance.

### 4.2 Blast Radius Analysis

Combine code index data (R-014) with LLM analysis:
1. **Deterministic phase:** Use the dependency graph from the code index to identify all files/functions that import or reference the changed symbols. Count affected files, packages, downstream consumers.
2. **LLM phase:** For each non-trivial change, ask the model to assess whether the change is likely to break any consumer, based on the symbol's type signature and usage patterns.

This produces evidence-derived data (per R-008), not model self-assessed confidence.

### 4.3 Unresolved Assumptions

Prompt the model explicitly: "List any assumptions you made that you were not able to verify through tests or code inspection." This is a structured output field in the evidence packet. The model's output here is genuinely useful -- it flags areas where the human reviewer should focus attention.

**Critical rule from R-008:** No scalar confidence scores. No generic rollback prose. Evidence must be derived from actual analysis, not model self-assessment.

### 4.4 Protected-Surface Edits

When the agent edits a flagged file (R-011), the evidence generation step must:
1. Highlight the edit prominently
2. Explain what changed and why
3. Show the before/after
4. If it's a behavioral control file, explain what behavior would change

This is a structured section in the evidence packet, not a buried detail.

---

## 5. Prompt Engineering Best Practices

### 5.1 System Prompt Structure

Based on analysis of production coding agents (Claude Code, Cursor, Aider):

```
[ROLE]         - What the agent is and its capabilities
[CONSTRAINTS]  - Non-negotiable rules (path policies, protected files, budget)
[CONTEXT]      - Repo map, task objective, plan
[TOOLS]        - Tool definitions with usage instructions
[FORMAT]       - Expected output format (edit format, structured output schema)
[EXAMPLES]     - Few-shot examples of good edits (optional)
```

**Key principle from research:** "System prompts define the agent as much as the model." Complex instructions should be broken down using headings, lists, or tags. Rules should be organized logically, not dumped as prose.

### 5.2 Context Injection

From the PRD (R-023), context sources are trust-classified:

| Trust Class | Source | How to Handle |
|-------------|--------|---------------|
| Factory config | `.factory/**` policy | Highest trust, load as system prompt |
| Base-ref behavioral control | `AGENTS.md`, `CLAUDE.md`, etc. from trusted base ref | Used for planning context, not trusted commands |
| Human-authored task input | Issue text, operator directives | Medium trust, validate before parameterizing tools |
| Untrusted external | PR comments, code comments, external content | HTML/hidden-comment stripping; cannot parameterize destructive tools |

**Implementation:**
- Surround untrusted content with clear delimiters: `<untrusted_content>...</untrusted_content>`
- Reinforce system rules immediately after untrusted blocks
- Never pass untrusted content as tool arguments for destructive operations
- Strip HTML, hidden comments, and zero-width characters from external content

### 5.3 Prompt Injection Defense

Industry consensus (2026): Prompt injection cannot be fully prevented. Defense requires architecture, not just prompts.

**Defense-in-depth layers:**
1. **Trust classification** at input time (R-023)
2. **Delimiters** separating instructions from data ("spotlighting")
3. **Content filtering** scanning untrusted input for known injection patterns
4. **Tool-call validation** -- untrusted content cannot parameterize destructive tools
5. **Output verification** -- validate structured outputs against schemas
6. **Least-privilege tool design** -- tools have minimal permissions
7. **Behavioral control file trust boundary** (R-011) -- only load from trusted base ref

**Anthropic's approach:** Reinforcement learning to build injection robustness directly into the model. Classifiers scan untrusted content entering the context window. Claude Opus 4.5 reduced successful injection attacks to ~1% in browser-based operations.

The PRD's trust boundary (R-011) -- loading behavioral control files only from the trusted base ref, pinned at task creation -- is aligned with industry best practice.

**Sources:** https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html, https://www.anthropic.com/research/prompt-injection-defenses

---

## 6. SDK / Library Selection

### 6.1 Three Options

**Option A: OpenRouter TypeScript SDK (official)**

The official SDK (`openrouter` npm package, auto-generated from OpenAPI specs) provides:
- `callModel()` with automatic multi-turn tool execution
- Zod-based type-safe tool definitions (regular, generator, manual)
- Built-in stop conditions: `stepCountIs(n)`, `maxCost(amount)`, `hasToolCall(name)`, `maxTokensUsed(n)`
- `TurnContext` for custom stop logic with access to all step results, token counts, and costs
- Streaming-first architecture with concurrent consumers
- Message format conversion (OpenAI <-> Anthropic <-> OpenResponses)
- `nextTurnParams` for dynamic context injection per turn
- Generation stats retrieval via `/api/v1/generation`

**Pros:** Direct integration with all OpenRouter features (provider routing, caching, ZDR, model-specific params). Built-in cost tracking and budget enforcement via `maxCost`. Auto-generated from OpenAPI spec -- always up to date.
**Cons:** Coupled to OpenRouter. No OTel telemetry built in. Newer, smaller community.

**Option B: Vercel AI SDK (`ai` package) + OpenRouter provider (`@openrouter/ai-sdk-provider`)**

The Vercel AI SDK provides:
- `generateText()`, `streamText()`, `generateObject()` with unified API
- `ToolLoopAgent` class for production agent loops
- Built-in OpenTelemetry telemetry (`experimental_telemetry`)
- Tool calling with Zod schemas
- Structured output with JSON Schema / Zod / Valibot
- Loop control: `stepCountIs(20)`, `hasToolCall()`, custom stop conditions
- `prepareStep` callback for dynamic model switching, context trimming, tool availability per phase
- Provider-agnostic: 25+ providers supported
- 2.8M weekly npm downloads (most popular TS AI framework)

**Pros:** Best OTel integration (span attributes for `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, model, latency). Provider-agnostic (future-proofs against OpenRouter lock-in). Largest community. `prepareStep` enables sophisticated context management.
**Cons:** OpenRouter-specific features (provider routing, ZDR, caching control) may not be fully exposed through the community provider. Additional dependency.

**Option C: Direct OpenAI-compatible API calls**

Use `fetch()` or a minimal HTTP client to call `https://openrouter.ai/api/v1/chat/completions` directly.

**Pros:** Zero abstraction, full control, no dependency risk.
**Cons:** Must build tool loop, streaming handling, error recovery, retry logic, telemetry, type safety manually. Significant boilerplate.

### 6.2 Recommendation

**Use the Vercel AI SDK (`ai`) as the primary abstraction layer, with the OpenRouter provider for model access.**

Rationale:
1. **OTel telemetry is built in** -- critical for R-012 (audit trail) and R-013 (cost tracking). Spans automatically capture `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, model, latency, tool calls.
2. **Provider-agnostic** -- supports the PRD requirement that architecture "must not preclude self-hosted inference" (R-017). Switching from OpenRouter to a local OpenAI-compatible endpoint is a provider change, not an architecture change.
3. **`prepareStep` callback** -- enables dynamic context trimming and model switching per step, which is essential for context window management and cost optimization.
4. **Loop control** -- built-in `stepCountIs()` maps to R-024 max iteration limit. Custom stop conditions can implement no-progress detection and budget enforcement.
5. **Structured output** -- `generateObject()` with Zod schemas maps directly to evidence packet generation (R-008).
6. **Largest community and ecosystem** -- more stable, better maintained, more examples.

**Supplement with direct OpenRouter API calls** for:
- Generation stats retrieval (`/api/v1/generation?id=`) for detailed cost/latency metadata
- Provider routing configuration (disable fallbacks, specify providers)
- Prompt caching configuration

**Do NOT use LangChain.js.** LangChain adds significant abstraction overhead, has edge-runtime incompatibility issues, requires more boilerplate, and its chain/agent abstractions do not align with the factory's explicit, inspectable workflow. The factory needs thin orchestration (PRD Principle 7: "factory logic in code, not prompts"), not framework magic.

### 6.3 Token Counting

For offline token estimation (before sending to API):
- Use `js-tiktoken` (pure JS, no WASM) for OpenAI model tokenizers
- For Anthropic models, approximate with `p50k_base` encoding (official Anthropic counts should be preferred for billing)
- For accurate counts, use the API response's `usage` field or the generation stats endpoint

For the factory's cost tracking (R-013), always use the actual token counts from the API response, not client-side estimates. Client-side estimates are useful only for pre-flight context window fitting.

---

## 7. Cost Optimization

### 7.1 Model Routing by Task Complexity

Use a tiered approach (R-017):

| Task Type | Recommended Model Tier | Estimated Cost |
|-----------|----------------------|----------------|
| Planning, complex reasoning | Frontier (Opus 4.6, Gemini 3.1 Pro) | $$$ |
| Code generation, editing | Mid-tier (Sonnet 4.6, GPT-5.2) | $$ |
| Simple tasks (summaries, commit messages) | Budget (Flash, Mini) | $ |
| Evidence annotation | Mid-tier with structured output | $$ |

Research from LMSYS shows a well-trained router achieves 95% of frontier quality using the frontier model for only 26% of requests. Realistic savings: 60-80% cost reduction.

**Implementation for the factory:** Classify task phases by complexity. The UNDERSTAND and PLAN phases use the frontier model. The IMPLEMENT phase uses mid-tier for code generation. Simple sub-tasks (formatting, commit messages) use budget models. EVIDENCE uses mid-tier with structured output.

### 7.2 Prompt Caching

- Anthropic models cache system prompts and long prefixes (5-minute TTL)
- OpenRouter provides sticky routing to maximize cache hits
- Structure prompts to maximize the cacheable prefix: put stable content (system prompt, repo map, tool definitions) first, variable content (current task, file contents) last
- Monitor `cache_discount` in generation stats to verify caching is working

### 7.3 Context Pruning

- Use repo map (compressed, ~1000 tokens) instead of dumping entire files
- `prepareStep` callback in Vercel AI SDK to trim message history (keep system prompt + last N messages)
- Compress verbose tool results between iterations
- Use tree-sitter to extract only relevant functions/classes from large files
- Remove redundant context between iterations

### 7.4 Structured Output vs Free-Form

Use structured output (`response_format` with JSON schema) when:
- Generating evidence packets (R-008)
- Generating execution plans
- Classifying task complexity for model routing
- Producing blast radius analysis

Use free-form generation when:
- Writing code (code is inherently unstructured text within a file)
- Writing commit messages
- Explaining changes in human-readable form

### 7.5 Agentic Plan Caching

A 2026 development: cache and reuse structured plan templates across semantically similar tasks. The plan stage incurs the majority of LLM compute cost and often produces reusable outputs. Evaluation shows 50.31% cost reduction and 27.28% latency reduction on average. Consider this for Phase 2+ optimization.

**Source:** https://arxiv.org/abs/2506.14852

---

## 8. Observability & Logging

### 8.1 Architecture

The PRD requires every LLM call logged with model ID, tokens, latency, cost (R-017), and every action produces an audit entry (R-012). The recommended stack:

```
Vercel AI SDK (telemetry: enabled)
    |
    | OpenTelemetry spans
    |
OpenTelemetry SDK (NodeTracerProvider)
    |
    | Export spans to:
    |
    +-- Postgres (audit entries, R-012)
    +-- OTEL Collector -> Jaeger/Grafana (operational observability)
    +-- Langfuse (optional, LLM-specific analysis)
```

### 8.2 What to Capture Per LLM Call

From the Vercel AI SDK telemetry, each span automatically captures:

| Attribute | Source |
|-----------|--------|
| `gen_ai.system` | Provider identifier |
| `gen_ai.request.model` | Requested model |
| `gen_ai.response.model` | Actual model used |
| `gen_ai.usage.input_tokens` | Prompt tokens |
| `gen_ai.usage.output_tokens` | Completion tokens |
| `ai.model.id` | Model identifier |
| `ai.response.finishReason` | Why generation stopped |
| Tool call name, args, result | Per tool invocation |

Supplement with data from the OpenRouter generation stats endpoint:
- `total_cost` (USD)
- `latency`, `generation_time` (ms)
- `provider_name`
- `native_tokens_reasoning`, `native_tokens_cached`
- `cache_discount`

### 8.3 Audit Entry Structure (R-012)

Each LLM call should produce an audit entry:

```typescript
interface LLMCallAuditEntry {
  timestamp: string;           // ISO 8601
  task_id: string;
  workflow_phase: string;      // understand, plan, implement, evidence
  model_requested: string;
  model_used: string;
  provider: string;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens?: number;
  cached_tokens?: number;
  cost_usd: number;
  latency_ms: number;
  finish_reason: string;
  content_hash: string;        // SHA-256 of prompt + response
  // Full content stored separately with shorter retention (R-012)
}
```

### 8.4 Langfuse Integration (Optional)

Langfuse is an open-source LLM engineering platform that integrates with Vercel AI SDK via OpenTelemetry. It provides:
- Structured traces per request (LLM calls, tool executions, custom logic)
- Token usage tracking with cost aggregation
- Trace attributes (user_id, session_id, tags, metadata)
- Self-hostable (aligns with factory's self-hosted requirement)

Langfuse is a good fit for Phase 2 (R-019 dashboard) -- it provides the analytical layer on top of raw audit data. For Phase 1, the factory's own Postgres audit log + OTel export to a basic collector is sufficient.

**Source:** https://langfuse.com/docs/observability/overview

---

## 9. Self-Healing / Loop Detection

### 9.1 PRD Requirements (R-024)

- Max iteration limit: 10
- No-progress detector: 3 loops without state change
- Time budget: 30 min per repair attempt
- Cost budget: per-task ($10 default) and global ($100/day)
- Loop-of-doom detector: 4+ identical failing calls
- On trip: pause, notify human

### 9.2 Implementation Approach

**Iteration counting:** Use Vercel AI SDK's `stepCountIs(10)` or OpenRouter SDK's `stepCountIs(10)` as a hard stop. This is the simplest guardrail.

**No-progress detection:** After each iteration, compute a fingerprint of the agent's state:
- Files modified (set of paths + content hashes)
- Test results (pass/fail counts)
- Lint/typecheck error counts
- Last N tool calls and their results

If the fingerprint is identical for 3 consecutive iterations, the agent is stuck. Trip the guardrail.

**Loop-of-doom detection:** Track the last N tool calls. If the same tool is called with the same arguments 4+ times and fails each time, trip the guardrail. Implementation: hash(tool_name + JSON.stringify(args) + error_message). If the same hash appears 4 times, stop.

**Time budget:** Set a wall-clock timer at the start of each repair attempt. If 30 minutes elapse, pause regardless of agent state.

**Cost budget enforcement:**
- Use `maxCost()` stop condition in the SDK for per-execution budget
- After each LLM call, query generation stats and accumulate cost
- At 80% of per-task budget ($8 default): notify
- At 100% ($10 default): pause mid-execution
- Track global daily spend in Redis (atomic increment per call)
- At 80% of daily budget ($80): notify
- At 100% ($100): pause all tasks

### 9.3 Graceful Degradation

When the agent is stuck or budget is exceeded:
1. Save current state (files modified, test results, error messages)
2. Produce a partial evidence bundle showing what was attempted
3. Pause and notify human with the partial evidence
4. Human can: provide hints, increase budget, redirect, or reject

The "Ralph Wiggum Loop" technique (2026): When an agent fails, start a fresh agent with fresh context that includes documentation of what the previous agent tried and why it failed. This "naive persistence" approach allows the new agent to learn from failures. Consider for Phase 2.

### 9.4 Circuit Breaker (R-025)

Per-tool and per-agent circuit breakers. Global kill switch via Redis key checked at every tool invocation.

Implementation:
```
Before each tool call:
  1. Check Redis key `factory:kill_switch` -- if set, abort immediately
  2. Check Redis key `factory:circuit:{tool_name}` -- if tripped, skip tool
  3. Check Redis key `factory:circuit:{agent_id}` -- if tripped, abort agent
```

Circuit breaker state transitions: closed -> open (on N consecutive failures) -> half-open (after cooldown) -> closed (on success) or open (on failure).

---

## 10. Summary of Key Decisions and Recommendations

### SDK Choice
Use **Vercel AI SDK** (`ai` + `@openrouter/ai-sdk-provider`) as the primary LLM abstraction. Supplement with direct OpenRouter API calls for generation stats and provider routing configuration.

### Agent Pattern
**Hybrid plan-and-execute + ReAct.** Plan-and-execute for the outer workflow (understand -> plan -> implement -> validate -> evidence). ReAct tool loop for the implementation phase.

### Edit Format
**Search/replace blocks** as primary format. Progressive matching (exact -> whitespace-tolerant -> fuzzy). Whole-file generation for small new files.

### Context Management
**Tree-sitter repo map** (Aider-style) for compressed codebase awareness. Dynamic context trimming via `prepareStep`. Strict ordering: rules at top, reference in middle, working context at end.

### Cost Tracking
Query OpenRouter generation stats endpoint after each call. Accumulate in Postgres per task. Enforce budgets via SDK stop conditions + Redis counters.

### Observability
Vercel AI SDK OTel telemetry -> OpenTelemetry SDK -> Postgres audit log + OTEL collector. Every LLM call captured with model, tokens, cost, latency.

### Prompt Injection Defense
Trust classification (R-023) + delimiters + content filtering + tool-call validation + behavioral control file trust boundary (R-011). Defense in depth, not a single layer.

### Self-Healing
SDK-native iteration limits + custom no-progress fingerprinting + loop-of-doom hash detection + wall-clock timer + Redis-backed cost counters + global kill switch.

---

## 11. Open Questions for Planning

1. **Repo map implementation:** Build custom tree-sitter indexer or adapt Aider's open-source implementation? Aider's repo map code is Apache 2.0 licensed and well-tested.
2. **Token counting precision:** How accurate does pre-flight token counting need to be for context window fitting? Is `js-tiktoken` sufficient or do we need model-specific tokenizers?
3. **Prompt caching reliability:** OpenRouter's Anthropic prompt caching has reported issues. Should we implement our own caching layer or rely on provider caching?
4. **Edit format per model:** Should the factory select edit format based on which model is in use (as Aider does), or standardize on one format?
5. **Evidence annotation model:** Same model that did the implementation, or a separate model with fresh context? Using the same model risks self-serving explanations; using a different model adds cost.
6. **Plan caching:** Is agentic plan caching worth implementing in Phase 1, or defer to Phase 2?

---

## 12. Files Referenced

- `/Users/seanflanagan/proj/software-factory/docs/prd.md` -- PRD v5.1, Sections 5.2-5.4, 6.1, 8 (R-001 through R-033), 10 (Security)
- `/Users/seanflanagan/proj/software-factory/.claude/rules/immutable.md` -- Immutable rules
- `/Users/seanflanagan/proj/software-factory/.claude/rules/conventions.md` -- Code conventions
- `/Users/seanflanagan/proj/software-factory/.claude/rules/stack.md` -- Stack decisions (TBD)
- `/Users/seanflanagan/proj/software-factory/.claude/plans/research.md` -- Prior research (Temporal event history)

## 13. External Sources Consulted

**OpenRouter Documentation:**
- https://openrouter.ai/docs/api/reference/overview (API reference)
- https://openrouter.ai/docs/api/reference/streaming (streaming)
- https://openrouter.ai/docs/api/reference/errors-and-debugging (error handling)
- https://openrouter.ai/docs/api/reference/limits (rate limits)
- https://openrouter.ai/docs/api/api-reference/generations/get-generation (generation stats)
- https://openrouter.ai/docs/guides/routing/provider-selection (provider routing)
- https://openrouter.ai/docs/guides/best-practices/prompt-caching (prompt caching)
- https://openrouter.ai/docs/sdks/typescript (TypeScript SDK)
- https://openrouter.ai/docs/sdks/typescript/call-model/overview (callModel)
- https://openrouter.ai/docs/sdks/typescript/call-model/tools (tool definitions)
- https://openrouter.ai/docs/sdks/typescript/call-model/stop-conditions (stop conditions)

**Vercel AI SDK:**
- https://ai-sdk.dev/docs/introduction (overview)
- https://ai-sdk.dev/docs/agents/loop-control (agent loop control)
- https://ai-sdk.dev/docs/ai-sdk-core/telemetry (OTel telemetry)
- https://ai-sdk.dev/providers/community-providers/openrouter (OpenRouter provider)

**Agent Architecture:**
- https://redis.io/blog/ai-agent-architecture/ (2026 agent architecture)
- https://www.promptingguide.ai/techniques/react (ReAct pattern)
- https://www.wollenlabs.com/blog-posts/navigating-modern-llm-agent-architectures-multi-agents-plan-and-execute-rewoo-tree-of-thoughts-and-react (architecture comparison)

**Code Generation:**
- https://fabianhertwig.com/blog/coding-assistants-file-edits/ (edit format comparison)
- https://aider.chat/docs/more/edit-formats.html (Aider edit formats)
- https://www.morphllm.com/edit-formats/diff-format-explained (diff format analysis)
- https://aider.chat/docs/repomap.html (repo map technique)
- https://blog.kilo.ai/p/ai-coding-assistants-for-large-codebases (large codebase patterns)

**Model Benchmarks:**
- https://onyx.app/insights/best-llms-for-coding-2026 (2026 coding model rankings)
- https://llm-stats.com/leaderboards/best-ai-for-coding (coding benchmarks)

**Security:**
- https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html (OWASP agent security)
- https://www.anthropic.com/research/prompt-injection-defenses (Anthropic injection defenses)

**Observability:**
- https://langfuse.com/docs/observability/overview (Langfuse)
- https://opentelemetry.io/blog/2024/llm-observability/ (OTel LLM observability)
- https://langfuse.com/integrations/frameworks/vercel-ai-sdk (Vercel AI SDK + Langfuse)

**Cost Optimization:**
- https://redis.io/blog/llm-token-optimization-speed-up-apps/ (token optimization)
- https://arxiv.org/abs/2506.14852 (agentic plan caching)
- https://www.burnwise.io/blog/llm-model-routing-guide (model routing)

**Context Engineering:**
- https://www.faros.ai/blog/context-engineering-for-developers (context engineering guide)
- https://www.dbreunig.com/2026/02/10/system-prompts-define-the-agent-as-much-as-the-model.html (system prompts)

**Loop Detection & Guardrails:**
- https://markaicode.com/fix-ai-agent-looping-autonomous-coding/ (loop fixing)
- https://dev.to/aws/ai-agent-guardrails-rules-that-llms-cannot-bypass-596d (guardrails)
- https://authoritypartners.com/insights/ai-agent-guardrails-production-guide-for-2026/ (production guardrails)

**SDK Comparisons:**
- https://strapi.io/blog/langchain-vs-vercel-ai-sdk-vs-openai-sdk-comparison-guide (LangChain vs AI SDK vs OpenAI)
