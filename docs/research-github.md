# Research: GitHub Apps and API for Software Factory Control Plane

**Date:** 2026-03-18
**Question:** What GitHub App capabilities, API endpoints, and patterns does the software factory need to implement the control plane described in the PRD (v5.1)?

---

## 1. GitHub App Setup

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
- All three steps must complete within 1 hour
- Manifest JSON parameters: `name`, `url`, `hook_attributes` (webhook URL + active), `redirect_url`, `callback_urls` (up to 10), `setup_url`, `description`, `public` (boolean), `default_events` (array), `default_permissions` (object)

**Source:** https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest

**Recommendation for the factory:** Provide a manifest-flow onboarding command (`factory setup github-app`) that walks the operator through the manifest flow, automatically configures permissions and events, and stores the returned credentials (encrypted in Postgres per R-005/R-019). Manual registration documented as fallback.

### 1.2 Required Permissions

The factory needs these GitHub App permissions. Each permission can be scoped down per-token at installation token creation time.

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

**Source:** https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps, https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app

### 1.3 JWT Creation (App Authentication)

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

**Source:** https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app

### 1.4 Installation Token Minting

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

**PRD alignment (R-005):** Broker rotates at ~50 minutes. Per-phase permission scoping:

| Task Phase | Permissions Needed |
|-----------|-------------------|
| Capability scan | `contents:read`, `administration:read`, `checks:read` |
| Implementation (push to candidate branch) | `contents:write`, `checks:write` |
| PR creation | `contents:write`, `pull_requests:write` |
| PR tracking | `pull_requests:read`, `checks:read`, `statuses:read` |
| Merge queue enqueue | `contents:write`, `pull_requests:write` (via GraphQL) |

**Source:** https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app

### 1.5 Webhook Configuration

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

**Note on `merge_group`:** Available on **app webhooks only** (not repo or org webhooks). Requires `merge_queues:read` permission.

**Note on `pull_request_review` vs `pull_request_review_comment`:** The PRD (Section 6.1, step 11a) specifies waiting for **submitted reviews**, not individual comments. The `pull_request_review.submitted` event fires when a reviewer submits a full review (approve/request-changes/comment). Individual `pull_request_review_comment.created` events fire per inline comment. The factory should use `submitted` as the trigger for feedback iteration.

**Source:** https://docs.github.com/en/webhooks/webhook-events-and-payloads

---

## 2. Repo Capability Scan

### 2.1 Branch Protection Rules (Legacy API)

**Endpoint:** `GET /repos/{owner}/{repo}/branches/{branch}/protection`

**Permission:** `administration:read`

**Returns:**
- `required_status_checks` -- `strict` (require up-to-date), `contexts` (deprecated), `checks` (array of `{context, app_id}`)
- `required_pull_request_reviews` -- `dismiss_stale_reviews`, `require_code_owner_reviews`, `required_approving_review_count` (0-6), dismissal restrictions
- `enforce_admins` -- whether admins are also bound
- `restrictions` -- push restrictions (users, teams, apps)
- `required_signatures` -- whether signed commits required

**Important:** This is the **legacy** branch protection API. GitHub is migrating to **rulesets**. Both should be queried during capability scan since repos may use either or both.

**Source:** https://docs.github.com/en/rest/branches/branch-protection

### 2.2 Repository Rulesets

**Endpoints:**
- `GET /repos/{owner}/{repo}/rulesets` -- list all repo rulesets
- `GET /repos/{owner}/{repo}/rulesets?includes_parents=true` -- **include org/enterprise inherited rulesets**
- `GET /repos/{owner}/{repo}/rulesets/{ruleset_id}` -- get specific ruleset
- `GET /repos/{owner}/{repo}/rules/branches/{branch}` -- get **all active rules** for a specific branch (merged view)

**Rule types the factory must detect and handle:**

