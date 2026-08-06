'use client'

import { useState } from 'react'
import { X, AlertTriangle, Loader2, FlaskConical, TrendingUp, CreditCard, Sparkles, Telescope, Compass, Globe } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'

type Persona = 'researcher' | 'investor'
type Step = 'input' | 'interpreting' | 'choose-interpretation' | 'confirm' | 'purchasing' | 'generating'

interface Interpretation {
  id: 'narrow' | 'standard' | 'broad'
  label: string
  description: string
  semanticQuery: string
  keywordQuery: string
  // Populated by the enhanced interpret-topic endpoint: empirical project
  // yield for the interpretation's semanticQuery. Null when the count
  // lookup failed (rare). Displayed as a badge on each card so users
  // pick with data instead of picking blind.
  projectCount: number | null
}

interface GenerateReportDialogProps {
  onClose: () => void
  onGenerated: () => void
  /**
   * Pre-fill the topic field when the dialog opens. Used when a user lands
   * on /reports from an in-platform CTA (e.g., the inline "Generate the
   * intelligence report" prompt on /chat search results) carrying their
   * just-searched topic. Falls back to empty string when not supplied.
   */
  initialTopic?: string
}

export function GenerateReportDialog({
  onClose,
  onGenerated,
  initialTopic,
}: GenerateReportDialogProps) {
  const [topic, setTopic] = useState(initialTopic ?? '')
  const [persona, setPersona] = useState<Persona>('researcher')
  const [step, setStep] = useState<Step>('input')
  const [projectCount, setProjectCount] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [interpretations, setInterpretations] = useState<Interpretation[]>([])
  const [selectedInterpretation, setSelectedInterpretation] = useState<Interpretation | null>(null)
  // Second-pass critique + recommendation returned alongside interpretations.
  // Both are best-effort: the endpoint may return either as null if the
  // critique call fails; the UI simply hides those sections.
  const [critique, setCritique] = useState<string | null>(null)
  const [recommendedId, setRecommendedId] = useState<'narrow' | 'standard' | 'broad' | null>(null)

  const { isAdmin, profile } = useAuth()

  // Active beta gets free reports up to a lifetime cap of 3
  const isActiveBeta =
    profile?.tier === 'beta' &&
    !!profile.betaExpiresAt &&
    new Date(profile.betaExpiresAt) > new Date()
  const BETA_REPORT_CAP = 3
  const reportsUsed = profile?.reportsGenerated ?? 0
  const reportsRemaining = Math.max(0, BETA_REPORT_CAP - reportsUsed)
  const betaCapReached = isActiveBeta && reportsUsed >= BETA_REPORT_CAP

  // Associates get expanded search but NOT free report generation —
  // they pay like regular users. Only admins and active beta users
  // (within the cap) bypass payment. Server-side check at
  // /api/reports re-enforces this; the client copy of the flag is
  // cosmetic (it just decides whether to show "Purchase Anyway -
  // $199" vs "Generate Anyway").
  const canBypassPayment = isAdmin || (isActiveBeta && !betaCapReached)

  // Step 1: Fetch 3 scoped interpretations, their empirical project counts,
  // and a Claude critique + recommendation. Persona is included so the
  // critique reasons in the right frame (researcher vs investor). No credit
  // is deducted; this is the pre-flight preview.
  const fetchInterpretations = async () => {
    if (!topic.trim()) return

    setStep('interpreting')
    setError(null)
    setCritique(null)
    setRecommendedId(null)

    try {
      const response = await fetch('/api/reports/interpret-topic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: topic.trim(), persona }),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to interpret topic')
      }
      setInterpretations(data.interpretations)
      setCritique(data.critique ?? null)
      setRecommendedId(data.recommendedId ?? null)
      setStep('choose-interpretation')
    } catch (e) {
      console.error('Error fetching interpretations:', e)
      setError(e instanceof Error ? e.message : 'Failed to interpret topic')
      setStep('input')
    }
  }

  // Step 2: User picked an interpretation. Count is already known from the
  // preview response — no /check-topic round-trip. Route directly to
  // limited-data confirm (< 5), direct generation (admin/beta), or purchase.
  const selectInterpretation = async (interp: Interpretation) => {
    setSelectedInterpretation(interp)
    const count = interp.projectCount ?? 0
    setProjectCount(count)
    setError(null)

    if (count < 5) {
      setStep('confirm')
    } else if (canBypassPayment) {
      await generateReportDirect(false, interp)
    } else {
      await purchaseReport(false, interp)
    }
  }

  // Admin-only: Generate report directly without payment
  const generateReportDirect = async (dataLimited: boolean, interp?: Interpretation) => {
    setStep('generating')
    setError(null)
    const chosen = interp ?? selectedInterpretation

    try {
      const response = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          report_type: 'topic',
          topic: topic.trim(),
          persona,
          data_limited: dataLimited,
          interpretation: chosen ?? undefined,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate report')
      }

      // Report generation started - stay on generating step so user sees the message
      // User will click Close which triggers onGenerated() to refresh the list
    } catch (e) {
      console.error('Error generating report:', e)
      setError(e instanceof Error ? e.message : 'Failed to generate report')
      setStep('input')
    }
  }

  const purchaseReport = async (dataLimited: boolean, interp?: Interpretation) => {
    setStep('purchasing')
    setError(null)
    const chosen = interp ?? selectedInterpretation

    try {
      // Create Stripe checkout session for report purchase
      const response = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'report',
          topic: topic.trim(),
          persona,
          dataLimited,
          interpretation: chosen ?? undefined,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        if (response.status === 401) {
          // User not logged in
          window.location.href = '/?redirect=/reports'
          return
        }
        throw new Error(data.error || 'Failed to start checkout')
      }

      if (data.url) {
        // Redirect to Stripe checkout
        window.location.href = data.url
      }
    } catch (e) {
      console.error('Error starting checkout:', e)
      setError(e instanceof Error ? e.message : 'Failed to start checkout')
      setStep('input')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Dialog. Column layout with a max height + scrollable middle so
          long content (multi-sentence critique on the interpretation
          picker step, plus three interpretation cards) never overflows
          the viewport. Previously the dialog had no height cap and long
          Claude critiques pushed the picker cards off the top of the
          screen with no way to scroll to them. */}
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex-shrink-0 flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">
            Generate Intelligence Report
          </h2>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content — scrollable when it exceeds the dialog's max height. */}
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
          {/* Beta progress indicator — visible at every step inside the dialog */}
          {isActiveBeta && (
            <div className={`mb-4 rounded-lg border px-3 py-2 text-sm ${
              betaCapReached
                ? 'bg-gray-50 border-gray-200 text-gray-600'
                : reportsRemaining === 1
                  ? 'bg-amber-50 border-amber-200 text-amber-800'
                  : 'bg-violet-50 border-violet-200 text-violet-800'
            }`}>
              <div className="flex items-center gap-2">
                <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${
                  betaCapReached ? 'bg-gray-200 text-gray-700' : 'bg-violet-100 text-violet-700'
                }`}>
                  Beta
                </span>
                {betaCapReached ? (
                  <span>You&apos;ve used all {BETA_REPORT_CAP} of your beta reports.</span>
                ) : (
                  <span>This will be report <strong>{reportsUsed + 1} of {BETA_REPORT_CAP}</strong> &middot; <strong>{reportsRemaining - 1}</strong> will remain after.</span>
                )}
              </div>
            </div>
          )}

          {step === 'input' && betaCapReached && (
            <div className="text-center py-6">
              <p className="text-sm text-gray-600 mb-4">
                Your beta period included {BETA_REPORT_CAP} reports. You&apos;ve used them all. Existing reports stay viewable. Reach out about Pro access if you&apos;d like to keep generating reports.
              </p>
              <button
                onClick={onClose}
                className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200 transition-colors text-sm"
              >
                Close
              </button>
            </div>
          )}

          {step === 'input' && !betaCapReached && (
            <>
              <p className="text-sm text-gray-600 mb-4">
                Create comprehensive topic-focused intelligence reports synthesizing research activity, funding, clinical trials, patents, and publications.
              </p>

              {/* Persona Selection */}
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Report Type
              </label>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <button
                  onClick={() => setPersona('researcher')}
                  className={`flex items-center gap-2 p-3 rounded-lg border-2 transition-all ${
                    persona === 'researcher'
                      ? 'border-[#E07A5F] bg-[#E07A5F]/5'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <FlaskConical className={`w-5 h-5 ${persona === 'researcher' ? 'text-[#E07A5F]' : 'text-gray-400'}`} />
                  <div className="text-left">
                    <div className={`text-sm font-medium ${persona === 'researcher' ? 'text-[#E07A5F]' : 'text-gray-700'}`}>
                      Research
                    </div>
                    <div className="text-xs text-gray-500">Competitive intel</div>
                  </div>
                </button>
                <button
                  onClick={() => setPersona('investor')}
                  className={`flex items-center gap-2 p-3 rounded-lg border-2 transition-all ${
                    persona === 'investor'
                      ? 'border-[#E07A5F] bg-[#E07A5F]/5'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <TrendingUp className={`w-5 h-5 ${persona === 'investor' ? 'text-[#E07A5F]' : 'text-gray-400'}`} />
                  <div className="text-left">
                    <div className={`text-sm font-medium ${persona === 'investor' ? 'text-[#E07A5F]' : 'text-gray-700'}`}>
                      Investment
                    </div>
                    <div className="text-xs text-gray-500">Risk/opportunity</div>
                  </div>
                </button>
              </div>

              <label className="block text-sm font-medium text-gray-700 mb-2">
                Research Topic
              </label>
              <input
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="e.g., CAR-T cell therapy, CRISPR gene editing"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#E07A5F] focus:border-transparent"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') fetchInterpretations()
                }}
              />
              {error && (
                <p className="mt-2 text-sm text-rose-600">{error}</p>
              )}
            </>
          )}

          {step === 'interpreting' && (
            <div className="flex flex-col items-center py-10">
              <Loader2 className="w-8 h-8 text-[#E07A5F] animate-spin mb-3" />
              <p className="text-gray-900 font-medium mb-1">Analyzing your topic</p>
              <p className="text-sm text-gray-500 text-center max-w-xs">
                Generating three search interpretations, checking the data yield of each, and picking a recommendation. Takes about 10 seconds.
              </p>
            </div>
          )}

          {step === 'choose-interpretation' && (
            <div className="space-y-3">
              {critique ? (
                <div className="rounded-lg bg-[#E07A5F]/5 border border-[#E07A5F]/20 p-3">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-[#E07A5F]" />
                    <span className="text-xs font-semibold text-[#E07A5F] uppercase tracking-wide">
                      Recommendation
                    </span>
                  </div>
                  <p className="text-sm text-gray-700 leading-snug">{critique}</p>
                </div>
              ) : (
                <p className="text-sm text-gray-600">
                  Pick the interpretation that best matches what you want to search for. Each option searches a different scope.
                </p>
              )}
              {interpretations.map((interp) => {
                const Icon =
                  interp.id === 'narrow' ? Telescope : interp.id === 'standard' ? Compass : Globe
                const isRecommended = recommendedId === interp.id
                return (
                  <button
                    key={interp.id}
                    onClick={() => selectInterpretation(interp)}
                    className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
                      isRecommended
                        ? 'border-[#E07A5F] bg-[#E07A5F]/5 hover:bg-[#E07A5F]/10'
                        : 'border-gray-200 hover:border-[#E07A5F] hover:bg-[#E07A5F]/5'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <Icon className="w-5 h-5 text-[#E07A5F] flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <div className="flex items-baseline gap-2 min-w-0">
                            <span className="text-sm font-semibold text-gray-900">{interp.label}</span>
                            <span className="text-xs text-gray-500 truncate">{interp.description}</span>
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            {isRecommended && (
                              <span className="inline-block px-1.5 py-0.5 text-[10px] font-semibold bg-[#E07A5F] text-white rounded uppercase tracking-wide">
                                Recommended
                              </span>
                            )}
                            <span
                              className={`inline-block px-2 py-0.5 text-xs font-semibold rounded ${
                                interp.projectCount === null
                                  ? 'bg-gray-100 text-gray-500'
                                  : interp.projectCount < 5
                                    ? 'bg-amber-100 text-amber-800'
                                    : 'bg-emerald-100 text-emerald-800'
                              }`}
                            >
                              {interp.projectCount === null
                                ? '— projects'
                                : `${interp.projectCount} project${interp.projectCount === 1 ? '' : 's'}`}
                            </span>
                          </div>
                        </div>
                        <p className="text-sm text-gray-700 mb-2 leading-snug">
                          &ldquo;{interp.semanticQuery}&rdquo;
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {interp.keywordQuery.split('|').slice(0, 8).map((term, i) => (
                            <span
                              key={i}
                              className="inline-block px-1.5 py-0.5 text-[10px] bg-gray-100 text-gray-600 rounded"
                            >
                              {term.trim()}
                            </span>
                          ))}
                          {interp.keywordQuery.split('|').length > 8 && (
                            <span className="inline-block px-1.5 py-0.5 text-[10px] text-gray-400">
                              +{interp.keywordQuery.split('|').length - 8} more
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}

          {step === 'confirm' && (
            <div className="space-y-4">
              <div className="flex items-start gap-3 p-4 bg-amber-50 rounded-lg">
                <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-amber-800">Limited Data Available</p>
                  <p className="text-sm text-amber-700 mt-1">
                    We found only <strong>{projectCount}</strong> projects for
                    &ldquo;{topic}&rdquo;. The report will have limited depth.
                  </p>
                </div>
              </div>
              <p className="text-sm text-gray-600">
                Would you like to proceed with generating a report anyway?
              </p>
            </div>
          )}

          {step === 'purchasing' && (
            <div className="flex flex-col items-center py-8">
              <div className="relative mb-4">
                <CreditCard className="w-12 h-12 text-[#E07A5F]" strokeWidth={1.5} />
                <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-white rounded-full flex items-center justify-center">
                  <Loader2 className="w-4 h-4 text-[#E07A5F] animate-spin" />
                </div>
              </div>
              <p className="text-gray-900 font-medium mb-1">Redirecting to Checkout</p>
              <p className="text-sm text-gray-500 text-center">
                You will be redirected to complete your purchase.
              </p>
            </div>
          )}

          {step === 'generating' && (
            <div className="flex flex-col items-center py-8">
              <div className="relative mb-4">
                <Sparkles className="w-12 h-12 text-[#E07A5F]" strokeWidth={1.5} />
                <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-white rounded-full flex items-center justify-center">
                  <Loader2 className="w-4 h-4 text-[#E07A5F] animate-spin" />
                </div>
              </div>
              <p className="text-gray-900 font-medium mb-1">Report Started</p>
              <p className="text-sm text-gray-500 text-center max-w-xs">
                Your report is being generated in the background. You can close this dialog and check back in a few minutes.
              </p>
            </div>
          )}
        </div>

        {/* Footer — pinned to the bottom of the dialog so buttons stay
            reachable even when the middle content scrolls. */}
        <div className="flex-shrink-0 flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100">
          {step === 'input' && (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={fetchInterpretations}
                disabled={!topic.trim()}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#E07A5F] rounded-lg hover:bg-[#C96A4F] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Continue
              </button>
            </>
          )}

          {step === 'choose-interpretation' && (
            <>
              <button
                onClick={() => {
                  setStep('input')
                  setError(null)
                }}
                className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 transition-colors"
              >
                Back
              </button>
              <span className="text-xs text-gray-400">
                {canBypassPayment ? 'Pick to start generation' : 'Pick to purchase report'}
              </span>
            </>
          )}

          {step === 'confirm' && (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 transition-colors"
              >
                Cancel
              </button>
              {canBypassPayment ? (
                <button
                  onClick={() => generateReportDirect(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-violet-600 rounded-lg hover:bg-violet-700 transition-colors"
                >
                  <Sparkles className="w-4 h-4" />
                  Generate Anyway
                </button>
              ) : (
                <button
                  onClick={() => purchaseReport(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#E07A5F] rounded-lg hover:bg-[#C96A4F] transition-colors"
                >
                  <CreditCard className="w-4 h-4" />
                  Purchase Report
                </button>
              )}
            </>
          )}

          {step === 'purchasing' && (
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 transition-colors"
            >
              Cancel
            </button>
          )}

          {step === 'generating' && (
            <button
              onClick={() => {
                onGenerated()
                onClose()
              }}
              className="px-4 py-2 text-sm font-medium text-white bg-[#E07A5F] rounded-lg hover:bg-[#C96A4F] transition-colors"
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
