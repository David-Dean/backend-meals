let express = require('express');
let app = express();
let bodyParser=require('body-parser');
const MongoClient = require('mongodb').MongoClient;
let multer = multer({dest: 'uploads/'});
app.use(bodyParse.raw({type: 'application/json'}));
const url = /*  here url  */ ;
let sha256 = require("sha256")