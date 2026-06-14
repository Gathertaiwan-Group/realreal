# Prompt Localization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make all prompt-class text (form validation, backend/Supabase errors, toasts) default to Traditional Chinese; show English only when the visitor's browser language is primarily English.

**Architecture:** No i18n framework. A tiny `resolveLocale()` maps a language string → `'zh-Hant' | 'en'`. A small message dictionary + `t()` holds prompt strings in both locales. The shared `ui/input` component is enhanced once to localize browser-native HTML5 validation bubbles via `setCustomValidity` (fixes all ~18 forms). A `translateError()` maps known Supabase/API English errors to localized strings. Locale comes from `Accept-Language` (server) / `navigator.language` (client) via a React context.

**Tech Stack:** Next.js 15 (App Router, pinned), TypeScript, React, vitest. Work in `apps/web`. Verify per task with `cd apps/web && npx tsc --noEmit -p tsconfig.json` + `npx eslint <files>` + `npx vitest run <test>`. Use repo-root `node_modules/.bin` if workspace stubs error.

**Scope guardrail (YAGNI):** Only prompt/validation/error text. Do NOT translate product/blog content, do NOT add an i18n library, do NOT add IP geolocation.

---

### Task 1: Locale resolver

**Files:**
- Create: `apps/web/src/lib/locale.ts`
- Test: `apps/web/src/lib/__tests__/locale.test.ts`

**Step 1: Write failing test**
```ts
import { describe, it, expect } from "vitest"
import { resolveLocale, type Locale } from "../locale"

describe("resolveLocale", () => {
  it("returns en for English language tags", () => {
    expect(resolveLocale("en-US,zh;q=0.8")).toBe("en")
    expect(resolveLocale("en")).toBe("en")
    expect(resolveLocale("EN-GB")).toBe("en")
  })
  it("defaults to zh-Hant for everything else", () => {
    expect(resolveLocale("zh-TW")).toBe("zh-Hant")
    expect(resolveLocale("ja-JP")).toBe("zh-Hant")
    expect(resolveLocale(null)).toBe("zh-Hant")
    expect(resolveLocale(undefined)).toBe("zh-Hant")
    expect(resolveLocale("")).toBe("zh-Hant")
  })
})
```

**Step 2:** Run `npx vitest run src/lib/__tests__/locale.test.ts` → FAIL (module not found).

**Step 3: Implement**
```ts
// apps/web/src/lib/locale.ts
export type Locale = "zh-Hant" | "en"
export const DEFAULT_LOCALE: Locale = "zh-Hant"

/** Map an Accept-Language header or navigator.language to our supported locale.
 *  Only the primary (first, highest-q) tag matters: en-* => en, else zh-Hant. */
export function resolveLocale(input: string | null | undefined): Locale {
  if (!input) return DEFAULT_LOCALE
  const primary = input.split(",")[0]?.trim().toLowerCase() ?? ""
  return primary.startsWith("en") ? "en" : DEFAULT_LOCALE
}
```

**Step 4:** Run test → PASS.

**Step 5: Commit**
```bash
git add apps/web/src/lib/locale.ts apps/web/src/lib/__tests__/locale.test.ts
git commit -m "feat(i18n): locale resolver (en for English browsers, else zh-Hant)"
```

---

### Task 2: Message dictionary + `t()`

**Files:**
- Create: `apps/web/src/lib/messages.ts`
- Test: `apps/web/src/lib/__tests__/messages.test.ts`

**Step 1: Failing test**
```ts
import { describe, it, expect } from "vitest"
import { t } from "../messages"

describe("t", () => {
  it("returns zh-Hant by default with params", () => {
    expect(t("validation.tooShort", "zh-Hant", { n: 8 })).toBe("請至少輸入 8 個字元")
    expect(t("validation.required", "zh-Hant")).toBe("此欄位為必填")
  })
  it("returns en for en locale", () => {
    expect(t("validation.tooShort", "en", { n: 8 })).toContain("8")
    expect(t("validation.required", "en")).toMatch(/required/i)
  })
  it("falls back to the key if missing", () => {
    expect(t("nope.nope" as never, "zh-Hant")).toBe("nope.nope")
  })
})
```

**Step 2:** Run → FAIL.

