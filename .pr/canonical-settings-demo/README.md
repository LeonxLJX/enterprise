# Canonical settings PM demo

This demo registers a new non-secret settings section once, then renders it from the same SDK schema in Agent Canvas and Enterprise.

## Pull these branches

1. **SDK + Agent Server** — [`OpenHands/software-agent-sdk#6134`](https://github.com/OpenHands/software-agent-sdk/pull/6134), branch `prototype/canonical-settings-document`
2. **Agent Canvas** — [`OpenHands/OpenHands#18778`](https://github.com/OpenHands/OpenHands/pull/18778), branch `prototype/canonical-settings-canvas`
3. **Enterprise** — branch `prototype/canonical-settings-live-demo` in `OpenHands/enterprise`

Install each repository normally (`uv sync` for the SDK workspace; `npm ci` in the Canvas root and `enterprise/frontend`).

## Run in this order

Use four terminals. Keep the Agent Server running while using both UIs.

### 1. Agent Server — port 3000

From `software-agent-sdk`:

```bash
rm -f /tmp/openhands-settings-demo-schema.json
env -u SESSION_API_KEY -u OH_SESSION_API_KEYS_0 \
  OH_SETTINGS_SCHEMA_OVERLAY=/tmp/openhands-settings-demo-schema.json \
  uv run python -m openhands.agent_server --host 127.0.0.1 --port 3000
```

The explicit `env -u` makes this local demo server header-free. Do not use that setup for a shared or production server.

### 2. Agent Canvas — port 9000

From `OpenHands`:

```bash
VITE_BACKEND_HOST=127.0.0.1:3000 \
VITE_FRONTEND_PORT=9000 \
npm run dev:frontend -- --port 9000 --host 127.0.0.1
```

On first use, Canvas asks for a backend:

1. Set **Host Name** to `Settings demo`.
2. Set **Host URL** to `http://127.0.0.1:3000`; leave the API key empty.
3. Click **Next**, select **OpenHands**, click **Next**, then **Skip for now** on the optional LLM setup.

### 3. Enterprise mock SaaS — port 10000

From `enterprise/frontend`:

```bash
npm run dev:mock:saas -- --port 10000 --host 127.0.0.1
```

Mock SaaS supplies the organization/admin/member flows and forwards canonical settings calls to the Agent Server on port 3000.

### 4. JSON prototype — port 11000

From `enterprise/.pr/canonical-settings-demo`:

```bash
python3 -m http.server 11000 --bind 127.0.0.1
```

Open <http://127.0.0.1:11000>.

## Experience the flow

1. In the prototype, edit the JSON section or fields. Keep field keys under `product.*`; plaintext secret fields are intentionally rejected.
2. Click **Commit settings**. Both default fields should report success.
3. Click **Open in Agent Canvas**. Within about one second, the new section appears as its own Settings navigation item and schema-rendered form.
4. Click **Open in Enterprise**. The same section and fields appear on a standalone page, with organization/personal tabs and `locked`, `replace`, `subset`, and `extend` hierarchy choices.
5. Change a hierarchy choice. Its selected state should update immediately and persist in the mock organization policy.

## View Enterprise as a member

1. Keep the original Enterprise tab open as the admin.
2. Open **Settings → Members** (`/settings/org-members`) and click **Add Members**.
3. Enter any new email, keep role **Member**, and click **Add**.
4. In the generated invitation result, click **Open in New Tab**.
5. The new tab automatically accepts the invitation and becomes the member identity; the original tab remains admin.
6. In the member tab, open `http://127.0.0.1:10000/settings/document/<section-key>` (the default is `product.prototype`).

Expected member behavior:

- No hierarchy picker.
- `locked` and `subset`: effective organization values are read-only.
- `extend` and `replace`: personal values can be edited.
- **Clear personal overrides** returns the section to inherited organization values.

Use `127.0.0.1` consistently in every tab so browser storage and the mock invitation flow share one origin.
