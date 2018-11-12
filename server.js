let express = require('express');
let app = express();
let bodyParser=require('body-parser');
const MongoClient = require('mongodb').MongoClient;
let multer = multer({dest: 'uploads/'});
app.use(bodyParse.raw({type: 'application/json'}));
const url = "mongodb://admin:password1@ds159993.mlab.com:59993/meals-db" ;
let sha256 = require("sha256")