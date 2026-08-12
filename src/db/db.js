const mongoose=require('mongoose')

async function myDb() {
    await mongoose.connect(process.env.MONGODB_URL)


    console.log('connected to db');

}
module.exports=myDb