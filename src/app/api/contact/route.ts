// POST /api/contact
//
// Receives BD / enterprise contact form submissions from /contact and
// forwards them downstream. Wiring is intentionally simple: validate,
// log with structured prefix so the submissions are findable in
// production logs, then fan out to any configured downstreams
// (Slack webhook, Resend email). All downstreams are fire-and-forget
// and env-gated — a missing env var disables that channel without
// breaking the form.

import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'

interface ContactPayload {
  name: string
  email: string
  company: string
  role?: string
  topicOfInterest: string
  headcount?: string
  message?: string
}

function isString(v: unknown): v is string {
  return typeof v === 'string'
}

function validatePayload(body: unknown): ContactPayload | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  if (!isString(b.name) || b.name.trim().length === 0) return null
  if (!isString(b.email) || !b.email.includes('@')) return null
  if (!isString(b.company) || b.company.trim().length === 0) return null
  if (!isString(b.topicOfInterest) || b.topicOfInterest.trim().length === 0) {
    return null
  }
  return {
    name: b.name.trim(),
    email: b.email.trim(),
    company: b.company.trim(),
    role: isString(b.role) ? b.role.trim() : undefined,
    topicOfInterest: b.topicOfInterest.trim(),
    headcount: isString(b.headcount) ? b.headcount.trim() : undefined,
    message: isString(b.message) ? b.message.trim() : undefined,
  }
}

// Render the payload as a list of "Label: value" lines, omitting
// optional fields that the submitter left blank. Shared by the Slack
// and email senders so both surfaces show the same shape.
function formatPayloadLines(payload: ContactPayload): string[] {
  return [
    `Name: ${payload.name}`,
    `Email: ${payload.email}`,
    `Company: ${payload.company}`,
    payload.role ? `Role: ${payload.role}` : null,
    `Topic of interest: ${payload.topicOfInterest}`,
    payload.headcount ? `Headcount: ${payload.headcount}` : null,
    payload.message ? `Message: ${payload.message}` : null,
  ].filter((line): line is string => line !== null)
}

async function postToSlack(payload: ContactPayload): Promise<void> {
  const webhookUrl = process.env.SLACK_CONTACT_WEBHOOK_URL
  if (!webhookUrl) return

  const text = ['*New BD contact request*', ...formatPayloadLines(payload)].join('\n')

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
  } catch (e) {
    console.error('[contact] Slack webhook failed:', e)
  }
}

// Email the submission to the hello@ inbox via Resend so BD inbound
// lands directly in the conversational inbox. Reply-To is set to the
// submitter's address so hitting Reply in the inbox goes straight to
// them — no copy-paste step.
async function sendContactEmail(payload: ContactPayload): Promise<void> {
  const apiKey = process.env.RESEND_CONTACT_FORM_API_KEY
  if (!apiKey) return

  const resend = new Resend(apiKey)
  const lines = formatPayloadLines(payload)
  const subject = `New BD contact: ${payload.company} — ${payload.topicOfInterest}`

  try {
    const { error } = await resend.emails.send({
      from: 'granted.bio Contact <contact-form@granted.bio>',
      to: 'hello@granted.bio',
      replyTo: payload.email,
      subject,
      text: lines.join('\n'),
    })
    if (error) {
      console.error('[contact] Resend email failed:', error)
    }
  } catch (e) {
    console.error('[contact] Resend email threw:', e)
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const payload = validatePayload(body)
    if (!payload) {
      return NextResponse.json(
        { error: 'Missing or invalid required fields (name, email, company, topicOfInterest).' },
        { status: 400 }
      )
    }

    // Structured log line so production submissions are findable via
    // "[contact-request]" search even without downstream wiring.
    console.log(
      `[contact-request] ${payload.email} (${payload.company}) — topic: "${payload.topicOfInterest}"`,
      payload
    )

    // Fire-and-forget downstreams. A failed webhook or email should not
    // break the user's submission — they get a success response regardless.
    void postToSlack(payload)
    void sendContactEmail(payload)

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Error in POST /api/contact:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
