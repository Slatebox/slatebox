import { Meteor } from 'meteor/meteor';
import stripe from 'stripe';
import { CONSTANTS } from '../../imports/api/common/constants';
import { Organizations, PricingTiers } from '../../imports/api/common/models';

let method = {};
method[CONSTANTS.methods.stripe.createSession] = async function(opts) {

  if (Meteor.user() && !Meteor.user().isAnonymous) {

    const stripeAPI = stripe(Meteor.settings.stripePrivateKey);

    console.log("creating sesh ", opts.type);

    switch (opts.type) {
      case "checkout": {
        const priceId = opts.priceId;
        console.log("priceId is ", priceId, Meteor.user().orgId);
        let qty = 1;
        const tier = PricingTiers.findOne({ $or: [{ "monthly.priceId": opts.priceId }, { "yearly.priceId": opts.priceId }] });
        if (tier.requiresOrgId) {
          qty = Meteor.users.find({ orgId: Meteor.user().orgId }).count();
        }

        const sessOpts = {
          mode: 'subscription',
          payment_method_types: ['card'],
          client_reference_id: tier.requiresOrgId ? Meteor.user().orgId : Meteor.userId(),
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
          cancel_url: `${Meteor.settings.public.baseUrl}`
        };

        console.log("creating sessionOpts ", sessOpts);
    
        // See https://stripe.com/docs/api/checkout/sessions/create
        // for additional parameters to pass.
        const session = await stripeAPI.checkout.sessions.create(sessOpts);

        console.log("creating session", JSON.stringify(session));
  
        //note the planType
        if (tier.requiresOrgId) {
          Organizations.update({ _id: Meteor.user().orgId }, { $set: { pendingPriceId: opts.priceId, customerId: null, subscriptionId: null }});
        } else {
          Meteor.users.update({ _id: Meteor.userId() }, { $set: { pendingPriceId: opts.priceId, customerId: null, subscriptionId: null }});
        }
        return session;
      }
      case "portal": {
        let customerId = Meteor.user().orgId ? Organizations.findOne({ _id: Meteor.user().orgId }).customerId : Meteor.user().customerId;
        console.log("customerId ", Meteor.user().orgId, Meteor.user().customerId, customerId);
        if (customerId) {
          console.log("create billing session", {
            customer: customerId,
            return_url: opts.returnUrl
          });
          const session = await stripeAPI.billingPortal.sessions.create({
            customer: customerId,
            return_url: opts.returnUrl
          });
          return session.url;
        } else {
          return null;
        }
      }
    }
  }
};

method[CONSTANTS.methods.stripe.updateSubscriptionQuantity] = async function() {
  if (Meteor.user() && Meteor.user().orgId) {
    const stripeAPI = stripe(Meteor.settings.stripePrivateKey);
    let org = Organizations.findOne({ _id: Meteor.user().orgId });
    if (org.subscriptionId) {
      let qty = Meteor.users.find({ orgId: org._id }).count();
      const subscription = await stripeAPI.subscriptions.retrieve(
        org.subscriptionId
      );
      console.log("got subscription", org.subscriptionId, JSON.stringify(subscription, null, 2));
      const update = await stripeAPI.subscriptionItems.update(
        subscription.items.data[0].id,
        { quantity: qty }
      );
      return update;
    }
  }
}

method[CONSTANTS.methods.stripe.deleteCustomer] = async function() {
  if (Meteor.user() && Meteor.user().orgId && Meteor.user().isOrgOwner) {
    const stripeAPI = stripe(Meteor.settings.stripePrivateKey);
    let org = Organizations.findOne({ _id: Meteor.user().orgId });
    const deleted = await stripeAPI.customers.del(
      org.customerId
    );
    return deleted;
  }
}

method[CONSTANTS.methods.stripe.confirmPayment] = async function() {
  if (Meteor.user() && Meteor.user().orgId) {
    //note the planType
    console.log("confirming customerid exists on user or org", Meteor.user().customerId);
    return !!Meteor.user().customerId || !!Organizations.findOne({ _id: Meteor.user().orgId }).customerId;
  }
}

Meteor.methods(method);