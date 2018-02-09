"use strict";
// --------------------------------------------------------------------------
// Require statements
// --------------------------------------------------------------------------
var express = require("express");
var bodyParser = require("body-parser");
var request = require("request");
var requestjs = require("request-json");
var crypto = require("crypto");
var _ = require('underscore');
var Cloudant = require("cloudant");

var cprofclass = require("./cprofiles");

// --------------------------------------------------------------------------
// Setup global variables
// --------------------------------------------------------------------------
var textBreakGQL = "\\r\\n";
var textBreak = "\r\n";

// Workspace API Setup - fixed stuff
const WWS_URL = "https://api.watsonwork.ibm.com";
const AUTHORIZATION_API = "/oauth/token";
const OAUTH_ENDPOINT = "/oauth/authorize";
const WEBHOOK_VERIFICATION_TOKEN_HEADER = "X-OUTBOUND-TOKEN".toLowerCase();

// ICS Log Setup
const LOG_APP = "IWWExpertFinder";
const LOG_FEATURE = "ExpertRequest";
var LOG_DC;
var LOG_AUTHOR;

// These should be entered as additional environment variables when running on
// Bluemix
// The Workspace App IDs
var APP_ID;
var APP_SECRET;
var APP_WEBHOOK_SECRET;
var APP_MODE = "PROD";

// cloudantNoSQLDB
var CLOUDANT_USER;
var CLOUDANT_PW;

// Connections Info
var CONNECTIONS_HOST;
var CONNECTIONS_USER;
var CONNECTIONS_PW;
var CONNECTIONS_ORGNAME;
var CONNECTIONS_AVATAR_URL;

// --------------------------------------------------------------------------
// Read environment variables
// --------------------------------------------------------------------------

// When not present in the system environment variables, dotenv will take them
// from the local file
require('dotenv').config({silent: true, path: 'my.env'});

// See if you can get them from Bluemix bound services (VCAP_SERVICES)
if (process.env.VCAP_SERVICES) {
  var bluemix_env = JSON.parse(process.env.VCAP_SERVICES);
  console.log("Checking VCAP_SERVICES");

  // Check if we have the cloudant api
  if (bluemix_env.cloudantNoSQLDB) {
    CLOUDANT_USER = bluemix_env.cloudantNoSQLDB[0].credentials.username;
    CLOUDANT_PW = bluemix_env.cloudantNoSQLDB[0].credentials.password;
    console.log("Cloudant API keys coming from Bluemix VCAP");
  } else {
    CLOUDANT_USER = process.env.CLOUDANT_USER;
    CLOUDANT_PW = process.env.CLOUDANT_PW;
    console.log("Cloudant API not found in VCAP_SERVICES, keys coming from local");
  }

} else {
  CLOUDANT_USER = process.env.CLOUDANT_USER;
  CLOUDANT_PW = process.env.CLOUDANT_PW;
  console.log("Cloudant API keys coming from local");
}

// Grab the rest from the bluemix env. or from the local env. file
// Workspace APP keys
APP_ID = process.env.APP_ID;
APP_SECRET = process.env.APP_SECRET;
APP_WEBHOOK_SECRET = process.env.APP_WEBHOOK_SECRET;

// Connections Info
CONNECTIONS_HOST = process.env.CONNECTIONS_HOST;
CONNECTIONS_USER = process.env.CONNECTIONS_USER;
CONNECTIONS_PW = process.env.CONNECTIONS_PW;
CONNECTIONS_ORGNAME = process.env.CONNECTIONS_ORGNAME;
CONNECTIONS_AVATAR_URL= process.env.CONNECTIONS_AVATAR_URL;

// Logging parameters
LOG_DC = process.env.LOG_DC;
LOG_AUTHOR = process.env.LOG_AUTHOR;

// --------------------------------------------------------------------------
// Setup Cloudant
// --------------------------------------------------------------------------
// Initialize the library with my account.
var cloudant = Cloudant({account: CLOUDANT_USER, password: CLOUDANT_PW});

// --------------------------------------------------------------------------
// Setup the express server
// --------------------------------------------------------------------------
var app = express();

// serve the files out of ./public as our main files
app.use(express.static(__dirname + "/public"));

// create application/json parser
var jsonParser = bodyParser.json();
var urlencodedParser = bodyParser.urlencoded({extended: false});

// --------------------------------------------------------------------------
// Express Server runtime
// --------------------------------------------------------------------------
// Start our server !
app.listen(process.env.PORT || 3000, function() {
  console.log("INFO: app is listening on port %s", (process.env.PORT || 3000));

  cloudant.db.list(function(err, allDbs) {
    console.log('Checking cloudant by listing all my databases: %s', allDbs.join(', '))
  });
});

//--------------------------------------------------------------------------
//This is where the configure App links enters
app.get("/configure", function(req, res) {
  console.log("INFO: Starting the configure app sequence ...");

  var spaceid = req.query.spaceId;
  console.log("Configuring space with id %s.", spaceid);

  var redirectpath = "/configure.html?spaceId=" + spaceid;

  res.redirect(redirectpath);
});

// --------------------------------------------------------------------------
// Save Configuration
/*app.post("/setconfig", urlencodedParser, function(req, res) {
  console.log("------------------------------------");
  console.log("Starting Save configuration for Space sequence");

  var connenv = req.body.envidchosen;
  var spaceid = req.body.spaceid;

  console.log("Saving environment %s for spaceid %s", connenv, spaceid);

  // Get the DB
  var expertfinderdb = cloudant.db.use("expertfinder");

  // check if we already have a record with spaceId as key.
  expertfinderdb.get(spaceid, {
    revs_info: false
  }, function(err, doc) {
    if (!err) {
      // update the refreshtoken
      doc.targetenv = connenv;

      expertfinderdb.insert(doc, spaceid, function(err, doc) {
        if (err) {
          console.log("Error adding config to database :", err.message);
        } else {
          console.log("Config updated for space", spaceid);
        }
      });
    } else {
      // it's a new record.
      expertfinderdb.insert({
        spaceid: spaceid,
        targetenv: connenv
      }, spaceid, function(err, body, header) {
        if (err) {
          return console.log("Error adding config to database :", err.message);
        }

        console.log("Config added to database for space", spaceid);
      });
    }
  });

  // It should always be use or create, so if we end up here, it failed.
  res.redirect("/configure-done.html");
});*/