| Rule Type | Factory Impact |
|-----------|---------------|
| `required_status_checks` | Factory must submit its check run before it can be required. Bootstrap flow needed. |
| `pull_request` | Mandates PR workflow, required reviewers, dismiss stale reviews |
| `required_signatures` | Commits must have verified signatures. See Section 2.8. |
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

**Bypass actors:**
- `bypass_actors` property on rulesets defines who can bypass rules
- Actor types: `Integration` (GitHub App), `OrganizationAdmin`, `RepositoryRole`, `Team`, `DeployKey`
- Bypass modes: `always`, `pull_request` (bypass on PRs only)
- The factory's GitHub App can be configured as a bypass actor (actor type: `Integration`)
- **Only returned to users with write access** to prevent information disclosure

**Source:** https://docs.github.com/en/rest/repos/rules

### 2.3 Organization Rulesets

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

**Source:** https://docs.github.com/en/rest/orgs/rules

### 2.4 CODEOWNERS

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

**Source:** https://docs.github.com/articles/about-code-owners

### 2.5 Merge Queue Configuration

Merge queue configuration is managed via branch protection / rulesets, not a separate API. Detection:

1. Check if `merge_queue` rule type exists in rulesets for the target branch
2. Configuration options (via UI/rulesets): batch size (1-100 min/max), timeout, merge method (merge/rebase/squash), build concurrency (1-100)
3. Merge queue creates temporary branches named `{base_branch}/pr-{number}` (or `gh-readonly-queue/{base_branch}/...` for non-Actions CI)

**CI integration requirement:** When merge queue is active, CI must be configured to trigger on `merge_group` events. For GitHub Actions, add `merge_group` to workflow triggers. For third-party CI, trigger on branches matching `gh-readonly-queue/{base_branch}/*`.

**Source:** https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue

### 2.6 Required Status Checks Bootstrap

**Problem:** A check cannot be selected as "required" in branch protection until it has been **submitted at least once** on the repository. The factory's check run must be bootstrapped.

**Bootstrap flow:**
1. Factory creates a check run on any commit: `POST /repos/{owner}/{repo}/check-runs` with `name: "software-factory"`, `head_sha: <any_commit>`, `status: "completed"`, `conclusion: "success"`
2. Once created, the check name appears in the branch protection required checks selector
3. Operator can then configure it as required
4. The factory's scan guides the user through this process

**Required-check binding:** In rulesets, `required_status_checks` can specify `app_id` to bind a check to a specific GitHub App. Setting `app_id: -1` allows any app to provide the check.

### 2.7 OIDC Trust Policies (Detection Only)

**Approach:** Query deployment environments via `GET /repos/{owner}/{repo}/environments` to detect environment protection rules. If environments use OIDC claims tied to specific workflow refs, the factory surfaces a warning during scan (factory-initiated runs will not carry the expected claims).

This is a **detection-only** feature for V1 per PRD Section 4.4 and 6.3.

### 2.8 Signed Commit Requirements

**Detection:** Check for `required_signatures` in branch protection or rulesets.

**GitHub App commit signing behavior:**
- Commits made via the API by a GitHub App are automatically signed **only if** the request contains no custom author, committer, or signature information
- The commit is signed by GitHub using the app's identity
- This means the factory can create verified commits by using the Git Database API without custom committer overrides

**Bypass actors:** The factory's GitHub App can be configured as a bypass actor for the `required_signatures` rule in rulesets. Per PRD: repos requiring signed commits **without** a validated bypass path are marked unsupported in V1.

**Source:** https://docs.github.com/en/authentication/managing-commit-signature-verification/about-commit-signature-verification

---

## 3. PR Lifecycle Management

### 3.1 Creating Pull Requests

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

### 3.2 Updating PR State

**Endpoint:** `PATCH /repos/{owner}/{repo}/pulls/{pull_number}`

**Updatable parameters:**
- `title`, `body` -- Update content
- `state` -- `open` or `closed`
- `base` -- Change target branch
- `draft` -- `true` to convert to draft, `false` to mark ready for review
- `maintainer_can_modify` -- Toggle maintainer access

