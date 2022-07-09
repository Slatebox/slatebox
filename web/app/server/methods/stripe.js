/* eslint-disable no-underscore-dangle */
import { Meteor } from 'meteor/meteor'
import stripe from 'stripe'
import CONSTANTS from '../../imports/api/common/constants'
import { Organizations, PricingTiers } from '../../imports/api/common/models'

const method = {}
method[CONSTANTS.methods.stripe.createSession] = async (opts) => {
  if (Meteor.user() && !Meteor.user().isAnonymous) {
    const stripeAPI = stripe(Meteor.settings.stripePrivateKey)
    switch (opts.type) {
      case 'checkout': {
        const { priceId } = opts
        let qty = 1
        const tier = PricingTiers.findOne({
          $or: [
            { 'monthly.priceId': opts.priceId },
            { 'yearly.priceId': opts.priceId },
          ],
        })
        if (tier.requiresOrgId) {
          qty = Meteor.users.find({ orgId: Meteor.user().orgId }).count()
        }

        const sessOpts = {
          mode: 'subscription',
          payment_method_types: ['card'],
          client_reference_id: tier.requiresOrgId
            ? Meteor.user().orgId
            : Meteor.userId(),
          customer_email: Meteor.user().emails[0].address,
          line_items: [
            {
              price: priceId,
              // For metered billing, do not pass quantity
              quantity: qty,
            },
          ],
          // {CHECKOUT_SESSION_ID} is a string literal; do not change it!
          // the actual Session ID is returned in the query parameter when your customer
          // is redirected to the success page.
          success_url: `${Meteor.settings.public.baseUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${Meteor.settings.public.baseUrl}`,
        }

        if (opts.couponCode) {
          sessOpts.discounts = [{ coupon: opts.couponCode }]
        }

        // See https://stripe.com/docs/api/checkout/sessions/create
        // for additional parameters to pass.
        try {
          console.log('creating session', sessOpts)
          const session = await stripeAPI.checkout.sessions.create(sessOpts)

          // note the planType
          if (tier.requiresOrgId) {
            Organizations.update(
              { _id: Meteor.user().orgId },
              {
                $set: {
                  pendingPriceId: opts.priceId,
                  customerId: null,
                  subscriptionId: null,
                },
              }
            )
          } else {
            Meteor.users.update(
              { _id: Meteor.userId() },
              {
                $set: {
                  pendingPriceId: opts.priceId,
                  customerId: null,
                  subscriptionId: null,
                },
              }
            )
          }
          return session
        } catch (err) {
          console.error(err)
          throw new Meteor.Error(err)
        }
      }
      case 'portal': {
        const customerId = Meteor.user().orgId
          ? Organizations.findOne({ _id: Meteor.user().orgId }).customerId
          : Meteor.user().customerId
        if (customerId) {
          const session = await stripeAPI.billingPortal.sessions.create({
            customer: customerId,
            return_url: opts.returnUrl,
          })
          return session.url
        }
        return null
      }
      default:
        return null
    }
  }
  return null
}

method[CONSTANTS.methods.stripe.updateSubscriptionQuantity] = async () => {
  if (Meteor.user() && Meteor.user().orgId) {
    const stripeAPI = stripe(Meteor.settings.stripePrivateKey)
    const org = Organizations.findOne({ _id: Meteor.user().orgId })
    if (org.subscriptionId) {
      const qty = Meteor.users.find({ orgId: org._id }).count()
      const subscription = await stripeAPI.subscriptions.retrieve(
        org.subscriptionId
      )
      const update = await stripeAPI.subscriptionItems.update(
        subscription.items.data[0].id,
        { quantity: qty }
      )
      return update
    }
  }
  return null
}

method[CONSTANTS.methods.stripe.deleteCustomer] = async () => {
  if (Meteor.user() && Meteor.user().orgId && Meteor.user().isOrgOwner) {
    const stripeAPI = stripe(Meteor.settings.stripePrivateKey)
    const org = Organizations.findOne({ _id: Meteor.user().orgId })
    const deleted = await stripeAPI.customers.del(org.customerId)
    return deleted
  }
  return null
}

method[CONSTANTS.methods.stripe.confirmPayment] = async () => {
  if (Meteor.user() && Meteor.user().orgId) {
    // note the planType
    return (
      !!Meteor.user().customerId ||
      !!Organizations.findOne({ _id: Meteor.user().orgId }).customerId
    )
  }
  return null
}

Meteor.methods(method)
