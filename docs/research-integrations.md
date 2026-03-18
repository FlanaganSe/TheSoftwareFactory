# Research: Integrations — GitHub, LLM, Code Indexing, CLI, Dashboard, Notifications

**Date:** 2026-03-18
**Consolidated from:** `research-github.md`, `research-llm-integration.md`, `research-code-index.md`, `research-deployment-ux.md`, `research-full-extraction.md`, `research.md`
**PRD Version:** 5.1

---

## 1. GitHub App Integration

### 1.1 App Registration

**Two paths to create a GitHub App:**

**Manual registration (recommended for production):**
- GitHub Settings > Developer settings > GitHub Apps > New GitHub App
- Configure name, homepage URL, webhook URL, permissions, and events
- Download the generated private key (PEM file)

**Manifest flow (recommended for onboarding/self-hosted setup):**
- Three-step handshake similar to OAuth:
  1. POST a JSON manifest to `https://github.com/settings/apps/new` (personal) or `https://github.com/organizations/{org}/settings/apps/new` (org)
  2. GitHub redirects back with a temporary `code`
  3. Exchange code via `POST /app-manifests/{code}/conversions` to receive: `id`, `pem` (private key), `webhook_secret`, `client_id`, `client_secret`
- **All three steps must complete within 1 hour**
- Manifest JSON parameters: `name`, `url`, `hook_attributes` (webhook URL + active), `redirect_url`, `callback_urls` (up to 10), `setup_url`, `description`, `public` (boolean), `default_events` (array), `default_permissions` (object)

**Recommendation for the factory:** Provide a manifest-flow onboarding command (`factory setup github-app`) that walks the operator through the manifest flow, automatically configures permissions and events, and stores the returned credentials (encrypted in Postgres per R-005/R-019). Manual registration documented as fallback.

### 1.2 Required Permissions

Each permission can be scoped down per-token at installation token creation time.

**Repository permissions:**

| Permission | Level | Why |
|-----------|-------|-----|
| `contents` | `write` | Read repo content, create branches, push commits, read CODEOWNERS file |
| `pull_requests` | `write` | Create PRs (draft/ready), update PR state, request reviews |
| `checks` | `write` | Create/update check runs (factory validation status) |
| `statuses` | `write` | Create commit statuses (alternative to check runs for some flows) |
| `issues` | `read` | Read issue content for task intake |
| `metadata` | `read` | Implicit/required -- basic repo metadata |
| `administration` | `read` | Read branch protection rules, rulesets (needed for capability scan) |
| `merge_queues` | `read` | Receive `merge_group` webhook events, read merge queue state |

**Organization permissions (if org-installed):**

| Permission | Level | Why |
|-----------|-------|-----|
| `administration` | `read` | Read org-level rulesets (with `includes_parents=true`) |
| `members` | `read` | Resolve team ownership for CODEOWNERS |

**Note:** The `merge_queues` permission with `read` access is required to subscribe to `merge_group` webhook events. The factory does NOT need `write` access to merge queues -- enqueuing is done via the GraphQL `enqueuePullRequest` mutation using `contents:write` + `pull_requests:write`.

### 1.3 Authentication

#### JWT Creation (App Authentication)

To authenticate as the GitHub App itself (needed to list installations, create installation tokens):

**Algorithm:** RS256 (RSA + SHA-256)

**Required JWT claims:**
- `iss` -- The GitHub App's **client ID** (preferred) or numeric App ID
- `iat` -- Issued-at time. **Set 60 seconds in the past** to accommodate clock drift
- `exp` -- Expiration time. Maximum **10 minutes** from current time

**Usage:** `Authorization: Bearer <JWT>` header on API requests

**Limitations:**
- JWT lifetime is max 10 minutes -- must regenerate for extended sessions
- JWT is only for app-level endpoints (listing installations, creating tokens)
- Not for repo-level API calls (those use installation tokens)

**TypeScript implementation pattern:**
```typescript
import { createAppAuth } from "@octokit/auth-app";

const auth = createAppAuth({
  appId: APP_ID,
  privateKey: PEM_CONTENT,
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
});

// JWT is generated automatically when needed
const { token } = await auth({ type: "app" });
```

#### Installation Token Minting

**Endpoint:** `POST /app/installations/{installation_id}/access_tokens`

**Authentication:** JWT (Bearer token) from the app itself

**Request body (all optional):**
- `repositories` -- Array of repository name strings (max 500)
- `repository_ids` -- Array of repository ID integers (alternative to names)
- `permissions` -- Object mapping permission names to access levels, e.g. `{"contents": "read", "checks": "write"}`

**Key behaviors:**
- Tokens expire after exactly **1 hour** (not configurable)
- Cannot grant permissions the app was not granted at installation
- If `permissions` not specified, token gets all app permissions
- If `repositories`/`repository_ids` not specified, token gets access to all installation repositories

#### Per-Phase Permission Scoping

| Task Phase | Permissions Needed |
|-----------|-------------------|
| Capability scan | `contents:read`, `administration:read`, `checks:read` |
| Implementation (push to candidate branch) | `contents:write`, `checks:write` |
| PR creation | `contents:write`, `pull_requests:write` |
| PR tracking | `pull_requests:read`, `checks:read`, `statuses:read` |
| Merge queue enqueue | `contents:write`, `pull_requests:write` (via GraphQL) |

#### CredentialBroker Architecture

```
CredentialBroker
  |
  +-- AppAuth (JWT, 10-min lifetime)
  |     Used for: listing installations, creating installation tokens
  |
  +-- InstallationTokenCache (Map<installationId+scope, {token, expiresAt}>)
  |     Uses @octokit/auth-app internal caching (toad-cache, 15K entries)
  |     Factory adds: 50-minute rotation timer per active token
  |
  +-- TokenFactory(taskPhase) -> scoped installation token
        Maps task phase to minimal permission set
        Logs token creation in audit trail
```

Broker rotates at ~50 minutes (PRD R-005). `@octokit/auth-app` caches tokens internally using toad-cache (15K entry capacity). Installation tokens auto-refresh on expiry (~1 hour).

### 1.4 Webhook Configuration

**GitHub App webhook:** Each GitHub App has a single webhook endpoint. Events to subscribe to are configured in the app settings (or via manifest `default_events`).

**Events the factory needs:**

| Event | Actions Used | Why |
|-------|-------------|-----|
| `pull_request` | `opened`, `synchronize`, `closed`, `review_requested`, `review_request_removed`, `enqueued`, `dequeued`, `ready_for_review`, `converted_to_draft` | PR lifecycle tracking |
| `pull_request_review` | `submitted`, `dismissed` | Review decisions, stale review detection, feedback triggers |
| `pull_request_review_comment` | `created` | Thread tracking (secondary -- batch via submitted review) |
| `check_suite` | `completed` | External CI status tracking |
| `check_run` | `completed`, `created`, `rerequested` | Individual check tracking, rerun requests |
| `merge_group` | `checks_requested`, `destroyed` | Merge queue lifecycle |
| `push` | (no actions) | Detect human pushes to agent branches, branch updates |
| `installation` | `created`, `deleted`, `suspend`, `unsuspend`, `new_permissions_accepted` | App lifecycle (auto-subscribed) |

**`merge_group` gotcha:** Available on **app webhooks only** (not repo or org webhooks). Requires `merge_queues:read` permission.

**`pull_request_review` vs `pull_request_review_comment`:** The PRD (Section 6.1, step 11a) specifies waiting for **submitted reviews**, not individual comments. The `pull_request_review.submitted` event fires when a reviewer submits a full review (approve/request-changes/comment). Individual `pull_request_review_comment.created` events fire per inline comment. The factory should use `submitted` as the trigger for feedback iteration.

#### Signature Verification (HMAC-SHA256)

**Header:** `X-Hub-Signature-256`

**Format:** `sha256=<hex_digest>`

**Algorithm:** HMAC-SHA256 using the webhook secret as key and raw request body as message.

**Critical security requirements:**
- **Always verify** before processing any webhook payload
- Use **timing-safe comparison** (`crypto.timingSafeEqual` in Node.js) -- never use `==` or `===`
- Handle UTF-8 encoded payloads correctly
- Ensure proxies/load balancers do not modify the payload before verification

**TypeScript implementation with Octokit:**
```typescript
import { Webhooks } from "@octokit/webhooks";

const webhooks = new Webhooks({
  secret: process.env.WEBHOOK_SECRET,
});

// Verification is built into the middleware
const handleWebhook = async (req, res) => {
  const signature = req.headers["x-hub-signature-256"];
  const body = await req.text();
  if (!(await webhooks.verify(body, signature))) {
    res.status(401).send("Unauthorized");
    return;
  }
};
```

#### Idempotency

GitHub does not guarantee exactly-once delivery. The factory must handle duplicate events idempotently using the `X-GitHub-Delivery` header as an idempotency key.

### 1.5 Event-to-State Mapping

All 16 webhook-to-factory-state transitions:

| Webhook Event | Factory State Update |
|--------------|---------------------|
| `pull_request.opened` | Task -> `pr_created` |
| `pull_request.synchronize` | New commits pushed; may invalidate reviews |
| `pull_request.closed` (merged=true) | Task -> `merged` |
| `pull_request.closed` (merged=false) | Task -> `failed` (or manual close) |
| `pull_request.enqueued` | Task -> merge queue entered |
| `pull_request.dequeued` | Task -> merge queue exited (check reason) |
| `pull_request.ready_for_review` | PR transitioned from draft to ready |
| `pull_request.converted_to_draft` | PR converted back to draft |
| `pull_request_review.submitted` (changes_requested) | Task -> `addressing_review_feedback` trigger |
| `pull_request_review.submitted` (approved) | Update ReviewState approval count |
| `pull_request_review.dismissed` | Update ReviewState, may need re-request |
| `check_run.completed` | Update external check status tracking |
| `check_suite.completed` | Update aggregate check suite status |
| `merge_group.checks_requested` | Factory must run checks on merge group HEAD |
| `merge_group.destroyed` | Merge group resolved (success or failure) |
| `push` (to agent branch by non-factory actor) | Pause task, notify operator (per PRD 6.4) |
| `installation.deleted` / `installation.suspend` | Disable factory for affected repos |

