let sha256 = require("sha256");
let uuid = require('uuid/v1');
let fs = require('fs');
let geolib = require('geolib');
let express = require('express');
let app = express();
let bodyParser = require('body-parser');
let cookieParser = require('cookie-parser');
let multer = require('multer');
const MongoDb = require('mongodb');
const MongoClient = MongoDb.MongoClient;

// Our database info
const url = "mongodb://admin:password1@ds159993.mlab.com:59993/meals-db";
const dbName = 'meals-db';

// Our server Port
const PORT = 4002;

// Configure the express app with needed middleware
app.use(bodyParser.raw({
    type: ['application/*', 'text/*']
})); // avoid parsing 'multipart/mixed' content types, let multer deal with that
app.use(cookieParser());

// Configure Multer storage (upload for images)
let multerStorage = multer.diskStorage({
    destination: '../frontend-meals/public/pictures/',
    filename: function (req, file, callback) {
        callback(null, uuid() + '_' + file.originalname)
    }
})

let upload = multer({
    storage: multerStorage
});

/***************************
 *  Login/Signup Endpoints 
 **************************/

app.post('/signup', function (req, res) {
    // Parse the request body
    // We assume that the request uses the exact same fields as the users collection
    // So we'll use 'parsed' as our insert object directly
    let parsed = JSON.parse(req.body);

    // Connect to the db
    MongoClient.connect(url, {useNewUrlParser: true}, function (err, client) {

        if (err) throw err;

        let db = client.db(dbName);

        // Does the username already exist?
        db.collection('users').findOne({
            userName: parsed.userName
        }, function (err, result) {

            if (err) throw err;

            // Already signed up, send failure response and close connection, .
            if (result) {
                res.send(JSON.stringify({
                    success: false,
                    msg: 'Username already signed up.'
                }));

                client.close();
            } else {
                // Ok, we have a user to signup.
                // Deal with password hashing and salting (store the salt with the user's document)
                parsed.salt = uuid();
                parsed.password = sha256(parsed.password + parsed.salt);

                // We need a session id to write to both cookie and db,
                // Don't forget to write the user type to the cookie (for later auto login)
                // then we insert the document in the db and send success result
                parsed.sessionId = uuid();

                let date = new Date();
                date.setMinutes(date.getMinutes() + 30); // cookie expires in 30 min...
                res.cookie("sessionId", parsed.sessionId, {
                    expire: date.toUTCString(),
                    httpOnly: true
                }); // httpOnly so Javascript can't access and mess with it
                res.cookie("userType", parsed.userType, {
                    httpOnly: true
                }); // We'll use this for auto login

                db.collection('users').insertOne(parsed, function (err, result) {

                    if (err) throw err;

                    console.log("/signup user doc inserted: " + result.insertedCount);

                    res.send(JSON.stringify({
                        success: true,
                        userType: parsed.userType,
                        userCoordinates: parsed.coordinates
                    }))

                    // All done, goodbye
                    client.close();
                })
            }
        })
    })
})

// A post to the /login endpoint means a form based login scenario (auto login will use get /login)
app.post('/login', function (req, res) {
    // Parse the request body.
    // We expect the same fields as in the database's user document
    let parsed = JSON.parse(req.body);

    // Connect to the db
    MongoClient.connect(url, {useNewUrlParser: true}, function (err, client) {

        if (err) throw err;

        let db = client.db(dbName);

        // Find the document with the provided userName
        db.collection('users').findOne({
            userName: parsed.userName
        }, function (err, result) {

            if (err) throw err;

            // If there is no result, the login failed. Respond with failure and close db connection.
            if (!result) {
                res.send(JSON.stringify({
                    success: false,
                    msg: 'Username not found'
                }))

                client.close();
            } else {
                // Record found
                // Does the password match our hashed and salted one?
                if (!result.password === sha256(result.password + result.salt)) // no
                {
                    // Send failure response and close db connection.
                    res.send(JSON.stringify({
                        success: false,
                        msg: 'Wrong password'
                    }))

                    client.close();
                } else // We have a document and password is correct
                {
                    // So our user has properly logged in.
                    // Give him a sessionId (written to cookie and database collection)
                    // Don't forget user type in the cookie
                    // Then send success
                    let sessionId = uuid();

                    let date = new Date();
                    date.setMinutes(date.getMinutes() + 30); // cookie expires in 30 min...
                    res.cookie("sessionId", sessionId, {
                        expire: date.toUTCString(),
                        httpOnly: true
                    }); // httpOnly so Javascript can't access and mess with it
                    res.cookie("userType", result.userType, {
                        httpOnly: true
                    })

                    db.collection('users').updateOne({
                        userName: result.userName
                    }, {
                        $set: {
                            sessionId: sessionId
                        }
                    }, function (err, result) {

                        if (err) throw err;

                        if (result.modifiedCount !== 1) throw new Error("post /login, failed to write sessionId to database"); // Just to be on the safe side...
                    })

                    // Ok all done successfully!
                    // The front end will need to know userType
                    // (Thing we also managed to write to the cookie for later automatic login)
                    res.send(JSON.stringify({
                        success: true,
                        userType: result.userType,
                        userCoordinates: result.coordinates
                    }))

                    // All done, goodbye
                    client.close();
                }
            }
        })
    })
})

