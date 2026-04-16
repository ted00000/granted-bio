# Granted.bio System Review

**Date:** April 16, 2026
**Scope:** Full codebase review across user types (Admin, Associate, Pro, Free)
**Focus:** Sign-up → Search → Report generation flow

---

## Executive Summary

The granted.bio platform is a well-architected biotech/life sciences search application with solid fundamentals. However, several issues across authentication, billing, UI/UX, and state management need attention to achieve best-in-class status.

### Overall Assessment

| Area | Grade | Summary |
|------|-------|---------|
| **Authentication** | B | Works well, but missing error feedback and profile creation safety |
| **Search & Quota** | B+ | Functional with good tier differentiation, minor date calculation bugs |
| **Report Generation** | B | Sophisticated multi-agent system, missing server-side role validation |
| **Billing/Stripe** | B | Complete integration, needs payment failure notifications |
| **UI/UX** | C+ | Functional but inconsistent, poor accessibility |
| **State Management** | C | No centralized state, duplicate fetches, potential race conditions |

---

## Critical Issues (Fix Immediately)

### 1. Admin/Associate Role Not Server-Validated for Reports
**Location:** `/src/app/api/reports/route.ts`
**Risk:** HIGH - Security vulnerability

The report generation bypass for admin/associate roles is only checked client-side. A malicious user could spoof the `canBypassPayment` state and generate reports without payment.

**Fix:** Add server-side role check before allowing payment bypass:
```typescript
// In POST /api/reports
const { data: profile } = await supabase
  .from('user_profiles')
  .select('role')
  .eq('id', user.id)
  .single()

const canBypassPayment = profile?.role === 'admin' || profile?.role === 'associate'
```

### 2. Payment Failure Silent - No User Notification
**Location:** `/src/app/api/stripe/webhook/route.ts`
**Risk:** HIGH - User experience

When `invoice.payment_failed` fires, the user is downgraded to `past_due` but never notified. They discover this only when a search fails with HTTP 402.

**Fix:** Implement email notification via Stripe or in-app alert system.

### 3. Search Race Condition
**Location:** `/src/components/Chat.tsx`
**Risk:** MEDIUM - Data integrity

Rapid consecutive searches can cause old results to appear as new ones. The `currentSearchId.current` check happens too late in the streaming process.

**Fix:** Abort controller pattern:
```typescript
const abortControllerRef = useRef<AbortController | null>(null)

const sendMessage = async () => {
  abortControllerRef.current?.abort()
  abortControllerRef.current = new AbortController()

  const response = await fetch('/api/chat', {
    signal: abortControllerRef.current.signal
  })
}
```

### 4. Monthly Reset Date Calculation Bug
**Location:** `/src/lib/billing/usage.ts` (lines 61, 92)
**Risk:** MEDIUM - Billing accuracy

Current code:
```typescript
const monthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate())
```

This fails for dates like Jan 31 → creates invalid "Feb 31".

**Fix:**
```typescript
const monthAgo = new Date()
monthAgo.setMonth(monthAgo.getMonth() - 1)
```

---

## High Priority Issues

### 5. No Centralized Auth State
**Locations:** `Header.tsx`, `Sidebar.tsx`, `ProjectPage.tsx`, `middleware.ts`

Each component independently fetches user profile and role, resulting in 3-4 duplicate queries per page load.

**Impact:**
- Increased latency
- Potential consistency issues if role changes mid-session
- Wasted database resources

**Fix:** Create `AuthContext` provider at app root.

### 6. Profile Creation Race Condition
**Location:** `supabase/migrations/20260331_fix_role_constraint.sql`

Database trigger creates profile AFTER auth user is created. If client queries before trigger executes, it fails silently. The trigger catches exceptions but returns success anyway.

**Fix:** Add profile existence check in auth callback with fallback creation.

### 7. Precision Filter Broken for Keyword Search
**Location:** `/src/components/Chat.tsx`

Precision filter (Focused/Balanced/Broad) only works with semantic search because keyword search doesn't return `similarity` scores.

**Impact:** Users switching to standard/keyword mode see precision buttons but they have no effect.

**Fix:** Either disable precision filter for keyword mode or compute relevance scores for keyword results.

### 8. Usage Data Becomes Stale
**Location:** `/src/components/Sidebar.tsx`

Usage indicator fetches once on mount and never updates. After a search, the sidebar still shows old count until page refresh.

**Fix:** Refetch after search or implement real-time subscription.

---

## Medium Priority Issues

### 9. Auth Errors Not Displayed to User
**Location:** `/src/app/api/auth/callback/route.ts`

Errors redirect to `/?error=auth_callback_error` but the homepage never displays this error.

### 10. Admin Tier Label Incorrect
**Location:** `/src/lib/billing/usage.ts` (line 51)

Admin returns `tier: 'pro'` instead of `tier: 'admin'`. This is cosmetic but misleading.

### 11. Portfolio Report Feature Incomplete
**Location:** `/src/lib/reports/generate.ts`

`generatePortfolioReport()` creates a record but has TODO comment and returns without generation. Users see perpetually "generating" status.

### 12. No Webhook Idempotency
**Location:** `/src/app/api/stripe/webhook/route.ts`

If Stripe retries webhook delivery, duplicate database updates could occur.

### 13. Subscription Counter Reset on Any Update
**Location:** `/src/app/api/stripe/webhook/route.ts` (lines 178-181)

Resets `searches_this_month: 0` whenever subscription status is 'active', including non-renewal updates like seat changes.

