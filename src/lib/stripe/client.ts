// Stripe client initialization (server-side only)

import Stripe from 'stripe'

// Only initialize Stripe if secret key is available (not during build)
const stripeSecretKey = process.env.STRIPE_SECRET_KEY

export const stripe = stripeSecretKey
  ? new Stripe(stripeSecretKey, {
      apiVersion: '2026-02-25.clover',
      typescript: true,
    })
  : (null as unknown as Stripe)
