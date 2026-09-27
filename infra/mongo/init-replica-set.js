// Run by mongo1's healthcheck (unauthenticated, via the localhost exception) until the
// replica set exists and the database users have been created. See docker-compose.yml.

// 1. Initiate the replica set (once). hello() works without authentication; if the set is
//    already initiated (e.g. a previous run stopped before creating users), skip this step.
if (!db.hello().setName) {
  rs.initiate({
    _id: "rs0",
    members: [
      { _id: 0, host: "host.docker.internal:27017", priority: 2 },
      { _id: 1, host: "host.docker.internal:27018", priority: 1 },
      { _id: 2, host: "host.docker.internal:27019", priority: 1 },
    ],
  });
}

// 2. Users can only be created on the primary; wait for the election.
for (let i = 0; i < 60 && !db.hello().isWritablePrimary; i++) sleep(1000);
if (!db.hello().isWritablePrimary) quit(1);

// 3. Create users. The localhost exception allows creating the first user only, so create
//    root, authenticate as root, then create the rest.
const admin = db.getSiblingDB("admin");
const env = process.env;

admin.createUser({ user: env.MONGO_ROOT_USER, pwd: env.MONGO_ROOT_PASSWORD, roles: ["root"] });
admin.auth(env.MONGO_ROOT_USER, env.MONGO_ROOT_PASSWORD);

// Application user: read/write + schema admin on da2 (collMod for TTL, indexes), and
// clusterMonitor for the Admin health page (replSetGetStatus, serverStatus).
admin.createUser({
  user: env.MONGO_APP_USER,
  pwd: env.MONGO_APP_PASSWORD,
  roles: [
    { role: "readWrite", db: "da2" },
    { role: "dbAdmin", db: "da2" },
    { role: "clusterMonitor", db: "admin" },
  ],
});

// Analyst user: read-only. Used for all Product Growth Analyst queries (UC1–UC3).
admin.createUser({
  user: env.MONGO_ANALYST_USER,
  pwd: env.MONGO_ANALYST_PASSWORD,
  roles: [{ role: "read", db: "da2" }],
});

print("replica set initiated and users created");
