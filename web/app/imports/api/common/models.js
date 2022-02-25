import { Mongo } from 'meteor/mongo';

const Organizations = new Mongo.Collection("organizations");
const Collaboration = new Mongo.Collection("collaboration");
const Slates = new Mongo.Collection("slates");
const Collaborators = new Mongo.Collection("collaborators");

//Audit
const Audit = new Mongo.Collection("audit");
const Messages = new Mongo.Collection("messages");
const Comments = new Mongo.Collection("comments");

const Claims = new Mongo.Collection("claims");
const SlateAccess = new Mongo.Collection("slateAccess");
const Permissions = new Mongo.Collection("permissions");
const FeaturedSlates = new Mongo.Collection("featuredSlates");
const Themes = new Mongo.Collection("themes");
const PrivateThemes = new Mongo.Collection("privateThemes");
const SlateSnapshots = new Mongo.Collection("slateSnapshots");
const Tags = new Mongo.Collection("tags");

const NounProjectResults = new Mongo.Collection("nounProjectResults");
const NounProjectResultsMetaData = new Mongo.Collection("nounProjectResultsMetaData");
const Servers = new Mongo.Collection("servers");
const PricingTiers = new Mongo.Collection("pricingTiers");
const GuestViews = new Mongo.Collection("guestViews");
const OrgPreferences = new Mongo.Collection("orgPreferences");

const ArchivedSlates = new Mongo.Collection("archivedSlates");

const ApprovalRequests = new Mongo.Collection("approvalRequests");

const CachedImages = new Mongo.Collection("cachedImages");
const CachedImageTiming = new Mongo.Collection("cachedImageTiming");

export {
    Organizations
  , Collaboration
  , Slates
  , Collaborators
  , Claims
  , Permissions
  , FeaturedSlates
  , NounProjectResults
  , NounProjectResultsMetaData
  , Servers
  , PricingTiers
  , Tags
  , Audit
  , Messages
  , SlateAccess
  , GuestViews
  , OrgPreferences
  , ArchivedSlates
  , Comments
  , ApprovalRequests
  , Themes
  , PrivateThemes
  , SlateSnapshots
  , CachedImages
  , CachedImageTiming
};