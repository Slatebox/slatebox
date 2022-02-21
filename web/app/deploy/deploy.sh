#!/bin/bash

###### CHECK ARGUMENTS ######
while getopts s:e: option
do
        case "${option}"
        in
                s) SKIP_BUNDLE=${OPTARG};;
                e) ENV_TARGET=${OPTARG};;
        esac
done

if [ "x$ENV_TARGET" = "x" ]; then 
  echo "specify a target, e.g., deploy.sh prod|staging"
  exit 0
fi

if [ "x$ENV_TARGET" = "xstaging" ]; then

  mongo=`sed -n 's/^STAGE=\(.*\)$/\1/p' resources/mongoUrls`
  echo $mongo
  mongo_oplog=`sed -n 's/^STAGE_OPLOG=\(.*\)$/\1/p' resources/mongoUrls`
  echo "mongo oplog DB:  "$mongo_oplog
  servers=`sed -n 's/^STAGE=\(.*\)$/\1/p' resources/servers`

elif [ "x$ENV_TARGET" = "xprod" ]; then

  mongo=`sed -n 's/^PROD=\(.*\)$/\1/p' resources/mongoUrls`
  echo $mongo
  mongo_oplog=`sed -n 's/^PROD_OPLOG=\(.*\)$/\1/p' resources/mongoUrls`
  echo "mongo oplog DB:  "$mongo_oplog
  servers=`sed -n 's/^PROD=\(.*\)$/\1/p' resources/servers`

fi

#to use the cloudfront CDN for js/css
CDN_URL=https://assets.slatebox.com

echo $SKIP_BUNDLE;

if [ "x$SKIP_BUNDLE" != "xtrue" ]; then 
  echo "bundling"
  # mv ../../slatebox-library/.parcel-cache ../../slatebox-library-parcel-cache
  mkdir ../../slatebox-build
  meteor build ../../slatebox-build --server-only --architecture os.linux.x86_64
  # mv ../../slatebox-library-parcel-cache ../../slatebox-library/.parcel-cache
fi

#report servers
startPort=3000
numberServers=1
echo "Deploy to $ENV_TARGET"

for server in $servers
do
 _server=`echo $server | tr -d ','`
 echo "deploy to $_server.  Start port $startPort, number of servers: $numberServers"
 bash meteor.sh -h $_server -m "$mongo" -o "$mongo_oplog" -p $startPort -n $numberServers -e $ENV_TARGET;
done

echo "removing bundle"
#rm bundle.tgz