// --------------------------------------------------------------------------
// Webhook entry point
app.post("/callback", jsonParser, function(req, res) {
  // Check if we have all the required variables
  if (!APP_ID || !APP_SECRET || !APP_WEBHOOK_SECRET) {
    console.log("ERROR: Missing variables APP_ID, APP_SECRET or WEBHOOK_SECRET from environment");
    return;
  }

  // Handle Watson Work Webhook verification challenge
  if (req.body.type === 'verification') {
    console.log('Got Webhook verification challenge ' + JSON.stringify(req.body));

    var bodyToSend = {
      response: req.body.challenge
    };

    var hashToSend = crypto.createHmac('sha256', APP_WEBHOOK_SECRET).update(JSON.stringify(bodyToSend)).digest('hex');

    res.set('X-OUTBOUND-TOKEN', hashToSend);
    res.send(bodyToSend);
    return;
  }

  // Ignore all our own messages
  if (req.body.userId === APP_ID) {
    console.log("Message from myself : abort");
    res.status(200).end();
    return;
  }

  // Ignore empty messages
  if (req.body.content === "") {
    console.log("Empty message : abort");
    res.status(200).end();
    return;
  }

  // Get the event type
  var eventType = req.body.type;
  console.log("Event Type:", eventType);

  // Get the spaceId
  var spaceId = req.body.spaceId;

  // Acknowledge we received and processed notification to avoid getting
  // sent the same event again
  res.status(200).end();

  // Act only on the events we need
  if (eventType === "message-annotation-added") {
    // Get the annotation type and payload
    var annotationType = req.body.annotationType;
    var annotationPayload = JSON.parse(req.body.annotationPayload);

    // Annotation from Watson Conversation integration
    if (annotationType === "message-focus") {
      // Get the lens of the focus
      var lens = annotationPayload.lens;

      // Only react on lens 'expertquery'
      if (lens === "expertquery") {
        console.log("Expert Query detected : " + annotationPayload.phrase);

        // No direct action here, Watson Workspace will underline and the user has the option to click.
      }

      if (lens === "comunidades"){
      	console.log("Estan preguntando por comunidades!!");
      }
    }

    // Action fulfillment callback - When user clicks and engages with App
    if (annotationType === "actionSelected") {
      var userName = req.body.userName;
      console.log("------- AF -------------------------------");
      console.log("%s clicked on an action link.", userName);

      // Extract the necessary info
      var targetUserId = req.body.userId;
      var conversationId = annotationPayload.conversationId;
      var targetDialogId = annotationPayload.targetDialogId;
      var referralMessageId = annotationPayload.referralMessageId;
      var actionId = annotationPayload.actionId;
      console.log("Action : %s", actionId);
      console.log("Referral Message Id : %s", referralMessageId);

      var gqlmessage = "query getMessage {message(id: \"" + referralMessageId + "\") {annotations}}";

      // Check for the various types of interaction
      //      ___       _______
      //     /   \     |   ____|
      //    /  ^  \    |  |__
      //   /  /_\  \   |   __|
      //  /  _____  \  |  |
      // /__/     \__\ |__|
      // ------------------------------------------

      // First click on underlined message
      if (actionId === "Get_Communities") {
        console.log("Estan preguntando por comunidades!!");

        // Get a Token
        getAuthFromAppIdSecret(APP_ID, APP_SECRET, function(error, accessToken) {
            if (error) {
              console.log("No se puede autenticar para enviar comunidad. No se mostraran resultados.");
            } else {
              // Building the message to send to the space.
              var messageData = {
                type: "appMessage",
                version: 1.0,
                annotations: [
                  {
                    type: "generic",
                    version: 1.0,
                    color: "#00B6CB",
                    title: env.CONNECTIONS_ORGNAME,
                    text: "He encontrado esta [comunidad](https://apps.na.collabserv.com/communities/service/html/communitystart?communityUuid=72e32051-b630-4330-aff4-fa0097e10a62&ftHelpTip=true)",
                    actor: {
                      name: actorname,
                      avatar: env.CONNECTIONS_AVATAR_URL,
                      url: ""
                    }
                  }
                ]
              };

              postCustomMessageToSpace(accessToken, spaceId, messageData, function(err, accessToken) {
                if (err) {
                  console.log("No se pued eenviar el mensaje de comunidad");
                }
              });
              // Preparing the dialog message
              var infomsg = "Encontré una Comunidad que te puede ayudar y la compartí en el Grupo. ¿Te puedo ayudar en algo más?";
              var afgraphql1 = "mutation {createTargetedMessage(input: {conversationId: \"" + conversationId + "\" targetUserId: \"" + targetUserId + "\" targetDialogId: \"" + targetDialogId + "\" annotations: [{genericAnnotation: {title: \"Expert details\" text: \"" + infomsg + "\" buttons: [";
              var afgraphql3 = "]}}]}){successful}}";

              // The buttons
              var afgraphql2 = "{postbackButton: {title: \"Buscar de nuevo ?\",id: \"Get_Communities\",style: SECONDARY}},{postbackButton: {title: \"No Gracias, Estoy bien\",id: \"STOP\",style: SECONDARY}}";

              var afgraphql = afgraphql1 + afgraphql2 + afgraphql3;

               // Send the dialog message
               postActionFulfillmentMessage(accessToken, afgraphql, function(err, accessToken) {});
             }
          });

      }

      if (actionId === "Get_Connections_Experts") {
        console.log("AF triggered by user.");

        // We first need to get back the annotations of the originating message to get the possible search terms.
        getAuthFromAppIdSecret(APP_ID, APP_SECRET, function(error, accessToken) {
          if (error) {
            console.log("Unable to authenticate. No results will be shown.");
          } else {
            callGraphQL(accessToken, gqlmessage, function(error, bodyParsed, accessToken) {
              if (!error) {
                var msgannotations = bodyParsed.data.message.annotations;

                // Loop over all the annotations and get the one we need
                for (var i = 0; i < msgannotations.length; i++) {
                  var ann = JSON.parse(msgannotations[i]);

                  // React on message-focus to catch the expert query
                  if (ann.type === "message-focus") {
                    // Get the lens of the focus
                    var lens = ann.lens;

                    // Only react on lens 'expertquery'
                    if (lens === "expertquery") {
                      console.log("Received Expert Query : " + ann.phrase);
                      console.log("JSON FRASE : ", ann);

                      var confidence = ann.confidence;
                      var extractedInfo = ann.extractedInfo;
                      var keywords = extractedInfo.keywords;
                      var arrayLength = keywords.length;
                      var keywordlist = [];
                      for (var j = 0; j < arrayLength; j++) {
                        // keywords can be multile words too. Split these as well.
                        var subkeywords = keywords[j].text.split(' ');
                        var subarrayLength = subkeywords.length;
                        for (var k = 0; k < subarrayLength; k++) {
                          keywordlist.push(subkeywords[k].toLowerCase());
                        }
                      }

                      // Check if certain keywords which suggest an expertise question are in the sentence and
                      // remove those before the search
                      var removefromlist = ["expert", "experts", "expertise", "sme", "help"];
                      var filteredlist = _.difference(keywordlist, removefromlist);
                      var tags = filteredlist.join('+');
                      var combs = combinations(filteredlist);

                      // Attach the confidence to the request body for later use
                      confidence = (confidence * 100).toFixed(2);
                      req.body.confidence = confidence;

                      console.log("Confidence is ", confidence);
                      console.log("Keywords are : ", filteredlist);
                      console.log("Possible combinations are : ", combs.join("+"));
                      console.log("We have an expert question ! Looking for %s", filteredlist.join(' '));

                      // Preparing the dialog message
                      var afgraphql1 = "mutation {createTargetedMessage(input: {conversationId: \"" + conversationId + "\" targetUserId: \"" + targetUserId + "\" targetDialogId: \"" + targetDialogId + "\" annotations: [{genericAnnotation: {title: \"Looking for an expert ?\" text: \"I'm " + confidence + "% sure you're looking for an expert and detected these possible search combinations. Please select one :\" buttons: [";
                      var afgraphql3 = "]}}]}){successful}}";

                      // Loop over the search combinations and generate the button syntax
                      var combsLen = combs.length;

                      // If there's only one search possibility, execute the search immediately
                      if (combsLen === 1) {
                        afSearch(conversationId, targetUserId, targetDialogId, spaceId, combs[0]);
                        return;
                      }

                      // If more than one, show all combinations as buttons.
                      var afgraphql2 = "";
                      for (var l = 0; l < combsLen; l++) {
                        if (l != 0) {
                          afgraphql2 += ",";
                        }
                        var srchterm = combs[l].toString().split(",").join("+");
                        afgraphql2 += "{postbackButton: {title: \"" + srchterm + "\",id: \"CSEARCH-" + srchterm + "\",style: PRIMARY}}";
                      }

                      // Add an extra button in case the user wants to cancel
                      afgraphql2 += ",{postbackButton: {title: \"No thanks, I'm good\",id: \"STOP\",style: SECONDARY}}";

                      var afgraphql = afgraphql1 + afgraphql2 + afgraphql3;

                      // Send the dialog message
                      postActionFulfillmentMessage(accessToken, afgraphql, function(err, accessToken) {});
                    }
                  }
                }
              }
            });
          }
        });
      }

      if (actionId.startsWith("CSEARCH")) {
        // Get the searchwords from the actionId
        var searchterm = actionId.slice(8, actionId.length);
        console.log("AF received searchterm : ", searchterm);

        afSearch(conversationId, targetUserId, targetDialogId, spaceId, searchterm);

        // ICS Logging - Now the app is really being used
        var httplogger = require('http');
        var httprequest = "http://ics-metrics.mybluemix.net/logger";
        httprequest += "?author=" + LOG_AUTHOR;
        httprequest += "&app=" + LOG_APP;
        httprequest += "&feature=" + LOG_FEATURE;
        httprequest += "&datacenter=" + LOG_DC;
        httprequest += "&user=" + userName;
        httprequest += "&communityName=" + req.body.spaceName;
        httprequest += "&query=" + searchterm;
        httprequest = encodeURI(httprequest);
        console.log("Logging to : " + httprequest);
        httplogger.get(httprequest);
      }

      if (actionId.startsWith("SHOWEXPERT")) {
        // Get the searchwords from the actionId
        var expertid = actionId.slice(11, actionId.length);
        console.log("AF received searchterm : ", expertid);

        afShow(conversationId, targetUserId, targetDialogId, spaceId, expertid);
      }

      if (actionId.startsWith("INVITE")) {
        // Get the searchwords from the actionId
        var actionsplit = actionId.split("****");
        //var expertid = actionId.slice(7, actionId.length);
        var expertid = actionsplit[1];
        var expertname = actionsplit[2];
        console.log("AF received INVITE for %s with id %s.", expertname, expertid);

        afInvite(conversationId, targetUserId, targetDialogId, spaceId, expertid, expertname);
      }

      if (actionId.startsWith("SHARE")) {
        // Get the searchwords from the actionId
        var expertid = actionId.slice(6, actionId.length);
        console.log("AF received SHARE for : ", expertid);

        afShare(conversationId, targetUserId, targetDialogId, spaceId, expertid);
      }

      if (actionId === "STOP") {
        console.log("AF received STOP");

        afStop(conversationId, targetUserId, targetDialogId, spaceId);
      }

    }

    return;
  }

  if (eventType === "message-created") {
    console.log("Message Created received.");
    console.log("Message Received:", req.body.content);

    if (req.body.content.indexOf("comunidad"))

    return;
  }

  // We don't do anything else, so return.
  console.log("INFO: Skipping unwanted eventType: " + eventType);
  return;
});

