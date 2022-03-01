/* eslint-disable no-console */
/* eslint-disable no-underscore-dangle */
import { Meteor } from 'meteor/meteor'
import { Picker } from 'meteor/communitypackages:picker'
import {
  StripeEvents,
  Messages,
  Audit,
  Organizations,
  PricingTiers,
} from '../imports/api/common/models'

const posts = Picker.filter(
  Meteor.bindEnvironment((req) => req.method === 'POST')
)

posts.route('/hooks', (params, req, res) => {
  let body = ''
  req.on('readable', () => {
    const nextStr = req.read()
    body += nextStr || ''
  })
  const finalize = Meteor.bindEnvironment(() => {
    const stripeEvent = JSON.parse(body)
    stripeEvent._id = stripeEvent.id
    StripeEvents.insert(stripeEvent)
    console.log(
      '*************** WEBHOOK BODY RECEIVED ********************',
      stripeEvent
    )
    switch (stripeEvent.type) {
      case 'customer.subscription.deleted': {
        const planType = stripeEvent.data.object.plan?.id || 'free'
        const tier = PricingTiers.findOne({
          $or: [
            { 'monthly.priceId': planType },
            { 'yearly.priceId': planType },
          ],
        })
        const entity = tier.requiresOrgId
          ? Organizations.findOne({
              customerId: stripeEvent.data.object.customer,
            })
          : Meteor.users.findOne({
              customerId: stripeEvent.data.object.customer,
            })
        if (entity) {
          let user = entity
          if (tier.requiresOrgId) {
            user = Meteor.users.findOne({ orgId: entity._id, isOrgOwner: true })
          }
          Messages.insert({
            timestamp: new Date().valueOf(),
            userId: user._id,
            text: `Your subscription to the ${entity.planType} has been canceled. You're now on the forever free plan, but you can upgrade anytime in your account`,
            read: false,
            priority: 10,
          })
          if (tier.requiresOrgId) {
            Organizations.update(
              { _id: user._id },
              {
                $set: {
                  planType: 'free',
                  customerId: stripeEvent.data.object.customer,
                },
              }
            )
          } else {
            Meteor.users.update(
              { _id: user._id },
              {
                $set: {
                  planType: 'free',
                  customerId: stripeEvent.data.object.customer,
                },
              }
            )
          }
        }
        break
      }
      case 'customer.subscription.updated': {
        let planType = stripeEvent.data.object.plan?.id || 'free'
        const tier = PricingTiers.findOne({
          $or: [
            { 'monthly.priceId': planType },
            { 'yearly.priceId': planType },
          ],
        })
        let entity = null
        if (tier) {
          if (tier.requiresOrgId) {
            entity = Organizations.findOne({
              customerId: stripeEvent.data.object.customer,
            })
          } else {
            entity = Meteor.users.findOne({
              customerId: stripeEvent.data.object.customer,
            })
          }
        }
        if (entity) {
          let user = entity
          if (tier.requiresOrgId) {
            user = Meteor.users.findOne({ orgId: entity._id, isOrgOwner: true })
          }
          // upgrade or downgrade
          Audit.insert({
            planChange: true,
            timestamp: new Date().valueOf(),
            userId: user._id,
            orgId: tier.requiresOrgId ? entity._id : 'N/A',
            stripeEventId: stripeEvent._id,
            email: user.emails[0].address,
            currentPlan: entity.planType,
            changedPlan: planType,
          })
          const update = { $set: { planType } }
          if (stripeEvent.data.object?.subscription?.pause_collection) {
            // pausing
            const resumesAt =
              stripeEvent.data.object?.subscription?.pause_collection
                ?.resumes_at || -1
            update.$set.paused = { resumesAt, resumePlan: planType }
            planType = 'free'
            Messages.insert({
              timestamp: new Date().valueOf(),
              userId: user._id,
              title: `Subscription Plan Paused`,
              text: `Your subscription to the ${planType} is paused. You can restart it anytime in your account. In the meantime, you are on the forever free plan.`,
              read: false,
              priority: 10,
            })
          } else if (stripeEvent.data.object.cancel_at_period_end) {
            // canceling at the end of the period -- a deleted hook will fire, no need to do anything now, just note it
            update.$set.setToCancel = true
            update.$set.setToCancelOn = new Date(
              parseInt(`${stripeEvent.data.object.cancel_at}000`, 10)
            )
              .toString()
              .split(' ')
              .slice(0, 4)
              .join(' ')
            Messages.insert({
              timestamp: new Date().valueOf(),
              userId: user._id,
              title: `Subscription Cancellation`,
              text: `Your subscription is set to cancel on ${update.$set.setToCancelOn}. You still have full access on the ${planType} plan until then. At that time you'll be downgraded to the forever free plan.`,
              read: false,
              priority: 10,
            })
          } else if (
            entity.setToCancel &&
            !stripeEvent.data.object.cancel_at_period_end
          ) {
            // resuming
            Messages.insert({
              timestamp: new Date().valueOf(),
              userId: user._id,
              title: `Subscription Plan Change`,
              text: `Welcome back! You have successfully reactivated the ${planType} plan!`,
              read: false,
              priority: 10,
              effect: 'celebrate',
            })
            update.$set.resubscribed = true
            update.$unset = { setToCancel: true, setToCancelOn: true }
          }
          if (tier.requiresOrgId) {
            Organizations.update({ _id: entity._id }, update)
            if (planType !== 'free') {
              Meteor.users.update(
                { orgId: entity._id },
                { $unset: { planType: true } },
                { multi: true }
              )
            }
          } else {
            Meteor.users.update({ _id: user._id }, update)
          }
        }
        break
      }
      case 'checkout.session.completed': {
        // first payment
        let entity = Organizations.findOne({
          _id: stripeEvent.data.object.client_reference_id,
        })
        let attachedToOrg = false
        if (entity) {
          attachedToOrg = true
        } else {
          entity = Meteor.users.findOne({
            _id: stripeEvent.data.object.client_reference_id,
          })
        }
        if (entity) {
          const tier = PricingTiers.findOne({
            $or: [
              { 'monthly.priceId': entity.pendingPriceId },
              { 'yearly.priceId': entity.pendingPriceId },
            ],
          })
          let user = entity
          if (attachedToOrg) {
            user = Meteor.users.findOne({ orgId: entity._id, isOrgOwner: true })
          }
          if (attachedToOrg) {
            Organizations.update(
              { _id: entity._id },
              {
                $set: {
                  planType: entity.pendingPriceId,
                  customerId: stripeEvent.data.object.customer,
                  subscriptionId: stripeEvent.data.object.subscription,
                },
                $unset: { pendingPriceId: true },
              }
            )
          } else {
            Meteor.users.update(
              { _id: user._id },
              {
                $set: {
                  planType: entity.pendingPriceId,
                  customerId: stripeEvent.data.object.customer,
                  subscriptionId: stripeEvent.data.object.subscription,
                },
                $unset: { pendingPriceId: true },
              }
            )
          }
          Messages.insert({
            timestamp: new Date().valueOf(),
            userId: user._id,
            title: `Plan Activated!`,
            text: tier.welcomeMessage,
            read: false,
            priority: 10,
            effect: 'celebrate',
          })
        }
        break
      }
      default: {
        break
      }
    }
    res.write('OK')
    res.end()
  })
  req.on('end', finalize)
})
