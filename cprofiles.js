"use strict";
//--------------------------------------------------------------------------
//Require statements
//--------------------------------------------------------------------------
var request = require('request');
var xml2js = require("xml2js");
var parser = new xml2js.Parser();
var auth = require('basic-auth');

//--------------------------------------------------------------------------
// Object to get Profiles information
//--------------------------------------------------------------------------
// Constructor
function CProfiles() {
  // always initialize all instance properties
  this.host = "https://apps.na.collabserv.com";

  this.userid = "";
  this.passwd = "";
}

//--------------------------------------------------------------------------
// Class methods
//--------------------------------------------------------------------------
//set the environment (na or ce)
CProfiles.prototype.setHost = function(host) {
  this.host = host;
  console.log("CProfiles : Setting the environment to : %s", host);
};

//--------------------------------------------------------------------------
//set the credentials
CProfiles.prototype.setCreds = function(userid, passwd) {
  this.userid = userid;
  this.passwd = passwd;
  console.log("CProfiles : credentials set for user %s", userid);
};

//--------------------------------------------------------------------------
// Search by Tag (the extra parameter can be null. It's simply used to pass along anything you might need in the callback
CProfiles.prototype.searchByTag = function(tagstring, extra, callback) {
  var myData = {};

  // Build the rest call to profiles
  var ccloudurl = this.host + "/profiles/atom/search.do?profileTags=" + tagstring;
  console.log("CProfiles : Issuing request : %s", ccloudurl);

  // Issue the request
  request.get(ccloudurl, function(error, response, body) {

    //Check for error
    if (error) {
      console.log("CProfiles : Error searching profiles:", error);
      return;
    }

    //Check for right status code
    if (response.statusCode !== 200) {
      console.log("CProfiles : Error searching profiles:", response.statusCode);
      return;
    }

    //All is good. Parse the xml
    parser.parseString(body, function(err, result) {
      if (err) {
        console.log("CProfiles : Error parsing xml:", error);
        return;
      }
      var resultcount = result.feed['opensearch:totalResults'][0];
      console.log("CProfiles : Found %s results", resultcount);
      myData.resultcount = resultcount;
      myData.tagsearch = tagstring;
      if (result.feed.entry) {
        // we have a result !
        var resultSet = result.feed.entry;
        var arrayLength = resultSet.length;
        var profileList = [];

        for (var i = 0; i < arrayLength; i++) {
          profileList.push({"userid": resultSet[i].contributor[0]['snx:userid'][0],
            "mail": resultSet[i].contributor[0].email[0],
            "name": resultSet[i].contributor[0].name[0],
            "photo": resultSet[i].content[0]['sp_' + i + ':div'][0].span[0].div[0].img[0].$.src,
            "title": resultSet[i].content[0]['sp_' + i + ':div'][0].span[0].div[7]._
          });
        }

        myData.results = profileList;
      }

      // All done, let's go back
      callback(extra, myData);
    });
  }).auth(this.userid, this.passwd);
};

//--------------------------------------------------------------------------
// Search by Tag (the extra parameter can be null. It's simply used to pass along anything you might need in the callback
CProfiles.prototype.searchById = function(id, extra, callback) {
  var myData = {};

  // Build the rest call to profiles
  var ccloudurl = this.host + "/profiles/atom/profileEntry.do?userid=" + id;
  console.log("CProfiles : Issuing request : %s", ccloudurl);

  // Issue the request
  request.get(ccloudurl, function(error, response, body) {

    //Check for error
    if (error) {
      console.log("CProfiles : Error searching profiles:", error);
      return;
    }

    //Check for right status code
    if (response.statusCode !== 200) {
      console.log("CProfiles : Error searching profiles:", response.statusCode);
      return;
    }

    //All is good. Parse the xml
    parser.parseString(body, function(err, result) {
      if (err) {
        console.log("CProfiles : Error parsing xml:", error);
        return;
      }
      var profileList = [];
      if (result.entry) {
        // we have a result !
        myData.userid = result.entry.contributor[0]['snx:userid'][0];
        myData.mail = result.entry.contributor[0].email[0];
        myData.name = result.entry.contributor[0].name[0];
        myData.photo = result.entry.content[0]['sp_0:div'][0].span[0].div[0].img[0].$.src;
        myData.title = result.entry.content[0]['sp_0:div'][0].span[0].div[7]._;
      } else {
        console.log("CProfiles : Error parsing xml, no result.");
      }

      profileList.push(myData);
      var experts = {};
      experts.results = profileList;

      // All done, let's go back
      callback(extra, experts);
    });
  }).auth(this.userid, this.passwd);
};

//--------------------------------------------------------------------------
// Search Fulltext (the extra parameter can be null. It's simply used to pass along anything you might need in the callback
CProfiles.prototype.searchFullText = function(searchstring, extra, callback) {
  var myData = {};

  // Build the rest call to profiles
  var ccloudurl = this.host + "/profiles/atom/search.do?ps=30&search=" + searchstring;
  console.log("CProfiles : Issuing request : %s", ccloudurl);

  // Issue the request
  request.get(ccloudurl, function(error, response, body) {

    //Check for error
    if (error) {
      console.log("CProfiles : Error searching profiles:", error);
      return;
    }

    //Check for right status code
    if (response.statusCode !== 200) {
      console.log("CProfiles : Error searching profiles:", response.statusCode);
      return;
    }

    //All is good. Parse the xml
    parser.parseString(body, function(err, result) {
      if (err) {
        console.log("CProfiles : Error parsing xml:", error);
        return;
      }
      var resultcount = result.feed['opensearch:totalResults'][0];
      console.log("CProfiles : Found %s results", resultcount);
      myData.resultcount = resultcount;
      myData.tagsearch = searchstring;
      if (result.feed.entry) {
        // we have a result !
        var resultSet = result.feed.entry;
        var arrayLength = resultSet.length;
        var profileList = [];

        for (var i = 0; i < arrayLength; i++) {
          profileList.push({"userid": resultSet[i].contributor[0]['snx:userid'][0],
            "mail": resultSet[i].contributor[0].email[0],
            "name": resultSet[i].contributor[0].name[0],
            "photo": resultSet[i].content[0]['sp_' + i + ':div'][0].span[0].div[0].img[0].$.src,
            "title": resultSet[i].content[0]['sp_' + i + ':div'][0].span[0].div[7]._
          });
        }

        myData.results = profileList;
      }

      // All done, let's go back
      callback(extra, myData);
    });
  }).auth(this.userid, this.passwd);
};

//--------------------------------------------------------------------------
// export the class
//--------------------------------------------------------------------------
module.exports = CProfiles;