// --------------------------------------------------------------------------
// Action Fulfillment helper methods
// --------------------------------------------------------------------------

// ------------------------------------------
//      _______. _______     ___      .______        ______  __    __
//     /       ||   ____|   /   \     |   _  \      /      ||  |  |  |
//    |   (----`|  |__     /  ^  \    |  |_)  |    |  ,----'|  |__|  |
//     \   \    |   __|   /  /_\  \   |      /     |  |     |   __   |
// .----)   |   |  |____ /  _____  \  |  |\  \----.|  `----.|  |  |  |
// |_______/    |_______/__/     \__\ | _| `._____| \______||__|  |__|
// ------------------------------------------
function afSearch(conversationId, targetUserId, targetDialogId, spaceId, searchterm) {

  // Let's search Connections
  var cprof = new cprofclass();
  cprof.setHost(CONNECTIONS_HOST);
  cprof.setCreds(CONNECTIONS_USER, CONNECTIONS_PW);
  cprof.searchFullText(searchterm, null, function(extra, experts) {
    var numberOfExperts = experts.resultcount;
    var searchterm = experts.tagsearch;
    var results = experts.results;

    var afgraphql = "";

    // Debug
    //console.log("Received experts : %s", JSON.stringify(experts));

    // If we don't have any results, go back to the search dialog
    if (parseInt(numberOfExperts) === 0) {
      // Preparing the dialog message
      var afgraphql1 = "mutation {createTargetedMessage(input: {conversationId: \"" + conversationId + "\" targetUserId: \"" + targetUserId + "\" targetDialogId: \"" + targetDialogId + "\" annotations: [{genericAnnotation: {title: \"Expert details\" text: \"Sorry, couldn't find any experts. Do you want to try again ?\" buttons: [";
      var afgraphql3 = "]}}]}){successful}}";

      // The buttons
      var afgraphql2 = "{postbackButton: {title: \"Yes, please !\",id: \"Get_Connections_Experts\",style: PRIMARY}},{postbackButton: {title: \"No thanks, I'm good\",id: \"STOP\",style: SECONDARY}}";

      afgraphql = afgraphql1 + afgraphql2 + afgraphql3;
    } else if (parseInt(numberOfExperts) === 1) {
      var expertid = results[0].userid;

      // We only have one result, so show the expert right away.
      afShow(conversationId, targetUserId, targetDialogId, spaceId, expertid);
      return;
    } else {
      // Preparing the dialog message
      var afgraphql1 = "mutation {createTargetedMessage(input: {conversationId: \"" + conversationId + "\" targetUserId: \"" + targetUserId + "\" targetDialogId: \"" + targetDialogId + "\" annotations: [{genericAnnotation: {title: \"Results\" text: \"I've found these experts. Select one to get more details.\" buttons: [";
      var afgraphql3 = "]}}]}){successful}}";

      // Loop over the experts and generate the button syntax
      var expertsLen = results.length;
      console.log(expertsLen);
      var afgraphql2 = "";
      for (var i = 0; i < expertsLen; i++) {
        if (i != 0) {
          afgraphql2 += ",";
        }
        var btnlabel = results[i].name;
        var btnid = results[i].userid;
        afgraphql2 += "{postbackButton: {title: \"" + btnlabel + "\",id: \"SHOWEXPERT-" + btnid + "\",style: PRIMARY}}";
      }

      // Add an extra button in case the user wants to cancel
      afgraphql2 += ",{postbackButton: {title: \"Search Again ?\",id: \"Get_Connections_Experts\",style: SECONDARY}}";
      afgraphql2 += ",{postbackButton: {title: \"No thanks, I'm good\",id: \"STOP\",style: SECONDARY}}";

      afgraphql = afgraphql1 + afgraphql2 + afgraphql3;
    }

    // Send the dialog message
    getAuthFromAppIdSecret(APP_ID, APP_SECRET, function(error, accessToken) {
      postActionFulfillmentMessage(accessToken, afgraphql, function(err, accessToken) {});
    });
  });
}