// Assuming the frontend fetch request is made with 'credentials' option, the cookies are passed along the HTTP request by the browser
app.get('/login', function (req, res) {

    // Check that sessionId cookie is set on the request
    // If not, send failure and quit (don't care to go further)
    if (!req.cookies.sessionId) {
        res.send(JSON.stringify({
            success: false
        }))

        return;
    }

    // Check in the db that the session id exists in our 'users' collection
    MongoClient.connect(url, {useNewUrlParser: true}, function (err, client) {

        if (err) throw err;

        let db = client.db(dbName);

        db.collection('users').findOne({
            sessionId: req.cookies.sessionId
        }, function (err, result) {

            if (err) throw err;

            // If there is no result for the session id, login Nazi, no login for you!
            if (!result) {
                res.send(JSON.stringify({
                    success: false
                }))
            } else {
                // This user has already logged in and the cookie is still valid: Hello friend!
                res.send(JSON.stringify({
                    success: true,
                    userType: req.cookies.userType,
                    userName: result.userName,
                    userCoordinates: result.coordinates
                }))
            }

            // All done, goodbye
            client.close();
        })
    })
})

// We'll clear the cookies and the auto-login will stop working, the user still needs to be logged out on the frontend
app.get('/logout', function (req, res) {

    // Clear the 'sessionId' and 'userType' cookies
    res.clearCookie('sessionId', {
        httpOnly: true
    });
    res.clearCookie('userType', {
        httpOnly: true
    });

    // and we're done
    res.send(JSON.stringify({
        success: true
    }))
})

/*********************
 * Profile endpoints
 *********************/
//adding a Profile Picture and Bio to user or chef account
app.post('/setprofile', upload.single('file'), function (req, res) {

    // create the object with values to update the user document
    let updateObj = {
        bio: req.body.bio,
        profilePicturePath: '/pictures/' + req.file.filename
    }

    // Connect to the db
    MongoClient.connect(url, {useNewUrlParser: true}, function (err, client) {

        if (err) throw err;

        let db = client.db(dbName);

        // Update the document that has the provided userName
        db.collection('users').updateOne({
            userName: req.body.userName
        }, {
            $set: {
                bio: updateObj.bio,
                profilePicturePath: updateObj.profilePicturePath
            }
        }, function (err, result) {

            if (err) throw err;

            if (result.modifiedCount !== 1) // to be on the safe side
            {
                res.send(JSON.stringify({
                    success: false,
                    msg: 'Document update modified nothing...'
                }))
            } else {
                res.send(JSON.stringify({
                    success: true
                }))
            }

            // All done, goodbye
            client.close();
        })
    })
})
//adding a meal's information 
app.post('/addmeal', upload.single('image'), function (req, res) {

    //splitting the string of dietary restrictions into an array
    let dietObject = req.body.diet.split(',');
    console.log(dietObject)
    let ingredientObject = req.body.ingredients.split(',');

    let meal = {
        title: req.body.title,
        description: req.body.description,
        price: req.body.price,
        image: '/pictures/' + req.file.filename,
        ingredients: ingredientObject,
        diet: dietObject,
        userName: req.body.userName,
        coordinates: JSON.parse(req.body.coordinates)
    }

    //connect to the database
    MongoClient.connect(url, {useNewUrlParser: true}, function (err, client) {

        if (err) throw err;

        let db = client.db(dbName);

        //add the meal to the meal database
        db.collection('meals').insertOne(meal, function (err, result) {

            if (err) throw err;

            console.log(req.body.title + " has been added to the Database");

            res.send(JSON.stringify({
                success: true,
                msg: "Meal added to the Database",
                _id: result._id
            }))

            //disconnect from database
            client.close();
        })
    })
})