**Step 3: Implement** (start with the validation + common-error keys; more added in Task 7/9)
```ts
// apps/web/src/lib/messages.ts
import type { Locale } from "./locale"

type Params = Record<string, string | number>
type Entry = string | ((p: Params) => string)

const DICT: Record<Locale, Record<string, Entry>> = {
  "zh-Hant": {
    "validation.required": "此欄位為必填",
    "validation.email": "請輸入有效的 Email",
    "validation.tooShort": (p) => `請至少輸入 ${p.n} 個字元`,
    "validation.tooLong": (p) => `請勿超過 ${p.n} 個字元`,
    "validation.pattern": "格式不正確",
    "validation.number": "請輸入數字",
    "error.generic": "發生錯誤，請稍後再試",
  },
  en: {
    "validation.required": "This field is required",
    "validation.email": "Please enter a valid email address",
    "validation.tooShort": (p) => `Please use at least ${p.n} characters`,
    "validation.tooLong": (p) => `Please use at most ${p.n} characters`,
    "validation.pattern": "Invalid format",
    "validation.number": "Please enter a number",
    "error.generic": "Something went wrong, please try again",
  },
}

export function t(key: string, locale: Locale, params: Params = {}): string {
  const entry = DICT[locale]?.[key] ?? DICT["zh-Hant"]?.[key]
  if (entry == null) return key
  return typeof entry === "function" ? entry(params) : entry
}

export { DICT }
```

**Step 4:** Run → PASS.

**Step 5: Commit** `feat(i18n): prompt message dictionary + t()`.

---

### Task 3: Locale context (client) + server reader

**Files:**
- Create: `apps/web/src/lib/locale-context.tsx`

**Step 1: Implement** (no test — thin wiring; covered indirectly)
```tsx
// apps/web/src/lib/locale-context.tsx
"use client"
import { createContext, useContext } from "react"
import { DEFAULT_LOCALE, type Locale } from "./locale"

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE)

export function LocaleProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>
}

/** Safe outside a provider: returns DEFAULT_LOCALE. */
export function useLocale(): Locale {
  return useContext(LocaleContext)
}
```

**Step 2:** `npx tsc --noEmit -p tsconfig.json` → 0 errors.

**Step 3: Commit** `feat(i18n): locale context provider + useLocale`.

---

### Task 4: Wire locale into the root layout

**Files:**
- Modify: `apps/web/src/app/layout.tsx` (RootLayout: read Accept-Language, set `<html lang>`, wrap in `LocaleProvider`)

**Step 1: Implement.** Read the file first. At the top of `RootLayout`, before/after the existing supabase call, add:
```ts
import { headers } from "next/headers"
import { resolveLocale } from "@/lib/locale"
import { LocaleProvider } from "@/lib/locale-context"
// ...
const locale = resolveLocale((await headers()).get("accept-language"))
```
Then set the root element `lang` to `locale === "en" ? "en" : "zh-Hant"` (find the `<html ...>` tag in this file — if it lives in this file, edit its `lang`; the page currently hardcodes zh) and wrap the existing `children`/shell tree in `<LocaleProvider locale={locale}>…</LocaleProvider>`.