### 1.6 Repo Capability Scan

#### 10-Step Scan Sequence

```
1. Authenticate as installation
2. GET /repos/{owner}/{repo}                          -> repo metadata (default branch, visibility)
3. GET /repos/{owner}/{repo}/rulesets?includes_parents=true -> all rulesets (repo + org + enterprise)
4. GET /repos/{owner}/{repo}/rules/branches/{default} -> effective rules for default branch
5. GET /repos/{owner}/{repo}/branches/{default}/protection -> legacy branch protection
6. GET /repos/{owner}/{repo}/contents/.github/CODEOWNERS    -> CODEOWNERS (try 3 locations)
7. GET /repos/{owner}/{repo}/environments               -> deployment environments (OIDC detection)
8. Parse rulesets for: push rules, signed commits, commit message patterns, bypass actors
9. Determine repo support class (A/B/C)
10. Generate capability report with warnings and blockers
```

#### Legacy Branch Protection API

**Endpoint:** `GET /repos/{owner}/{repo}/branches/{branch}/protection`

**Permission:** `administration:read`

**Returns:**
- `required_status_checks` -- `strict` (require up-to-date), `contexts` (deprecated), `checks` (array of `{context, app_id}`)
- `required_pull_request_reviews` -- `dismiss_stale_reviews`, `require_code_owner_reviews`, `required_approving_review_count` (0-6), dismissal restrictions
- `enforce_admins` -- whether admins are also bound
- `restrictions` -- push restrictions (users, teams, apps)
- `required_signatures` -- whether signed commits required

**Important:** This is the **legacy** branch protection API. GitHub is migrating to **rulesets**. Both should be queried during capability scan since repos may use either or both.

#### Repository Rulesets

**Endpoints:**
- `GET /repos/{owner}/{repo}/rulesets` -- list all repo rulesets
- `GET /repos/{owner}/{repo}/rulesets?includes_parents=true` -- **include org/enterprise inherited rulesets**
- `GET /repos/{owner}/{repo}/rulesets/{ruleset_id}` -- get specific ruleset
- `GET /repos/{owner}/{repo}/rules/branches/{branch}` -- get **all active rules** for a specific branch (merged view)

**18 ruleset rule types the factory must detect and handle:**

| Rule Type | Factory Impact |
|-----------|---------------|
| `required_status_checks` | Factory must submit its check run before it can be required. Bootstrap flow needed. |
| `pull_request` | Mandates PR workflow, required reviewers, dismiss stale reviews |
| `required_signatures` | Commits must have verified signatures. See signed commit handling. |
| `file_path_restriction` | Prevents commits touching restricted paths. Factory must check before pushing. |
| `file_extension_restriction` | Blocks commits with restricted file extensions. |
| `max_file_size` | Enforces max individual file size (excluding LFS). |
| `max_file_path_length` | Limits file path length. |
| `commit_message_pattern` | Validates commit messages against regex. Agent commits must comply. |
| `commit_author_email_pattern` | Validates author email. Factory's app email must match. |
| `committer_email_pattern` | Validates committer email. |
| `branch_name_pattern` | Controls branch naming. Factory candidate branches must match. |
| `creation` / `deletion` / `update` | Ref lifecycle controls. |
| `required_linear_history` | No merge commits. |
| `non_fast_forward` | Block force pushes. |
| `merge_queue` | Routes merges through queue. |
| `required_deployments` | Requires deployment environment success. |
| `code_scanning` | Requires code scanning results. |
| `workflows` | Requires specific workflow execution. |

#### Bypass Actor Configuration

- `bypass_actors` property on rulesets defines who can bypass rules
- Actor types: `Integration` (GitHub App), `OrganizationAdmin`, `RepositoryRole`, `Team`, `DeployKey`
- Bypass modes: `always`, `pull_request` (bypass on PRs only)
- The factory's GitHub App can be configured as a bypass actor (actor type: `Integration`)
- **Only returned to users with write access** to prevent information disclosure

#### Organization Rulesets

**Endpoints:**
- `GET /orgs/{org}/rulesets` -- list all org rulesets
- `GET /orgs/{org}/rulesets/{ruleset_id}` -- get specific org ruleset
- `GET /orgs/{org}/rulesets/{ruleset_id}/history` -- ruleset change history

**Permission:** `organization_administration:read`

**Key differences from repo rulesets:**
- Scope covers all (or selected) repositories in the organization
- Can target by repository name, ID, or properties
- `evaluate` enforcement mode (Enterprise only) lets admins test before enforcing

**Factory scan pattern:**
1. Query `GET /repos/{owner}/{repo}/rulesets?includes_parents=true` to get the merged view
2. If org-installed, also query `GET /orgs/{org}/rulesets` for full org ruleset details
3. Use `GET /repos/{owner}/{repo}/rules/branches/{branch}` for the effective rules on the target branch

#### CODEOWNERS Parsing

**No dedicated API endpoint.** Must be parsed from file content.

**File location search order:**
1. `.github/CODEOWNERS`
2. `CODEOWNERS` (repo root)
3. `docs/CODEOWNERS`

First found is used. Each branch can have its own CODEOWNERS file (PR uses the base branch version).