//removing a meal from chefDashboard
app.post('/removemeal', function (req, res){

    let parsed = JSON.parse(req.body)


    MongoClient.connect(url, {useNewUrlParser: true}, function(err, client){

        if (err) throw err;

        let db = client.db(dbName);

        let obj_id = MongoDb.ObjectID.createFromHexString(parsed._id);

        console.log(parsed)
        console.log(parsed._id)

        db.collection('meals').deleteOne({_id : obj_id}, function (err, result){
            if (err) throw err;

            if (result.deletedCount !== 1)
            {
                // inform of the situation
                res.send(JSON.stringify({
                    success: false,
                    msg: 'No request was deleted'
                }))
            }
            else
            {
            console.log('meal item removed from database')

            res.send(JSON.stringify({
                success: true
            }))

            }
        })
    })
})
// to display information about an individual meal
app.post('/getmealdescription', function (req, res) {

    let parsed = JSON.parse(req.body);

    var obj_id = MongoDb.ObjectID.createFromHexString(parsed._id);

    //connect to the db
    MongoClient.connect(url, {useNewUrlParser: true}, function (err, client) {

        if (err) throw err;

        let db = client.db(dbName);

        //Search 'meals' collection in db for matching mealId
        db.collection('meals').findOne({ _id: obj_id }, function (err, result) {

            if (err) throw err;

            if (!result) {
                res.send(JSON.stringify({
                    success: false
                }))
            } else {
                // Prepare the object we'll be sending back
                let resObj = {
                    success: true,
                    title: result.title,
                    description: result.description,
                    price: result.price,
                    ingredients: result.ingredients,
                    diet: result.diet,
                    image: result.image,
                    userName: result.userName,
                    _id: result._id
                }

                // Check if we have userCoordinates passed along the request,
                // if so, calculate the distance between that and the coordinates on the found meal
                let userCoords = parsed.userCoordinates;

                if (userCoords)
                {
                    resObj.distance = geolib.getDistance(userCoords, result.coordinates, 5);
                }

                res.send(JSON.stringify(resObj))
            }
            client.close()
        })
    })
})

//To display all meals on Browse Page
app.post('/getallmeals', function (req, res) {

    let parsed = JSON.parse(req.body);

    MongoClient.connect(url, {useNewUrlParser: true}, function (err, client) {

        if (err) throw err;

        let db = client.db(dbName);

        //return all items in the collection
        db.collection('meals').find({}).toArray(function (err, result) {

            if (err) throw err;

            // Check if we have userCoordinates in the request
            // If so, we'll calculate the distance between those and the meals' coordinates
            if (parsed.userCoordinates)
            {
                for (let i = 0; i < result.length; i++)
                {
                    result[i]['distance'] = geolib.getDistance(parsed.userCoordinates, result[i].coordinates, 5);
                }
            }
            
            res.send(JSON.stringify(result))
            
            client.close()
        })
    })
})
app.get('/getchef/:id', function (req, res) {

    let id = req.params.id

    MongoClient.connect(url, {useNewUrlParser: true}, function (err, client){

        if (err) throw err;

        let db = client.db(dbName);

        let query = {userName : id }

        db.collection('users').findOne(query, function (err, result){
            
            if (err) throw err;

            res.send(JSON.stringify(result));

            client.close();
         });
     }
  );
});