**Step 2:** `npx tsc --noEmit -p tsconfig.json` + `npx eslint src/app/layout.tsx` → clean. (Note: this repo's Next is pinned/non-standard — confirm `headers()` is async here as used elsewhere, e.g. `supabase/server.ts`.)

**Step 3: Commit** `feat(i18n): provide browser locale from root layout`.

---

### Task 5: Pure validation-message function

**Files:**
- Create: `apps/web/src/lib/validation-message.ts`
- Test: `apps/web/src/lib/__tests__/validation-message.test.ts`

**Step 1: Failing test** (pure fn; no DOM needed)
```ts
import { describe, it, expect } from "vitest"
import { messageForValidity } from "../validation-message"

const v = (o: Partial<ValidityState>): ValidityState => ({
  valueMissing: false, typeMismatch: false, tooShort: false, tooLong: false,
  patternMismatch: false, badInput: false, rangeOverflow: false, rangeUnderflow: false,
  stepMismatch: false, customError: false, valid: false, ...o,
} as ValidityState)

describe("messageForValidity", () => {
  it("required (zh-Hant)", () =>
    expect(messageForValidity(v({ valueMissing: true }), {}, "zh-Hant")).toBe("此欄位為必填"))
  it("email (zh-Hant)", () =>
    expect(messageForValidity(v({ typeMismatch: true }), { type: "email" }, "zh-Hant")).toBe("請輸入有效的 Email"))
  it("tooShort uses minLength (zh-Hant)", () =>
    expect(messageForValidity(v({ tooShort: true }), { minLength: 8 }, "zh-Hant")).toBe("請至少輸入 8 個字元"))
  it("tooShort (en)", () =>
    expect(messageForValidity(v({ tooShort: true }), { minLength: 8 }, "en")).toContain("8"))
  it("valid returns empty string", () =>
    expect(messageForValidity(v({ valid: true }), {}, "zh-Hant")).toBe(""))
})
```

**Step 2:** Run → FAIL.

**Step 3: Implement**
```ts
// apps/web/src/lib/validation-message.ts
import type { Locale } from "./locale"
import { t } from "./messages"

export interface FieldAttrs { type?: string; minLength?: number; maxLength?: number }

/** Map a field's ValidityState to a localized message. "" when valid. */
export function messageForValidity(validity: ValidityState, attrs: FieldAttrs, locale: Locale): string {
  if (validity.valid) return ""
  if (validity.valueMissing) return t("validation.required", locale)
  if (validity.typeMismatch) return t(attrs.type === "email" ? "validation.email" : "validation.pattern", locale)
  if (validity.tooShort) return t("validation.tooShort", locale, { n: attrs.minLength ?? 0 })
  if (validity.tooLong) return t("validation.tooLong", locale, { n: attrs.maxLength ?? 0 })
  if (validity.patternMismatch) return t("validation.pattern", locale)
  if (validity.badInput) return t("validation.number", locale)
  return t("validation.pattern", locale)
}
```

**Step 4:** Run → PASS.

**Step 5: Commit** `feat(i18n): pure validation-message mapper`.

---

### Task 6: Enhance shared `ui/input` to localize native validation

**Files:**
- Modify: `apps/web/src/components/ui/input.tsx`

**Step 1: Implement.** Make Input call `messageForValidity` on `onInvalid` and clear on `onInput`, using `useLocale()`. Preserve any caller-supplied `onInvalid`/`onInput`.
```tsx
"use client"
import * as React from "react"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/locale-context"
import { messageForValidity } from "@/lib/validation-message"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, onInvalid, onInput, ...props }, ref) => {
    const locale = useLocale()
    return (
      <input
        type={type}
        onInvalid={(e) => {
          const el = e.currentTarget
          el.setCustomValidity(messageForValidity(el.validity, { type, minLength: el.minLength || undefined, maxLength: el.maxLength || undefined }, locale))
          onInvalid?.(e)
        }}
        onInput={(e) => {
          e.currentTarget.setCustomValidity("")
          onInput?.(e)
        }}
        className={cn("flex h-10 w-full rounded-[10px] border border-gray-300 bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#10305a] focus-visible:border-[#10305a] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm", className)}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"
export { Input }
```
Note: adding `"use client"` — confirm no server component imports `Input` for SSR-only use (it's an interactive form input; safe). `el.minLength`/`maxLength` are `-1` when unset → coerce falsy to `undefined`.

**Step 2:** `npx tsc --noEmit -p tsconfig.json` + `npx eslint src/components/ui/input.tsx` → clean. Run the full web suite `npx vitest run` → existing tests still pass (Input is used by tested components; if any test renders Input outside a LocaleProvider, `useLocale` safely returns the default — no failure expected).

**Step 3: Commit** `feat(i18n): localize browser-native validation in shared Input`.

---

### Task 7: `translateError` for backend/Supabase messages

**Files:**
- Create: `apps/web/src/lib/translate-error.ts`
- Test: `apps/web/src/lib/__tests__/translate-error.test.ts`
- Add keys to `messages.ts` (`error.invalidLogin`, `error.userExists`, `error.emailNotConfirmed`, `error.weakPassword`, `error.rateLimited`, …) in both locales.

**Step 1: Failing test**
```ts
import { describe, it, expect } from "vitest"
import { translateError } from "../translate-error"

describe("translateError", () => {
  it("maps known Supabase auth errors (zh-Hant)", () => {
    expect(translateError("Invalid login credentials", "zh-Hant")).toBe("Email 或密碼錯誤")
    expect(translateError("User already registered", "zh-Hant")).toMatch(/已註冊|已存在/)
  })
  it("maps known errors (en)", () => {
    expect(translateError("Invalid login credentials", "en")).toMatch(/email|password/i)
  })
  it("returns generic localized message for unknown errors (no English leak)", () => {
    expect(translateError("pq: deadlock detected xyz", "zh-Hant")).toBe("發生錯誤，請稍後再試")
  })
})
```

**Step 2:** Run → FAIL.

**Step 3: Implement** (substring match against known patterns → message key; unknown → `error.generic`)
```ts
// apps/web/src/lib/translate-error.ts
import type { Locale } from "./locale"
import { t } from "./messages"

const MAP: Array<[RegExp, string]> = [
  [/invalid login credentials/i, "error.invalidLogin"],
  [/already registered|already exists/i, "error.userExists"],
  [/email not confirmed/i, "error.emailNotConfirmed"],
  [/password should be at least|weak password/i, "error.weakPassword"],
  [/rate limit|too many requests/i, "error.rateLimited"],
]

export function translateError(message: string | null | undefined, locale: Locale): string {
  if (!message) return t("error.generic", locale)
  const hit = MAP.find(([re]) => re.test(message))
  return t(hit ? hit[1] : "error.generic", locale)
}
```
Add the matching `error.*` keys to `messages.ts` DICT (both locales).

**Step 4:** Run → PASS.

**Step 5: Commit** `feat(i18n): translateError for Supabase/API messages`.

---

### Task 8: Apply `translateError` at error-display points

**Files:**
- Modify: `apps/web/src/app/auth/actions.ts` (lines ~31, 65, 92, 112: `return { error: error.message }`)
- Audit + modify other server actions / client toasts that surface raw `error.message` (e.g. admin `[id]/actions.ts`, checkout). Grep: `grep -rn "error.message\|err.message" apps/web/src`.

**Step 1: Implement (auth/actions.ts).** These are server actions → get locale from headers:
```ts
import { headers } from "next/headers"
import { resolveLocale } from "@/lib/locale"
import { translateError } from "@/lib/translate-error"
// in each action, replace `return { error: error.message }` with:
const locale = resolveLocale((await headers()).get("accept-language"))
return { error: translateError(error.message, locale) }
```
For client-side toasts that show `error.message`, read locale via `useLocale()` and wrap with `translateError`.

**Step 2:** Update `apps/web/src/app/auth/__tests__/actions.test.ts` expectations that asserted raw English error strings (e.g. the "Invalid credentials" passthrough) to the localized value. `npx vitest run src/app/auth/__tests__/actions.test.ts` → PASS.

**Step 3:** `npx tsc --noEmit -p tsconfig.json` + eslint changed files → clean.

**Step 4: Commit** `feat(i18n): localize Supabase/API error messages at display points`.

---

### Task 9: Audit residual English prompts

**Files:** various (web only)

**Step 1:** Grep for English user-facing strings in prompt contexts:
`grep -rnE "toast\.(error|success|info)\(\"[A-Za-z]" apps/web/src` and scan `alert(`, hardcoded English in form helper text. For each real leak, add a key to `messages.ts` and replace with `t(key, useLocale())` (client) or the server-locale equivalent.

**Step 2:** Keep this surgical — only prompt/validation/error text. Do NOT touch product/blog content. List anything ambiguous for the reviewer instead of guessing.

**Step 3:** `npx tsc --noEmit -p tsconfig.json` + `npx vitest run` + eslint → all clean.

**Step 4: Commit** `feat(i18n): localize remaining English prompt strings`.

---

### Task 10: Final verification

**Step 1:** `cd apps/web && npx tsc --noEmit -p tsconfig.json` → 0 errors.
**Step 2:** `npx vitest run` → all pass.
**Step 3:** `npx eslint` on every file created/changed → clean.
**Step 4:** Manual check notes for reviewer (cannot fully automate browser-native bubbles): with browser language = English, the register password bubble should now read the English custom message; with zh-TW, it reads「請至少輸入 8 個字元」. Document this as a manual QA step.
**Step 5: Commit** any final fixups. Push.

---

## Notes / risks
- **Pinned Next.js**: confirm `headers()` async usage matches `supabase/server.ts`; read `node_modules/next/dist/docs` if an API differs.
- **`"use client"` on Input**: it's already only used in interactive forms — safe. If a purely-server render of Input exists, it will still render (client component renders on server too); the `onInvalid` logic only runs in the browser.
- **`useLocale` default**: returns `zh-Hant` outside a provider, so admin pages / tests without the provider degrade gracefully to Chinese.
- Browser-native validation bubbles can't be unit-tested through jsdom reliably — that's why the logic lives in the pure `messageForValidity` (fully tested) and the component only wires it.
