# The tag here should match the Meteor version of your app, per .meteor/release
FROM geoffreybooth/meteor-base:2.5

# Copy app package.json and package-lock.json into container
COPY ./app/package*.json $APP_SOURCE_FOLDER/

RUN bash $SCRIPTS_FOLDER/build-app-npm-dependencies.sh

# Copy app source into container
COPY ./app $APP_SOURCE_FOLDER/

RUN bash $SCRIPTS_FOLDER/build-meteor-bundle.sh

# Use the specific version of Node expected by your Meteor release, per https://docs.meteor.com/changelog.html; this is expected for Meteor 2.5
FROM node:14.18.1-alpine

ENV APP_BUNDLE_FOLDER /opt/bundle
ENV SCRIPTS_FOLDER /docker

# Install OS build dependencies, which stay with this intermediate image but don’t become part of the final published image
RUN apk --no-cache add \
	bash \
	g++ \
	make \
	python3

# Copy in entrypoint
COPY --from=0 $SCRIPTS_FOLDER $SCRIPTS_FOLDER/

# Copy in app bundle
COPY --from=0 $APP_BUNDLE_FOLDER/bundle $APP_BUNDLE_FOLDER/bundle/

RUN bash $SCRIPTS_FOLDER/build-meteor-npm-dependencies.sh --build-from-source

# Start another Docker stage, so that the final image doesn’t contain the layer with the build dependencies
# See previous FROM line; this must match
FROM node:14.18.1-alpine

ENV APP_BUNDLE_FOLDER /opt/bundle
ENV SCRIPTS_FOLDER /docker
ENV ROOT_URL ${APP_ROOT_URL:-http://localhost}
ENV MONGO_URL ${MONGO_URL}
ENV MONGO_OPLOG_URL ${MONGO_OPLOG_URL}
ENV PORT 2006
ENV METEOR_SETTINGS "{\"redisOplog\": { \"redis\": { \"port\": 6379, \"host\": \"${REDIS_OPLOG_URL}:-redis-oplog.slatebox.com\" }, \"retryIntervalMs\": 1000, \"mutationDefaults\": { \"optimistic\": true, \"pushToRedis\": true }, \"cacheTimeout\": 1800000, \"cacheTimer\": 300000, \"secondaryReads\": null, \"raceDetectionDelay\": 1000, \"raceDetection\": true, \"debug\": true},\"nounProject\": { \"key\": \"${NOUN_PROJECT_KEY}\", \"secret\": \"${NOUN_PROJECT_SECRET}\"},\"monti\": { \"appId\": \"${MONTI_APP_ID}\", \"appSecret\": \"${MONTI_APP_SECRET}\",},\"stripePrivateKey\": \"${STRIPE_PRIVATE_KEY}\",\"mailGun\": { \"server\": \"${MAIL_URL}\"},\"public\": { \"env\": \"${SB_ENV:-prod}\", \"baseUrl\": \"${APP_ROOT_URL:-https://app.slatebox.com}\", \"stripePublicKey\": \"${STRIPE_PUBLIC_KEY}\", \"googleFontAPIKey\": \"${GOOGLE_API_KEY}\", \"googleImageSearchEngineKey\": \"${GOOGLE_IMAGE_SEARCH_API_KEY}\", \"googleImageSearchAPIKey\": \"${GOOGLE_API_KEY}\", \"heapIOKey\": \"${HEAP_IO_KEY}\", \"pixabayAPIKey\": \"${PIXABAY_API_KEY}\"} }"

# Install OS runtime dependencies
RUN apk --no-cache add \
	bash \
	ca-certificates

# Copy in entrypoint with the built and installed dependencies from the previous image
COPY --from=1 $SCRIPTS_FOLDER $SCRIPTS_FOLDER/

# Copy in app bundle with the built and installed dependencies from the previous image
COPY --from=1 $APP_BUNDLE_FOLDER/bundle $APP_BUNDLE_FOLDER/bundle/

EXPOSE 2006

# Start app
ENTRYPOINT ["/docker/entrypoint.sh"]

CMD ["node", "main.js"]