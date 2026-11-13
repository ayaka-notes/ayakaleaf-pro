// Deterministic seed for the Track A sensor test (run inside the fixture mongo).
//
// Expected gauges (ACTIVE_WINDOW_HOURS=6, INSTANCE_STATS_SEGMENTATION=true):
//   users   12 total = 9 standard + 3 guest (adminRoles contains 'guest-user')
//           active:  5 = 3 standard + 2 guest  (lastActive within 6h)
//   projects  7 total, 4 active (lastUpdated within 6h)
//   docs      9
const now = Date.now()
const H = 3600 * 1000
const within = h => new Date(now - h * H) // inside the 6h window
const outside = h => new Date(now - h * H) // outside it

db.users.deleteMany({})
db.projects.deleteMany({})
db.docs.deleteMany({})

const users = []
// 9 standard: u1-u3 active, u4-u9 inactive
for (let i = 1; i <= 9; i++)
  users.push({ username: `u${i}`, lastActive: i <= 3 ? within(1) : outside(10) })
// 3 guest: g1-g2 active, g3 inactive
for (let i = 1; i <= 3; i++)
  users.push({
    username: `g${i}`,
    adminRoles: ['guest-user'],
    lastActive: i <= 2 ? within(2) : outside(12),
  })
db.users.insertMany(users)

// 7 projects: p1-p4 active, p5-p7 inactive
const projects = []
for (let i = 1; i <= 7; i++)
  projects.push({ slug: `p${i}`, lastUpdated: i <= 4 ? within(1) : outside(8) })
db.projects.insertMany(projects)

// 9 docs
db.docs.insertMany([1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => ({ _id: `d${i}` })))

// Recommended indexes (the active-window counts are filtered queries)
db.users.createIndex({ lastActive: 1 })
db.projects.createIndex({ lastUpdated: 1 })
db.users.createIndex({ adminRoles: 1 })

print(`seeded: users=${db.users.countDocuments()} projects=${db.projects.countDocuments()} docs=${db.docs.countDocuments()}`)