// ------------------------------------------
//      _______. __    __    ______   ____    __    ____
//     /       ||  |  |  |  /  __  \  \   \  /  \  /   /
//    |   (----`|  |__|  | |  |  |  |  \   \/    \/   /
//     \   \    |   __   | |  |  |  |   \            /
// .----)   |   |  |  |  | |  `--'  |    \    /\    /
// |_______/    |__|  |__|  \______/      \__/  \__/
// ------------------------------------------
function afShow(conversationId, targetUserId, targetDialogId, spaceId, expertid) {
  // Search again in Connections.
  var cprof = new cprofclass();
  cprof.setHost(CONNECTIONS_HOST);
  cprof.setCreds(CONNECTIONS_USER, CONNECTIONS_PW);
  cprof.searchById(expertid, null, function(extra, experts) {
    var results = experts.results;

    var afgraphql = "";

    var expertname = results[0].name;
    var expertmail = results[0].mail;
    var experttitle = results[0].title;
    var expertid = results[0].userid;
    var expertmsg = formatExpertResult(expertname, experttitle, expertmail, expertid, spaceId, textBreakGQL, CONNECTIONS_HOST);

    // Check if this person has a workspace account as well.
    getAuthFromAppIdSecret(APP_ID, APP_SECRET, function(error, accessToken) {
      getUserId(accessToken, expertmail, function(error, personid, accessToken) {
        var afgraphql2 = "";
        // If we have a workspace account, add an invite to space button.
        if (!error) {
          afgraphql2 = "{postbackButton: {title: \"Invite to space\",id: \"INVITE****" + personid + "****" + expertname + "\",style: PRIMARY}},";
        }

        // Preparing the dialog message
        var afgraphql1 = "mutation {createTargetedMessage(input: {conversationId: \"" + conversationId + "\" targetUserId: \"" + targetUserId + "\" targetDialogId: \"" + targetDialogId + "\" annotations: [{genericAnnotation: {title: \"Expert details\" text: \"" + expertmsg + "\" buttons: [";
        var afgraphql3 = "]}}]}){successful}}";

        // The buttons
        afgraphql2 += "{postbackButton: {title: \"Share details with space\",id: \"SHARE-" + expertid + "\",style: PRIMARY}},{postbackButton: {title: \"Search Again ?\",id: \"Get_Connections_Experts\",style: SECONDARY}},{postbackButton: {title: \"No thanks, I'm good\",id: \"STOP\",style: SECONDARY}}";

        afgraphql = afgraphql1 + afgraphql2 + afgraphql3;

        // Send the dialog message
        postActionFulfillmentMessage(accessToken, afgraphql, function(err, accessToken) {});
      });
    });
  });
}