app.get('/getallchefs', function(req, res){

    MongoClient.connect(url, {useNewUrlParser: true}, function (err, client){

        if (err) throw err;

        let db = client.db(dbName);

        db.collection('users').find({userType:'chef'}).toArray(function (err, result) {

            if (err) throw err;

            else
            {
                res.send(JSON.stringify(result))
            }
            client.close()
    })
})
})
app.post('/getallchefs', function(req, res){

    let parsed = JSON.parse(req.body)

    MongoClient.connect(url, {useNewUrlParser: true}, function (err, client){

        if (err) throw err;
        
        let db = client.db(dbName);

        db.collection('users').find({userType:'chef'}).toArray(function (err, result) {

            if (err) throw err;

            else
            {
                if (parsed.userCoordinates)
            {
                for (let i = 0; i < result.length; i++)
                {
                    result[i]['distance'] = geolib.getDistance(parsed.userCoordinates, result[i].coordinates, 5);
                }
            }
                res.send(JSON.stringify(result))
            }
            client.close()
    })
})
})
app.post('/searchmeals', function (req, res) {

    let parsed = JSON.parse(req.body)
    
    MongoClient.connect(url, {useNewUrlParser: true}, function (err, client) {

        if (err) throw err;

        let db = client.db(dbName);

        let regex = new RegExp(parsed.query, "i")

        //return all items in the collection
        db.collection('meals').find({
            $or: [{
                title: regex
            }, {
                userName: regex
            }]
        }).toArray(function (err, result) {

            if (err) throw err;

            // Check if we have userCoordinates in the request
            // If so, we'll calculate the distance between those and the meals' coordinates
            if (parsed.userCoordinates)
            {
                for (let i = 0; i < result.length; i++)
                {
                    result[i]['distance'] = geolib.getDistance(parsed.userCoordinates, result[i].coordinates, 5);
                }
            }
            
            res.send(JSON.stringify(result))
            
            client.close()
        })
    })
})

// to get infomation for Chef Profile   
app.post('/getprofile', function (req, res) {

    let parsed = JSON.parse(req.body)

    MongoClient.connect(url, {useNewUrlParser: true}, function (err, client) {

        if (err) throw err;

        let db = client.db(dbName);

        // searching 'users' db to filter and return matching userName info 
        db.collection('users').findOne({
            userName: parsed.userName
        }, function (err, result) {

            if (err) throw err;

            if (!result) {
                res.send(JSON.stringify({
                    success: false
                }))
            } else {
                res.send(
                    JSON.stringify(result)
                )
            }
            client.close()
        })
    })
})
//to get all the meals offered by a selected chef
app.post('/getitemsbychef', function (req, res) {

    let parsed = JSON.parse(req.body)

    MongoClient.connect(url, {useNewUrlParser: true}, function (err, client) {

        if (err) throw err;

        let db = client.db(dbName);

        //find meals matching chef's username from  collection, return as array
        db.collection('meals').find({userName: parsed.userName}).toArray(function (err, result) {

            if (err) throw err;

            // Check if we have userCoordinates in the request
            // If so, we'll calculate the distance between those and the meals' coordinates
            if (parsed.userCoordinates)
            {
                for (let i = 0; i < result.length; i++)
                {
                    result[i]['distance'] = geolib.getDistance(parsed.userCoordinates, result[i].coordinates, 5);
                }
            }
            
            res.send(JSON.stringify(result))
            
            client.close()
        })
    })
})
//endpoint to place an order, activated when '*PlaceOrder*" is clicked from OrderBox
app.post('/placerequest', function (req, res) {

    let parsed = JSON.parse(req.body);

    MongoClient.connect(url, {useNewUrlParser: true}, function (err, client) {

        if (err) throw err;

        let db = client.db(dbName);

        db.collection('requests').insertOne(parsed, function (err, result) {

            if (err) throw err;

            res.send(JSON.stringify({
                success: true,
                msg: "request added to the Database",
            }))

            //disconnect from database
            client.close();


        })
    })
})

