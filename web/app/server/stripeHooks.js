/* eslint-disable no-console */
import { handleWalletEvent } from './wallet-stripe.mjs'
import { stripeClient, walletIo } from './methods/wallet'
import { handleBilling, handleSetup } from './methods/pro'
import app from './expressApp'
import { StripeEvents } from '../imports/api/common/models'
import { cloudOn } from './cloud-lock-meteor'

// Slatebox Pro subscriptions, then top-up payments, refunds and disputes, then card changes (setup sessions). The inbound
// body supplies only the event id: the event is read back from this installation's Stripe account
// before anything is used, and Pro's state is read fresh from Stripe (pro-billing.mjs).
app.post('/stripehooks', async (req, res) => {
  // payments run only on Slatebox Cloud by its Cloud key (cloud-lock.mjs): elsewhere there is no
  // payment endpoint, so a self-hosted server never records a Stripe event, whatever its settings
  if (!cloudOn()) return res.status(404).json({ ok: false, error: 'cloud_only' })
  const id = req.body?.id
  if (typeof id !== 'string' || !/^evt_[A-Za-z0-9]+$/.test(id)) {
    return res.status(400).json({ ok: false })
  }
  if (await StripeEvents.findOneAsync({ _id: id }, { fields: { _id: 1 } })) {
    return res.json({ ok: true })
  }
  let client
  let stripeEvent
  try {
    client = stripeClient()
    stripeEvent = await client.events.retrieve(id)
  } catch (err) {
    return res.status(err.statusCode === 404 ? 400 : 503).json({ ok: false })
  }
  const recordOnce = (collection, doc) => collection.rawCollection().updateOne(
    { _id: id }, { $setOnInsert: doc }, { upsert: true }
  )
  try {
    // A paid checkout is read again with its payment (so a later refund knows the charge), and a
    // card change with its setup intent (the new card).
    if (/^checkout\.session\./.test(stripeEvent.type)) {
      stripeEvent = { ...stripeEvent, data: { object: await client.checkout.sessions.retrieve(stripeEvent.data.object.id, { expand: ['payment_intent', 'setup_intent'] }) } }
    }
    // Pro first; whatever it does not take (top-ups) goes to the wallet; then card changes.
    const billing = await handleBilling(stripeEvent)
    const wallet = billing.handled ? billing : await handleWalletEvent(stripeEvent, walletIo)
    const result = wallet.handled ? wallet : await handleSetup(stripeEvent)
    await recordOnce(StripeEvents, { type: stripeEvent.type, created: stripeEvent.created, handled: result.handled })
  } catch (err) {
    console.error('Stripe event handling failed', id, err.message)
    return res.status(503).json({ ok: false })
  }
  res.status(200).json({ ok: true })
})
