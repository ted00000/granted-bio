# Bug: Navigation Broken After Search

## Status: RESOLVED

## Root Cause
The `isSbirSttr` helper function in Chat.tsx was defined without `useCallback`, but was used as a dependency in a `useEffect`. This caused an infinite re-render loop after search results arrived, blocking all click events.

**Introduced in:** Commit 7e3762e (March 5) - "Move precision filter to results header"
**Fixed in:** Commit c289e00 - Wrapped `isSbirSttr` in `useCallback`

## Symptoms

1. **After doing a People (bd) or Trials search**, all navigation stops working:
   - Links in search results don't navigate
   - Sidebar navigation links don't work
   - Hover effects show, but clicks do nothing

2. **If user leaves and returns to page**, it shows blank:
   - Example URL: `https://www.granted.bio/chat?persona=researcher`
   - Page is completely blank
   - Refreshing doesn't fix it

3. **What still works:**
   - Logout button worked (user could sign out and back in)
   - Auth flow works normally

## Environment

- Browser: Safari (user showed viewport warning in console)
- Platform: Production (Vercel + Supabase)
- Both Vercel and Supabase show healthy status

## What We Checked (No Issues Found)

1. **Chat.tsx click handlers** - `navigateToProject`, `navigateToTrial` look correct
2. **Sidebar.tsx** - Link components and onClick handlers look correct
3. **CSS pointer-events** - No blocking styles found
4. **Overlays/z-index** - No invisible overlays blocking clicks
5. **Console errors** - Only harmless "viewport argument key 'interactive-widget' not recognized"
6. **Middleware** - Standard auth redirects, nothing blocking navigation
7. **Recent git changes** - Chat.tsx not modified in recent commits (precision filter was last change)

## Files Examined

- `src/components/Chat.tsx` - Main chat with results rendering
- `src/components/Sidebar.tsx` - Navigation sidebar
- `src/components/AppLayout.tsx` - Layout wrapper
- `src/app/chat/page.tsx` - Chat page
- `src/app/globals.css` - Global styles
- `src/app/layout.tsx` - Root layout with viewport config
- `src/middleware.ts` - Auth middleware

## Key Observations

1. **Issue happens after search, not on page load** - Fresh login works, search breaks navigation
2. **Affects both custom onClick AND Next.js Link components** - Something fundamental is breaking
3. **Hover works, click doesn't** - DOM is rendered, but events not firing
4. **Blank page persists after refresh** - Something stored (sessionStorage/localStorage?) causing crash on reload

## Theories (Unconfirmed)

1. **SessionStorage corruption** - Large search results stored, causes crash on restore
2. **React event system broken** - Render error corrupting event delegation
3. **Safari-specific bug** - Something with touch-action or viewport settings
4. **Hydration mismatch** - SSR/client mismatch breaking event handlers

## Debugging Steps to Try

1. **Clear browser storage:**
   ```javascript
   sessionStorage.clear()
   localStorage.clear()
   location.reload()
   ```

2. **Test in Chrome/Firefox** - See if Safari-specific

3. **Test locally vs production** - `npm run dev` to compare behavior

4. **Add console.log to click handlers** - See if events fire at all

5. **Check React DevTools** - Look for errors in component tree

## Files That Might Be Relevant

- `src/components/Chat.tsx:1188-1230` - navigateToProject/navigateToTrial save to sessionStorage
- `src/components/Chat.tsx:1086-1116` - sessionStorage restoration on mount
- `src/app/globals.css:27-30` - touch-action: manipulation (iOS double-tap prevention)

## Changes Made and Reverted

1. **Reverted:** Added try-catch around sessionStorage.setItem (commit 97eb444, reverted in 0bea895)
   - Reason for revert: Was guessing, not confirmed root cause

## Next Steps

1. Reproduce issue with console open to catch any errors
2. Determine if issue is Safari-specific
3. Check if clearing sessionStorage/localStorage fixes the blank page
4. Add logging to understand if click events fire at all