### 3.3 Requesting Reviews

**Endpoint:** `POST /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers`

**Body:** `{ "reviewers": ["username1"], "team_reviewers": ["team-slug1"] }`

**Note:** CODEOWNERS automatically requests reviewers when the PR is created/marked ready. The factory should track which reviewers were auto-requested vs. manually requested.

### 3.4 Check Runs (Factory Validation Status)

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
  - `annotations` -- Array of file-level annotations (max 50 per request):
    - `path`, `start_line`, `end_line`, `annotation_level` (`notice`/`warning`/`failure`), `message`
  - `images` -- Array of `{alt, image_url, caption}`
- `actions` -- Up to 3 action buttons (label, identifier, description)

**Update:** `PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}`

**Critical:** Only GitHub Apps can create/update check runs. OAuth apps and PATs cannot.

**Annotation limits:** Max 50 annotations per API request. GitHub Actions: 10 warnings and 10 errors per step.

**Check run limit:** Max 1000 check runs with the same name per check suite. Older ones auto-deleted.

**Source:** https://docs.github.com/en/rest/checks/runs

### 3.5 Merge Queue Interaction

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

**Alternative: enable auto-merge (will auto-enqueue when checks pass):**
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

**Source:** https://github.blog/changelog/2023-04-19-pull-request-merge-queue-public-beta-api-support-and-recent-fixes/

### 3.6 Merging (Non-Queue Path)

**Endpoint:** `PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge`

**Parameters:**
- `merge_method` -- `merge`, `squash`, or `rebase`
- `commit_title` -- Custom merge commit title
- `commit_message` -- Custom merge commit message
- `sha` -- Expected HEAD SHA (safety check -- merge fails if PR head has changed)

### 3.7 Stale Review Detection

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

**Source:** https://github.com/orgs/community/discussions/24375, https://github.com/orgs/community/discussions/24299

### 3.8 Review Thread Tracking

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

**Source:** https://github.com/orgs/community/discussions/24854

### 3.9 Review Dismissal Detection

**Webhook:** `pull_request_review.dismissed` event fires when a review is dismissed.

**Payload includes:** The `review` object with the dismissed review details and `pull_request` context.

**Factory response:** Re-route -- surface in dashboard as "review dismissed, re-request needed" or automatically re-request review depending on policy.

---

## 4. Webhook Handling

### 4.1 Signature Verification

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

**Source:** https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries

### 4.2 Event-to-State Mapping

This maps webhook events to the factory's `ReviewState` entity (per PRD Section 5.3):

| Webhook Event | Factory State Update |
|--------------|---------------------|
| `pull_request.opened` | Task -> `pr_created` |
| `pull_request.synchronize` | New commits pushed; may invalidate reviews |
| `pull_request.closed` (merged=true) | Task -> `merged` |
| `pull_request.closed` (merged=false) | Task -> `failed` (or manual close) |
| `pull_request.enqueued` | Task -> merge queue entered |
| `pull_request.dequeued` | Task -> merge queue exited (check reason) |
| `pull_request_review.submitted` (changes_requested) | Task -> `addressing_review_feedback` trigger |
| `pull_request_review.submitted` (approved) | Update ReviewState approval count |
| `pull_request_review.dismissed` | Update ReviewState, may need re-request |
| `check_run.completed` | Update external check status tracking |
| `check_suite.completed` | Update aggregate check suite status |
| `merge_group.checks_requested` | Factory must run checks on merge group HEAD |
| `merge_group.destroyed` | Merge group resolved (success or failure) |
| `push` (to agent branch by non-factory actor) | Pause task, notify operator (per PRD 6.4) |
| `installation.deleted` / `installation.suspend` | Disable factory for affected repos |

### 4.3 Webhook-Driven State Sync + Periodic Reconciliation

