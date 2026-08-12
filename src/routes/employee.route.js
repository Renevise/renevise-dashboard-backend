const express = require('express')
const employeeRoute=express.Router()
const { createEmployee ,getAllEmployees,getSingleEmployee,updateEmployee,deletedUser} = require('../controller/employee.controller')
const authenticate = require('../middleware/authenticate')
const authorize = require('../middleware/authorize')

employeeRoute.post('/', authenticate, authorize('admin'), createEmployee)
employeeRoute.put('/:id', authenticate, authorize('admin'), updateEmployee)
employeeRoute.delete('/:id', authenticate, authorize('admin'), deletedUser)

employeeRoute.get('/', authenticate, authorize('admin'), getAllEmployees)
employeeRoute.get('/:id', authenticate, getSingleEmployee)

module.exports=employeeRoute