### 14. Type Casting Without Null Checks
**Location:** `/src/app/api/stripe/webhook/route.ts` (lines 85-86)

```typescript
const customerId = session.customer as string  // Could be null
```

---

## UI/UX Issues

### 15. Accessibility (WCAG Compliance)
- No ARIA labels on icon-only buttons (hamburger menu, close buttons)
- No `role="dialog"` or focus trap on modals
- No skip links for sidebar navigation
- No visible focus indicators
- Missing `aria-live` regions for dynamic content

### 16. Mobile Responsiveness
- Sidebar doesn't scroll properly on short screens
- Tables not responsive (no horizontal scroll or card view)
- Filter chips can overflow without indication

### 17. Inconsistent Error Handling
- Different error styles across pages (red-50, rose-50, various borders)
- Silent failures in non-critical paths (usage fetch, checkout errors)
- Generic "Failed" messages without recovery guidance

### 18. Loading State Issues
- No skeleton screens for perceived performance
- Slow search feedback (8-second indicator) implementation unclear
- No progress indication for report generation

### 19. Upgrade Prompt Gaps
- No warning before hitting search limit (only after)
- No inline upgrade during search when approaching limit
- Account page shows 80%+ warning but no prominent CTA

### 20. Inconsistent Lock/Badge Treatment
- PersonaSelector: Lock icon + "Premium" text
- Sidebar: "Premium" badge only
- Different visual treatment of same feature

---

## State Management Anti-Patterns

### 21. No Context Providers
The app has no React Context usage. All state is:
- Component-local (`useState`)
- Props drilling
- Independent Supabase fetches

Missing contexts:
- `AuthContext` - user, role, tier
- `UsageContext` - search quota
- `NotificationContext` - toasts/alerts

### 22. SessionStorage Limitations
- No cross-session persistence (results lost on refresh)
- Quota exceeded fallback drops all but last result
- Complex scroll restoration with multiple RAF/setTimeout hacks

### 23. No Data Fetching Library
No SWR, React Query, or TanStack Query:
- No automatic refetching
- No error retry logic
- No request deduplication
- No cache management

---

## User Journey Analysis by Type

### Free User Journey

1. **Sign Up:** Clean OAuth/magic link flow
2. **First Search:** Works well, sees 10 results limit
3. **Hit Limit:** Clear upgrade modal with pricing
4. **Upgrade Path:** Pricing page → Stripe checkout → Pro tier

**Issues:**
- No pre-warning before limit hit
- Usage indicator always visible (could feel naggy)
- No "what you're missing" preview on capped results

### Pro User Journey ($49/month)

1. **Sign Up + Upgrade:** Smooth Stripe integration
2. **Searching:** 500 searches, 200 results, full details
3. **Reports:** $99 per report (additional charge)
4. **Renewal:** Automatic, search counter resets

**Issues:**
- No renewal notification
- Current period end not updated on renewal in DB
- No "searches reset" messaging

### Associate User Journey (Partner billing)

1. **Account Setup:** Admin assigns role
2. **Searching:** 500 searches/month (same as Pro)
3. **Reports:** Can generate without payment
4. **Billing:** API usage tracked for cost billing

**Issues:**
- UI shows $99 report button before checking role
- No differentiation from Pro in search UI
- API usage tracking works but no visibility to user

### Admin User Journey

1. **Access:** Redirected to /admin after auth
2. **Searching:** Unlimited searches
3. **Reports:** Can generate without payment
4. **Admin Features:** User management, data upload, ETL

**Issues:**
- Tier shows as "Pro" not "Admin"
- Usage indicator bug (was showing "10/" in red) - FIXED
- No audit logging for role changes

---

## Recommendations by Priority

### Immediate (Security/Data Integrity)
1. Add server-side role validation for report bypass
2. Fix search race condition with abort controller
3. Fix monthly reset date calculation
4. Implement payment failure notifications

### High Priority (Core UX)
5. Create AuthContext for centralized state
6. Add profile existence check in auth callback
7. Fix or disable precision filter for keyword search
8. Add usage data refetching after search
9. Display auth errors to users

### Medium Priority (Polish)
10. Add ARIA labels and focus management
11. Implement skeleton loading screens
12. Standardize error components
13. Add webhook idempotency
14. Fix subscription counter reset logic

### Lower Priority (Nice to Have)
15. Add React Query for data fetching
16. Implement breadcrumb navigation
17. Add mobile-optimized table layouts
18. Create unified component library
19. Add retry logic for failed operations

---

## Code Quality Observations

### Strengths
- Clean Next.js 14 App Router structure
- Good separation of concerns (lib/, components/, app/)
- Consistent Tailwind usage
- Proper TypeScript typing
- Good error catching in critical paths
- Streaming responses for search

### Areas for Improvement
- No testing visible in codebase
- No Storybook or component documentation
- Inconsistent code formatting in places
- Some large components (Chat.tsx could be split)
- Duplicate code patterns across components

---

## Conclusion

Granted.bio is a functional, well-designed application that needs refinement to reach best-in-class status. The core search and report generation features work well, but the supporting infrastructure (auth state, error handling, accessibility) needs attention.

**Priority Focus:**
1. Fix the 4 critical security/data issues immediately
2. Implement centralized auth state to reduce DB load and improve consistency
3. Improve accessibility to meet WCAG AA standards
4. Add proper loading and error feedback throughout

The foundation is solid - these improvements will elevate the product significantly.