// ------------------------------------------
//  __  .__   __. ____    ____  __  .___________. _______
// |  | |  \ |  | \   \  /   / |  | |           ||   ____|
// |  | |   \|  |  \   \/   /  |  | `---|  |----`|  |__
// |  | |  . `  |   \      /   |  |     |  |     |   __|
// |  | |  |\   |    \    /    |  |     |  |     |  |____
// |__| |__| \__|     \__/     |__|     |__|     |_______|
// ------------------------------------------
function afInvite(conversationId, targetUserId, targetDialogId, spaceId, expertid, expertname) {
  // add the user to the space
  getAuthFromAppIdSecret(APP_ID, APP_SECRET, function(error, accessToken) {
    addUserToSpace(accessToken, spaceId, expertid, function(error, accessToken) {
      // Put a small notification in the space that the expert was added as a member.
      // Building the message to send to the space.
      var actorname = "At your request ...";
      var expertmsg = "... I have invited " + expertname + " into this space.";

      var messageData = {
        type: "appMessage",
        version: 1.0,
        annotations: [
          {
            type: "generic",
            version: 1.0,
            color: "#00B6CB",
            title: "",
            text: expertmsg,
            actor: {
              name: actorname,
              url: ""
            }
          }
        ]
      };

      postCustomMessageToSpace(accessToken, spaceId, messageData, function(err, accessToken) {
        if (err) {
          console.log("Unable to post custom message to space. No experts returned.");
        }
      });

      // Dynamic feedback message
      var infomsg = "";
      if (!error) {
        infomsg = "The user was successfully added to this space. Anything else you need ?";
      } else {
        infomsg = "I'm sorry, I was unable to add the expert to this space. Is there anything else I can help you with ?";
      }

      // Preparing the dialog message
      var afgraphql1 = "mutation {createTargetedMessage(input: {conversationId: \"" + conversationId + "\" targetUserId: \"" + targetUserId + "\" targetDialogId: \"" + targetDialogId + "\" annotations: [{genericAnnotation: {title: \"Expert details\" text: \"" + infomsg + "\" buttons: [";
      var afgraphql3 = "]}}]}){successful}}";

      // The buttons
      var afgraphql2 = "{postbackButton: {title: \"Search Again ?\",id: \"Get_Connections_Experts\",style: SECONDARY}},{postbackButton: {title: \"No thanks, I'm good\",id: \"STOP\",style: SECONDARY}}";

      var afgraphql = afgraphql1 + afgraphql2 + afgraphql3;

      // Send the dialog message
      postActionFulfillmentMessage(accessToken, afgraphql, function(err, accessToken) {});
    });
  });
}

// ------------------------------------------
//      _______. __    __       ___      .______       _______
//     /       ||  |  |  |     /   \     |   _  \     |   ____|
//    |   (----`|  |__|  |    /  ^  \    |  |_)  |    |  |__
//     \   \    |   __   |   /  /_\  \   |      /     |   __|
// .----)   |   |  |  |  |  /  _____  \  |  |\  \----.|  |____
// |_______/    |__|  |__| /__/     \__\ | _| `._____||_______|
// ------------------------------------------
function afShare(conversationId, targetUserId, targetDialogId, spaceId, expertid) {
    // Search again in Connections.
    var cprof = new cprofclass();
    cprof.setHost(CONNECTIONS_HOST);
    cprof.setCreds(CONNECTIONS_USER, CONNECTIONS_PW);
    cprof.searchById(expertid, null, function(extra, experts) {
      var results = experts.results;

      var afgraphql = "";

      var expertname = results[0].name;
      var expertmail = results[0].mail;
      var experttitle = results[0].title;
      var expertid = results[0].userid;
      var expertmsg = formatExpertResult(expertname, experttitle, expertmail, expertid, spaceId, textBreak, CONNECTIONS_HOST);
      var actorname = "I have found this expert within"

      // Get a Token
      getAuthFromAppIdSecret(APP_ID, APP_SECRET, function(error, accessToken) {
        if (error) {
          console.log("Unable to authenticate in printExperts. No results will be shown.");
        } else {
          // Building the message to send to the space.
          var messageData = {
            type: "appMessage",
            version: 1.0,
            annotations: [
              {
                type: "generic",
                version: 1.0,
                color: "#00B6CB",
                title: CONNECTIONS_ORGNAME,
                text: expertmsg,
                actor: {
                  name: actorname,
                  avatar: CONNECTIONS_AVATAR_URL,
                  url: ""
                }
              }
            ]
          };

          postCustomMessageToSpace(accessToken, spaceId, messageData, function(err, accessToken) {
            if (err) {
              console.log("Unable to post custom message to space. No experts returned.");
            }
          });

          // Preparing the dialog message
          var infomsg = "I've shared the expert details with the Space. Is there anything else I can do for you ?";
          var afgraphql1 = "mutation {createTargetedMessage(input: {conversationId: \"" + conversationId + "\" targetUserId: \"" + targetUserId + "\" targetDialogId: \"" + targetDialogId + "\" annotations: [{genericAnnotation: {title: \"Expert details\" text: \"" + infomsg + "\" buttons: [";
          var afgraphql3 = "]}}]}){successful}}";

          // The buttons
          var afgraphql2 = "{postbackButton: {title: \"Search Again ?\",id: \"Get_Connections_Experts\",style: SECONDARY}},{postbackButton: {title: \"No thanks, I'm good\",id: \"STOP\",style: SECONDARY}}";

          var afgraphql = afgraphql1 + afgraphql2 + afgraphql3;

          // Send the dialog message
          postActionFulfillmentMessage(accessToken, afgraphql, function(err, accessToken) {});
        }
      });

    });
}

