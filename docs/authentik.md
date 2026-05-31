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

## 4. Customizing / disabling the logout link

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

## Notes

- authentik **2025.12.5 / 2026.2.3** dropped the non-standard `X-Original-Uri`
  header in favour of `X-Original-Url`; if you run a third-party Traefik
  authentik plugin (rather than the forwardAuth middleware above), update it.
- This is the same delegation model the project's README "Security" section
  mandates — authentik is just one concrete, well-supported choice. Any
  forward-auth proxy (oauth2-proxy, Cloudflare Access, etc.) works the same way;
  adjust the header names and `signOutPath` accordingly.
