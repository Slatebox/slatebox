import { Mongo } from 'meteor/mongo';

const Organizations = new Mongo.Collection("organizations");
const Collaboration = new Mongo.Collection("collaboration");
//const CollaborationMessages = new Mongo.Collection("collaborationMessages");
const Slates = new Mongo.Collection("slates");
//const SharedSlates = new Mongo.Collection("sharedSlates");
const Collaborators = new Mongo.Collection("collaborators");
//const VideoCollaborators = new Mongo.Collection("videoCollaborators");
//const LocalVideoCollaborators = new Mongo.Collection(null);
//const Feedback = new Mongo.Collection("feedback");
//const StudentGroups = new Mongo.Collection("studentGroups");
// const Apps = new Mongo.Collection("apps");
// const AppTypes = new Mongo.Collection("appTypes");
// const AppSegments = new Mongo.Collection("appSegments");
// const AppFeedback = new Mongo.Collection("appFeedback");
// const Grades = new Mongo.Collection("grades");
// const CommonCoreStandards = new Mongo.Collection("commonCoreStandards");
//const Fonts = new Mongo.Collection("fonts");
//const Campaigns = new Mongo.Collection("campaigns");

//server side collections
//OrgMigrations = new Mongo.Collection("orgMigrations");

const StripeEvents = new Mongo.Collection("stripeEvents");

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
  , Tags
  , Audit
  , StripeEvents
  , Messages
  , PricingTiers
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