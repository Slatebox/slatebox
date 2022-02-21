#install mongo 3.6

sudo systemctl stop mongod
sudo apt-key adv --keyserver hkp://keyserver.ubuntu.com --recv 2930ADAE8CAF5059EE73BB4B58712A2291FA4AD5
echo 'deb https://repo.mongodb.org/apt/ubuntu xenial/mongodb-org/3.6 multiverse' | sudo tee /etc/apt/sources.list.d/mongodb-org-3.6.list
apt update
sudo apt-get install -y --allow-downgrades mongodb-org=3.6.2 mongodb-org-server=3.6.2 mongodb-org-shell=3.6.2 mongodb-org-mongos=3.6.2 mongodb-org-tools=3.6.2
systemctl enable mongod
systemctl start mongod
systemctl status mongod

#instal mongo 4.0
sudo systemctl stop mongod
sudo apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv E52529D4
bash -c 'echo "deb http://repo.mongodb.org/apt/ubuntu xenial/mongodb-org/4.0 multiverse" > /etc/apt/sources.list.d/mongodb-org-4.0.list'
apt update
apt-get upgrade mongodb-org
systemctl enable mongod
systemctl start mongod
systemctl status mongod

#install mongo 4.2.8

mv /etc/mongod.conf /etc/mongod-4.2.conf
sudo systemctl stop mongod
sudo apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv 4B7C549A058F8B6B
bash -c 'echo "deb https://repo.mongodb.org/apt/ubuntu bionic/mongodb-org/4.2 multiverse" > /etc/apt/sources.list.d/mongodb-org-4.2.list'
apt update
apt-get upgrade mongodb-org
systemctl enable mongod
systemctl start mongod
systemctl status mongod



#1:
127.0.0.1,192.168.128.66,45.56.97.91


mongo repl 1:
45.56.97.91
192.168.128.66

mongo repl2:



mongo primary:
104.200.28.186
192.168.220.24

#2:
127.0.0.1,192.168.198.90,104.200.28.237


#3:
127.0.0.1,192.168.220.24,104.200.28.186
