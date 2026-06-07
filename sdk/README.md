# @luxdb/sdk

Official TypeScript SDK for Lux.

Use the project client for browser, server, and SSR app code. Use the direct client when you want low-level Redis-compatible access to a Lux instance.

## Install

```bash
bun i @luxdb/sdk
```

## Browser app client

Use a publishable key in browser code. The browser client persists auth sessions in browser storage by default.

```ts
import { createBrowserClient } from "@luxdb/sdk";

const lux = createBrowserClient(
  "https://api.luxdb.dev/v1/my-project",
  "lux_pub_..."
);

const { data: session, error } = await lux.auth.signInWithPassword({
  email: "user@example.com",
  password: "correct horse battery staple",
});

if (error) throw error;
```

## Tables

Queries and mutations return a Supabase-style result object:

```ts
const { data: users, error } = await lux
  .table<{ id: number; email: string; age: number }>("users")
  .select()
  .gt("age", 25)
  .order("age", { ascending: false })
  .limit(10);

if (error) throw error;
console.log(users);
```

```ts
const { data: inserted, error: insertError } = await lux
  .table("messages")
  .insert({ body: "hello", channel: "general" });

const { data: updated, error: updateError } = await lux
  .table("messages")
  .update({ body: "edited" })
  .eq("id", inserted?.id);

const { data: deleted, error: deleteError } = await lux
  .table("messages")
  .delete()
  .eq("id", inserted?.id);
```

## OAuth

```ts
const { data, error } = await lux.auth.signInWithOAuth({
  provider: "google",
  redirectTo: "https://app.example.com/auth/callback",
});

if (error) throw error;
```

On your callback page:

```ts
const { data, error } = await lux.auth.consumeOAuthRedirect();

if (error) throw error;
console.log(data.user);
```

## Server client

Use a secret key only from trusted server code.

```ts
import { createClient } from "@luxdb/sdk";

const admin = createClient(
  "https://api.luxdb.dev/v1/my-project",
  process.env.LUX_SECRET_KEY!
);

const { data: users, error } = await admin.auth.listUsers();
```

## SSR client

Use `createServerClient` with your framework's cookie methods to persist sessions on the server.

```ts
import { createServerClient } from "@luxdb/sdk";

const lux = createServerClient(
  "https://api.luxdb.dev/v1/my-project",
  "lux_pub_...",
  { cookies }
);
```

## Direct Lux/Redis-compatible access

Use direct access for trusted infrastructure that needs RESP commands, low-level primitives, or compatibility with Redis workflows. Do not ship database passwords to browsers.

```ts
import Lux from "@luxdb/sdk";

const lux = new Lux("lux://:password@localhost:6379");

await lux.set("hello", "world");
const value = await lux.get("hello");
```

## Access model

- `lux_pub_...` keys are safe for browser app calls.
- `lux_sec_...` keys are server-only.
- User sessions issue JWT access tokens.
- Direct `lux://` or `rediss://` database access uses the database password and is for trusted infrastructure.