**File format:**
- Pattern syntax follows gitignore rules with exceptions: `#` escape with `\` does not work, negation `!` does not work, character ranges `[ ]` do not work
- Patterns are **case-sensitive**
- Each line: `<pattern> <@owner1> <@owner2> ...`
- All owners for a pattern must be on the **same line** (last-pattern-wins for overlapping patterns)
- Owners can be `@username`, `@org/team-name`, or email addresses
- File size limit: **3 MB** (files over this are silently ignored)
- Invalid syntax lines are skipped (errors available via API)

**Automatic review requests:**
- Code owners are automatically requested when a PR modifies their paths
- Draft PRs do **not** trigger automatic review requests (requests fire when marked ready)
- Teams must have explicit **write access** to the repository
- When branch protection requires code owner reviews, approval from **any** matching owner is sufficient (not all)

**Factory scan implementation:**
1. Fetch CODEOWNERS via `GET /repos/{owner}/{repo}/contents/.github/CODEOWNERS` (fall back to root and docs/)
2. Parse using gitignore pattern matching (use a library like `codeowners-utils` or `@snyk/github-codeowners`)
3. For each PR diff, compute which owners are implicated -- store in evidence packet as "Owners impacted"

#### Merge Queue Detection

1. Check if `merge_queue` rule type exists in rulesets for the target branch
2. Configuration options (via UI/rulesets): batch size (1-100 min/max), timeout, merge method (merge/rebase/squash), build concurrency (1-100)
3. Merge queue creates temporary branches named `{base_branch}/pr-{number}` (or `gh-readonly-queue/{base_branch}/...` for non-Actions CI)

**CI integration requirement:** When merge queue is active, CI must be configured to trigger on `merge_group` events. For GitHub Actions, add `merge_group` to workflow triggers. For third-party CI, trigger on branches matching `gh-readonly-queue/{base_branch}/*`.

#### Required Status Checks Bootstrap

**Problem:** A check cannot be selected as "required" in branch protection until it has been **submitted at least once** on the repository.

**Bootstrap flow:**
1. Factory creates a check run on any commit: `POST /repos/{owner}/{repo}/check-runs` with `name: "software-factory"`, `head_sha: <any_commit>`, `status: "completed"`, `conclusion: "success"`
2. Once created, the check name appears in the branch protection required checks selector
3. Operator can then configure it as required
4. The factory's scan guides the user through this process

**Required-check binding:** In rulesets, `required_status_checks` can specify `app_id` to bind a check to a specific GitHub App. Setting `app_id: -1` allows any app to provide the check.

#### Signed Commit Handling

**Detection:** Check for `required_signatures` in branch protection or rulesets.

**GitHub App commit signing behavior:**
- Commits made via the API by a GitHub App are automatically signed **only if** the request contains no custom author, committer, or signature information
- The commit is signed by GitHub using the app's identity
- This means the factory can create verified commits by using the Git Database API without custom committer overrides

**Bypass actors:** The factory's GitHub App can be configured as a bypass actor for the `required_signatures` rule in rulesets. Per PRD: repos requiring signed commits **without** a validated bypass path are marked unsupported in V1.

#### OIDC Detection (Detection Only)

Query deployment environments via `GET /repos/{owner}/{repo}/environments` to detect environment protection rules. If environments use OIDC claims tied to specific workflow refs, the factory surfaces a warning during scan (factory-initiated runs will not carry the expected claims). Detection-only for V1 per PRD Section 4.4 and 6.3.

### 1.7 PR Lifecycle

#### Creating Pull Requests

**Endpoint:** `POST /repos/{owner}/{repo}/pulls`

**Parameters:**
- `title` (string) -- PR title
- `body` (string) -- PR description (Markdown)
- `head` (string, required) -- Source branch (candidate branch)
- `base` (string, required) -- Target branch
- `draft` (boolean) -- Create as draft PR. **Default: false.**
- `maintainer_can_modify` (boolean) -- Allow maintainers to push to the PR branch
- `issue` (integer) -- Convert existing issue to PR

**Permission:** `pull_requests:write`

**PRD alignment:** The factory creates PRs after human evidence approval (step 10). Draft vs. ready is configurable per-repo. Default is ready-for-review (to avoid triggering unnecessary CI on repos where drafts trigger workflows).

#### Updating PR State

**Endpoint:** `PATCH /repos/{owner}/{repo}/pulls/{pull_number}`

**Updatable parameters:**
- `title`, `body` -- Update content
- `state` -- `open` or `closed`
- `base` -- Change target branch
- `draft` -- `true` to convert to draft, `false` to mark ready for review
- `maintainer_can_modify` -- Toggle maintainer access

#### Requesting Reviews

**Endpoint:** `POST /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers`

**Body:** `{ "reviewers": ["username1"], "team_reviewers": ["team-slug1"] }`

**Note:** CODEOWNERS automatically requests reviewers when the PR is created/marked ready. The factory should track which reviewers were auto-requested vs. manually requested.

#### Check Runs (Factory Validation Status)

**Create:** `POST /repos/{owner}/{repo}/check-runs`

**Required parameters:**
- `name` (string) -- e.g., `"software-factory/validation"`
- `head_sha` (string) -- commit SHA

**Optional parameters:**
- `status` -- `queued`, `in_progress`, `completed`
- `conclusion` -- `success`, `failure`, `neutral`, `cancelled`, `skipped`, `timed_out`, `action_required` (only when status is `completed`)
- `started_at`, `completed_at` -- ISO 8601 timestamps
- `details_url` -- URL to full results (link to factory dashboard)
- `external_id` -- Factory task ID for correlation
- `output` -- Rich output object:
  - `title` (required) -- Summary title
  - `summary` (required, Markdown) -- Summary text
  - `text` (optional, Markdown) -- Detailed output
  - `annotations` -- Array of file-level annotations (**max 50 per request**):
    - `path`, `start_line`, `end_line`, `annotation_level` (`notice`/`warning`/`failure`), `message`
  - `images` -- Array of `{alt, image_url, caption}`
- `actions` -- Up to 3 action buttons (label, identifier, description)

**Update:** `PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}`

**Critical:** Only GitHub Apps can create/update check runs. OAuth apps and PATs cannot.

**Annotation limits:** Max 50 annotations per API request. GitHub Actions: 10 warnings and 10 errors per step. Max 1000 check runs with the same name per check suite (older ones auto-deleted).

#### Merge Queue GraphQL Mutations

**Enqueue a PR (GraphQL only -- no REST endpoint):**
```graphql
mutation {
  enqueuePullRequest(input: {
    pullRequestId: "PR_NODE_ID"
  }) {
    mergeQueueEntry {
      id
      position
      state
      estimatedTimeToMerge
    }
  }
}
```

**Enable auto-merge (will auto-enqueue when checks pass):**
```graphql
mutation {
  enablePullRequestAutoMerge(input: {
    pullRequestId: "PR_NODE_ID"
    mergeMethod: SQUASH
  }) {
    pullRequest { id }
  }
}
```
Requires `contents:write` + `pull_requests:write`.

**Dequeue a PR:**
```graphql
mutation {
  dequeuePullRequest(input: {
    pullRequestId: "PR_NODE_ID"
  }) {
    mergeQueueEntry { id }
  }
}
```

**Monitor merge queue:**
```graphql
query {
  repository(owner: "owner", name: "repo") {
    mergeQueue(branch: "main") {
      entries(first: 10) {
        nodes {
          position
          state
          pullRequest { number title }
          estimatedTimeToMerge
        }
      }
    }
  }
}
```

**Webhook events:**
- `merge_group.checks_requested` -- A merge group was created. Factory must run checks on the `merge_group.head_sha` and report back via check runs.
- `merge_group.destroyed` -- Merge group was dissolved (success or failure).

**Rejection handling (per PRD max 3 attempts):**
- PR is removed from queue on CI failure, timeout, or unresolvable conflicts
- Removal reason available on PR timeline
- Factory re-enqueues after remediation (rebase, re-validate) up to 3 times

#### Merging (Non-Queue Path)

**Endpoint:** `PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge`

**Parameters:**
- `merge_method` -- `merge`, `squash`, or `rebase`
- `commit_title` -- Custom merge commit title
- `commit_message` -- Custom merge commit message
- `sha` -- Expected HEAD SHA (safety check -- merge fails if PR head has changed)

#### Stale Review Detection

**When reviews go stale:**
- When the merge base changes (new commits to the base branch change the merge base)
- When `dismiss_stale_reviews` is enabled in branch protection, approvals are auto-dismissed on new pushes to the PR branch
- Review dismissal fires `pull_request_review.dismissed` webhook

**Detection approach (hybrid):**

1. **Webhook-driven:** Listen for `pull_request_review.dismissed` events
2. **GraphQL query for review decision:**
```graphql
query {
  repository(owner: "owner", name: "repo") {
    pullRequest(number: 123) {
      reviewDecision  # APPROVED, CHANGES_REQUESTED, REVIEW_REQUIRED, null
      mergeable       # MERGEABLE, CONFLICTING, UNKNOWN
    }
  }
}
```
3. **Periodic reconciliation:** `reviewDecision` reflects the current state accounting for dismissals. `REVIEW_REQUIRED` after previous `APPROVED` means reviews went stale.

**`mergeable_state` values (REST):** `clean`, `dirty` (conflicts), `blocked` (failing checks/reviews), `unstable` (passing checks but pending), `unknown` (being calculated)

**Limitation:** `reviewDecision` is an enum without timestamps. There is no direct way to query when a review decision was made. The factory must track this via webhook events + reconciliation reads.

#### Review Thread Tracking (GraphQL)

**REST API limitation:** No endpoint for unresolved conversation count.

**GraphQL approach:**
```graphql
query($owner: String!, $name: String!, $prNumber: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $prNumber) {
      reviewThreads(first: 100) {
        totalCount
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          startLine
          comments(last: 1) {
            nodes {
              body
              author { login }
              createdAt
            }
          }
        }
      }
    }
  }
}
```

**Counting unresolved threads:** Filter `nodes` where `isResolved === false`. Paginate if `totalCount > 100`.

**`isOutdated`:** Thread is on code that has since changed (useful for factory to decide whether to address it).

#### Review Dismissal

**Webhook:** `pull_request_review.dismissed` event fires when a review is dismissed.

**Payload includes:** The `review` object with the dismissed review details and `pull_request` context.

**Factory response:** Re-route -- surface in dashboard as "review dismissed, re-request needed" or automatically re-request review depending on policy.

### 1.8 Reconciliation Schedule

Webhook-driven (primary): Real-time state updates from events. Low latency, low API usage.

Periodic reconciliation (secondary): Cron-based reads to catch missed webhooks or drift:

| What to Reconcile | API Call | Frequency |
|-------------------|----------|-----------|
| PR merge status | `GET /repos/{owner}/{repo}/pulls/{pull_number}` | Every 5 minutes for active PRs |
| Review decision | GraphQL `pullRequest.reviewDecision` | Every 5 minutes for active PRs |
| Unresolved threads | GraphQL `pullRequest.reviewThreads` | Every 5 minutes for active PRs |
| Check run status | `GET /repos/{owner}/{repo}/commits/{ref}/check-runs` | Every 5 minutes for pending PRs |
| Branch protection changes | `GET /repos/{owner}/{repo}/branches/{branch}/protection` | Every 30 minutes or on config change |
| Ruleset changes | `GET /repos/{owner}/{repo}/rulesets?includes_parents=true` | Every 30 minutes |

**Use conditional requests (ETags)** for reconciliation to avoid rate limit consumption (304 responses don't count against primary rate limit).

### 1.9 Rate Limits

**Installation access tokens (primary):**
- GitHub.com: **5,000 requests/hour** base
- Scales: +50 req/hr per repository (>20 repos) and per user (>20 users), capped at **12,500**
- GitHub Enterprise Cloud: **15,000 requests/hour**

**Secondary rate limits:**
- Max **100 concurrent requests** across REST + GraphQL
- **900 points/minute** per REST endpoint
- **80 content-creating requests/minute**, 500/hour
- CPU time: 90 seconds per 60 seconds real time

**GraphQL rate limits (separate):**
- Queries: **1 point** each
- Mutations: **5 points** each
- Secondary: **2,000 points/minute**

**Response headers:**

| Header | Purpose |
|--------|---------|
| `x-ratelimit-limit` | Max requests per hour |
| `x-ratelimit-remaining` | Remaining in current window |
| `x-ratelimit-used` | Used in current window |
| `x-ratelimit-reset` | UTC epoch seconds when window resets |
| `x-ratelimit-resource` | Rate limit bucket name |

### 1.10 Best Practices

1. **Prefer webhooks over polling.** Subscribe to events instead of polling API endpoints.
2. **Use conditional requests (ETags).** Include `If-None-Match` with stored ETag. 304 responses don't count against rate limit (when authorized).
3. **Use Link header pagination.** Never construct pagination URLs manually.
4. **Serialize mutating requests.** Wait at least **1 second** between POST/PATCH/PUT/DELETE requests. Queue system recommended.
5. **Handle rate limit errors correctly:**
   - 403 with rate limit headers: primary limit hit. Wait until `x-ratelimit-reset`.
   - 429: secondary limit hit. Check `retry-after` header first, then `x-ratelimit-reset`, then wait at least 1 minute.
   - Use exponential backoff for persistent secondary limit failures.
6. **Batch GraphQL queries** to reduce request count (one GraphQL request can fetch multiple resources).
7. **Track usage per-token** -- the factory should log rate limit headers to detect approaching limits.

### 1.11 Error Handling

| Error Type | Response |
|-----------|----------|
| 401 Unauthorized | Token expired -- rotate immediately |
| 403 Rate limit | Check headers, wait, retry with backoff |
| 403 Permission denied | Log, surface to operator (permission may need upgrade) |
| 404 Not found | Resource may have been deleted; reconcile state |
| 409 Conflict | Concurrent modification; retry with fresh state |
| 422 Validation failed | Parse error message; common for push rule violations |
| 429 Secondary rate limit | Check `retry-after`, exponential backoff |

### 1.12 Octokit Packages

| Package | Purpose | Key Feature |
|---------|---------|-------------|
| `octokit` | All-in-one SDK (REST + GraphQL + Auth + Webhooks) | Single import for everything |
| `@octokit/rest` | REST API client with typed methods | `octokit.rest.pulls.create(...)` |
| `@octokit/auth-app` | GitHub App auth (JWT + installation tokens) | Automatic token caching and refresh |
| `@octokit/webhooks` | Webhook event handling + signature verification | Typed event handlers, middleware |
| `@octokit/graphql` | GraphQL client | Typed queries |
| `@octokit/webhooks-types` | TypeScript types for webhook payloads | v7.6.1+ |

#### @octokit/auth-app Usage

```typescript
import { Octokit } from "@octokit/core";
import { createAppAuth } from "@octokit/auth-app";

// App-level authentication (for listing installations)
const appOctokit = new Octokit({
  authStrategy: createAppAuth,
  auth: {
    appId: APP_ID,
    privateKey: PEM_CONTENT,
  },
});

// Installation-level authentication (for repo operations)
const installationOctokit = new Octokit({
  authStrategy: createAppAuth,
  auth: {
    appId: APP_ID,
    privateKey: PEM_CONTENT,
    installationId: INSTALLATION_ID,
  },
});
// Token creation/refresh is automatic and transparent.
// Caches up to 15,000 tokens using toad-cache.
// Installation tokens auto-refresh on expiry (~1 hour).
```

**Scoped token creation:**
```typescript
const { token } = await installationOctokit.auth({
  type: "installation",
  installationId: INSTALLATION_ID,
  permissions: { contents: "read", checks: "write" },
  repositoryIds: [REPO_ID],
});
```

#### @octokit/webhooks Usage

```typescript
import { Webhooks, createNodeMiddleware } from "@octokit/webhooks";
import type { EmitterWebhookEventName } from "@octokit/webhooks";

const webhooks = new Webhooks({ secret: WEBHOOK_SECRET });

// Typed event handlers
webhooks.on("pull_request.opened", async ({ id, name, payload }) => {
  // payload is typed as PullRequestOpenedEvent
  const prNumber = payload.pull_request.number;
});

webhooks.on("pull_request_review.submitted", async ({ payload }) => {
  // payload.review.state: "approved" | "changes_requested" | "commented"
});

webhooks.on("merge_group.checks_requested", async ({ payload }) => {
  // payload.merge_group.head_sha -- run checks on this
});

webhooks.onAny(async ({ id, name, payload }) => {
  // Audit logging for all events
});

webhooks.onError(async (error) => {
  // Error handling with error.event context
});

// Express/Node.js middleware -- handles verification automatically
const middleware = createNodeMiddleware(webhooks, {
  path: "/api/github/webhooks",
});

// For serverless (Cloudflare Workers, Vercel, etc.)
import { createWebMiddleware } from "@octokit/webhooks";
const webMiddleware = createWebMiddleware(webhooks, {
  path: "/api/github/webhooks",
});
```

#### TypeScript Configuration

**Required tsconfig.json settings for Octokit:**
```json
{
  "compilerOptions": {
    "moduleResolution": "node16",
    "module": "node16"
  }
}
```

These are needed because Octokit packages use conditional exports.

**API version:** `2026-03-10`. Pin to a specific version via the `X-GitHub-Api-Version` header and update explicitly.

### 1.13 Git Operations

#### Branch Creation

```
POST /repos/{owner}/{repo}/git/refs
{
  "ref": "refs/heads/factory/task-T-001",
  "sha": "<base_commit_sha>"
}
```

**Permission:** `contents:write`

#### Pushing Commits (Git Database API -- 6-Step Sequence)

For lightweight operations (updating a file, creating metadata commits):

1. **Get current commit:** `GET /repos/{owner}/{repo}/git/ref/heads/{branch}` -> commit SHA
2. **Get tree:** `GET /repos/{owner}/{repo}/git/commits/{sha}` -> tree SHA
3. **Create blob:** `POST /repos/{owner}/{repo}/git/blobs` with `{content, encoding}`
4. **Create tree:** `POST /repos/{owner}/{repo}/git/trees` with `{base_tree, tree: [{path, mode, type, sha}]}`
5. **Create commit:** `POST /repos/{owner}/{repo}/git/commits` with `{message, tree, parents: [parent_sha]}`
6. **Update ref:** `PATCH /repos/{owner}/{repo}/git/refs/heads/{branch}` with `{sha: new_commit_sha}`

**Commit signing:** Commits created via this API are automatically signed by GitHub as the App identity **if and only if** no custom author/committer/signature information is provided. This satisfies `required_signatures` rules without needing the factory to manage GPG keys.

**Important:** These operations must be serialized -- concurrent writes conflict and produce errors.

#### Branch Naming Convention

The factory should use a predictable branch naming pattern that:
- Satisfies `branch_name_pattern` rulesets (detected during capability scan)
- Is clearly identifiable as factory-managed
- Supports the "one active mutator per branch" rule (PRD Section 6.4)

Suggested pattern: `factory/{task-id}` or `factory/{task-id}/{attempt}` (configurable).

### 1.14 REST vs. GraphQL Decision Matrix

| Operation | Use REST | Use GraphQL |
|-----------|----------|-------------|
| CRUD on PRs, check runs, branches | Yes | |
| Capability scan (rulesets, protection) | Yes | |
| Review thread tracking (isResolved) | | Yes (no REST equivalent) |
| Review decision (stale detection) | | Yes (reviewDecision enum) |
| Merge queue interaction (enqueue/dequeue) | | Yes (no REST equivalent) |
| Merge queue status monitoring | | Yes (mergeQueue field) |
| Auto-merge enablement | | Yes (enablePullRequestAutoMerge) |
| Webhook handling | REST (incoming) | |

### 1.15 Identified Gaps

1. **No REST API for merge queue enqueue/dequeue.** Must use GraphQL. The factory needs both REST and GraphQL clients.
2. **No REST API for unresolved review thread count.** Must use GraphQL.
3. **`reviewDecision` has no timestamps.** Stale review detection requires correlating webhook events with GraphQL state. Cannot query "when did this review become stale?"
4. **CODEOWNERS parsing is client-side.** No API returns "these are the owners for this set of changed files." The factory must implement gitignore-style pattern matching.
5. **Installation token expiry is not configurable.** Always 1 hour. The factory must implement its own rotation schedule (~50 minutes per PRD R-005).
6. **`merge_group` events are app-webhook-only.** Cannot be received via repo or org webhooks. The factory's GitHub App must have a webhook endpoint.
7. **Check run annotations limited to 50 per request.** For large evidence packets, may need multiple update calls.

---

## 2. LLM Integration

### 2.1 SDK Selection

**Use the Vercel AI SDK (`ai`) as the primary abstraction layer, with the OpenRouter provider (`@openrouter/ai-sdk-provider`) for model access.**

Rationale:
1. **OTel telemetry is built in** -- critical for R-012 (audit trail) and R-013 (cost tracking). Spans automatically capture `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, model, latency, tool calls.
2. **Provider-agnostic** -- supports the PRD requirement that architecture "must not preclude self-hosted inference" (R-017). Switching from OpenRouter to a local OpenAI-compatible endpoint is a provider change, not an architecture change.
3. **`prepareStep` callback** -- enables dynamic context trimming and model switching per step, essential for context window management and cost optimization.
4. **Loop control** -- built-in `stepCountIs()` maps to R-024 max iteration limit. Custom stop conditions can implement no-progress detection and budget enforcement.
5. **Structured output** -- `generateObject()` with Zod schemas maps directly to evidence packet generation (R-008).
6. **Largest community and ecosystem** -- 2.8M weekly npm downloads, most popular TS AI framework.

**Supplement with direct OpenRouter API calls** for:
- Generation stats retrieval (`/api/v1/generation?id=`) for detailed cost/latency metadata
- Provider routing configuration (disable fallbacks, specify providers)
- Prompt caching configuration

**Do NOT use LangChain.js.** LangChain adds significant abstraction overhead, has edge-runtime incompatibility issues, requires more boilerplate, and its chain/agent abstractions do not align with the factory's explicit, inspectable workflow. The factory needs thin orchestration (PRD Principle 7: "factory logic in code, not prompts"), not framework magic.

### 2.2 OpenRouter Configuration

**Primary endpoint:**
```
POST https://openrouter.ai/api/v1/chat/completions
```

Authentication is via Bearer token in the `Authorization` header. Accepts the standard OpenAI request format with `messages`, `model`, `stream`, `tools`, `response_format`, `max_tokens`, `temperature`, etc.

**Critical configuration for PRD R-017 (pause-on-failure, no silent failover):**
- `allow_fallbacks: false` -- disable automatic failover
- `provider.order` -- specify a single provider
- `provider.only` -- whitelist specific providers
- `data_collection: "deny"` -- control training data usage
- `require_parameters: true` -- route only to providers supporting all request params (e.g., `tools`)

Additional routing controls:
- `provider.zdr` -- enforce Zero Data Retention (relevant for governance)
- `provider.quantizations` -- filter by quantization level

**Streaming:** Set `stream: true` for SSE responses. Final chunk includes `usage` stats (token counts). OpenRouter sends occasional comment payloads (`": OPENROUTER PROCESSING"`) to prevent timeouts -- these should be ignored per SSE spec. Aborting a stream stops billing on supported providers. On unsupported providers, the model continues and full billing applies.

**Prompt caching:** Anthropic models support prompt caching via OpenRouter. Add `cache_control` to messages. OpenRouter uses provider-sticky routing to maximize cache hits. Default cache lifetime: 5 minutes, refreshed on each cache hit.

#### OpenRouter Error Code Table

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

Mid-stream errors arrive as SSE events with `finish_reason: "error"` (HTTP status remains 200 since headers are already sent). Pre-stream errors return standard JSON with the error code as HTTP status. Provider error details are in `error.metadata.raw`. Moderation errors include `error.metadata.reasons` and `error.metadata.flagged_input`.

**Rate limits:** Dynamic, tied to account balance. Free tier: 50 requests/day (1000/day if 10+ credits purchased). Paid tier: $1 balance = 1 RPS, up to 500 RPS maximum. Read `Retry-After` header. Use exponential backoff with randomized jitter. Implement client-side token-bucket or leaky-bucket limiter.

### 2.3 Cost Tracking

**Generation Stats Endpoint** (critical for R-013):

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

**Budget enforcement:**
- 80% of per-task budget ($8 default): notify
- 100% ($10 default): pause mid-execution
- 80% of daily budget ($80): notify
- 100% ($100): pause all tasks

**Redis INCR for counters:** Track global daily spend via atomic increment per call. Per-task cost accumulated in Postgres per task.

**Token counting:** Use `js-tiktoken` (pure JS, no WASM) for offline pre-flight estimates only. For Anthropic models, approximate with `p50k_base` encoding. Always use actual token counts from the API response's `usage` field or the generation stats endpoint for billing.

### 2.4 Agent Architecture

**Hybrid plan-and-execute (outer, Temporal) + ReAct (inner, Vercel AI SDK `generateText` with `maxSteps`).**

The outer loop aligns with the PRD core workflow (Section 6.1). The plan is a first-class artifact (visible in evidence, R-008). If the agent deviates significantly from the plan, it re-plans (with iteration limits per R-024).

**5-Phase structure:**

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

**Model routing by phase:**
- **UNDERSTAND/PLAN**: Frontier (Claude Opus 4.6, Gemini 3.1 Pro) -- strongest reasoning
- **IMPLEMENT**: Mid-tier (Claude Sonnet 4.6, GPT-5.2) -- good quality, lower cost
- **Simple sub-tasks** (commit messages, summaries): Budget (GPT-5.2-mini, Gemini Flash) -- cheap, fast
- **EVIDENCE**: Mid-tier with structured output (Claude Sonnet 4.6)

### 2.5 Edit Format

**Search/replace blocks as primary format.** Progressive matching:
1. **Exact match** -- literal string match
2. **Whitespace-tolerant** -- normalize whitespace before matching
3. **Fuzzy** -- approximate match for handling minor model output variations

**Whole-file generation** for small new files (under ~400 lines).

**Avoid line numbers** in edit formats -- they cause off-by-one errors.

**Key finding:** Edit format choice can swing benchmark performance from 26% to 59% (GPT-4 Turbo). The format matters as much as the model.

**Design error messages for diagnosis:** When a match fails, report what was expected vs found. Log match failures to the audit trail.

### 2.6 Context Management

#### Repo Map (tree-sitter, Aider-style)

Build a compressed representation of the codebase using tree-sitter AST parsing. The repo map includes file names, function signatures, class definitions, and a dependency graph. Token budget: **~1000 tokens** (`--map-tokens` equivalent).

**Strict ordering for lost-in-the-middle effect:**

```
1. System prompt + instructions     (top -- rules never get buried)
2. Repo map (compressed)            (bird's eye view)
3. Task objective + constraints      (what to do)
4. Execution plan                    (how to do it)
5. Relevant file contents           (working context)
6. Tool call history (recent)       (what happened so far)
7. Previous attempt results          (if iterating)
```

Research shows information position matters ("lost-in-the-middle" effect). Place non-negotiable rules and constraints at the start. Place current working context at the end. Bury reference material in the middle. Moving instruction files from middle to beginning reduced code style violations by 35-40%.

**`prepareStep` callback:** Vercel AI SDK callback for dynamic context trimming and model switching per step. Trim message history (keep system prompt + last N messages). Compress verbose tool results between iterations.

**Context pruning strategies:**
- Use repo map (compressed, ~1000 tokens) instead of dumping entire files
- Use tree-sitter to extract only relevant functions/classes from large files
- Remove redundant context between iterations
- Structure prompts to maximize the cacheable prefix: stable content first, variable content last

### 2.7 Agent Toolset

7 core tools for coding tasks:

| Tool | Purpose | Security Constraints |
|------|---------|---------------------|
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

### 2.8 Self-Healing Guardrails

All 5 guardrails:

**1. Iteration count (max 10):**
Use Vercel AI SDK's `stepCountIs(10)` as a hard stop.

**2. No-progress fingerprinting (3 identical):**
After each iteration, compute a fingerprint of the agent's state:
- Files modified (set of paths + content hashes)
- Test results (pass/fail counts)
- Lint/typecheck error counts
- Last N tool calls and their results

If the fingerprint is identical for 3 consecutive iterations, the agent is stuck. Trip the guardrail.

**3. Loop-of-doom hash (4 identical failing):**
Track the last N tool calls. If the same tool is called with the same arguments 4+ times and fails each time, trip the guardrail. Implementation: `hash(tool_name + JSON.stringify(args) + error_message)`. If the same hash appears 4 times, stop.

**4. Wall-clock timer (30 minutes):**
Set a wall-clock timer at the start of each repair attempt. If 30 minutes elapse, pause regardless of agent state.

**5. Redis cost budgets ($10/task, $100/day):**
- Use `maxCost()` stop condition in the SDK for per-execution budget
- After each LLM call, query generation stats and accumulate cost
- At 80% of per-task budget ($8 default): notify
- At 100% ($10 default): pause mid-execution
- Track global daily spend in Redis (atomic increment per call)
- At 80% of daily budget ($80): notify
- At 100% ($100): pause all tasks

**Graceful degradation on guardrail trip:**
1. Save current state (files modified, test results, error messages)
2. Produce a partial evidence bundle showing what was attempted
3. Pause and notify human with the partial evidence
4. Human can: provide hints, increase budget, redirect, or reject

### 2.9 Circuit Breaker

**Redis key patterns:**

```
Before each tool call:
  1. Check Redis key `factory:kill_switch` -- if set, abort immediately
  2. Check Redis key `factory:circuit:{tool_name}` -- if tripped, skip tool
  3. Check Redis key `factory:circuit:{agent_id}` -- if tripped, abort agent
```

Circuit breaker state transitions: closed -> open (on N consecutive failures) -> half-open (after cooldown) -> closed (on success) or open (on failure).

### 2.10 Prompt Injection Defense

**7-layer defense-in-depth architecture:**

1. **Trust classification** at input time (R-023)
2. **Delimiters** separating instructions from data ("spotlighting")
3. **Content filtering** scanning untrusted input for known injection patterns
4. **Tool-call validation** -- untrusted content cannot parameterize destructive tools
5. **Output verification** -- validate structured outputs against schemas
6. **Least-privilege tool design** -- tools have minimal permissions
7. **Behavioral control file trust boundary** (R-011) -- only load from trusted base ref

**4-tier trust classification table:**

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

### 2.11 Audit Entry Structure

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

### 2.12 Evidence Generation

#### DiffAnnotation Zod Schema

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

**Blast radius analysis:** Combine code index data (R-014) with LLM analysis:
1. **Deterministic phase:** Use the dependency graph from the code index to identify all files/functions that import or reference the changed symbols. Count affected files, packages, downstream consumers.
2. **LLM phase:** For each non-trivial change, ask the model to assess whether the change is likely to break any consumer, based on the symbol's type signature and usage patterns.

**Unresolved assumptions:** Prompt the model explicitly: "List any assumptions you made that you were not able to verify through tests or code inspection." Structured output field in the evidence packet.

**Critical rule from R-008:** No scalar confidence scores. No generic rollback prose. Evidence must be derived from actual analysis, not model self-assessment.

**Protected-surface edits (R-011):** When the agent edits a flagged file, the evidence generation step must:
1. Highlight the edit prominently
2. Explain what changed and why
3. Show the before/after
4. If it's a behavioral control file, explain what behavior would change

### 2.13 Observability

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
    +-- Langfuse (optional, LLM-specific analysis -- deferred to Phase 2)
```

**What Vercel AI SDK telemetry captures per span automatically:**

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

**Supplement with OpenRouter generation stats:**
- `total_cost` (USD)
- `latency`, `generation_time` (ms)
- `provider_name`
- `native_tokens_reasoning`, `native_tokens_cached`
- `cache_discount`

**Langfuse** (open-source LLM engineering platform): Integrates with Vercel AI SDK via OpenTelemetry. Provides structured traces, token usage tracking with cost aggregation, trace attributes (user_id, session_id, tags, metadata). Self-hostable. Good fit for Phase 2 (R-019 dashboard). For Phase 1, Postgres audit log + OTel export to a basic collector is sufficient.

---

## 3. Code Indexing

### 3.1 Pipeline (10 Steps)

```
┌────────────────────────────────────────────────────────────┐
│                     INDEX PIPELINE                          │
│                                                            │
│  1. File Discovery (git ls-files)                          │
│         │                                                  │
│  2. Governance Filter (picomatch)     <── PolicyConfig     │
│         │                                                  │
│  3. Language Detection (file extension)                    │
│         │                                                  │
│  4. Parse (tree-sitter + language grammar)                 │
│         │                                                  │
│  5. Symbol Extraction (tags.scm queries)                   │
│         │                                                  │
│  6. Import Extraction (AST queries + heuristic resolution) │
│         │                                                  │
│  7. Store (Postgres: symbols, imports, files)              │
│         │                                                  │
│  8. Build Dependency Graph (file_dependencies table)       │
│         │                                                  │
│  9. Detect Structure (entry points, module boundaries)     │
│         │                                                  │
│  10. Mark Index Ready (code_index_versions.status)         │
└────────────────────────────────────────────────────────────┘
```

### 3.2 tree-sitter Setup

**Package:** `tree-sitter` (native N-API bindings) -- ~280K weekly downloads, fastest option. WASM fallback via `web-tree-sitter` if native fails.

**Performance:** ~100,000 lines per second. Incremental parsing reduces parsing time by **up to 70%** compared to full re-parsing. The `tree.edit()` + `parser.parse(newSource, oldTree)` pattern enables incremental updates. `tree.getChangedRanges(newTree)` identifies exactly which ranges changed.

#### .scm Query Files (tags.scm)

**Standard captures:**

| Capture | Meaning |
|---------|---------|
| `@definition.function` | Function definition |
| `@definition.class` | Class definition |
| `@definition.interface` | Interface definition |
| `@definition.method` | Method definition |
| `@definition.module` | Module definition |
| `@reference.call` | Function/method call |
| `@reference.class` | Class reference |
| `@reference.implementation` | Interface implementation |
| `@name` | The identifier being tagged |
| `@doc` | Optional docstring |

**Example TypeScript query for function definitions:**
```scheme
(function_declaration
  name: (identifier) @name) @definition.function

(class_declaration
  name: (type_identifier) @name) @definition.class

(interface_declaration
  name: (type_identifier) @name) @definition.interface

(method_definition
  name: (property_identifier) @name) @definition.method
```

**Node.js Query API:**
```typescript
const Parser = require('tree-sitter');
const TypeScript = require('tree-sitter-typescript').typescript;

const parser = new Parser();
parser.setLanguage(TypeScript);
const tree = parser.parse(sourceCode);

// Query API
const query = new Parser.Query(TypeScript, queryString);
const matches = query.matches(tree.rootNode);
// Each match: { pattern: number, captures: QueryCapture[] }
// Each capture: { name: string, node: SyntaxNode }
```

Key `Query` methods:
- `matches(node, options?)` -- returns `QueryMatch[]` in match order
- `captures(node, options?)` -- returns `QueryCapture[]` in source order
- `disablePattern(index)` / `disableCapture(name)` -- optimize by skipping irrelevant patterns

### 3.3 Tag Type Definition

```
Tag = { rel_path, abs_path, line, name, kind: "def" | "ref" }
```

Per-file extraction:
1. Detect language from file extension
2. Load appropriate tree-sitter grammar
3. Parse file into AST
4. Run `tags.scm` query against AST
5. Collect all `@definition.*` and `@reference.*` captures
6. Store as Tag tuples with file path, line number, symbol name, and kind

### 3.4 Repo Map (Aider-style, Personalized PageRank)

**Graph construction:**
- Nodes = files (relative paths)
- Edges = shared symbol references between files
- Built as a `NetworkX.MultiDiGraph` (equivalent in our TypeScript implementation)

**Edge weight computation (multiplicative factors):**

| Factor | Multiplier | Purpose |
|--------|-----------|---------|
| Base | 1.0 | Default |
| Identifier mentioned in chat | x10 | Boost task-relevant symbols |
| Long identifier (>=8 chars, camelCase/snake_case) | x10 | Favor specific names over generic ones |
| Private identifier (starts with `_`) | x0.1 | Demote internal details |
| Symbol defined in >5 files | x0.1 | Demote ubiquitous symbols |
| Reference in active chat files | x50 | Heavily boost files user is working on |
| Reference count | x sqrt(num_refs) | Sublinear boost for popular symbols |

**PageRank with personalization:**
- Files mentioned in chat get initial weight 100/len(fnames)
- Files with path components matching mentioned identifiers also boosted
- Standard PageRank distributes rank through the graph
- Final ranking: (file, identifier) pairs sorted by rank

**Token budget optimization:**
- Binary search to fit maximum tags within token limit
- Default: **~1000 tokens**
- Sampling-based token counting for texts >= 200 chars
- Lines truncated to 100 chars max

**Three-level caching:**
1. `TAGS_CACHE` -- disk cache, keyed by file path, invalidated on mtime change
2. `map_cache` -- in-memory, keyed by (chat_fnames, other_fnames, max_tokens)
3. `tree_cache` -- in-memory, keyed by (file, lines_of_interest, mtime)

### 3.5 Governance Filter

**picomatch as FIRST pipeline stage -- this is a security boundary.**

| Library | Weekly Downloads | Dependencies | ReDoS Safe | Brace Expansion |
|---------|-----------------|-------------|------------|-----------------|
| `picomatch` | 220M | 0 | Yes | No (by design) |
| `micromatch` | ~60M | picomatch | Yes | Yes |
| `minimatch` | ~100M | brace-expansion | **No** (CVE-2022-3517) | Yes |

**Default exclusion patterns:**
```
secrets/**
.env*
*.pem
*.key
*.p12
*.pfx
*.jks
.git/**
node_modules/**
```

**Critical invariant (from PRD R-010 AC):** "Given read exclusion on `secrets/**`, code index does not contain content from those paths. Agent context retrieval skips them."

The exclusion list must be configurable per repo via `PolicyConfig` and applied at **every** entry point to the index: initial build, incremental update, and query-time retrieval.

**Symlink resolution:** Resolve symlinks before filtering. Filter on resolved paths to prevent governance bypass via symlinks or generated files.

### 3.6 Storage (Postgres)

**All 7 tables with columns and indexes:**

```sql
-- Repository tracking
CREATE TABLE repositories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  github_owner VARCHAR(255) NOT NULL,
  github_repo VARCHAR(255) NOT NULL,
  default_branch VARCHAR(255) NOT NULL DEFAULT 'main',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(github_owner, github_repo)
);

-- Index version per commit
CREATE TABLE code_index_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id UUID NOT NULL REFERENCES repositories(id),
  commit_sha VARCHAR(40) NOT NULL,
  branch VARCHAR(255),
  status VARCHAR(20) NOT NULL DEFAULT 'building',
  indexed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  file_count INTEGER,
  symbol_count INTEGER,
  duration_ms INTEGER,
  UNIQUE(repo_id, commit_sha)
);

-- Indexed files with content hash for cache invalidation
CREATE TABLE indexed_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  index_version_id UUID NOT NULL REFERENCES code_index_versions(id) ON DELETE CASCADE,
  rel_path VARCHAR(1024) NOT NULL,
  language VARCHAR(50),
  content_hash VARCHAR(64) NOT NULL,  -- SHA-256 of file content
  line_count INTEGER,
  byte_size INTEGER,
  UNIQUE(index_version_id, rel_path)
);

-- Symbol table: functions, classes, interfaces, exports, imports
CREATE TABLE symbols (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id UUID NOT NULL REFERENCES indexed_files(id) ON DELETE CASCADE,
  name VARCHAR(512) NOT NULL,
  kind VARCHAR(50) NOT NULL,  -- function, class, interface, method, type, variable, export, import
  line_start INTEGER NOT NULL,
  line_end INTEGER,
  column_start INTEGER,
  column_end INTEGER,
  signature TEXT,              -- function signature, class declaration line
  doc_comment TEXT,            -- extracted docstring
  is_exported BOOLEAN DEFAULT false,
  parent_symbol_id UUID REFERENCES symbols(id),  -- for methods within classes
  -- Full-text search on symbol names
  name_tsvector TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('simple', replace(replace(name, '_', ' '), '.', ' '))
  ) STORED
);

-- Import relationships (lightweight, heuristic-resolved)
CREATE TABLE imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id UUID NOT NULL REFERENCES indexed_files(id) ON DELETE CASCADE,
  source_path VARCHAR(1024) NOT NULL,  -- raw import path
  resolved_file_id UUID REFERENCES indexed_files(id),  -- resolved target (nullable)
  imported_names TEXT[],  -- specific named imports, or NULL for * / default
  is_type_only BOOLEAN DEFAULT false,
  line_number INTEGER
);

-- File dependency edges (derived from imports)
CREATE TABLE file_dependencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  index_version_id UUID NOT NULL REFERENCES code_index_versions(id) ON DELETE CASCADE,
  source_file_id UUID NOT NULL REFERENCES indexed_files(id),
  target_file_id UUID NOT NULL REFERENCES indexed_files(id),
  dependency_type VARCHAR(20) NOT NULL DEFAULT 'import',  -- import, require, re-export
  weight REAL DEFAULT 1.0,
  UNIQUE(index_version_id, source_file_id, target_file_id, dependency_type)
);

-- Repo map metadata: entry points, module boundaries
CREATE TABLE repo_structure (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  index_version_id UUID NOT NULL REFERENCES code_index_versions(id) ON DELETE CASCADE,
  file_id UUID NOT NULL REFERENCES indexed_files(id),
  role VARCHAR(50) NOT NULL,  -- entry_point, barrel_export, config, test, migration
  confidence REAL DEFAULT 1.0,
  metadata JSONB
);

-- Indexes
CREATE INDEX idx_symbols_file_id ON symbols(file_id);
CREATE INDEX idx_symbols_name ON symbols(name);
CREATE INDEX idx_symbols_kind ON symbols(kind);
CREATE INDEX idx_symbols_name_tsvector ON symbols USING GIN(name_tsvector);
CREATE INDEX idx_imports_file_id ON imports(file_id);
CREATE INDEX idx_imports_resolved ON imports(resolved_file_id);
CREATE INDEX idx_file_deps_source ON file_dependencies(source_file_id);
CREATE INDEX idx_file_deps_target ON file_dependencies(target_file_id);
CREATE INDEX idx_indexed_files_path ON indexed_files(rel_path);
CREATE INDEX idx_indexed_files_version ON indexed_files(index_version_id);
CREATE INDEX idx_repo_structure_version ON repo_structure(index_version_id);

-- Phase 3+: Embedding column for semantic search
-- ALTER TABLE symbols ADD COLUMN embedding VECTOR(1536);
-- CREATE INDEX idx_symbols_embedding ON symbols USING hnsw(embedding vector_cosine_ops);
```

**Full-text search:** `'simple'` config (no stemming). GIN index on `name_tsvector`. Custom dictionary can handle camelCase/snake_case splitting. No external dependency for Phase 1.

**Phase 3 path:** Add `pgvector` `VECTOR(1536)` column with HNSW index. Postgres-native means no additional infrastructure.

**Query patterns:**

```sql
-- "Find all files related to authentication"
SELECT DISTINCT f.rel_path, s.name, s.kind, s.signature
FROM symbols s
JOIN indexed_files f ON s.file_id = f.id
WHERE f.index_version_id = $1
  AND s.name_tsvector @@ to_tsquery('simple', 'auth | authenticate | login | session | jwt | token')
ORDER BY f.rel_path;

-- "Get the dependency chain for a file" (recursive CTE, depth 5)
WITH RECURSIVE deps AS (
  SELECT fd.target_file_id, 1 AS depth
  FROM file_dependencies fd
  WHERE fd.source_file_id = $1 AND fd.index_version_id = $2
  UNION ALL
  SELECT fd.target_file_id, d.depth + 1
  FROM file_dependencies fd
  JOIN deps d ON fd.source_file_id = d.target_file_id
  WHERE fd.index_version_id = $2 AND d.depth < 5
)
SELECT DISTINCT f.rel_path, d.depth
FROM deps d
JOIN indexed_files f ON d.target_file_id = f.id
ORDER BY d.depth, f.rel_path;

-- "Get repo map -- top symbols per file, ranked by importance"
SELECT f.rel_path, s.name, s.kind, s.signature,
       (SELECT COUNT(*) FROM imports i WHERE i.resolved_file_id = f.id) AS import_count
FROM indexed_files f
LEFT JOIN symbols s ON s.file_id = f.id AND s.is_exported = true
WHERE f.index_version_id = $1
ORDER BY import_count DESC, f.rel_path, s.line_start;
```

### 3.7 Performance Numbers

**Full indexing:**

| Repo Size | Files | Est. Lines | Parse Time | Total (parse + extract + store) |
|-----------|-------|------------|------------|-------------------------------|
| Small | ~1K | ~100K | ~1s | ~5-10s |
| Medium | ~10K | ~1M | ~10s | ~30-60s |
| Large | ~100K | ~10M | ~100s | ~5-10 min |

**Incremental updates (changed files only):**
- 1-10 files changed: **50-200ms**
- Git diff check: **1-2ms**

**Query performance (with proper indexes):**
- Symbol name lookup (B-tree): <1ms
- Full-text search on names (GIN/tsvector): <10ms
- Dependency graph traversal (recursive CTE, depth 5): <50ms
- File listing for an index version: <5ms

### 3.8 Incremental Indexing

**Git diff-based, branch-aware via commit SHA:**

```bash
# Get list of changed files between indexed commit and HEAD
git diff --name-only <last-indexed-sha> HEAD
```

This is extremely fast: `git diff --name-only` completes in 1-2ms even on large repos.

**Incremental update flow:**
1. Store `last_indexed_commit_sha` in the index metadata
2. On index refresh, run `git diff --name-only <stored-sha> HEAD`
3. For each changed file: re-parse with tree-sitter, extract symbols, update DB
4. For deleted files: remove all symbols from DB
5. For renamed files: detect via `git diff --name-status -M` and update paths
6. Rebuild affected portions of the dependency graph
7. Update `last_indexed_commit_sha` to HEAD

**Branch-aware freshness (R-014):** Index versioned by commit SHA. When a task starts, it references the current index version. If the index is stale (HEAD has advanced), trigger an incremental update before the UNDERSTAND step.

**Cache invalidation:** Git SHA for committed state + content-hash for working tree changes. Content-hash handles `git checkout` that restores old content.

### 3.9 Language Grammars (Phase 1)

| Language | npm Package | Status |
|----------|------------|--------|
| TypeScript/TSX | `tree-sitter-typescript` | Mature, official |
| JavaScript | `tree-sitter-javascript` | Mature, official |
| Python | `tree-sitter-python` | Mature, official |
| Go | `tree-sitter-go` | Mature, official |
| Rust | `tree-sitter-rust` | Mature, official |
| Java | `tree-sitter-java` | Mature, official |

**Import resolution:** Heuristic resolution (~90% accuracy) sufficient for retrieval:
- Relative paths (`./foo`, `../bar`) -- resolve against file location
- Package imports (`lodash`, `@scope/pkg`) -- resolve via `node_modules`
- Path aliases (`@/components`) -- resolve via `tsconfig.json` paths
- Extension probing (`.ts`, `.tsx`, `.js`, `/index.ts`)

---

## 4. CLI UX Design

### 4.1 Framework: oclif

Powers Heroku CLI, Salesforce CLI, Shopify CLI. TypeScript native, plugin architecture, auto-generated help/man/completions, test infra.

**Framework comparison:**

| Framework | Weekly Downloads | TypeScript | Plugins | Shell Completions | Best For |
|-----------|-----------------|------------|---------|-------------------|----------|
| **Commander.js** | ~35M | Yes | No | Via external pkg | Simple CLIs |
| **oclif** | ~1M | Yes (native) | Yes (first-class) | Yes (built-in) | Multi-command tools |
| **yargs** | ~30M | Via @types | No | Yes (`yargs.completion()`) | Middleware-heavy CLIs |
| **citty** (unjs) | ~3M | Yes | No | No | Lightweight, modern |
| **clipanion** (yarn) | ~500K | Yes | No | No | Stateful CLIs |

### 4.2 All 13 Commands

```
factory
  submit          Submit a task (--issue 42, --directive "...")
  status          Show task status (--task T-001, or list all)
  evidence        Display evidence packet (--task T-001)
  approve         Approve task for PR creation (--task T-001)
  reject          Reject task (--task T-001 --reason "...")
  changes         Request changes (--task T-001 --feedback "...")
  kill            Emergency stop (--task T-001 or --all)
  config          Configure factory (init, set, get, list)
  repo            Repo management (scan, onboard, status)
  logs            View task/system logs (--task T-001, --follow)
  health          System health check
  backup          Backup factory state
  upgrade         Upgrade factory version
```

### 4.3 All 8 UX Patterns

**1. First-Run Wizard**
First invocation should guide setup: API key, GitHub App, repo config. Safe defaults, escape hatch with flags. Not a questionnaire -- a few high-signal prompts. `--non-interactive` escape hatch.

**2. Helpful Help**
Every command has examples, not just flag descriptions. `factory submit --help` should show `factory submit --issue 42 --repo my-org/my-repo`.

**3. Dry-Run with Diff**
`factory submit --dry-run` shows what would happen without executing. Critical for a control-plane product where user control is a core principle.

**4. Idempotent Retries**
`factory approve --task T-001` should succeed or report "already approved" -- not error on duplicate invocation.

**5. Structured Output**
`factory status --json` for machine consumption. `factory status --format table` for humans. Default to human-readable with color.

**6. Smart Errors**
Errors should include: what went wrong, why, and what to do next. Example: "Task T-001 is in state 'needs_clarification'. Run `factory respond --task T-001` to provide clarification."

**7. Honest Progress**
Live progress for long operations: spinners for indeterminate, progress bars for determinate. Use `ora` for spinners, `listr2` for multi-step progress.

**8. Shell Completions**
oclif provides this out of the box. Support bash, zsh, fish.

### 4.4 Evidence Display

**Libraries:**
- **Annotated diff:** `diff2html` or custom ANSI coloring (green/red for add/remove). Page with less/more for large diffs.
- **Markdown rendering:** `marked-terminal` or `cli-markdown` for rendering markdown in terminal.
- **Test results:** Table format with pass/fail indicators (checkmark/X unicode).
- **Blast radius:** Compact summary table.
- **Security scan:** Severity-colored table (red: critical, yellow: warning).
- **Protected file edits:** Highlighted with warning color, justification inline.

**Example output:**
```
factory evidence --task T-001

  Task T-001: Add user authentication
  Status: evidence_ready

  Blast Radius
  Files changed: 4  |  Packages affected: 2  |  Downstream consumers: 1

  Test Results
  [PASS] 24 passed  [FAIL] 0 failed  [SKIP] 2 skipped

  Security Scan
  No vulnerabilities found

  Protected File Edits
  [!] src/middleware/auth.test.ts (flagged: test file modification)
      Justification: Added tests for new auth middleware

  Diff Summary
  src/middleware/auth.ts        | +45 -0
  src/routes/login.ts           | +32 -2
  src/middleware/auth.test.ts   | +28 -0
  src/types/auth.ts             | +12 -0

  [View full diff: factory evidence --task T-001 --diff]
  [Approve: factory approve --task T-001]
  [Request changes: factory changes --task T-001 --feedback "..."]
```

### 4.5 Configuration

**XDG Base Directory spec:**
- User config: `~/.config/factory/config.toml` (or `$XDG_CONFIG_HOME/factory/`)
- Per-project: `.factory/config.toml` in repo root
- Environment variables: `FACTORY_API_KEY`, `FACTORY_API_URL`
- Flag override: `--api-key`, `--api-url`

**Precedence:** flags > env vars > project config > user config > defaults

**Format:** TOML (human-readable, well-typed, standard for developer tools).

### 4.6 Interactive Review

`@inquirer/prompts` (the modern, modular Inquirer.js) for `factory review --task T-001`:

```
factory review --task T-001

  [Evidence summary displayed]

  What would you like to do?
  > Approve (create PR)
    Request changes
    Reject
    View full diff
    View test details
    Skip (decide later)
```

Falls back to `--approve` / `--reject` / `--changes` flags for non-interactive use.

### 4.7 Accessibility

- `chalk` for color (respects `NO_COLOR` and `FORCE_COLOR` env vars)
- Detect `NO_COLOR` environment variable (https://no-color.org/) and disable color output
- `--no-color` flag as override
- Unicode symbols with ASCII fallbacks for non-unicode terminals
- Detect terminal capabilities (`TERM`, `COLORTERM`)
- Test with screen readers (some terminal outputs are read aloud)

---

## 5. Dashboard (Phase 2)

### 5.1 Real-Time Architecture: SSE over WebSocket

| Approach | Direction | Complexity | Best For |
|----------|-----------|------------|----------|
| **SSE (Server-Sent Events)** | Server -> Client only | Low | Read-heavy dashboards, monitoring |
| **WebSocket** | Bidirectional | Medium | Interactive features, commands |

**Recommendation:** SSE for the primary dashboard feed. The review inbox is primarily read-heavy (display evidence, show status updates). Commands (approve, reject, kill) go through the REST API. SSE is simpler, auto-reconnects, and works through proxies without special configuration.

SvelteKit 2.19+ has native WebSocket support for cases where bidirectional communication is needed (e.g., interactive terminal output).

**Browser limit: 6 SSE connections per domain** -- multiplex all event types into a single SSE connection.

### 5.2 SSE Endpoint Pattern

```typescript
// src/routes/api/events/+server.ts
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request }) => {
  const headers = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  };

  const stream = new ReadableStream({
    start(controller) {
      // Subscribe to Redis pub/sub
      const redisSub = createRedisSubscriber();
      redisSub.subscribe('factory:tasks', 'factory:system');

      redisSub.on('message', (channel, message) => {
        const chunk = `event: ${channel}\ndata: ${message}\n\n`;
        controller.enqueue(new TextEncoder().encode(chunk));
      });

      // Cleanup on disconnect
      request.signal.addEventListener('abort', () => {
        redisSub.unsubscribe();
        redisSub.quit();
        controller.close();
      });
    },
  });

  return new Response(stream, { headers });
};
```

### 5.3 Review Inbox Features

The PRD (R-019) specifies the review inbox as the primary dashboard view:

- Tasks awaiting review (`evidence_ready` state)
- Dual-boundary status: internal evidence vs. external merge readiness
- Task cards with summary: objective, blast radius, test results, cost
- Expand to full evidence view
- Action buttons: approve, request changes, reject
- Filter/sort by: urgency, age, repo, assignee

### 5.4 Shared Types via Monorepo

Since both backend and frontend are TypeScript, share types via a common package:

```
packages/
  shared/              # Shared types package
    src/
      types/
        task.ts        # Task, TaskStatus, TaskEvent
        evidence.ts    # EvidenceBundle, EvidenceField
        review.ts      # ReviewState, ReviewAction
        notification.ts
        api.ts         # API request/response types
```

Use npm workspaces or turborepo to share the types package between backend and frontend.

### 5.5 Authentication

Same API key auth as CLI (R-018). The dashboard sends the API key as a Bearer token in the Authorization header.

**For SSE:** Pass the API key as a **query parameter** (SSE `EventSource` API does not support custom headers from the browser):

```typescript
// Client-side
const eventSource = new EventSource(`/api/events?token=${apiKey}`);
```

Consider switching to **cookie-based sessions** for the dashboard to avoid exposing the API key in URLs.

---

## 6. Notifications

### 6.1 Channel Router Architecture

```
Event Source (Temporal Activity / API)
    |
    v
Notification Router
    |
    +-- Rate Limiter (per channel, per category)
    |
    +-- Channel: Slack Webhook
    +-- Channel: Discord Webhook (future)
    +-- Channel: Email (future)
    +-- Channel: Custom Webhook (future)
```

New channels are registered at startup. Each channel declares which categories it supports. The router fans out to all matching channels.

### 6.2 All 6 Notification Categories with Urgency Levels

| Category | Urgency | Default Delivery | Example |
|----------|---------|------------------|---------|
| **Blocked review** | Real-time | Immediate | "Task T-001 evidence ready for review" |
| **Circuit breaker trip** | Real-time | Immediate | "Kill switch activated: budget exceeded" |
| **External failure** | Real-time | Immediate | "Task T-001 blocked: required check failed" |
| **Cost warning** | Real-time | Immediate | "Task T-001 at 80% budget ($8.00/$10.00)" |
| **Task completion** | Normal | Batched (configurable) | "Task T-001 merged successfully" |
| **System health** | Normal | Batched | "Daily digest: 5 tasks completed, 1 failed" |

### 6.3 Slack Webhook Rate Limiting

**Rate limit:** 1 message per second per webhook URL. Slack returns HTTP 429 with `Retry-After` header on exceeding.

```typescript
class SlackWebhookNotifier implements SlackNotifier {
  private readonly webhookUrl: string;
  private readonly rateLimiter: RateLimiter; // token bucket, 1/sec

  async send(message: SlackMessage): Promise<void> {
    await this.rateLimiter.acquire();
    const response = await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    });

    if (response.status === 429) {
      const retryAfter = parseInt(response.headers.get('Retry-After') || '30');
      await delay(retryAfter * 1000);
      return this.send(message); // Retry once
    }
  }
}
```

**Full rate limiting strategy:**
- **Token bucket rate limiter:** 1 token per second per webhook URL
- **Exponential backoff with jitter** on HTTP 429
- **Message batching** for non-urgent categories: collect messages for 5 minutes, send as single digest
- **Deduplication:** Same notification within 60 seconds is suppressed (e.g., multiple budget warnings)
- **Dead-letter queue:** Messages that fail after 3 retries are logged to audit trail

### 6.4 Extensible Channel Interface

```typescript
interface NotificationChannel {
  readonly name: string;
  send(notification: Notification): Promise<void>;
  supports(category: NotificationCategory): boolean;
}

interface NotificationRouter {
  register(channel: NotificationChannel): void;
  notify(notification: Notification): Promise<void>;
}
```

---

## Sources

### GitHub
- https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest
- https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app
- https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app
- https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps
- https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app
- https://docs.github.com/en/rest/repos/rules
- https://docs.github.com/en/rest/orgs/rules
- https://docs.github.com/en/rest/branches/branch-protection
- https://docs.github.com/articles/about-code-owners
- https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue
- https://docs.github.com/en/webhooks/webhook-events-and-payloads
- https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
- https://docs.github.com/en/rest/checks/runs
- https://docs.github.com/en/rest/pulls/pulls
- https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
- https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api
- https://docs.github.com/en/rest/guides/using-the-rest-api-to-interact-with-your-git-database
- https://docs.github.com/en/authentication/managing-commit-signature-verification/about-commit-signature-verification
- https://docs.github.com/en/graphql/reference/mutations
- https://github.blog/changelog/2023-04-19-pull-request-merge-queue-public-beta-api-support-and-recent-fixes/
- https://github.com/orgs/community/discussions/24854
- https://github.com/orgs/community/discussions/24375
- https://github.com/orgs/community/discussions/24299
- https://github.com/octokit/auth-app.js/
- https://github.com/octokit/webhooks.js/
- https://www.npmjs.com/package/octokit

### LLM / OpenRouter
- https://openrouter.ai/docs/api/reference/overview
- https://openrouter.ai/docs/api/reference/streaming
- https://openrouter.ai/docs/api/reference/errors-and-debugging
- https://openrouter.ai/docs/api/reference/limits
- https://openrouter.ai/docs/api/api-reference/generations/get-generation
- https://openrouter.ai/docs/guides/routing/provider-selection
- https://openrouter.ai/docs/guides/best-practices/prompt-caching
- https://ai-sdk.dev/docs/introduction
- https://ai-sdk.dev/docs/agents/loop-control
- https://ai-sdk.dev/docs/ai-sdk-core/telemetry
- https://ai-sdk.dev/providers/community-providers/openrouter
- https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html
- https://www.anthropic.com/research/prompt-injection-defenses
- https://langfuse.com/docs/observability/overview
- https://arxiv.org/abs/2506.14852

### Code Indexing
- https://www.npmjs.com/package/tree-sitter
- https://github.com/tree-sitter/node-tree-sitter
- https://tree-sitter.github.io/tree-sitter/4-code-navigation.html
- https://tree-sitter.github.io/node-tree-sitter/classes/Parser.Query.html
- https://aider.chat/2023/10/22/repomap.html
- https://deepwiki.com/Aider-AI/aider/4.1-repository-mapping
- https://github.com/orgs/sheeptechnologies/discussions/4
- https://github.com/micromatch/picomatch
- https://github.com/pgvector/pgvector
- https://www.postgresql.org/docs/current/textsearch-intro.html

### CLI / Dashboard / Notifications
- https://oclif.io/
- https://sveltetalk.com/posts/building-real-time-sveltekit-apps-with-server-sent-events
- https://docs.slack.dev/apis/web-api/rate-limits/
- https://no-color.org/
