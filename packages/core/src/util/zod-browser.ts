import { z } from "zod";

// In a browser, Zod parses without compiling. When a schema is created it
// tests whether new Function() works, and compiled parsers use it, but the web
// app's Content-Security-Policy doesn't allow eval: each use was a violation
// report, and would be blocked once the policy is enforced. Modules that
// create schemas import this first, so it runs before any schema exists.
// globalThis, not window: core also compiles without the DOM types (the CLI).
if ("window" in globalThis) z.config({ jitless: true });
