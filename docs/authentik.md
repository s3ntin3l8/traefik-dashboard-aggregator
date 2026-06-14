# Putting traefik-viewer behind authentik (forward auth)

traefik-viewer has **no built-in authentication** — by design. The blessed way
to require a login (with full OIDC, MFA, etc.) is to front it with
[authentik](https://goauthentik.io/) in **forward-auth** mode: Traefik calls the
authentik outpost on every request, the outpost runs the entire login/OIDC flow,
and only authenticated requests ever reach the app.

The app itself enforces nothing. It only **reads the identity headers** authentik
injects and shows "signed in as …" plus a logout link in the sidebar — purely
cosmetic. authentik (at the edge) remains the sole access-control point.

> Because of that, two deployment rules below are **load-bearing for security**,
> not optional hardening. Read the *Security model* section.

---

## 1. Create the authentik provider + application

In the authentik admin UI:

1. **Providers → Create → Proxy Provider**
   - **Authorization flow:** your usual implicit/explicit consent flow.
   - **Mode:** **Forward auth (single application)**.
   - **External host:** `https://traefik-viewer.example.com` (the URL users hit).
2. **Applications → Create**, bind it to that provider, and assign the
   users/groups allowed in.
3. Make sure an **outpost** (the embedded one is fine) has this provider
   assigned. Note the outpost's address as Traefik will reach it, e.g.
   `http://authentik-server:9000` on your Docker network.

authentik will inject these request headers once a user is authenticated (the
app reads `username`, `email`, `name`, `groups`):

```
X-authentik-username   X-authentik-email   X-authentik-name   X-authentik-groups
X-authentik-uid        X-authentik-jwt     X-authentik-entitlements   X-authentik-meta-*
```

The logout link points at authentik's outpost sign-out endpoint
`/outpost.goauthentik.io/sign_out` (configurable via `server.signOutPath`, see
below).

---

## 2. Traefik dynamic config

Two pieces are required: the **forwardAuth middleware**, and a **router that
sends `/outpost.goauthentik.io/` to the authentik outpost** (without it, both the
login redirect and the logout link break).

### a) forwardAuth middleware

File-provider form:

```yaml
http:
  middlewares:
    authentik:
      forwardAuth:
        address: "http://authentik-server:9000/outpost.goauthentik.io/auth/traefik"
        trustForwardHeader: true
        authResponseHeaders:
          - X-authentik-username
          - X-authentik-email
          - X-authentik-name
          - X-authentik-groups
          - X-authentik-uid
          - X-authentik-jwt

    # Strip any client-supplied identity headers BEFORE they reach the app or the
    # forwardAuth call, so a client can't spoof an identity. See "Security model".
    strip-identity:
      headers:
        customRequestHeaders:
          X-authentik-username: ""
          X-authentik-email: ""
          X-authentik-name: ""
          X-authentik-groups: ""
          X-authentik-uid: ""
          X-authentik-jwt: ""
          X-Forwarded-User: ""
```

### b) Route the outpost path + protect the app

Docker labels on the traefik-viewer service (the commented forward-auth block
in `compose.yaml`):

```yaml
labels:
  traefik.enable: "true"

  # The app router, protected by authentik. Strip first, then auth.
  traefik.http.routers.traefik-viewer.rule: "Host(`traefik-viewer.example.com`)"
  traefik.http.routers.traefik-viewer.entrypoints: "websecure"
  traefik.http.routers.traefik-viewer.tls: "true"
  traefik.http.routers.traefik-viewer.middlewares: "strip-identity@file,authentik@file"
  traefik.http.services.traefik-viewer.loadbalancer.server.port: "8080"

  # Higher-priority router sending the outpost path to authentik (NOT to the app).
  traefik.http.routers.traefik-viewer-outpost.rule: "Host(`traefik-viewer.example.com`) && PathPrefix(`/outpost.goauthentik.io/`)"
  traefik.http.routers.traefik-viewer-outpost.entrypoints: "websecure"
  traefik.http.routers.traefik-viewer-outpost.tls: "true"
  traefik.http.routers.traefik-viewer-outpost.service: "authentik"   # your authentik outpost service
```

(If authentik runs in a separate compose project, define the `authentik` service
reference / load-balancer in your authentik stack instead and only keep the app
router + middleware here.)

---

## 3. Security model — why two rules are load-bearing

The app does **no authorization** of its own. The injected headers only change
the displayed name. That is safe **only if both** of these hold:

1. **The app's `:8080` is never directly reachable.** It must only be reachable
   through Traefik. `compose.yaml` already attaches it to the external `proxy`
   network and publishes **no host port** — keep it that way. If you expose
   `:8080` directly, the whole app is open, because the app authenticates
   nobody.
2. **The edge strips client-supplied `X-authentik-*` / `X-Forwarded-*`
   headers** (the `strip-identity` middleware above, ordered *before* the
   `authentik` middleware). Otherwise a client could send
   `X-authentik-username: admin` and the UI would display it. It grants no
   access — but don't let spoofed identity show up at all.

Even with a spoofed header an attacker gains **no privilege** (the app makes no
access decisions), but rule #1 is what actually keeps the data private.

**Never** add app-side authorization based on `X-authentik-groups` and assume
it's trustworthy unless rule #2 is enforced. The app deliberately doesn't.

---

## 4. Programmatic / API access (monitoring, automation)

Forward auth protects the whole app — the SPA at `/` and every `/api/*` endpoint
alike. A browser authenticates interactively and the SPA then calls the API with
the resulting session cookie. A non-interactive client (a monitoring poller, a
script, another service) can't follow that redirect flow — but it doesn't need a
second auth system carved out of the app: authentik's outpost **accepts
non-interactive credentials on the same host**, so the API stays behind the one
enforcement point.

> Don't move `/api/*` onto a separate basic-auth router instead. The browser SPA
> calls those same endpoints (`/api/snapshot`, `/api/events`, `/api/me`, …) with
> its forward-auth cookie, so splitting them out would break the UI.

The `strip-identity` middleware strips inbound `X-authentik-*` headers but **not**
`Authorization`, so the credentials below pass straight through to the outpost.

The two options below are the **same OAuth2 machine-to-machine
(`client_credentials`) flow underneath** — they differ only in who runs the token
exchange and what travels on the wire. (a) is the least code; (b) gives you a
short-lived token and keeps the long-lived secret off the proxied app.

### a) HTTP Basic with a service account (simplest)

Create a service account in authentik (**Directory → Users**, type *Service
account*) with an **app password** (**Directory → Tokens & App passwords**) and
grant it access to **the application that gates this host** (in domain-level mode
that's the domain-level application — see *Scoping* below). Then:

```sh
curl -u "$SVC_USER:$SVC_APP_PASSWORD" \
     -c cookies.txt -b cookies.txt \
     https://traefik-viewer.example.com/api/snapshot
```

The password **must** be an authentik *app password* — the outpost uses it
internally for the OAuth2 machine-to-machine flow, so an ordinary login password
won't work.

### b) Bearer JWT (explicit token lifetime)

Mint a JWT with the `client_credentials` grant against the **proxy provider's**
`client_id` (shown on the provider in the admin UI — the token must be issued
*for* that provider), then send it as a Bearer token:

```sh
ACCESS_TOKEN=$(curl -s -X POST https://authentik.example.com/application/o/token/ \
    -d grant_type=client_credentials \
    -d client_id="$PROXY_PROVIDER_CLIENT_ID" \
    -d username="$SVC_USER" \
    -d password="$SVC_APP_PASSWORD" \
    -d scope=openid | jq -r .access_token)

curl -H "Authorization: Bearer $ACCESS_TOKEN" \
     -c cookies.txt -b cookies.txt \
     https://traefik-viewer.example.com/api/snapshot
```

Unlike (a), your client mints the JWT itself and the long-lived app password only
ever reaches authentik's token endpoint — never the proxied app — so you control
the token's lifetime and rotation. Refresh it before it expires. For a client that
can only send HTTP Basic but already holds a JWT, pass it as Basic with the
reserved username `goauthentik.io/token` and the JWT as the password.

> **Domain-level forward auth:** there is only one proxy provider for the whole
> domain, so `PROXY_PROVIDER_CLIENT_ID` is the **domain-level** provider's
> `client_id` (the JWT must be issued for that provider). The credential is then
> **domain-scoped**, not app-scoped — see *Scoping to a single app* below.

### Notes for long-running consumers

- **Persist the outpost cookies** (`-c`/`-b` above, or a cookie jar in your
  client). Without them every request re-runs the full auth flow against
  authentik — needless load for a poller, and worse on SSE reconnects.
- **SSE works the same way:** `/api/events` and `/api/logs/tail` are long-lived
  GETs that carry the credential like any other request; the persisted session
  keeps reconnections cheap.
- The proxy provider may need the chosen method enabled. See authentik's
  [header authentication](https://docs.goauthentik.io/add-secure-apps/providers/proxy/header_authentication/)
  and [client credentials](https://docs.goauthentik.io/add-secure-apps/providers/oauth2/client_credentials/)
  docs for the provider-side toggles.

### Scoping a credential to just this app

authentik checks the **policies bound to the application being accessed**, so in
**single-application** mode you scope a credential by binding the service account
(or a group it's in) to the traefik-viewer application and nothing else — standard
least privilege.

**Domain-level mode is different — and it's a real limitation.** With one proxy
provider for the whole domain, authentik
[cannot enforce per-application access](https://docs.goauthentik.io/add-secure-apps/providers/proxy/forward_auth/):
*"You cannot restrict individual applications to different users with separate
application-level policies."* Authorization is shared across the domain, so any
credential that passes the domain-level application's policy can reach **every**
app under that domain — it is domain-scoped, not traefik-viewer-scoped. To actually
restrict it to this app, pick one:

- **Carve out a single-application provider for traefik-viewer.** Add a *Forward
  auth (single application)* proxy provider + application for traefik-viewer's host,
  with its own policy/group bindings limited to the service-account's group, and
  route that host (and its `/outpost.goauthentik.io/` path) to that provider while
  the rest of the domain stays domain-level. Now the credential is gated by
  traefik-viewer's own bindings = true per-app scope. The JWT in (b) is then issued
  for this single-app provider's `client_id`.
- **Or accept domain-wide reach** and limit blast radius by other means: a
  least-privilege service account, a short-lived app password, and network
  restrictions. authentik won't enforce "this app only" in pure domain mode.

---

## 5. Customizing / disabling the logout link

`server.signOutPath` in `config.yaml` controls the sidebar logout link:

```yaml
server:
  signOutPath: /outpost.goauthentik.io/sign_out   # default (authentik single-app mode)
  # signOutPath: ""                                # set empty to hide the logout link
```

- Default (field unset): authentik's outpost sign-out path.
- **Domain-level** authentik mode: point it at the auth host, e.g.
  `https://auth.example.com/outpost.goauthentik.io/sign_out`.
- Non-authentik proxy: set it to that proxy's logout URL, or `""` to hide it.

The link only renders when an identity header is actually present, so local dev
(no proxy) shows nothing.

---

## 6. Optional: authentik enrichment in the UI

Independently of being *fronted* by authentik, traefik-viewer can query the
authentik API (read-only) to annotate what it shows: a router protected by an
authentik forward-auth middleware gets an **Authentik** section in its detail
drawer (application, provider, outpost, proxy mode), and the middleware itself
is badged `authentik` in the tables and the request chain.

1. In authentik: **Directory → Tokens → Create** (intent **API**), ideally
   bound to a dedicated service account with read-only permissions.
2. In `.env` (gitignored — `compose.yaml` loads it via `env_file`):

   ```sh
   AUTHENTIK_URL=https://authentik.example.com   # API base (serves /api/v3/)
   AUTHENTIK_TOKEN=...
   ```

3. In `config.yaml`:

   ```yaml
   authentik:
     url: ${AUTHENTIK_URL:-}
     token: ${AUTHENTIK_TOKEN:-}
     # insecureSkipVerify: true           # self-signed API cert only
   ```

How matching works (mirrors authentik's own routing): the forward-auth
middleware only signals *authentik* (its address path contains
`outpost.goauthentik.io`); the application is resolved from the **router's
host** against the proxy provider's **external host** (single-app mode, exact
match) or **cookie domain** (domain mode, longest suffix). `chain` middlewares
— like the `strip-identity` + `authentik` chain above — are resolved
transitively. Routers whose host matches no provider still get the badge on
the middleware, just no application attribution.

The provider list is refreshed at most once per minute; on API errors the
last-good data is kept and the Traefik poll is unaffected. Leave `url`/`token`
empty to disable the feature entirely (no authentik calls are made).

## Notes

- authentik **2025.12.5 / 2026.2.3** dropped the non-standard `X-Original-Uri`
  header in favour of `X-Original-Url`; if you run a third-party Traefik
  authentik plugin (rather than the forwardAuth middleware above), update it.
- This is the same delegation model the project's README "Security" section
  mandates — authentik is just one concrete, well-supported choice. Any
  forward-auth proxy (oauth2-proxy, Cloudflare Access, etc.) works the same way;
  adjust the header names and `signOutPath` accordingly.
