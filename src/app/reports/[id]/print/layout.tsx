/**
 * Print-route layout. The parent root layout wraps everything in
 * AuthProvider + GoogleAnalytics; we don't want either on a print
 * document. This nested layout renders the children raw so the print
 * page controls the entire visible tree.
 *
 * Note: this is not a "new root layout" — Next.js allows only one root
 * per project. The parent's <html>/<body> still owns the outer chrome.
 * We just short-circuit the nav/auth wrappers.
 */

export default function PrintLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <>{children}</>
}
