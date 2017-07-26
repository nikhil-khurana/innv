/**
 * @module jobQueue/tokens
 * @type {exports}
 */
var dbConstants = require('./../config/db_constants');
var config = require('./../config/vars.js');
var async = require('async');
//var moment = require('moment');

var tokenUrlModel = require('./../models/verifyTokens');
var jobTranModel  = require('./../models/jobTransactions');
var AWS = require('aws-sdk');
AWS.config.loadFromPath(config.awsPath + 'aws.json');
//added to get querystring features
var url = require('url');
var errors = require('common-errors');
//for reading csv file
var csv = require("fast-csv"),
	fs = require("fs"),
	path = require("path"),
	csvStream = csv.format({
		headers: true
	});
var underscore = require('underscore'); //underscore JS library

/**
 * Function updates the member count in job stats
 * @param transId {String} the transaction id
 * @param jID {String} the job id
 * @param gID {String} the group id
 * @param calBck {String} the callback function
 */

exports.asyncVerifyTknUpdate = function(Id, userId, req, res, callback) {
	console.log("Executing asyncVerifyTknUpdate Function");
	var storeData = [];
 	var Id = parseInt(Id);
	var userId = userId;
	var fileName = "";
	var tokenLength;
		
	var condition = {"id": Id, "upload_by.id": userId, "st": 0};
	var limit = 1000 , sort = {}, page = 1;
	tokenUrlModel.getToken(condition, limit, sort, page, function(err, total, results) {
		if (!err && results.length > 0) {
			async.waterfall([
				function(cb) {
					fileName = results[0].fileNm;
					//resetting CSV data
					csvData = new Array();
					console.log("Reading File: " + fileName);
					var s3 = new AWS.S3();
					var params = {
						Bucket: config.bucket,
						Key: fileName
					};
					var stream = s3.getObject(params).createReadStream();
					var csvStream = csv.parse().on("data", function(data) {
						storeData.push(data);
						if (data[0] != undefined) { // INVT-1637 fix
							csvData.push({
								"token": data[0]
							});
						}
					}).on("end", function() {
						console.log("done reading csv");
						if (csvData.length >= 75000) { //checking for file size
							cb(null, [], []);
						} else {
							if(csvData[0].token != "TOKEN"){
								tokenLength = csvData.length;
								var updateData = {
                                    "st": dbConstants.tokenUpload['fail']
                                };
                                tokenUrlModel.updateTokenFiles({"_id": results[0]._id}, updateData, function(err, memDoc) {
									if (err) {
										console.log("error while updating verifyTokenUpload " + err);
									}
									cb(true, fileName + " Is Invalid File Type");
								});
							}
							else{
								tokenLength = csvData.length-1;
								cb(null, fileName);
							}
						}
					});
					stream.pipe(csvStream);
				},
				function(fileName, cb) {
					console.log("Processing CSV Data For " + fileName);
					if (fileName != "") {
						var updateData = {
                            "st": dbConstants.tokenUpload['success']
                        };
                        tokenUrlModel.updateTokenFiles({"_id": results[0]._id}, updateData, function(err, updateSt) {
							if (err) {
								console.log("error while updating Tokens " + err);
								cb(true, "error while updating Tokens ");
							}else{
								console.log("success status updated succesfully");
								cb(null);
								// return res.status(200).json({"apiStatus": "success", "msg": "file upload success status updated succesfully"});
							}
						});
						
					}
				},function(cb){
					// verify Token schema Update with total count and total Matching of tokens
					var body= {"verified" :"true", "verifiedTknDt": new Date()} 
					var grpIdData = [];
					var grpData = results[0].group.filter(function(obj){
							grpIdData.push(obj.id);
							return(grpIdData);
					})
						
					var cond= {$and:[{"id":{$in:storeData}},{"grp.grpId":{$in: grpIdData}}]}
					jobTranModel.updateTransData(cond, body,{multi: true}, function(error, tknMatch){
						if(error){
							console.log("error in to updation in transaction model");
							// return res.status(400).json({"apiStatus" :"Failure" ,"message" :"Error in to updation in transaction model"})
						}
						if(tknMatch != undefined){
							totalTokenMatch = tknMatch;
							var countUpdate = {
								'cmp'     :totalTokenMatch,
								'tknUpld' : tokenLength
							}
							var tokenCond ={"_id": results[0]._id}
							tokenUrlModel.updateTokenFiles(tokenCond,countUpdate,function(error, response){
								if(error){
									console.log("error in update token count");
									return {"apiStatus": "Failure", "msg": "Error while to update in Token Schema"};
								}
								else{
									console.log("tokenData" , response);
								}
							})
						}
					})
							
				}

			],
			function(err, msg){
                console.log('failures' + msg);
                callback(msg);
        	});
		} else {
			console.log("No CSV file found to read");
			callback("No CSV file found to read", null);
		}
	});
};