//when clientDashboard or chefDashboard is loaded, Requests component will fetch to this endpoint
//to receive all requests matching the userName of 
app.post('/getrequests', function (req, res) {

    let parsed = JSON.parse(req.body);

    MongoClient.connect(url, {useNewUrlParser: true}, function (err, client) {

        if (err) throw err;

        let db = client.db(dbName);

        //two cases; 
        //if user is a client, match for userName
        //if user is a chef, match for chefName
        if (parsed.userType === 'client') {

            db.collection('requests').find({userName: parsed.userName}).toArray(function (err, result) {

                if (err) throw err;

                if(result)
                {
                    res.send(JSON.stringify({
                        success: true,
                        result: result
                    }))
                }
                else
                {
                    res.send(JSON.stringify({
                        success: false,
                        msg: 'No requests found.'
                    }))
                }
            })
        }
        
        if (parsed.userType === "chef") {

            db.collection('requests').find({chefName: parsed.userName}).toArray(function (err, result) {

                if (err) throw err;

                if (result)
                {
                    res.send(JSON.stringify({
                        success: true,
                        result: result
                    }))
                }
                else
                {
                    res.send(JSON.stringify({
                        success: false,
                        msg: 'No request found.'
                    }))
                }
            })
        }

        // All done, bye
        client.close();
    })
})

//change the status of a request (0-1-2-3-4-5)
app.post('/updaterequeststatus', function(req, res){
    let parsed = JSON.parse(req.body);
    console.log(parsed)

    MongoClient.connect(url, {useNewUrlParser: true}, function(err, client){

        if (err) throw err;

        let db = client.db(dbName);
        let searchId = MongoDb.ObjectId.createFromHexString(parsed._id);

        // Update the document's status field
        db.collection('requests').updateOne({_id: searchId}, {$set:{requestStatus: parsed.status}}, function(err, result){

            if (err) throw err;

            // Did we manage to update a document at all?
            if(result.modifiedCount !== 1)
            {
                res.send(JSON.stringify({
                    success: false,
                    msg: 'No requests were updated, document probably not found...'
                }))
            }
            
                // Ok, so the request was updated, let's grab all of the collection and
                // send it back to the frontend
                
                let query=undefined
                if(parsed.userType==='chef'){
                    query={chefName:parsed.userName}
                }
                if (parsed.userType==="client"){
                    query={userName:parsed.userName}
                }
                db.collection('requests').find(query).toArray(function(err, result){

                    if (err) throw err;

                    
                    if (result)
                        {
                            res.send(JSON.stringify({
                                success: true,
                                result: result
                            }))
                            client.close();
                        }
                        else
                        {
                            res.send(JSON.stringify({
                                success: false,
                                msg: 'No request found.'
                            }))
                            // All done, bye
                            client.close();
                        }
                    })
                })
            })
        })

    
//to delete a request from ClientDashboard
app.post('/deleterequest', function(req, res){

    let parsed = JSON.parse(req.body);

    MongoClient.connect(url, {useNewUrlParser: true}, function(err, client){

        if (err) throw err;

        let db = client.db(dbName);

        let docId = MongoDb.ObjectId.createFromHexString(parsed._id);

        db.collection('requests').deleteOne({_id: docId}, function(err, result){

            if (err) throw err;

            if (result.deletedCount !== 1)
            {
                // inform of the situation
                res.send(JSON.stringify({
                    success: false,
                    msg: 'No request was deleted'
                }))
            }
            else
            {
                // We need to send back the whole collection of requests
                //two cases; 
                //if user is a client, match for userName
                //if user is a chef, match for chefName
                if (parsed.userType === 'client') {

                    db.collection('requests').find({userName: parsed.userName}).toArray(function (err, result) {

                        if (err) throw err;

                        if(result)
                        {
                            res.send(JSON.stringify({
                                success: true,
                                result: result
                            }))
                        }
                        else
                        {
                            res.send(JSON.stringify({
                                success: false,
                                msg: 'No requests found.'
                            }))
                        }
                    })
                }
                
                if (parsed.userType === "chef") {

                    db.collection('requests').find({chefName: parsed.userName}).toArray(function (err, result) {

                        if (err) throw err;

                        if (result)
                        {
                            res.send(JSON.stringify({
                                success: true,
                                result: result
                            }))
                        }
                        else
                        {
                            res.send(JSON.stringify({
                                success: false,
                                msg: 'No request found.'
                            }))
                        }
                    })
                }
            }

            // All done
            client.close();
        })
    })
})
/******************
 * Server listen
 ******************/
app.listen(PORT, function () {
    console.log('Server listening on port ' + PORT)
})