// ------------------------------------------
//      _______.___________.  ______   .______
//     /       |           | /  __  \  |   _  \
//    |   (----`---|  |----`|  |  |  | |  |_)  |
//     \   \       |  |     |  |  |  | |   ___/
// .----)   |      |  |     |  `--'  | |  |
// |_______/       |__|      \______/  | _|
// ------------------------------------------
function afStop(conversationId, targetUserId, targetDialogId, spaceId) {
  var afgraphql = "mutation {createTargetedMessage(input: {conversationId: \"" + conversationId + "\" targetUserId: \"" + targetUserId + "\" targetDialogId: \"" + targetDialogId + "\" annotations: [{genericAnnotation: {title: \"OK\" text: \"No problem. You can safely close this window now.\"}}]}){successful}}";

  getAuthFromAppIdSecret(APP_ID, APP_SECRET, function(error, accessToken) {
    postActionFulfillmentMessage(accessToken, afgraphql, function(err, accessToken) {});
  });
}

// --------------------------------------------------------------------------
// App specific helper methods
// --------------------------------------------------------------------------
//
//  __    __   _______  __      .______    _______ .______
// |  |  |  | |   ____||  |     |   _  \  |   ____||   _  \
// |  |__|  | |  |__   |  |     |  |_)  | |  |__   |  |_)  |
// |   __   | |   __|  |  |     |   ___/  |   __|  |      /
// |  |  |  | |  |____ |  `----.|  |      |  |____ |  |\  \----.
// |__|  |__| |_______||_______|| _|      |_______|| _| `._____|
//
// --------------------------------------------------------------------------

// --------------------------------------------------------------------------
// Format the Expert results
function formatExpertResult(name, title, email, profileID, spaceId, newlinesequence, connections_host) {
  var profileURL = connections_host + "/profiles/html/profileView.do?userid=";
  var textMsg = "";

  if (typeof title == 'undefined') {
    title = "";
  } else {
    title = " (" + title + ")";
  }

  textMsg += "*" + name + "*" + title + newlinesequence;
  textMsg += "Email : [" + email + "](mailto:" + email + ")" + newlinesequence;
  textMsg += "Link to profile : [browser](" + profileURL + profileID + ") / [mobile](ibmscp://com.ibm.connections/profiles?userid=" + profileID + ")";

  return textMsg;
}

// --------------------------------------------------------------------------
// create combinations
// source from : https://gist.github.com/axelpale/3118596
function combinations(set) {
  var k,
    i,
    combs,
    k_combs;
  combs = [];

  // Calculate all non-empty k-combinations
  for (k = 1; k <= set.length; k++) {
    k_combs = k_combinations(set, k);
    for (i = 0; i < k_combs.length; i++) {
      combs.push(k_combs[i]);
    }
  }
  return combs;
}

function k_combinations(set, k) {
  var i,
    j,
    combs,
    head,
    tailcombs;

  // There is no way to take e.g. sets of 5 elements from
  // a set of 4.
  if (k > set.length || k <= 0) {
    return [];
  }

  // K-sized set has only one K-sized subset.
  if (k == set.length) {
    return [set];
  }

  // There is N 1-sized subsets in a N-sized set.
  if (k == 1) {
    combs = [];
    for (i = 0; i < set.length; i++) {
      combs.push([set[i]]);
    }
    return combs;
  }

  combs = [];
  for (i = 0; i < set.length - k + 1; i++) {
    // head is a list that includes only our current element.
    head = set.slice(i, i + 1);
    // We take smaller combinations from the subsequent elements
    tailcombs = k_combinations(set.slice(i + 1), k - 1);
    // For each (k-1)-combination we join it with the current
    // and store it to the set of k-combinations.
    for (j = 0; j < tailcombs.length; j++) {
      combs.push(head.concat(tailcombs[j]));
    }
  }
  return combs;
}

// --------------------------------------------------------------------------
// Generic helper methods (can be reused in other apps)
// --------------------------------------------------------------------------
//
//   _______  _______ .__   __.  _______ .______       __    ______
//  /  _____||   ____||  \ |  | |   ____||   _  \     |  |  /      |
// |  |  __  |  |__   |   \|  | |  |__   |  |_)  |    |  | |  ,----'
// |  | |_ | |   __|  |  . `  | |   __|  |      /     |  | |  |
// |  |__| | |  |____ |  |\   | |  |____ |  |\  \----.|  | |  `----.
//  \______| |_______||__| \__| |_______|| _| `._____||__|  \______|
//
// --------------------------------------------------------------------------
// GraphQL Create new Space
function callGraphQL(accessToken, graphQLbody, callback) {
  // Build the GraphQL request
  const GraphQLOptions = {
    "url": `${WWS_URL}/graphql`,
    "headers": {
      "Content-Type": "application/graphql",
      "x-graphql-view": "PUBLIC",
      "jwt": accessToken
    },
    "method": "POST",
    "body": ""
  };

  GraphQLOptions.headers.jwt = accessToken;
  GraphQLOptions.body = graphQLbody;

  // Create the space
  request(GraphQLOptions, function(err, response, graphqlbody) {
    if (!err && response.statusCode === 200) {
      //console.log(graphqlbody);
      var bodyParsed = JSON.parse(graphqlbody);
      callback(null, bodyParsed, accessToken);
    } else if (response.statusCode !== 200) {
      console.log("ERROR: didn't receive 200 OK status, but :" + response.statusCode);
      var error = new Error("");
      callback(error, null, accessToken);
    } else {
      console.log("ERROR: Can't retrieve " + GraphQLOptions.body + " status:" + response.statusCode);
      var error = new Error("");
      callback(error, null, accessToken);
    }
  });
}

