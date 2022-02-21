#!/bin/bash

###### CHECK ARGUMENTS ######
while getopts h:m:o:l:i:p:n:e: option
do
        case "${option}"
        in
                h) APP_HOST=${OPTARG};;
                m) MONGO_URL=${OPTARG};;
                o) MONGO_OPLOG_URL=${OPTARG};;
                p) START_PORT=${OPTARG};;
                n) NUMBER_SERVERS=${OPTARG};;
                e) ENV_TARGET=${OPTARG};;
        esac
done

if [ "x$APP_HOST" == "x" ]; then echo "Need to set APP_HOST -h "; exit 1; fi
HOSTandPORT=( ${APP_HOST//[:]/ } )
HOST=${HOSTandPORT[0]}
PORT=${HOSTandPORT[1]}
if [ "x$MONGO_URL" == "x" ]; then echo "Need to set MONGO_URL -m"; exit 1; fi
if [ "x$MONGO_OPLOG_URL" == "x" ]; then echo "Need to set $MONGO_OPLOG_URL -o"; exit 1; fi
if [ "x$NUMBER_SERVERS" == "x" ]; then echo "Need to set NUMBER_SERVERS -n"; exit 1; fi
if [ "x$START_PORT" == "x" ]; then echo "Need to set START_PORT -p"; exit 1; fi
if [ "x$ENV_TARGET" == "x" ]; then echo "Need to set ENV_TARGET -e"; exit 1; fi

echo "APP_HOST: $APP_HOST"
echo "HOST: $HOST"
echo "MONGO_URL: $MONGO_URL"
echo "MONGO_OPLOG_URL: $MONGO_OPLOG_URL"
echo "ENV_TARGET: $ENV_TARGET"

###### CONSTANTS ######o
APP_NAME=slatebox
##EC2_PEM_FILE=$3
APP_DIR=/var/www/$APP_NAME
METEOR_CMD=meteorsb

###### VARIABLE DEFINITION ######

ROOT_URL=http://$HOST
SSH_HOST="root@$HOST"

#to use the cloudfront CDN for js/css
CDN_URL=https://assets.slatebox.com

echo "Deploying to $APP_HOST (Meteor: $APP_HOST)...using (Env: $ENV_TARGET)"

echo "copy bundle: scp bundle.tgz $SSH_HOST:/tmp/:"
rsync -avP ../../slatebox-build/slatebox-app.tar.gz $SSH_HOST:/tmp/bundle.tgz
#scp bundle.tgz $SSH_HOST:/tmp/:

CAT_ENV=$(cat ./settings.$ENV_TARGET.json)

echo "env is $CAT_ENV"

echo Using SSHCMD: "$SSH_OPT $SSH_HOST SERVER_NAME=$APP_HOST ROOT_URL=$ROOT_URL:$START_PORT APP_DIR=$APP_DIR MONGO_URL=$MONGO_URL MONGO_OPLOG_URL=$MONGO_OPLOG_URL START_PORT=$START_PORT NUMBER_SERVERS=$NUMBER_SERVERS  SB_ENV=prod CDN_URL=$CDN_URL METEOR_SETTINGS='$CAT_ENV' 'sudo -E bash -s'"
#ssh $SSH_HOST VAR=value cmd cmdargs
ssh $SSH_HOST "SERVER_NAME=$APP_HOST ROOT_URL=$ROOT_URL:$START_PORT APP_DIR=$APP_DIR MONGO_URL=$MONGO_URL MONGO_OPLOG_URL=$MONGO_OPLOG_URL START_PORT=$START_PORT NUMBER_SERVERS=$NUMBER_SERVERS SB_ENV=prod CDN_URL=$CDN_URL METEOR_SETTINGS='$CAT_ENV' " sudo -E bash -s < runOnServer.sh

echo Your app is deployed and serving on: $ROOT_URL
