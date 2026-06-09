// POST /api/contact
//
// Receives BD / enterprise contact form submissions from /contact and
// forwards them downstream. Wiring is intentionally simple: validate,
// log with structured prefix so the submissions are findable in
// production logs, and optionally POST to a Slack webhook if the env
// var is set. Stays operational regardless of which downstream the
// founder wants to wire next (Slack / Linear / email — pick later,
// the form keeps working).

import { NextRequest, NextResponse } from 'next/server'

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

async function postToSlack(payload: ContactPayload): Promise<void> {
  const webhookUrl = process.env.SLACK_CONTACT_WEBHOOK_URL
  if (!webhookUrl) return

  const text = [
    `*New BD contact request*`,
    `Name: ${payload.name}`,
    `Email: ${payload.email}`,
    `Company: ${payload.company}`,
    payload.role ? `Role: ${payload.role}` : null,
    `Topic of interest: ${payload.topicOfInterest}`,
    payload.headcount ? `Headcount: ${payload.headcount}` : null,
    payload.message ? `Message: ${payload.message}` : null,
  ]
    .filter(Boolean)
    .join('\n')

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

    // Fire-and-forget downstream. A failed webhook should not break the
    // user's submission — they get a success response regardless.
    void postToSlack(payload)

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Error in POST /api/contact:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
