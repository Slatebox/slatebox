echo 'in the server'
source /root/.profile
nvm use 0.10.26
node --version
if [ ! -d "$APP_DIR" ]; then
mkdir -p $APP_DIR
chown -R www-data:www-data $APP_DIR
fi
ln -sf /usr/share/zoneinfo/CST6CDT /etc/localtime
pushd $APP_DIR
rm -rf bundle
tar xfz /tmp/bundle.tgz -C $APP_DIR
rm /tmp/bundle.tgz
pushd bundle/programs/server/node_modules
rm -rf fibers
npm install fibers
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
	
	#makes sybmolic link for user images
	ln -s /sb_images sb_images

    PORT="$startPort" forever start $APP_DIR/bundle/main.js
	(( startPort+=$increment ))
	((i++))
done

popd
cat /dev/null > /etc/cron.daily/deleteForeverLogs.cron; echo -e "find /root/.forever/ -mtime +14 -name \"*.log\" -delete" >> /etc/cron.daily/deleteForeverLogs.cron
