let sha256 = require("sha256");
let uuid = require('uuid/v1');
let fs = require('fs');
let express = require('express');
let app = express();
let bodyParser=require('body-parser');
let cookieParser = require('cookie-parser');
let multer = require('multer');
const MongoClient = require('mongodb').MongoClient;

// Our database info
const url = "mongodb://admin:password1@ds159993.mlab.com:59993/meals-db" ;
const dbName = 'meals-db';

// Configure the express app with needed middleware
app.use(bodyParser.raw({type: ['application/*', 'text/*']}));// avoid parsing 'multipart/mixed' content types, let multer deal with that
app.use(cookieParser());

// Configure Multer storage (upload for images)
let multerStorage = multer.diskStorage({
    destination: '../frontend-meals/public/pictures/',
    filename: function (req, file, callback) { callback(null, uuid() + '_' + file.originalname) }
})

let upload = multer({storage: multerStorage});

/*******************
 *  Endpoints below
 ******************/

 app.post('/signup', function(req, res){
    // Parse the request body
    // We assume that the request uses the exact same fields as the users collection
    // So we'll use 'parsed' as our insert object directly
    let parsed = JSON.parse(req.body);

    // Connect to the db
    MongoClient.connect(url, function(err, client){
        
        if (err) throw err;

        let db = client.db(dbName);

        // Does the username already exist?
        db.collection('users').findOne({userName: parsed.userName}, function(err, result){

            if (err) throw err;

            // Already signed up, send failure response and close connection, .
            if (result)
            {
                res.send(JSON.stringify({
                    success: false,
                    msg: 'Username already signed up.'
                }));

                client.close();
            }
            else
            { 
                // Ok, we have a user to signup.
                // Deal with password hashing and salting (store the salt with the user's document)
                parsed.salt = uuid();
                parsed.password = sha256(parsed.password + parsed.salt);

                // We need a session id to write to both cookie and db,
                // Don't forget to write the user type to the cookie (for later auto login)
                // then we insert the document in the db and send success result
                parsed.sessionId = uuid();

                let date = new Date();
                date.setMinutes(date.getMinutes() + 30);// cookie expires in 30 min...
                res.cookie("sessionId", parsed.sessionId, {expire:date.toUTCString(), httpOnly:true});// httpOnly so Javascript can't access and mess with it
                res.cookie("host", parsed.host, {httpOnly: true});// We'll use this for auto login

                db.collection('users').insertOne(parsed, function(err, result){

                    if (err) throw err;

                    console.log("/signup user doc inserted: " + result.insertedCount);

                    res.send(JSON.stringify({
                        success: true,
                        host: parsed.host
                    }))

                    // All done, goodbye
                    client.close();
                })
            }
        })
    })
 })

 // A post to the /login endpoint means a form based login scenario (auto login will use get /login)
 app.post('/login', function(req, res){
     // Parse the request body.
     // We expect the same fields as in the database's user document
     let parsed = JSON.parse(req.body);

    // Connect to the db
    MongoClient.connect(url, function(err, client){

        if (err) throw err;

        let db = client.db(dbName);

        // Find the document with the provided userName
        let userDoc;

        db.collection('users').findOne({userName: parsed.userName}, function(err, result){

            if (err) throw err;

            // If there is no result, the login failed. Respond with failure and close db connection.
            if (!result)
            {
                res.send(JSON.stringify({
                    success: false,
                    msg: 'Username not found'
                }))

                client.close();
            }
            else
            {
                // Record found. keep a reference.
                userDoc = result; 
            }
        })

        // We may have a document for the user.
        // Does the password match our hashed and salted one?
        if (!userDoc ||
            !userDoc.password === sha256(parsed.password + userDoc.salt)) // no
        {
            // Send failure response and close db connection.
            res.send(JSON.stringify({
                success: false,
                msg: 'Wrong password'
            }))

            client.close();
        }
        else // We have a document and password is correct
        {
            // So our user has properly logged in.
            // Give him a sessionId (written to cookie and database collection)
            // Don't forget user type in the cookie
            // Then send success
            let sessionId = uuid();

            let date = new Date();
            date.setMinutes(date.getMinutes() + 30);// cookie expires in 30 min...
            res.cookie("sessionId", sessionId, {expire:date.toUTCString(), httpOnly:true});// httpOnly so Javascript can't access and mess with it
            res.cookie("host", userDoc.host, {httpOnly: true})

            db.collection('users').updateOne({userName: userDoc.userName}, {$set: {sessionId: sessionId}}, function(err, result){

                if (err) throw err;

                if (result.modifiedCount !== 1) throw new Error("post /login, failed to write sessionId to database");// Just to be on the safe side...
            })

            // Ok all done successfully!
            // The front end will need to know if this is a client or a host type of user
            // (Thing we also managed to write to the cookie for later automatic login)
            res.send(JSON.stringify({
                success: true,
                host: userDoc.host
            }))

            // All done, goodbye
            client.close();
        }
    })
 })

 app.get('/login', function(req, res){

    // Check that sessionId cookie is set on the request
    // If not, send failure, close db connection and quit (don't care to go further)
    if (!req.cookies.sessionId)
    {
        res.send(JSON.stringify({
            success: false
        }))

        client.close();

        return;
    }

    // Check in the db that the session id exists in our 'users' collection
    MongoClient.connect(url, function(err, client){

        if (err) throw err;

        let db = client.db(dbName);

        db.collection('users').findOne({sessionId: req.cookies.sessionId}, function(err, result){

            if (err) throw err;

            // If there is no result for the session id, login Nazi, no login for you!
            if (!result)
            {
                res.send(JSON.stringify({
                    success: false
                }))
            }
            else
            {
                // This user has already logged in and the cookie is still valid: Hello friend!
                res.send(JSON.stringify({
                    success: true,
                    host: req.cookies.host
                }))
            }

            // All done, goodbye
            client.close();
        })
    })
 })