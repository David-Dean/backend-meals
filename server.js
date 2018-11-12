let sha256 = require("sha256");
let uuid = require('uuid/v1');
let fs = require('fs');
let express = require('express');
let app = express();
let bodyParser=require('body-parser');
let cookieParser = require('cookie-parser');
let multer = require('multer');
const MongoClient = require('mongodb').MongoClient;


const url = "mongodb://admin:password1@ds159993.mlab.com:59993/meals-db" ;

// Configure the express app with needed middleware
app.use(bodyParser.raw({type: ['application/*', 'text/*']}));// avoid parsing 'multipart/mixed' content types, let multer deal with that
app.use(cookieParser());

// Configure Multer storage (upload for images)
let multerStorage = multer.diskStorage({
    destination: '../frontend-meals/public/pictures/',
    filename: function (req, file, callback) { callback(null, uuid() + '_' + file.originalname) }
})

let upload = multer({storage: multerStorage});
