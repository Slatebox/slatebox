mongosh mongodb+srv://my-user:37raqTaVJK83G1S@slatebox-mongo-svc.default.svc.cluster.local/admin?ssl=false

db.createUser({ user:'oplogger', pwd:'pwd', roles:[] })
db.runCommand({ createRole: "oplogger", privileges: [   { resource: { db: 'local', collection: 'system.replset'}, actions: ['find']}, ], roles: [{role: 'read', db: 'local'}] })
db.runCommand({ grantRolesToUser: 'oplogger', roles: ['oplogger']})

use slatebox

db.createUser({
  user: "sbuser",
  pwd: "jPyvYtQbzmrBifBJ",
  roles: [
    { role: "readWrite", db: "slatebox" }
  ]
});


# create backup of existing



# copy over backup

kubectl -n default cp sb-prod.yml slatebox-mongo-2:/tmp/