// --------------------------------------------------------------------------
// GraphQL Create new Space
function createNewSpace(accessToken, spacename, callback) {
  // Build the GraphQL request
  const GraphQLOptions = {
    "url": `${WWS_URL}/graphql`,
    "headers": {
      "Content-Type": "application/graphql",
      "x-graphql-view": "PUBLIC",
      "jwt": accessToken
    },
    "method": "POST",
    "body": ""
  };

  GraphQLOptions.headers.jwt = accessToken;
  GraphQLOptions.body = "mutation createSpace{createSpace(input:{title:\"" + spacename + "\",members: [\"\"]}){space {id}}}";

  // Create the space
  request(GraphQLOptions, function(err, response, graphqlbody) {
    if (!err && response.statusCode === 200) {
      //console.log(graphqlbody);
      var bodyParsed = JSON.parse(graphqlbody);

      if (bodyParsed.data.createSpace) {
        var spaceid = bodyParsed.data.createSpace.space.id;
        console.log("Space created with ID", spaceid);
        callback(null, spaceid, accessToken);

      } else {
        var error = new Error("");
        callback(error, null, accessToken);
      }

    } else if (response.statusCode !== 200) {
      console.log("ERROR: didn't receive 200 OK status, but :" + response.statusCode);
      var error = new Error("");
      callback(error, null, accessToken);
    } else {
      console.log("ERROR: Can't retrieve " + GraphQLOptions.body + " status:" + response.statusCode);
      var error = new Error("");
      callback(error, null, accessToken);
    }
  });
}

// --------------------------------------------------------------------------
// graphQL Get Userid from mail
function getUserId(accessToken, email, callback) {
  // Build the GraphQL request
  const GraphQLOptions = {
    "url": `${WWS_URL}/graphql`,
    "headers": {
      "Content-Type": "application/graphql",
      "x-graphql-view": "PUBLIC",
      "jwt": "${jwt}"
    },
    "method": "POST",
    "body": ""
  };

  GraphQLOptions.headers.jwt = accessToken;
  GraphQLOptions.body = "query getProfile{person(email:\"" + email + "\") {id displayName}}";

  request(GraphQLOptions, function(err, response, graphqlbody) {

    if (!err && response.statusCode === 200) {
      //console.log(graphqlbody);
      var bodyParsed = JSON.parse(graphqlbody);
      if (bodyParsed.data.person) {

        var personid = bodyParsed.data.person.id;
        var personname = bodyParsed.data.person.displayName;
        console.log("Found user : " + personname + ", ID = " + personid);
        callback(null, personid, accessToken);
      } else {
        var error = new Error("");
        callback(error, "Sorry, can't find that user.", accessToken);
      }

    } else if (response.statusCode !== 200) {
      console.log("ERROR: didn't receive 200 OK status, but :" + response.statusCode);
      var error = new Error("");
      callback(error, null, accessToken);
    } else {
      console.log("ERROR: Can't retrieve " + GraphQLOptions.body + " status:" + response.statusCode);
      callback(err, null, accessToken);
    }
  });
}

// --------------------------------------------------------------------------
// graphQL Get a list of spaces
function getSpaces(accessToken, callback) {
  // Build the GraphQL request
  const GraphQLOptions = {
    "url": `${WWS_URL}/graphql`,
    "headers": {
      "Content-Type": "application/graphql",
      "x-graphql-view": "PUBLIC",
      "jwt": "${jwt}"
    },
    "method": "POST",
    "body": ""
  };

  GraphQLOptions.headers.jwt = accessToken;
  GraphQLOptions.body = "query getSpaces {spaces(first:200) {items {title id}}}";

  console.log("Calling GraphQL query getSpaces");
  request(GraphQLOptions, function(err, response, graphqlbody) {

    if (!err && response.statusCode === 200) {
      var bodyParsed = JSON.parse(graphqlbody);
      if (bodyParsed.data.spaces) {
        console.log("Got list of spaces");
        callback(null, bodyParsed.data.spaces, accessToken);
      } else {
        console.log("Graphql not returning any spaces, dumping return :");
        console.log(graphqlbody);
        var error = new Error("");
        callback(error, "error getting spaces", accessToken);
      }

    } else if (response.statusCode !== 200) {
      console.log("ERROR: didn't receive 200 OK status, but :" + response.statusCode);
      var error = new Error("");
      callback(error, null, accessToken);
    } else {
      console.log("ERROR: Can't retrieve " + GraphQLOptions.body + " status:" + response.statusCode);
      var error = new Error("");
      callback(err, null, accessToken);
    }
  });
}

//--------------------------------------------------------------------------
//graphQL Add user to Space
function addUserToSpace(accessToken, spaceid, userid, callback) {

  // Build the GraphQL request
  const GraphQLOptions = {
    "url": `${WWS_URL}/graphql`,
    "headers": {
      "Content-Type": "application/graphql",
      "x-graphql-view": "PUBLIC",
      "jwt": "${jwt}"
    },
    "method": "POST",
    "body": ""
  };

  GraphQLOptions.headers.jwt = accessToken;
  GraphQLOptions.body = "mutation updateSpaceAddMembers{updateSpace(input: { id: \"" + spaceid + "\",  members: [\"" + userid + "\"], memberOperation: ADD}){memberIdsChanged space {title membersUpdated members {items {id email displayName}}}}}";

  request(GraphQLOptions, function(err, response, graphqlbody) {

    if (!err && response.statusCode === 200) {
      //console.log(graphqlbody);
      var bodyParsed = JSON.parse(graphqlbody);
      callback(null, accessToken);
    } else if (response.statusCode !== 200) {
      console.log("ERROR: didn't receive 200 OK status, but :" + response.statusCode);
      var error = new Error("");
      callback(error, accessToken);
    } else {
      console.log("ERROR: Can't retrieve " + GraphQLOptions.body + " status:" + response.statusCode);
      callback(err, accessToken);
    }
  });
}

//--------------------------------------------------------------------------
//Post a message to a space
function postMessageToSpace(accessToken, spaceId, textMsg, callback) {
  var jsonClient = requestjs.createClient(WWS_URL);
  var urlToPostMessage = "/v1/spaces/" + spaceId + "/messages";
  jsonClient.headers.jwt = accessToken;

  // Building the message
  var messageData = {
    type: "appMessage",
    version: 1.0,
    annotations: [
      {
        type: "generic",
        version: 1.0,
        color: "#4178BE",
        title: "Email content :",
        text: textMsg,
        actor: {
          name: "IBM Verse",
          avatar: "",
          url: ""
        }
      }
    ]
  };

  // Calling IWW API to post message
  jsonClient.post(urlToPostMessage, messageData, function(err, jsonRes, jsonBody) {
    if (jsonRes.statusCode === 201) {
      console.log("Message posted to IBM Watson Workspace successfully!");
      callback(null, accessToken);
    } else {
      console.log("Error posting to IBM Watson Workspace !");
      console.log("Return code : " + jsonRes.statusCode);
      console.log(jsonBody);
      callback(err, accessToken);
    }
  });
}

