require('dotenv').config()
const app              = require('./src/app')
const myDb             = require('./src/db/db')
const { startScheduler } = require('./src/jobs/scheduler')
const PORT = 3000

myDb()

app.listen(PORT, () => {
    console.log(`server is running on ${PORT}`);
    startScheduler();
})