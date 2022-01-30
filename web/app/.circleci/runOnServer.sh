#!/bin/bash
#sudo apt-get update && sudo apt-get install build-essential && sudo apt-get install python
echo 'in the server'
[ -s "/root/.nvm/nvm.sh" ] && . "/root/.nvm/nvm.sh" # This loads nvm
[ -s "/root/.profile" ] && . "/root/.profile" #loads env

# export SERVER_NAME=45.79.136.14
# export ROOT_URL=http://45.79.136.14:3000
# export APP_DIR=/var/www/slatebox
# export MONGO_URL="mongodb://sbuser:jPyvYtQbzmrBifBJ@slatebox-shard-00-00-dkx6f.mongodb.net:27017,slatebox-shard-00-01-dkx6f.mongodb.net:27017,slatebox-shard-00-02-dkx6f.mongodb.net:27017/slatebox?ssl=true&replicaSet=slatebox-shard-0&authSource=admin"
# export MONGO_OPLOG_URL="mongodb://oploguser:HAFiGhyczdu12xMS@slatebox-shard-00-00-dkx6f.mongodb.net:27017,slatebox-shard-00-01-dkx6f.mongodb.net:27017,slatebox-shard-00-02-dkx6f.mongodb.net:27017/local?ssl=true&replicaSet=slatebox-shard-0&authSource=admin"
# export START_PORT=3000
# export NUMBER_SERVERS=1
# export SB_ENV=prod

echo 'sourced...user'
whoami
env
nvm install 14.17.3
nvm use 14.17.3
npm install forever -g
rm -fr "$APP_DIR"
if [ ! -d "$APP_DIR" ]; then
mkdir -p $APP_DIR
chown -R www-data:www-data $APP_DIR
fi
ln -sf /usr/share/zoneinfo/CST6CDT /etc/localtime
pushd $APP_DIR
rm -rf bundle
tar xfz /tmp/bundle.tgz -C $APP_DIR
#rm /tmp/bundle.tgz
pushd bundle/programs/server
#rm -fr node_modules
npm install
#npm install @babel/runtime
#rm -fr /var/www/slatebox/bundle/programs/server/npm/node_modules
cd /var/www/slatebox/bundle/programs/server/npm/node_modules/meteor/accounts-password/node_modules
rm -fr bcrypt
npm install -D bcrypt@5.0.0

cd /var/www/slatebox/bundle/programs/server/npm/node_modules
rm -fr sharp
npm install -D sharp
npm install @babel/runtime

#cp -fr /var/www/slatebox/bundle/programs/server/node_modules /var/www/slatebox/bundle/programs/server/npm/node_modules
popd
chown -R www-data:www-data bundle

forever stopall

startPort=$START_PORT;
numberServers=$NUMBER_SERVERS;
i=1;
increment=10;
while [ $i -le $numberServers ]
do
	echo "mongo url: "$MONGO_URL

    PORT="$startPort" forever start $APP_DIR/bundle/main.js
	(( startPort+=$increment ))
	((i++))
done

popd
cat /dev/null > /etc/cron.daily/deleteForeverLogs.cron; echo -e "find /root/.forever/ -mtime +14 -name \"*.log\" -delete" >> /etc/cron.daily/deleteForeverLogs.cron