**Webhook-driven (primary):** Real-time state updates from events listed above. Low latency, low API usage.

**Periodic reconciliation (secondary):** Cron-based reads to catch missed webhooks or drift:

| What to Reconcile | API Call | Frequency |
|-------------------|----------|-----------|
| PR merge status | `GET /repos/{owner}/{repo}/pulls/{pull_number}` | Every 5 minutes for active PRs |
| Review decision | GraphQL `pullRequest.reviewDecision` | Every 5 minutes for active PRs |
| Unresolved threads | GraphQL `pullRequest.reviewThreads` | Every 5 minutes for active PRs |
| Check run status | `GET /repos/{owner}/{repo}/commits/{ref}/check-runs` | Every 5 minutes for pending PRs |
| Branch protection changes | `GET /repos/{owner}/{repo}/branches/{branch}/protection` | Every 30 minutes or on config change |
| Ruleset changes | `GET /repos/{owner}/{repo}/rulesets?includes_parents=true` | Every 30 minutes |

**Use conditional requests (ETags)** for reconciliation to avoid rate limit consumption (304 responses don't count against primary rate limit).

---

## 5. Rate Limiting and Best Practices

### 5.1 Rate Limits

**Installation access tokens (primary):**
- GitHub.com: **5,000 requests/hour** base
- Scales: +50 req/hr per repository (>20 repos) and per user (>20 users), capped at 12,500
- GitHub Enterprise Cloud: **15,000 requests/hour**

**Secondary rate limits:**
- Max **100 concurrent requests** across REST + GraphQL
- **900 points/minute** per REST endpoint
- **80 content-creating requests/minute**, 500/hour
- CPU time: 90 seconds per 60 seconds real time

**GraphQL rate limits (separate):**
- Queries: 1 point each
- Mutations: 5 points each
- Secondary: 2,000 points/minute

**Response headers:**

| Header | Purpose |
|--------|---------|
| `x-ratelimit-limit` | Max requests per hour |
| `x-ratelimit-remaining` | Remaining in current window |
| `x-ratelimit-used` | Used in current window |
| `x-ratelimit-reset` | UTC epoch seconds when window resets |
| `x-ratelimit-resource` | Rate limit bucket name |

**Source:** https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api

### 5.2 Best Practices

1. **Prefer webhooks over polling.** Subscribe to events instead of polling API endpoints.
2. **Use conditional requests (ETags).** Include `If-None-Match` with stored ETag. 304 responses don't count against rate limit (when authorized).
3. **Use Link header pagination.** Never construct pagination URLs manually.
4. **Serialize mutating requests.** Wait at least 1 second between POST/PATCH/PUT/DELETE requests. Queue system recommended.
5. **Handle rate limit errors correctly:**
   - 403 with rate limit headers: primary limit hit. Wait until `x-ratelimit-reset`.
   - 429: secondary limit hit. Check `retry-after` header first, then `x-ratelimit-reset`, then wait at least 1 minute.
   - Use exponential backoff for persistent secondary limit failures.
6. **Batch GraphQL queries** to reduce request count (one GraphQL request can fetch multiple resources).
7. **Track usage per-token** -- the factory should log rate limit headers to detect approaching limits.

**Source:** https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api

---

## 6. Octokit Library Ecosystem

### 6.1 Core Packages

| Package | Purpose | Key Feature |
|---------|---------|-------------|
| `octokit` | All-in-one SDK (REST + GraphQL + Auth + Webhooks) | Single import for everything |
| `@octokit/rest` | REST API client with typed methods | `octokit.rest.pulls.create(...)` |
| `@octokit/auth-app` | GitHub App auth (JWT + installation tokens) | Automatic token caching and refresh |
| `@octokit/webhooks` | Webhook event handling + signature verification | Typed event handlers, middleware |
| `@octokit/graphql` | GraphQL client | Typed queries |
| `@octokit/webhooks-types` | TypeScript types for webhook payloads | v7.6.1+ |

### 6.2 @octokit/auth-app Usage

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

### 6.3 @octokit/webhooks Usage

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

### 6.4 TypeScript Configuration

**Required tsconfig.json settings:**
```json
{
  "compilerOptions": {
    "moduleResolution": "node16",
    "module": "node16"
  }
}
```

These are needed because Octokit packages use conditional exports.

---

## 7. Git Operations via API

### 7.1 Creating Branches

**Create a branch (ref):**
```
POST /repos/{owner}/{repo}/git/refs
{
  "ref": "refs/heads/factory/task-T-001",
  "sha": "<base_commit_sha>"
}
```

**Permission:** `contents:write`

### 7.2 Pushing Commits (Git Database API)

The factory will primarily push via `git push` from the sandbox. However, for lightweight operations (updating a file, creating metadata commits), the Git Database API is available:

1. **Get current commit:** `GET /repos/{owner}/{repo}/git/ref/heads/{branch}` -> commit SHA
2. **Get tree:** `GET /repos/{owner}/{repo}/git/commits/{sha}` -> tree SHA
3. **Create blob:** `POST /repos/{owner}/{repo}/git/blobs` with `{content, encoding}`
4. **Create tree:** `POST /repos/{owner}/{repo}/git/trees` with `{base_tree, tree: [{path, mode, type, sha}]}`
5. **Create commit:** `POST /repos/{owner}/{repo}/git/commits` with `{message, tree, parents: [parent_sha]}`
6. **Update ref:** `PATCH /repos/{owner}/{repo}/git/refs/heads/{branch}` with `{sha: new_commit_sha}`

**Commit signing:** Commits created via this API are automatically signed by GitHub as the App identity **if and only if** no custom author/committer/signature information is provided. This satisfies `required_signatures` rules without needing the factory to manage GPG keys.

**Important:** These operations must be serialized -- concurrent writes conflict and produce errors.

### 7.3 Branch Naming Convention

The factory should use a predictable branch naming pattern that:
- Satisfies `branch_name_pattern` rulesets (detected during capability scan)
- Is clearly identifiable as factory-managed
- Supports the "one active mutator per branch" rule (PRD Section 6.4)

Suggested pattern: `factory/{task-id}` or `factory/{task-id}/{attempt}` (configurable).

---

## 8. Implementation Recommendations

### 8.1 Credential Broker Architecture

```
CredentialBroker
  |
  +-- AppAuth (JWT, 10-min lifetime)
  |     Used for: listing installations, creating installation tokens
  |
  +-- InstallationTokenCache (Map<installationId+scope, {token, expiresAt}>)
  |     Uses @octokit/auth-app internal caching (toad-cache, 15k entries)
  |     Factory adds: 50-minute rotation timer per active token
  |
  +-- TokenFactory(taskPhase) -> scoped installation token
        Maps task phase to minimal permission set
        Logs token creation in audit trail
```

### 8.2 Capability Scan Sequence

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

### 8.3 REST vs. GraphQL Decision Matrix

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

### 8.4 Error Handling Strategy

| Error Type | Response |
|-----------|----------|
| 401 Unauthorized | Token expired -- rotate immediately |
| 403 Rate limit | Check headers, wait, retry with backoff |
| 403 Permission denied | Log, surface to operator (permission may need upgrade) |
| 404 Not found | Resource may have been deleted; reconcile state |
| 409 Conflict | Concurrent modification; retry with fresh state |
| 422 Validation failed | Parse error message; common for push rule violations |
| 429 Secondary rate limit | Check `retry-after`, exponential backoff |

---

## 9. Gaps and Open Questions

### 9.1 Identified Gaps

1. **No REST API for merge queue enqueue/dequeue.** Must use GraphQL. This means the factory needs both REST and GraphQL clients.
2. **No REST API for unresolved review thread count.** Must use GraphQL.
3. **`reviewDecision` has no timestamps.** Stale review detection requires correlating webhook events with GraphQL state. Cannot query "when did this review become stale?"
4. **CODEOWNERS parsing is client-side.** No API returns "these are the owners for this set of changed files." The factory must implement gitignore-style pattern matching.
5. **Installation token expiry is not configurable.** Always 1 hour. The factory must implement its own rotation schedule (~50 minutes per PRD R-005).
6. **`merge_group` events are app-webhook-only.** Cannot be received via repo or org webhooks. The factory's GitHub App must have a webhook endpoint.
7. **Check run annotations limited to 50 per request.** For large evidence packets, may need multiple update calls.

### 9.2 Key Design Decisions for Planning

1. **Octokit wrapper vs. thin client:** Recommend using `@octokit/auth-app` for auth and `@octokit/webhooks` for webhook handling (they handle the hard parts -- JWT, token caching, signature verification). Use `@octokit/graphql` for GraphQL calls. Wrap in a factory-specific `GitHubClient` interface for testability.
2. **Webhook delivery guarantees:** GitHub does not guarantee exactly-once delivery. The factory must handle duplicate events idempotently (use `X-GitHub-Delivery` header as idempotency key).
3. **API version pinning:** Use `X-GitHub-Api-Version` header. Current latest: `2026-03-10`. Pin to a specific version and update explicitly.
4. **Rate limit budget:** With 5,000 req/hr base, a single active task doing capability scan + PR lifecycle + reconciliation should use <100 req/hr. Multiple concurrent tasks could approach limits. Budget tracking per-installation recommended.

---

## 10. Files Referenced

- `/Users/seanflanagan/proj/software-factory/docs/prd.md` -- PRD v5.1, Sections 5.3 (ReviewState), 6.1 (workflow), 6.3 (GitHub-native integration), 6.4 (concurrency), R-004, R-005
- `/Users/seanflanagan/proj/software-factory/.claude/plans/research.md` -- Prior research on Temporal vs. Postgres

## 11. External Sources Consulted

- https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest (manifest flow)
- https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app (JWT creation)
- https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app (installation tokens)
- https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps (permission matrix)
- https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app (permission selection)
- https://docs.github.com/en/rest/repos/rules (repository rulesets API)
- https://docs.github.com/en/rest/orgs/rules (organization rulesets API)
- https://docs.github.com/en/rest/branches/branch-protection (legacy branch protection API)
- https://docs.github.com/articles/about-code-owners (CODEOWNERS format and behavior)
- https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue (merge queue)
- https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/incorporating-changes-from-a-pull-request/merging-a-pull-request-with-a-merge-queue (merge queue PR flow)
- https://docs.github.com/en/webhooks/webhook-events-and-payloads (webhook events)
- https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries (signature verification)
- https://docs.github.com/en/rest/checks/runs (check runs API)
- https://docs.github.com/en/rest/pulls/pulls (pull requests API)
- https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api (rate limits)
- https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api (best practices)
- https://docs.github.com/en/rest/guides/using-the-rest-api-to-interact-with-your-git-database (Git Database API)
- https://docs.github.com/en/authentication/managing-commit-signature-verification/about-commit-signature-verification (commit signing)
- https://docs.github.com/en/graphql/reference/mutations (GraphQL mutations for merge queue, auto-merge, check runs, reviews)
- https://github.blog/changelog/2023-04-19-pull-request-merge-queue-public-beta-api-support-and-recent-fixes/ (merge queue API support)
- https://github.com/orgs/community/discussions/24854 (GraphQL review thread resolution)
- https://github.com/orgs/community/discussions/24375 (reviewDecision null states)
- https://github.com/orgs/community/discussions/24299 (mergeable_state values)
- https://github.com/octokit/auth-app.js/ (@octokit/auth-app documentation)
- https://github.com/octokit/webhooks.js/ (@octokit/webhooks documentation)
- https://www.npmjs.com/package/octokit (Octokit SDK)