//--------------------------------------------------------------------------
//Post a custom message to a space
function postCustomMessageToSpace(accessToken, spaceId, messageData, callback) {
  var jsonClient = requestjs.createClient(WWS_URL);
  var urlToPostMessage = "/v1/spaces/" + spaceId + "/messages";
  jsonClient.headers.jwt = accessToken;

  // Calling IWW API to post message
  jsonClient.post(urlToPostMessage, messageData, function(err, jsonRes, jsonBody) {
    if (jsonRes.statusCode === 201) {
      console.log("Message posted to IBM Watson Workspace successfully!");
      callback(null, accessToken);
    } else {
      console.log("Error posting to IBM Watson Workspace !");
      console.log("Return code : " + jsonRes.statusCode);
      console.log(jsonBody);
      callback(err, accessToken);
    }
  });
}

//--------------------------------------------------------------------------
//Post a message to a space
function postActionFulfillmentMessage(accessToken, afgraphql, callback) {
  // Build the GraphQL request
  const GraphQLOptions = {
    "url": `${WWS_URL}/graphql`,
    "headers": {
      "Content-Type": "application/graphql",
      "x-graphql-view": "PUBLIC, BETA",
      "jwt": "${jwt}"
    },
    "method": "POST",
    "body": ""
  };

  GraphQLOptions.headers.jwt = accessToken;
  GraphQLOptions.body = afgraphql;

  //console.log(GraphQLOptions.body);
  request(GraphQLOptions, function(err, response, graphqlbody) {
    //console.log(graphqlbody);

    if (!err && response.statusCode === 200) {

      var bodyParsed = JSON.parse(graphqlbody);
      callback(null, accessToken);
    } else if (response.statusCode !== 200) {
      console.log("ERROR: didn't receive 200 OK status, but :" + response.statusCode);
      var error = new Error("");
      callback(error, null, accessToken);
    } else {
      console.log("ERROR: Can't retrieve " + GraphQLOptions.body + " status:" + response.statusCode);
      callback(err, accessToken);
    }
  });
}

//--------------------------------------------------------------------------
//Get Authentication Token from an OAuth return code
function getAuthFromOAuthToken(app_id, app_secret, oauth_code, redirect_uri, callback) {
  // Build request options for authentication.
  const authenticationOptions = {
    "method": "POST",
    "url": `${WWS_URL}${AUTHORIZATION_API}`,
    "auth": {
      "user": app_id,
      "pass": app_secret
    },
    "form": {
      "grant_type": "authorization_code",
      "code": oauth_code,
      "redirect_uri": redirect_uri
    }
  };

  console.log("Issuing Authentication request with grant type 'authorization_code'");

  // Get the JWT Token
  request(authenticationOptions, function(err, response, authenticationBody) {
    // If successful authentication, a 200 response code is returned
    if (response.statusCode !== 200) {
      // if our app can't authenticate then it must have been
      // disabled. Just return
      console.log("ERROR: App can't authenticate");
      callback(err, null);
      return;
    }

    var reqbody = JSON.parse(authenticationBody);
    const accessToken = reqbody.access_token;
    const refreshToken = reqbody.refresh_token;
    const userName = reqbody.displayName;
    const userid = reqbody.id;

    callback(null, accessToken, refreshToken, userName, userid);
  });
}

//--------------------------------------------------------------------------
//Get Authentication Token from a Refresh token
function getAuthFromRefreshToken(app_id, app_secret, refreshToken, callback) {
  // Build request options for authentication.
  const authenticationOptions = {
    "method": "POST",
    "url": `${WWS_URL}${AUTHORIZATION_API}`,
    "auth": {
      "user": app_id,
      "pass": app_secret
    },
    "form": {
      "grant_type": "refresh_token",
      "refresh_token": refreshToken
    }
  };

  console.log("Issuing Authentication request with grant type 'refresh_token'");

  // Get the JWT Token
  request(authenticationOptions, function(err, response, authenticationBody) {
    if (err) {
      console.log("ERROR: Authentication request returned an error.");
      console.log(err);
      callback(err);
      return;
    }

    if (response.statusCode !== 200) {
      // App can't authenticate with refreshToken.
      // Just return an error
      var errormsg = "Error authenticating, statuscode=" + response.statusCode.toString();
      console.log("ERROR: App can't authenticate, statuscode =", response.statusCode.toString());
      callback(new Error(errormsg));
      return;
    }

    var reqbody = JSON.parse(authenticationBody);
    const accessToken = reqbody.access_token;
    const refreshToken = reqbody.refresh_token;
    const userName = reqbody.displayName;
    const userid = reqbody.id;

    callback(null, accessToken, refreshToken, userName, userid);
  });
}

//--------------------------------------------------------------------------
//Get an authentication token from AppId and secret
function getAuthFromAppIdSecret(app_id, app_secret, callback) {
  // Build request options for authentication.
  const authenticationOptions = {
    "method": "POST",
    "url": `${WWS_URL}${AUTHORIZATION_API}`,
    "auth": {
      "user": app_id,
      "pass": app_secret
    },
    "form": {
      "grant_type": "client_credentials"
    }
  };

  // Get the JWT Token
  request(authenticationOptions, function(err, response, authenticationBody) {
    if (err) {
      console.log("ERROR: Authentication request returned an error.");
      console.log(err);
      callback(err);
      return;
    }

    // If successful authentication, a 200 response code is returned
    if (response.statusCode !== 200) {
      // if our app can't authenticate then it must have been
      // disabled.
      var errormsg = "Error authenticating, statuscode=" + response.statusCode.toString();
      console.log("ERROR: App can't authenticate, statuscode =", response.statusCode.toString());
      callback(new Error(errormsg));
      return;
    }

    const accessToken = JSON.parse(authenticationBody).access_token;
    callback(null, accessToken);
  });
}
