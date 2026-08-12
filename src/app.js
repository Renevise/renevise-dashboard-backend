const express=require('express')
const route=require('./routes/user.route')
const employeeRoute=require('./routes/employee.route')
const attendanceRoute=require('./routes/attendance.route')
const leaveRoute=require('./routes/leave.route')
const notificationRoute=require('./routes/notification.route')
const correctionRoute=require('./routes/attendance-correction.route')
const overtimeRoute=require('./routes/overtime.route')
const companyOffRoute=require('./routes/company-off.route')
const clientOffRoute=require('./routes/client-off.route')
const cors=require('cors')
const app=express()


app.use(express.json())
app.use(cors())

app.use('/api/auth',route)
app.use('/api/employees',employeeRoute)
app.use('/api/attendance',attendanceRoute)
app.use('/api/leave',leaveRoute)
app.use('/api/notifications',notificationRoute)
app.use('/api/attendance-correction',correctionRoute)
app.use('/api/overtime',overtimeRoute)
app.use('/api/company-off',companyOffRoute)
app.use('/api/client-off',clientOffRoute)



module.exports=app