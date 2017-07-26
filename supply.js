/*
 * Controller for the questions collection objects
 * @module controllers/questions
 */

var questionsModel = require('./../models/questions');
var jobStatsModel = require('./../models/jobStats');
var jobTransModel = require('./../models/jobTransactions');
var quotaModel = require('./../models/quotas');
var jobModel = require('./../models/jobs');
var grpModel = require('./../models/groups');
var supModel = require('./../models/suppliers');
var memIdTans = require("./../models/memberIdTransactions");
var masterModel = require('./../models/masterData');
var grpTrgModel = require('./../models/groupTargets');
var companyModel = require('./../models/company');
var verifiedTknModel = require('../models/verifiedTokenJobStats');

var lib = require('./../lib/commonFunc');
var config = require('./../config/vars.js');
var errors = require('common-errors');
var async = require('async');
var dbConstants = require('./../config/db_constants');
var moment = require('moment');


/**
 * This function gets list of all questions by country
 * Content-Type application
 * @param req {Object} the request object
 * @param res {Object} the response object
 * @param next {Object} the error object
 */
exports.getQuestionsByCategory = function(req, res, next) {
    var country= 'US';      //setting default to US(for safe side) but it will not be needed as this function will always be called only if country is provided.

    if(req.params.country){
        country= req.params.country;
    }

    var cond = {};
    // get question categories for US and non US countries
    async.waterfall([
        function(callback) {
            if(req.params.country == 'US'){
                cond = {country : 'US'}
            }
            masterModel.getCategoryByCond(cond, "id category language", null, {}, function (err, qstnCategories) {
                if(err){
                    console.log("Error while fetching category for this Country: " + country);
                    next(new errors.HttpStatusError(400, { "apiStatus": "Failure", "msg": "Error while fetching category for this Country."}));
                }else {
                    if (qstnCategories && qstnCategories.length > 0){
                        callback(null, qstnCategories)
                    }
                    else{
                        console.log("No questions for category "+ qstnCategories);
                        next(new errors.HttpStatusError(404, { "apiStatus": "Failure", "msg": "No Data Found "}));
                    }
                }
            });
        },
        // function to call questions according to categoryId for US and questionKey for non US countries
        function(categoryDetails, callback){
            var condition;
            var catName = [];
            var language = [];
            var categoryIds = [];
            // to get category name, language according to category-id
            for (var i = categoryDetails.length - 1; i >= 0; i--){
                catName[categoryDetails[i].id] =  categoryDetails[i].category;
                language[categoryDetails[i].id] =  categoryDetails[i].language;
                categoryIds.push(categoryDetails[i].id)
            }
            if(req.params.country == 'US'){
                condition = {"Category": {$in: categoryIds}}
            } else {
                var qstnKeyArray = ['AGE', 'GENDER', 'EMPLOYMENT', 'RELATIONSHIP', 'PARENTAL_STATUS', 'INDUSTRY', 'JOB_TITLE', 
                        'STANDARD_ELECTRONICS', 'STANDARD_COMPANY_DEPARTMENT', 'STANDARD_GAMING_DEVICE', 'STANDARD_COMPANY_REVENUE', 'STANDARD_B2B_DECISION_MAKER', 'STANDARD_HOUSEHOLD_TYPE', 'STANDARD_No_OF_EMPLOYEES'];
                condition = {"QuestionKey": {$in: qstnKeyArray}}
            }
            questionsModel.getQuestions(condition, "QuestionKey QuestionText QuestionType Category", null, {}, function(err, questions) {
                if(err){
                    console.log("Error fetching questions for category id " + categoryIds);
                    callback(err, null)
                }
                else{
                    if(questions && questions.length > 0) {
                        // add category name and language fields
                        questions.map(function(qusObj){
                            qusObj['language'] = language[qusObj.Category];
                            qusObj['Category'] = catName[qusObj.Category];
                            return qusObj;
                        })
                    }
                    callback(null, questions)
                }
            });
        },
    ],function(err, questions){
        if (err){
            console.log("No data found for this Country: " + country);
            next(new errors.HttpStatusError(400, { "apiStatus": "Failure", "msg": "Error while fetching questions "}));
        } else{
            //Return final success data
            return res.status(200).json({
                "apiStatus": "success",
                "msg": "questions are successfully searched",
                "result": questions
            });
        }
    });
};


/**
 * This function get answerList corresponding to questionsId
 * Content-Type application
 * @param req {Object} the request object
 * @param res {Object} the response object
 * @param next {Object} the error object
 */
exports.getAnswersByQuesKey = function (req, res, next) {
    questionsModel.findQuestionByQuestionID({QuestionKey:req.params.quesKey}, 'QuestionText QuestionType QuestionOptions.OptionText QuestionOptions.id', function (err, doc) {
        if(err){
            console.log("Error while fetching data for QuestionKey: " + req.params.quesKey);
            next(new errors.HttpStatusError(400, { "apiStatus": "Failure", "msg": "Error while fetching data for QuestionKey"}));
        }else{    
            if(doc){     
                return res.status(200).json({
                    "apiStatus": "success",
                    "msg": "Answers are successfully searched",
                    "result": doc
                });
            }else{
                console.log("No data found for QuestionKey: " + req.params.quesKey);
                next(new errors.HttpStatusError(404, { "apiStatus": "Failure", "msg": "No data found"}));
            }
        }
    });
};

exports.getAllocatedSurveysV2 = function (req, res, next) {
    var supId = req.user.usr_id;
    var jobIds = [];
    var surveyIds = [];
    var filteredGroupIds = [], groupIndexes = {};
    jobStatsModel.getGroupsBySupId(supId, function(err, groups){
        if(err){
            console.log("Error while fetching live groups for Supplier: " + err);
            next(new errors.HttpStatusError(400, { "apiStatus": "Failure", "msg": "Error while fetching live groups for Supplier "+supId}));
        }else{
            if(groups && groups.length > 0){
                async.parallel({
                    setGroups: function (cb) {
                        groupIndexes = groups.reduce(function(ac, c, i){
                            if(jobIds.indexOf(c.id) == -1) {
                                jobIds.push(c.id);
                            }
                            ac[c.surveyId] = i;
                            return ac;
                        }, {});
                        surveyIds = Object.keys(groupIndexes);
                        cb();
                    },
                    languages: function (cb) {
                        var langList = {};
                        masterModel.getLanguages(function (err, langs) {
                            if(err){
                                console.log("Error while fetching all language names ", err);
                                next(new errors.HttpStatusError(400,{ "apiStatus": "Failure", "msg": "Error fetching languages list"}));
                            } else {
                                if (langs && langs.length > 0) {
                                    langList = langs.reduce(function (list, lng, i) {
                                        list[lng.id] = lng.name;
                                        return list;
                                    }, {});
                                } else {
                                    console.log("Error while fetching all language names")
                                }
                                cb(null, langList);
                            }
                        });
                    }, 
                    categories: function (cb) {
                        var categories = {};
                        masterModel.getCategoryByCond({}, "id category -_id", null, {}, function (err, catDetails) {
                            if(err){
                                console.log("Error while fetching all categories name ",err);
                                next(new errors.HttpStatusError(400, { "apiStatus": "Failure", "msg": "Error while fetching all categories name "}));
                            }else{
                                if (catDetails && catDetails.length > 0) {
                                    categories = catDetails.reduce(function (list, cat, i) {
                                        list[cat.id] = cat.category;
                                        return list;
                                    }, {});
                                } else {
                                    console.log("Error while fetching all category names")
                                } 
                                cb(null, categories);                                       
                            }
                        });  
                    }, 
                    jobCategories: function (cb) {
                        var jobCategories = {};
                        masterModel.getCategories(function (err, jobCats) {
                            if(err){
                                console.log("Error while fetching all job_categories name ",err);
                                next(new errors.HttpStatusError(400, { "apiStatus": "Failure", "msg": "Error while fetching all job_categories name "}));
                            }else{
                                if (jobCats && jobCats.length > 0) {
                                    jobCategories = jobCats.reduce(function (list, cat, i) {
                                        list[cat.id] = cat.name;
                                        return list;
                                    }, {});
                                } else {
                                    console.log("Error while fetching all category names")
                                } 
                                cb(null, jobCategories);                                       
                            }
                        });  
                    },
                    supplierDetail: function (cb) {
                        supModel.getSupplierDetailsBySupId(supId, function (supErr, supp) {
                            if(supErr){
                                console.log("Error while fetching supplier details ",supErr);
                                next(new errors.HttpStatusError(400, { "apiStatus": "Failure", "msg": "Error while fetching supplier details "}));
                            }else{
                                var cap_amount = (supp.cmsn.cap_amt) ? supp.cmsn.cap_amt : 0;
                                var adminFee = 0;
                                if(supp.cmsn.isAdFee == 1){    // is admin fee on
                                    // getting admin fee value from company collection
                                    var condition = {"id": parseInt(supp.cmp_id)};
                                    companyModel.getCompanyData(condition, 'gSettings.adm_fee', function(err, docs){
                                        if(err) {
                                            console.log("Error while fetching company details ",err);
                                            return next(new errors.HttpStatusError(400, { "apiStatus": "Failure", "msg": "Error while fetching company details "}));
                                        } else if(docs && docs.gSettings.adm_fee) {
                                            adminFee = docs.gSettings.adm_fee;
                                        }
                                        cb(null, {adminFee: adminFee, cap_amount:cap_amount});
                                    });
                                }
                                else{    // is admin fee off
                                    cb(null, {adminFee: adminFee, cap_amount:cap_amount});
                                }
                            }
                        });
                    }
                }, function (err, results) {
                    if (err) {
                        console.log("Error ", err);
                        return next(new errors.HttpStatusError(400, { "apiStatus": "Failure", "msg": "Error while fetching available surveys", "Error": err}));                        
                    }
                    var calculateCPI = function (grp, grpCPI, sup) {
                        if(grp.isRevShr == false && grp.supCPI >= 0){     // it means, Flat rate is on with some value
                            return grp.supCPI.toFixed(2);
                        }
                        else{
                            var cpiAfterAdminFee = grpCPI;
                            if(sup.adminFee > 0) {
                                cpiAfterAdminFee = (grpCPI - ((sup.adminFee/100) * grpCPI));
                            }
                            var cpiAfterRevShr = (grp.supCPI/100)* cpiAfterAdminFee;
                            
                            var CPI = cpiAfterRevShr.toFixed(2);
                            if(sup.cap_amount && cpiAfterRevShr > sup.cap_amount){
                                CPI = sup.cap_amount.toFixed(2);
                            }
                            return CPI;
                        }                                    
                    }
                    async.waterfall([function (cb) {
                        var filteredGroups = [], grpIds = {};
                        var condition = {id: {$in: surveyIds}};
                        if (req.params.datetime) {
                            condition["$or"] = [{"crtd_on": { $gt: lib.PSTtoGMT(new Date(req.params.datetime))}}, {"mod_on": { $gt: new Date(req.params.datetime)}}];
                        }
                        grpModel.getGroupByCondition(condition, "id CPI IR survNum grp_num_enc LOI trg dvc crtd_on mod_on mem_chk grp_typ gtrg", function (error, docs) {
                            if(error){
                                console.log("Error while fetching groups details ", error);
                                return next(new errors.HttpStatusError(400, { "apiStatus": "Failure", "msg": "Error while fetching groups details", "Error": error}));
                            }else{
                                if (docs && docs.length) {
                                    async.forEach(docs, function (grp, nextGrp) {
                                        if (groups[groupIndexes[grp.id]]) {
                                            groups[groupIndexes[grp.id]].grpCPI = grp.CPI;
                                            groups[groupIndexes[grp.id]].LOI = grp.LOI;
                                            groups[groupIndexes[grp.id]].IR = grp.IR;
                                            groups[groupIndexes[grp.id]].Country = grp.trg.cnt;
                                            groups[groupIndexes[grp.id]].Language = results.languages[grp.trg.lng[0]];
                                            groups[groupIndexes[grp.id]].groupType = ((grp.grp_typ != undefined) && (grp.grp_typ != null)) ? dbConstants.groupType[grp.grp_typ] : "";
                                            groups[groupIndexes[grp.id]].deviceType = dbConstants.groupDevice[grp.dvc]? dbConstants.groupDevice[grp.dvc]: dbConstants.groupDevice[6];
                                            if(grp.crtd_on){
                                                groups[groupIndexes[grp.id]].createdDate = lib.GMTtoPST(grp.crtd_on);
                                            }if(grp.mod_on){
                                                groups[groupIndexes[grp.id]].modifiedDate = lib.GMTtoPST(grp.mod_on);
                                            }
                                            groups[groupIndexes[grp.id]].reContact = (grp.mem_chk) ? true : false;
                                            groups[groupIndexes[grp.id]].entryLink = config.surveyUrl+"/startSurvey?survNum=" + grp.grp_num_enc + "&supCode=" + supId + "&PID=[%%pid%%]";
                                            groups[groupIndexes[grp.id]].testEntryLink = config.surveyUrl+"/startSurvey?Test=1&NotLive=1&survNum=" + grp.grp_num_enc + "&supCode=" + supId + "&PID=[%%pid%%]";
                                            groups[groupIndexes[grp.id]].targeting = grp.gtrg;
                                            groups[groupIndexes[grp.id]].CPI = calculateCPI(groups[groupIndexes[grp.id]], grp.CPI, results.supplierDetail);

                                            grpIds[grp.id] = filteredGroups.length;
                                            filteredGroups.push(groups[groupIndexes[grp.id]]); // It will be used for further processing instead of groups
                                        }
                                        nextGrp();
                                    }, function (err) {
                                        cb(null, filteredGroups, grpIds);
                                    });
                                } else {
                                    console.log("No data found for Groups: " + Object.keys(groupIndexes) + " -->Reason:- surveyId could be wrong or no data in DB related to this survey");
                                    cb(null);
                                }
                            }
                        });
                        
                    }], function (err, filteredGroups, grpIds) {
                        if (err) {
                            console.log("Error ", err);
                            return next(new errors.HttpStatusError(400, { "apiStatus": "Failure", "msg": "Error while setting up available surveys properties", "Error": err}));                        
                        }
                        if (filteredGroups && filteredGroups.length) {
                            surveyIds = Object.keys(grpIds).map(Number);
                            async.parallel([function (callback) {
                                // set job category
                                var cond = {id: {$in: jobIds}};
                                jobModel.getJobDetailsByCond(cond, 'ct id -_id', function (error, jobs) {
                                    if(error){
                                        console.log("Error while fetching job_category details ",error);
                                        return next(new errors.HttpStatusError(400, { "apiStatus": "Failure", "msg": "Error while fetching job details", "Error": error}));
                                    }else{                                        
                                        if (jobs && jobs.length) {
                                            for(var j = jobs.length-1; j >= 0; j--){ 
                                                filteredGroups.map(function(obj){                                                   
                                                    if(obj != undefined && obj.id == jobs[j].id){                                        
                                                        obj.jobCategory = results.jobCategories[jobs[j].ct];
                                                        delete obj.id;  // removing id from final response
                                                        delete obj.supCPI;
                                                        delete obj.grpCPI;
                                                    }
                                                });
                                            }
                                            callback();
                                        }
                                        else {
                                            console.log("No data found for Groups: " + surveyIds + " -->Reason:- surveyId could be wrong or no data in DB related to this survey");
                                            callback();
                                        }
                                    }
                                });
                            }, function (callback) {
                                // setup targeting
                                grpTrgModel.getTargetOptions({grp_num:{$in: surveyIds}}, {}, function (error, grpTrgs) {
                                    if(error) {
                                        console.log("Error while fetching group targeting details ", error);
                                        return next(new errors.HttpStatusError(400, { "apiStatus": "Failure", "msg": "Error while fetching survey questions", "Error": error}));
                                    }
                                    else if(grpTrgs && grpTrgs.length) { 
                                        //Get targeting question with their options
                                        async.eachSeries(grpTrgs, function (grpTrg, nextGrp) { 
                                            var targets = [];
                                            if (filteredGroups[grpIds[grpTrg.grp_num]] && filteredGroups[grpIds[grpTrg.grp_num]].targeting) {
                                                async.eachSeries(filteredGroups[grpIds[grpTrg.grp_num]].targeting, function (ques, nextQues) { 
                                                    var quesDetails = {};
                                                    quesDetails["QuestionKey"] = ques.q_key;
                                                    quesDetails["QuestionText"] = ques.q_txt;
                                                    quesDetails["QuestionType"] = ques.q_type;
                                                    quesDetails["QuestionCategory"] = results.categories[ques.q_cat];
                                                    quesDetails.Options = [];
                                                    if(grpTrg && grpTrg[ques.q_key] != undefined){
                                                        var quesOptions = grpTrg[ques.q_key];
                                                        for (var opt = 0; opt <= quesOptions.length-1; opt++){
                                                            if(ques.q_key == 'AGE'){
                                                                quesDetails.Options.push({
                                                                    OptionId : quesOptions[opt].opt_id,
                                                                    ageStart : quesOptions[opt].startAge,
                                                                    ageEnd : quesOptions[opt].endAge,
                                                                });
                                                            }else{
                                                                quesDetails.Options.push({
                                                                    OptionId : quesOptions[opt].opt_id,
                                                                    OptionText : quesOptions[opt].opt_txt
                                                                });
                                                            }
                                                        }
                                                    }
                                                    if(quesDetails.Options.length)
                                                        targets.push(quesDetails);

                                                    nextQues();
                                                }, function (err) {
                                                    // No error will be here
                                                    filteredGroups[grpIds[grpTrg.grp_num]].targeting = targets;
                                                    nextGrp();
                                                });
                                            }
                                            else {
                                                nextGrp();
                                            }
                                        }, function (err) {
                                            // No error will be here
                                            callback();                                    
                                        });
                                    }
                                    else {
                                        filteredGroups.map(function(group) {
                                            group.targeting = [];
                                        });
                                        console.log("No data found for Groups: " + surveyIds + " -->Reason:- surveyIds could be wrong or no data in DB related to this survey");
                                        callback();
                                    }  
                                });
                            }, function (callback) {
                                // setup quota
                                quotaModel.getQuotasGroupId({$in: surveyIds}, function(err, quotas){
                                    if(err){
                                        console.log("Error while fetching surveyIds which have Quotas",err);
                                        next(new errors.HttpStatusError(400, {
                                            "apiStatus": "Failure",
                                            "msg": "Error while getting list of all live groups associated to suppliers "
                                        }));
                                    }else {
                                        // compare and map isQuota flag true/false in response object which survey ids have quotas or not 
                                        filteredGroups.map(function(grpObj){
                                            if(quotas && quotas.length && quotas[0].surveyIds.indexOf(grpObj.surveyId) > -1){
                                                grpObj['isQuota'] = true;
                                            }
                                            else{
                                                grpObj['isQuota'] = false;
                                            }
                                        });
                                        callback();
                                    }
                                });
                            }], function (err) {
                                if (err) {
                                    console.log("Error", err);
                                    next(new errors.HttpStatusError(400, {
                                        "apiStatus": "Failure",
                                        "msg": "Error while getting list of all live groups associated to suppliers "
                                    }));                                
                                }
                                else {
                                    // send response
                                    return res.status(200).json({
                                            "apiStatus": "success",
                                            "msg": " All live groups are successfully searched",
                                            "result": filteredGroups
                                        });
                                }
                            });
                        }
                        else {
                            next(new errors.HttpStatusError(400, { "apiStatus": "Failure", "msg": "No surveys available"}));
                        }
                    });

                });
            }
            else { 
                console.log("No data found for Supplier: " + supId + " -->Reason:- surveyId could be wrong or no groups found in DB assigned to Supplier");
                next(new errors.HttpStatusError(404, { "apiStatus": "Failure", "msg": "No surveys available"}));
            }
        }
    })
}


/**
 * This function gets list of all live groups associated to suppliers
 * Content-Type application
 * @param req {Object} the request object
 * @param res {Object} the response object
 * @param next {Object} the error object
 */
exports.getAllocatedSurveys = function(req, res, next) {
    var surveyIds = new Array();
    var jobIds = new Array();
    var supId = req.user.usr_id;
    jobStatsModel.getGroupsBySupId(supId, function(err, groups){        
        if(err){
            console.log("Error while fetching live groups for Supplier: " + err);
            next(new errors.HttpStatusError(400, { "apiStatus": "Failure", "msg": "Error while fetching live groups for Supplier "+supId}));
        }else{
            if(groups && groups.length>0){
                var uniObj = {};
                groups.map(function(grp){
                    if(uniObj[grp.id] != true){
                        uniObj[grp.id] = true;
                        jobIds.push(grp.id);
                    }
                    surveyIds.push(grp.surveyId);
                });                
                var languages = [];
                var categories = [];
                var jobCategories = [];
                async.waterfall([
                    // function to get all Languages name to return Language in response
                    function (mainCallback) {
                        masterModel.getLanguages(function (err, languagesList) {
                            if(err){
                                console.log("Error while fetching all language names ", err);
                                next(new errors.HttpStatusError(400,{ "apiStatus": "Failure", "msg": "Error fetching languages list"}));
                            } else {
                                if (languagesList && languagesList.length > 0) {
                                    for (var lng = languagesList.length - 1; lng >= 0; lng--) {
                                        languages[languagesList[lng].id] =  languagesList[lng].name;
                                    }
                                } else {
                                    console.log("Error while fetching all language names")
                                }
                                mainCallback();
                            }
                        });
                    },
                    // function to get all categories name to return category name in response
                    function (mainCallback) {  
                        masterModel.getCategoryByCond({}, "id category -_id", null, {}, function (err, catDetails) {
                            if(err){
                                console.log("Error while fetching all categories name ",err);
                                next(new errors.HttpStatusError(400, { "apiStatus": "Failure", "msg": "Error while fetching all categories name "}));
                            }else{
                                if (catDetails && catDetails.length > 0) {
                                    for (var categry = catDetails.length - 1; categry >= 0; categry--) {
                                        categories[catDetails[categry].id] =  catDetails[categry].category;  
                                    }
                                } else {
                                    console.log("Error while fetching all category names")
                                } 
                                mainCallback();                                       
                            }
                        });  
                    }, 
                    // function to get all job_categories name to return jobCategory in response
                    function (mainCallback) {  
                        masterModel.getCategories(function (err, jobCats) {
                            if(err){
                                console.log("Error while fetching all job_categories name ",err);
                                next(new errors.HttpStatusError(400, { "apiStatus": "Failure", "msg": "Error while fetching all job_categories name "}));
                            }else{
                                if (jobCats && jobCats.length > 0) {
                                    for (var jobCt = jobCats.length - 1; jobCt >= 0; jobCt--) {
                                        jobCategories[jobCats[jobCt].id] =  jobCats[jobCt].name;  
                                    }
                                } else {
                                    console.log("Error while fetching all category names")
                                } 
                                mainCallback();                                       
                            }
                        });  
                    },
                    // function to fetch groups details
                    function (mainCallback) {
                        var cond = {id: {$in: surveyIds}};
                        grpModel.getGroupByCondition(cond, "id CPI IR survNum grp_num_enc LOI trg dvc crtd_on mod_on mem_chk grp_typ gtrg", function (error, doc) {
                            if(error){
                                console.log("Error while fetching groups details ", error);
                                return next(new errors.HttpStatusError(400, { "apiStatus": "Failure", "msg": "Error while fetching groups details", "Error": error}));
                            }else{
                                if (doc && doc.length) {
                                    for(var j = doc.length-1; j >= 0; j--){ 
                                        groups.map(function(obj, key){
                                            if(obj != undefined && obj.surveyId == doc[j].id){
                                                obj.grpCPI = doc[j].CPI;
                                                obj.LOI = doc[j].LOI;
                                                obj.IR = doc[j].IR;
                                                obj.Country = doc[j].trg.cnt;
                                                obj.Language = languages[doc[j].trg.lng[0]];
                                                obj.groupType = ((doc[j].grp_typ != undefined) && (doc[j].grp_typ != null)) ? dbConstants.groupType[doc[j].grp_typ] : "";
                                                obj.deviceType = dbConstants.groupDevice[doc[j].dvc]? dbConstants.groupDevice[doc[j].dvc]: dbConstants.groupDevice[6];
                                                if(doc[j].crtd_on){
                                                    obj.createdDate = lib.GMTtoPST(doc[j].crtd_on);
                                                }if(doc[j].mod_on){
                                                    obj.modifiedDate = lib.GMTtoPST(doc[j].mod_on);
                                                }
                                                obj.reContact = (doc[j].mem_chk) ? true : false;
                                                obj.entryLink = config.surveyUrl+"/startSurvey?survNum=" + doc[j].grp_num_enc + "&supCode=" + supId + "&PID=[%%pid%%]";
                                                obj.testEntryLink = config.surveyUrl+"/startSurvey?Test=1&NotLive=1&survNum=" + doc[j].grp_num_enc + "&supCode=" + supId + "&PID=[%%pid%%]";
                                                obj.targeting = doc[j].gtrg;
                                            }
                                        });
                                    }
                                    mainCallback();
                                } else {
                                    console.log("No data found for Groups: " + surveyIds + " -->Reason:- surveyId could be wrong or no data in DB related to this survey");
                                    mainCallback();
                                }
                            }                           
                        });
                    },
                    // function to supplier details and company details
                    function (mainCallback) {
                        supModel.getSupplierDetailsBySupId(supId, function (supErr, supp) {
                            if(supErr){
                                console.log("Error while fetching supplier details ",supErr);
                                next(new errors.HttpStatusError(400, { "apiStatus": "Failure", "msg": "Error while fetching supplier details "}));
                            }else{
                                var cap_amount = (supp.cmsn.cap_amt) ? supp.cmsn.cap_amt : 0;
                                var adminFee = 0;
                                if(supp.cmsn.isAdFee == 1){    // is admin fee on
                                    // getting admin fee value from company collection
                                    var condition = {"id": parseInt(supp.cmp_id)};
                                    companyModel.getCompanyData(condition, 'gSettings.adm_fee', function(err, docs){
                                        if(err) {
                                            console.log("Error while fetching company details ",err);
                                            return next(new errors.HttpStatusError(400, { "apiStatus": "Failure", "msg": "Error while fetching company details "}));
                                        } else if(docs && docs.gSettings.adm_fee) {
                                            adminFee = docs.gSettings.adm_fee;
                                        }
                                        mainCallback(null, adminFee, cap_amount);
                                    });
                                }
                                else{    // is admin fee off
                                    mainCallback(null, adminFee, cap_amount);
                                }
                            }
                        });
                    },
                    function(adminFee, cap_amount, mainCallback) {
                        async.parallel([
                            // function to calculate each suppliers CPI based on Admin_fee and cap_amount
                            function(cb){
                                async.forEach(groups, function(grp, supCallback) {
                                    // console.log("grpDetails ", grp);
                                    if(grp.isRevShr == false && grp.supCPI >= 0){     // it means, Flat rate is on with some value
                                        grp.CPI = grp.supCPI.toFixed(2);
                                        supCallback();
                                    }
                                    else{
                                        var supCPICalculate = function(cpiAfterAdminFee){
                                            var cpiAfterRevShr = (grp.supCPI/100)* cpiAfterAdminFee;
                                            
                                            grp.CPI = cpiAfterRevShr.toFixed(2);
                                            if(cap_amount && cpiAfterRevShr > cap_amount){
                                                grp.CPI = cap_amount.toFixed(2);
                                            }
                                            supCallback();
                                        };
                                        var cpiAfterAdminFee = grp.grpCPI;
                                        if(adminFee > 0) {
                                            cpiAfterAdminFee = (grp.grpCPI - ((adminFee/100) * grp.grpCPI));
                                        }
                                        supCPICalculate(cpiAfterAdminFee);
                                    }                                    
                                }, function(err) {
                                    if (err){
                                        console.log("No data found for Supplier: " + supId + " -->Reason:- surveyId could be wrong or no data in DB related to this Supplier",err);
                                        return next(new errors.HttpStatusError(400, { "apiStatus": "Failure", "msg": "Error while fetching details from jobstats by supplier Id "}));
                                    }
                                    cb();
                                });
                            },
                            // function to fetch job_category details
                            function(cb){ 
                                var cond = {id: {$in: jobIds}};
                                jobModel.getJobDetailsByCond(cond, 'ct id -_id', function (error, doc) {
                                    if(error){
                                        console.log("Error while fetching job_category details ",error);
                                    }else{                                        
                                        if (doc && doc.length) {
                                            for(var j = doc.length-1; j >= 0; j--){ 
                                                groups.map(function(obj){                                                   
                                                    if(obj != undefined && obj.id == doc[j].id){                                        
                                                        obj.jobCategory = jobCategories[doc[j].ct];
                                                        delete obj.id;  // removing id from final response
                                                        delete obj.supCPI;
                                                        delete obj.grpCPI;
                                                    }
                                                });
                                            }
                                            cb();
                                        } else {
                                            console.log("No data found for Groups: " + surveyIds + " -->Reason:- surveyId could be wrong or no data in DB related to this survey");
                                            cb();
                                        }
                                    }
                                });
                            },  
                            // function to fetch groups targeting options
                            function(cb) {
                                grpTrgModel.getTargetOptions({grp_num:{$in: surveyIds}}, {}, function (error, grpTrgs) {
                                    if(error) {
                                        console.log("Error while fetching group targeting details ", error);
                                        cb();
                                    }else if(grpTrgs && grpTrgs.length) { 
                                        var targetQues = [];
                                        //Get targeting question with their options
                                        groups.map(function(group, key) {
                                            var targets = [];
                                            async.eachSeries(group.targeting, function (ques, nextQues) {
                                                for (var i = 0; i <= grpTrgs.length - 1; i++) {
                                                    if(grpTrgs[i].grp_num == group.surveyId){
                                                        var quesDetails = {};
                                                        quesDetails["QuestionKey"] = ques.q_key;
                                                        quesDetails["QuestionText"] = ques.q_txt;
                                                        quesDetails["QuestionType"] = ques.q_type;
                                                        quesDetails["QuestionCategory"] = categories[ques.q_cat];
                                                        if(grpTrgs[i] && grpTrgs[i][ques.q_key] != undefined){
                                                            quesOptions = grpTrgs[i][ques.q_key];
                                                            quesDetails.Options = [];
                                                            for (var opt = 0; opt <= quesOptions.length-1; opt++){
                                                                if(ques.q_key == 'AGE'){
                                                                    quesDetails.Options.push({
                                                                        OptionId : quesOptions[opt].opt_id,
                                                                        ageStart : quesOptions[opt].startAge,
                                                                        ageEnd : quesOptions[opt].endAge,
                                                                    });
                                                                }else{
                                                                    quesDetails.Options.push({
                                                                        OptionId : quesOptions[opt].opt_id,
                                                                        OptionText : quesOptions[opt].opt_txt
                                                                    });
                                                                }
                                                            }
                                                        }
                                                        if(quesDetails.Options && quesDetails.Options.length)
                                                            targets.push(quesDetails);

                                                        break;
                                                    }
                                                }
                                                nextQues();
                                            }, function (err) {
                                                if(targets && targets.length)
                                                    group['targeting'] = targets;
                                                else
                                                    group['targeting'] = [];
                                            });
                                        }); 
                                        cb();
                                    }else{
                                        groups.map(function(group) {
                                            group.targeting = [];
                                        });
                                        console.log("No data found for Groups: " + surveyIds + " -->Reason:- surveyIds could be wrong or no data in DB related to this survey");
                                        cb();
                                    }  
                                });                             
                            },
                            //function to check stats survey ids have quota or not
                            function(cb){
                                //get suvery ids have Quotas
                                quotaModel.getQuotasGroupId({$in: surveyIds}, function(err, quotas){
                                    if(err){
                                        console.log("Error while fetching surveyIds which have Quotas",err);
                                        next(new errors.HttpStatusError(400, {
                                            "apiStatus": "Failure",
                                            "msg": "Error while getting list of all live groups associated to suppliers "
                                        }));
                                    }else {
                                        // compare and map isQuota flag true/false in response object which survey ids have quotas or not 
                                        groups.map(function(grpObj){
                                            if(quotas && quotas.length && quotas[0].surveyIds.indexOf(grpObj.surveyId) > -1){
                                                grpObj['isQuota'] = true;
                                            }else{
                                                grpObj['isQuota'] = false;
                                            }
                                        });
                                        cb();
                                    }
                                });
                            }      
                        ], function (error) {                
                            if (error) {
                               console.log("No data found -->Reason:- surveyId could be wrong or no live groups found in DB associated to suppliers",error);
                               return next(new errors.HttpStatusError(400, {
                                   "apiStatus": "Failure",
                                   "msg": "Error while getting list of all live groups associated to suppliers "
                               }));
                            }
                            mainCallback();
                        }); 
                    }   
                ], function (err) {                
                    if (err) {
                        console.log("No data found -->Reason:- surveyId could be wrong or no live groups found in DB associated to suppliers",err);
                        return next(new errors.HttpStatusError(400, {
                            "apiStatus": "Failure",
                            "msg": "Error while getting list of all live groups associated to suppliers "
                        }));
                    }
                    return res.status(200).json({
                            "apiStatus": "success",
                            "msg": " All live groups are successfully searched",
                            "result": groups
                        });
                });         
            }else{ 
                console.log("No data found for Supplier: " + supId + " -->Reason:- surveyId could be wrong or no groups found in DB assigned to Supplier");
                next(new errors.HttpStatusError(404, { "apiStatus": "Failure", "msg": "No surveys available"}));
            }
        }        
    })
};

/**
 * This function gets list of all live groups associated to suppliers after given datetime
 * Content-Type application
 * @param req {Object} the request object
 * @param res {Object} the response object
 * @param next {Object} the error object
 */
exports.getAllocatedSurveysByDate = function(req, res, next) {
    var supId = req.user.usr_id;
    var surveyIds = new Array();
    jobStatsModel.getGroupsBySupId(supId, function(err, groups){
        if(err){
            console.log("Error while fetching all live groups for Supplier: " + supId + " after given date time");
            next(new errors.HttpStatusError(400, { "apiStatus": "Failure", "msg": "Error while fetching live groups for Supplier "+supId + " after given date time"}));
        }else{
            if(groups && groups.length>0){
                var resultedGroups = [];
                var languages = [];
                var categories = [];
                var jobCategories = [];
                async.waterfall([
                    // function to get all Languages name to return Language in response
                    function (cb) {
                        masterModel.getLanguages(function (err, languagesList) {
                            if(err){
                                console.log("Error while fetching all language names ");
                                next(new errors.HttpStatusError(400,{ "apiStatus": "Failure", "msg": "Error fetching languages list"}));
                            } else {
                                if (languagesList && languagesList.length > 0) {
                                    for (var lng = languagesList.length - 1; lng >= 0; lng--) {
                                        languages[languagesList[lng].id] =  languagesList[lng].name;
                                    }
                                } else {
                                    console.log("Error while fetching all language names")
                                }
                                cb();
                            }
                        });
                    },
                    // function to get all categories name to return category name in response
                    function (cb) {  
                        masterModel.getCategoryByCond({}, "id category -_id", null, {}, function (err, catDetails) {
                            if(err){
                                console.log("Error while fetching all categories name ");
                                next(new errors.HttpStatusError(400, { "apiStatus": "Failure", "msg": "Error while fetching all categories name "}));
                            }else{
                                if (catDetails && catDetails.length > 0) {
                                    for (var categry = catDetails.length - 1; categry >= 0; categry--) {
                                        categories[catDetails[categry].id] =  catDetails[categry].category;  
                                    }
                                } else {
                                    console.log("Error while fetching all category names")
                                } 
                                cb();                                       
                            }
                        });  
                    }, 
                    // function to get all job_categories name to return jobCategory in response
                    function (cb) {  
                        masterModel.getCategories(function (err, jobCats) {
                            if(err){
                                console.log("Error while fetching all job_categories name ");
                                next(new errors.HttpStatusError(400, { "apiStatus": "Failure", "msg": "Error while fetching all job_categories name "}));
                            }else{
                                if (jobCats && jobCats.length > 0) {
                                    for (var jobCt = jobCats.length - 1; jobCt >= 0; jobCt--) {
                                        jobCategories[jobCats[jobCt].id] =  jobCats[jobCt].name;  
                                    }
                                } else {
                                    console.log("Error while fetching all category names")
                                } 
                                cb();                                       
                            }
                        });  
                    }, 
                    // function to fetch groups details
                    function(cb){
                        var condition = {$or: [{"crtd_on": { $gt: lib.PSTtoGMT(new Date(req.params.datetym))}},{"mod_on": { $gt: new Date(req.params.datetym)}}]};
                        grpModel.findGroups(condition, function (error, docs) {
                            if(error){
                                console.log("Error while fetching groups details after given date time");
                                next(new errors.HttpStatusError(400, { "apiStatus": "Failure", "msg": "Error while fetching groups details after given date time "}));
                            }else{
                                if (docs && docs.length>0) {

                                    for (var doc = docs.length - 1; doc >= 0; doc--) {
                                        for (var grp = groups.length - 1; grp >= 0; grp--) {
                                            // getting only those groups which are live, contains specified supplier and has date later than specified date
                                            if(docs[doc].id == groups[grp].surveyId){
                                                groups[grp].grpCPI = docs[doc].CPI;
                                                groups[grp].LOI = docs[doc].LOI;
                                                groups[grp].IR = docs[doc].IR;
                                                groups[grp].Country = docs[doc].trg.cnt;
                                                groups[grp].Language = languages[docs[doc].trg.lng[0]];
                                                groups[grp].groupType = ((docs[doc].grp_typ != undefined) && (docs[doc].grp_typ != null)) ? dbConstants.groupType[docs[doc].grp_typ] : "";
                                                groups[grp].deviceType = dbConstants.groupDevice[docs[doc].dvc];
                                                if(docs[doc].crtd_on){
                                                    groups[grp].createdDate = lib.GMTtoPST(docs[doc].crtd_on);
                                                }if(docs[doc].mod_on){
                                                    groups[grp].modifiedDate = lib.GMTtoPST(docs[doc].mod_on);
                                                }
                                                groups[grp].reContact = (docs[doc].mem_chk) ? true : false;
                                                groups[grp].entryLink = config.surveyUrl+"/startSurvey?survNum=" + docs[doc].grp_num_enc + "&supCode=" + supId + "&PID=[%%pid%%]";
                                                groups[grp].testEntryLink = config.surveyUrl+"/startSurvey?Test=1&NotLive=1&survNum=" + docs[doc].grp_num_enc + "&supCode=" + supId + "&PID=[%%pid%%]";

                                                resultedGroups.push(groups[grp]);
                                                surveyIds.push(groups[grp].surveyId);
                                            }
                                        }
                                    }                                    
                                } else {
                                    console.log("No data found for Group related to date'n'time: " + req.params.datetym + " -->Reason:- date'n'time could be wrong or no groups found in DB related to date'n'time");
                                }
                                cb();
                            }
                        });
                    },
                    // function to supplier details and company details
                    function (cb) {
                        supModel.getSupplierDetailsBySupId(supId, function (supErr, supp) {
                            if(supErr){
                                console.log("Error while fetching supplier details ");
                                next(new errors.HttpStatusError(400, { "apiStatus": "Failure", "msg": "Error while fetching supplier details "}));
                            }else{
                                var cap_amount = (supp.cmsn.cap_amt) ? supp.cmsn.cap_amt : 0;
                                var adminFee = 0;
                                if(supp.cmsn.isAdFee == 1){    // is admin fee on
                                    // getting admin fee value from company collection
                                    var condition = {"id": parseInt(supp.cmp_id)};
                                    companyModel.getCompanyData(condition, 'gSettings.adm_fee', function(err, docs){
                                        if(err) {
                                            console.log("Error while fetching company details ");
                                            return next(new errors.HttpStatusError(400, { "apiStatus": "Failure", "msg": "Error while fetching company details "}));
                                        } else if(docs && docs.gSettings.adm_fee) {
                                            adminFee = docs.gSettings.adm_fee;
                                        }
                                        cb(null, adminFee, cap_amount);
                                    });
                                }
                                else{    // is admin fee off
                                    cb(null, adminFee, cap_amount);
                                }
                            }
                        });
                    }, 
                    // function to calculate each suppliers CPI based on Admin_fee and cap_amount
                    function(adminFee, cap_amount, cb){
                        async.forEach(groups, function(grp, callback) {
                            if(grp.isRevShr == false && grp.supCPI >= 0){     // it means, Flat rate is on with some value
                                grp.CPI = grp.supCPI.toFixed(2);
                                callback();
                            }
                            else{
                                var supCPICalculate = function(cpiAfterAdminFee){
                                    var cpiAfterRevShr = (grp.supCPI/100)* cpiAfterAdminFee;
                                    
                                    grp.CPI = cpiAfterRevShr.toFixed(2);
                                    if(cap_amount && cpiAfterRevShr > cap_amount){
                                        grp.CPI = cap_amount.toFixed(2);
                                    }

                                    callback();
                                };

                                var cpiAfterAdminFee = grp.grpCPI;
                                if(adminFee > 0) {
                                    cpiAfterAdminFee = (grp.grpCPI - ((adminFee/100) * grp.grpCPI));                                            
                                }
                                supCPICalculate(cpiAfterAdminFee);
                            }
                        }, function(err) {
                            if (err){
                                console.log("No data found for Supplier: " + supId + " -->Reason:- surveyId could be wrong or no data in DB related to this Supplier");
                                return next(new errors.HttpStatusError(400, { "apiStatus": "Failure", "msg": "Error while fetching details from jobstats by supplier Id "}));
                            }
                            cb();
                        });
                    },
                    // function to fetch job_category details
                    function(cb){
                        async.forEach(groups, function(grp, grpCallback) { 
                            delete grp.supCPI;
                            delete grp.grpCPI;
                            jobModel.getJobDetailsByCond({id: grp.id}, 'ct -_id', function (error, doc) {
                                if(error){
                                    console.log("Error while fetching job_category details ");
                                }else{
                                    if (doc && doc.length) {
                                        grp.jobCategory = jobCategories[doc[0].ct];
                                        delete grp.id;  // removing id from fial response
                                    } else {
                                        console.log("No data found for Group: " + grp.surveyId + " -->Reason:- surveyId could be wrong or no data in DB related to this survey");
                                    }
                                }
                                grpCallback();
                            });
                        }, function(err) {
                            if (err){
                                console.log("No data found for Supplier: " + supId + " -->Reason:- surveyId could be wrong or no data in DB related to this Supplier");
                                return next(new errors.HttpStatusError(400, { "apiStatus": "Failure", "msg": "Error while fetching details from jobstats by supplier Id "}));
                            }
                            cb();
                           
                        });
                    },  
                    // function to fetch group targeting details
                    function(cb) {
                        async.forEach(resultedGroups, function(grp, trgCallback) {
                            grpTrgModel.getTargets({grp_num: parseInt(grp.surveyId), "fullTarget":true}, function (e, trgs) {
                                if(e){
                                    console.log("Error while fetching group targeting details ");
                                }else{
                                    if(trgs) {
                                        grp.targeting = [];
                                        for (var trg = trgs.length - 1; trg >= 0; trg--) {
                                            var qusObj = {
                                                QuestionKey : trgs[trg].q_key,
                                                QuestionText : trgs[trg].q_txt,
                                                QuestionType : trgs[trg].q_type,
                                                QuestionCategory : categories[trgs[trg].q_cat],
                                                // CategoryType : trgs[trg].type,
                                                Options : []
                                            };

                                            var trgOpt = trgs[trg].opts;
                                            for (var opt = trgOpt.length - 1; opt >= 0; opt--) {
                                                if(trgs[trg].q_key == 'AGE'){
                                                    qusObj.Options.push({
                                                        OptionId : trgOpt[opt].opt_id,
                                                        ageStart : trgOpt[opt].startAge,
                                                        ageEnd : trgOpt[opt].endAge,
                                                    });
                                                }else{
                                                    qusObj.Options.push({
                                                        OptionId : trgOpt[opt].opt_id,
                                                        OptionText : trgOpt[opt].opt_txt
                                                    });
                                                }
                                            }
                                            grp.targeting.push(qusObj);         
                                        }                                          
                                    }else{
                                        console.log("No data found -->Reason:- surveyId could be wrong or no data found in DB related to this survey");
                                    }
                                }
                                trgCallback();
                            });

                        }, function(err) {
                            if (err){
                                console.log("No data found -->Reason:- surveyId could be wrong or no data found in DB related to this survey");
                                return next(new errors.HttpStatusError(400, { "apiStatus": "Failure", "msg": "Error while fetching details from group_targets "}));
                            }
                            cb();
                        });
                    },
                    //function to check whether group has quota or not
                    function(cb){
                        quotaModel.getQuotasGroupId({$in: surveyIds}, function(err, quotas){
                            if(err){
                                console.log("Error while fetching surveyIds which have Quotas");
                                next(new errors.HttpStatusError(400, {
                                    "apiStatus": "Failure",
                                    "msg": "Error while getting list of all live groups associated to suppliers "
                                }));
                            }else if(quotas && quotas.length > 0){
                                resultedGroups.map(function(grpObj){
                                    if(quotas[0].surveyIds.indexOf(grpObj.surveyId) > -1){
                                        grpObj['isQuota'] = true;
                                    }else{
                                        grpObj['isQuota'] = false;
                                    }
                                });
                                cb();
                            }else{
                                cb(true);
                            }
                        });
                    }
                ], function (error) {
                    if (error) {
                        console.log("No data found -->Reason:- surveyId could be wrong or no data found in DB related to this survey");
                        return next(new errors.HttpStatusError(400, {
                            "apiStatus": "Failure",
                            "msg": "Error while getting list of all live groups associated to suppliers "
                        }));
                    }

                    return res.status(200).json({
                        "apiStatus": "success",
                        "msg": " All live groups are successfully searched",
                        "result": resultedGroups
                    });
                });
            }else{
                console.log("No data found for supplier: "+supId+" -->Reason:- supplierId could be wrong or no data found in DB related to this supplier");
                next(new errors.HttpStatusError(404, { "apiStatus": "Failure", "msg": "No surveys available"}));
            }
        }
    })
};


/**
 * This function get Quota for Survey
 * Content-Type application
 * @param req {Object} the request object
 * @param res {Object} the response object
 * @param next {Object} the error object
 */
exports.getQuotaForSurvey = function (req, res, next) {
    var supId = req.user.usr_id;
    jobStatsModel.supplierStats(parseInt(req.params.survNum), supId, function (err, obj) {
        if(err) {
            console.log("Error while fetching supplier stats");
            next(new errors.HttpStatusError(400, { "apiStatus": "Failure", "msg": "Error while fetching supplier stats, Please check your request again."}));
        } 
        else {
            if (obj && obj.length > 0) {
                var quotaCond = {'grpId': parseInt(req.params.survNum), st: {$in:[dbConstants.quotaStatus['Closed'], dbConstants.quotaStatus['Open']]}};
                quotaModel.getQuotas(quotaCond, 'title quotaN quotaName hardStop hardStopType conditions st cmp clk', null, {}, function (err, quota) {
                    if(err) {
                        console.log("Error while fetching quota for survey: " + req.params.survNum +" and supplierId: "+supId);
                        next(new errors.HttpStatusError(400, { "apiStatus": "Failure", "msg": "Error while fetching quota for surveyId: "+req.params.survNum+" and supplierId: "+supId+", Please check your request again."}));
                    } 
                    else {
                        if (quota && quota.length> 0) {
                            var quotaSt = lib.array_flip(dbConstants.quotaStatus);
                            quota.map(function(obj){
                                obj.quotaStatus = quotaSt[obj.st];
                                delete obj.st;

                                if(obj.hardStop){
                                    obj.hardStop = 1;
                                }
                                else{
                                    obj.hardStop = 0;
                                }
                                if(obj.hardStop && obj.hardStopType == 1){
                                    obj['RemainingN'] = (obj.quotaN - obj.clk) > 0 ? obj.quotaN - obj.clk : 0;
                                }
                                else{
                                    obj['RemainingN'] = (obj.quotaN - obj.cmp) > 0 ? obj.quotaN - obj.cmp : 0;
                                }
                                obj.targeting = obj.conditions;
                                delete obj.conditions;

                            });            
                            return res.status(200).json({
                                "apiStatus": "success",
                                "msg": "Quotas are successfully searched",
                                "result": quota
                            });
                        }
                        else{
                            console.log("No data found for survey: " + req.params.survNum +" and supplierId: "+supId  +" -->Reason:-surveyId could be wrong or no data present in DB related to this Survey and supplier:");
                            next(new errors.HttpStatusError(404, { "apiStatus": "Failure", "msg": "No data found for surveyId: "+req.params.survNum+" and supplierId: "+supId+", Please check your request again."}));
                        }
                    }
                });
            }
            else{
                console.log("No data found for survey: " + req.params.survNum +" and supplierId: "+supId  +" -->Reason:-surveyId could be wrong or no data present in DB related to this Survey and supplier:");
                next(new errors.HttpStatusError(404, { "apiStatus": "Failure", "msg": "No data found for surveyId: "+req.params.survNum+" and supplierId: "+supId+", Please check your request again."}));
            }
        }
    });    
};

/**
 * Function to update the selected supplier to the group
 * Content-Type application
 * @param req {Object} the request object
 * @param res {Object} the response object
 * @param next {Object} the error object
 */
exports.setRedirectionForSurvey = function(req, res, next) {
    var grpId = parseInt(req.params.survNum);
    var supId = req.user.usr_id;
    var supplier = {};

    var result = supModel.getSupplierDetails(false, supId, function(err, docs) {
        if(err) {
            console.log("Error while fetching supplier details for supplier: "+supId+" -->Reason:- supplierId could be wrong or no data found in DB related to this supplier");
            next(new errors.HttpStatusError(400, { "apiStatus": "Failure", "msg": "Error while fetching supplier details "}));
        } else {
            if(docs != null) {
                grpModel.getGrpDetails(grpId, function(e, o){
                    if(o) {
                        var jobId = o.jb_id;
                        jobStatsModel.getSupplierForGroup(jobId, grpId, function(er, supObj) {
                            if(supObj && supObj[0].groups) {
                                if (supObj[0].groups["sup"+docs.id]) {
                                    supplier.sUrl = req.body.sUrl? req.body.sUrl : (supObj[0].groups["sup"+docs.id].sUrl)? supObj[0].groups["sup"+docs.id].sUrl : (docs.sUrl)? docs.sUrl:" ";
                                    supplier.fUrl = req.body.fUrl? req.body.fUrl : (supObj[0].groups["sup"+docs.id].fUrl)? supObj[0].groups["sup"+docs.id].fUrl : (docs.fUrl)?docs.fUrl:" ";
                                    supplier.oUrl = req.body.oUrl? req.body.oUrl : (supObj[0].groups["sup"+docs.id].oUrl)? supObj[0].groups["sup"+docs.id].oUrl : (docs.oUrl)?docs.oUrl:" ";
                                    supplier.qTUrl = req.body.qTUrl? req.body.qTUrl : (supObj[0].groups["sup"+docs.id].qTUrl)? supObj[0].groups["sup"+docs.id].qTUrl : (docs.qTUrl)?docs.qTUrl:" ";

                                    supplier.pstbck = req.body.pstbck? req.body.pstbck : (supObj[0].groups["sup"+docs.id].pstbck)? supObj[0].groups["sup"+docs.id].pstbck : "";
                                    supplier.pstbck_fail = req.body.pstbck_fail? req.body.pstbck_fail : (supObj[0].groups["sup"+docs.id].pstbck_fail)? supObj[0].groups["sup"+docs.id].pstbck_fail : "";

                                    supplier.imgSrc = supObj[0].groups["sup"+docs.id].imgSrc? supObj[0].groups["sup"+docs.id].imgSrc : (docs.imgSrc)?docs.imgSrc:" ";
                                    supplier.N = supObj[0].groups["sup"+docs.id].N? supObj[0].groups["sup"+docs.id].N  : 0;
                                    supplier.isFulcrum = supObj[0].groups["sup"+docs.id].isFulcrum? supObj[0].groups["sup"+docs.id].isFulcrum : 0;
                                    supplier.cpi = supObj[0].groups["sup"+docs.id].cpi? supObj[0].groups["sup"+docs.id].cpi : 0;
                                    supplier.sup_id = supId;
                                    supplier.sup_nm = supObj[0].groups["sup"+docs.id].sup_nm? supObj[0].groups["sup"+docs.id].sup_nm : docs.disCmp;
                                    supplier.cmps = supObj[0].groups["sup"+docs.id].cmps? supObj[0].groups["sup"+docs.id].cmps : 0;
                                    supplier.clks = supObj[0].groups["sup"+docs.id].clks? supObj[0].groups["sup"+docs.id].clks : 0;
                                    supplier.fls = supObj[0].groups["sup"+docs.id].fls? supObj[0].groups["sup"+docs.id].fls : 0;
                                    supplier.oq = supObj[0].groups["sup"+docs.id].oq? supObj[0].groups["sup"+docs.id].oq : 0;
                                    supplier.isRevShr = supObj[0].groups["sup"+docs.id].isRevShr? supObj[0].groups["sup"+docs.id].isRevShr : false;
                                    supplier.sc = supObj[0].groups["sup"+docs.id].sc? supObj[0].groups["sup"+docs.id].sc : "";
                                    supplier.st = supObj[0].groups["sup"+docs.id].st? supObj[0].groups["sup"+docs.id].st : docs.st;
                                    supplier.added_on = supObj[0].groups["sup"+docs.id].added_on? supObj[0].groups["sup"+docs.id].added_on : new Date().toISOString();

                                    if(supObj[0].groups["sup"+docs.id].isDbSup) {
                                        supplier.isDbSup = supObj[0].groups["sup"+docs.id].isDbSup;
                                    }
                                    if(supObj[0].groups["sup"+docs.id].addedBy) {
                                        supplier.addedBy = supObj[0].groups["sup"+docs.id].addedBy;
                                    }
                                    if(supObj[0].groups["sup"+docs.id].last_clkdt) {
                                        supplier.last_clkdt = supObj[0].groups["sup"+docs.id].last_clkdt;
                                    }

                                    jobStatsModel.updateSupplier(jobId, grpId, supplier, function (err, jobStat) {
                                        if (err) {
                                            console.log("Error while updating supplier for grp surveyId: " + req.params.survNum + " and supplierId: "+supId+" -->Reason:-supplierId and surveyId could be wrong or no data found in DB related to this supplier");
                                            next(new errors.HttpStatusError(400, { "apiStatus": "Failure", "msg": "Error while updating supplier for grp"}));
                                        } else {
                                            res.status(200).json({apiStatus: 'success', "msg": "Redirection Methods updated successfully"});
                                        }
                                    });
                                }
                                else {
                                    console.log("No data found for surveyId: " + req.params.survNum + " and supplierId: "+supId+" -->Reason:-supplierId and surveyId could be wrong or no group found in DB related to this supplier");
                                    next(new errors.HttpStatusError(400, { "apiStatus": "Failure", "msg": "Supplier "+ supId +" does not exist for group "+grpId}));
                                }
                            } else {
                                console.log("No data found for surveyId: " + req.params.survNum +" -->Reason:- surveyId could be wrong or no data found in DB related to this supplier");
                                next(new errors.HttpStatusError(400, { "apiStatus": "Failure", "msg": "Error while fetching group details from job stats"}));
                            }

                        });
                    } else {
                        console.log("No data found for surveyId: " + req.params.survNum +" -->Reason:- surveyId could be wrong or no data found in DB related to this supplier");
                        next(new errors.HttpStatusError(400, { "apiStatus": "Failure", "msg": "Error while fetching group details from groups"}));
                    }
                });
            }
            else{
                console.log("No data found for supplierId: "+supId+" -->Reason:- supplierId could be wrong or no data found in DB related to this supplier");
                next(new errors.HttpStatusError(400, { "apiStatus": "Failure", "msg": "No Supplier found with given supplierId "}));
            }
        }
    });
};

/**
 * This function get PIDs for re-contact surveys
 * Content-Type application
 * @param req {Object} the request object
 * @param res {Object} the response object
 * @param next {Object} the error object
 */
exports.getPidsForRecontactSurvey = function (req, res, next) {
    var supId = req.user.usr_id;
    supModel.getSupplierDetailsById({'id': supId}, 'sup_id', null, {}, function (err, sup) {
        if(err) {
            console.log("Error while fetching Supplier details by supplierId: "+ supId);
            next(new errors.HttpStatusError(400, { "apiStatus": "Failure", "msg": "Error while fetching Supplier details by supplierId: "+ supId + " , Please check your request again."}));
        } 
        else {
            if (sup && sup.length > 0) {
                var result = {}, supCode = sup[0].sup_id;
                memIdTans.geSuccessIdsByGrpSupCode(parseInt(req.params.survNum), supCode, function (err, memIds) {
                    if(err) {
                        console.log("Error while fetching success_ids by supplier Code: "+ supCode);
                        next(new errors.HttpStatusError(400, { "apiStatus": "Failure", "msg": "Error while fetching success_ids by supplier Code: "+ supCode + " , Please check your request again."}));
                    } 
                    else {
                        if (memIds && memIds.length > 0) {
                            for (var memInd = memIds.length - 1; memInd >= 0; memInd--) {
                                if (memIds[memInd]._id == 1)
                                    result.include = memIds[memInd].success_ids;
                                else
                                    result.exclude = memIds[memInd].success_ids;
                            }                           
                            return res.status(200).json({
                                "apiStatus": "success",
                                "msg": "PIDs are successfully searched",
                                "result": result
                            });
                        }
                        else {
                            console.log("No data found for survey: " + req.params.survNum + " and supplierId: "+supId+" -->Reason:-supplierId/surveyId could be wrong or no data found in DB related to this supplier");
                            next(new errors.HttpStatusError(404, {
                                "apiStatus": "Failure",
                                "msg": "No data found for surveyId: " + req.params.survNum + " and supplierId: " + supId + ", Please check your request again."
                            }));
                        }
                    }
                });
            }
            else {
                console.log("No data found for survey: " + req.params.survNum + " and supplierId: "+supId+" -->Reason:-supplierId/surveyId could be wrong or no data found in DB related to this supplier");
                next(new errors.HttpStatusError(404, {
                    "apiStatus": "Failure",
                    "msg": "No data found for surveyId: " + req.params.survNum + " and supplierId: " + supId + ", Please check your request again."
                }));
            }
        }
    });
}

/**
 * This function gets list of closed survey based on supplierId after given datetime
 * Content-Type application
 * @param req {Object} the request object
 * @param res {Object} the response object
 * @param next {Object} the error object
 */
exports.getClosedSurveyListByDate = function (req, res, next) {
    var supId = parseInt(req.user.usr_id);

    var groupsAfterGivenDate = [];
    var groupBySupId = [];
    async.parallel([
        // function to fetch groups ids that are updated after given datetime
        function(cb){
            var condition = {"mod_on": { $gt: lib.PSTtoGMT(new Date(req.params.datetym))}, st: 3};
            grpModel.getGroupByCondition(condition, 'id -_id', function (error, grps) {
                if(error) {
                    console.log("Error while fetching groups ids that are closed after given datetime");
                    next(new errors.HttpStatusError(400, { "apiStatus": "Failure", "msg": "Error while fetching groups ids that are closed after given datetime, Please check your request again."}));
                } 
                else {
                    if (grps && grps.length>0) {
                        for (var grpInd = grps.length - 1; grpInd >= 0; grpInd--) {
                            groupsAfterGivenDate.push(grps[grpInd].id);                    
                        }
                        cb();
                    } else {
                        console.log("No closed group found after given date'n'time: " + req.params.datetym + " -->Reason:- date'n'time could be wrong or no groups found in DB after given date'n'time");
                        return next(new errors.HttpStatusError(404, { "apiStatus": "Failure", "msg": "No closed group found after given date'n'time: " + req.params.datetym + " , Please check your request again."}));
                    }
                }
            });
        },
        function(cb){
            jobStatsModel.getGrpArrayfromSupId(supId, function (err, docs) {
                if(err) {
                    console.log("Error while fetching groups details for supplier Id: " + supId);
                    return next(new errors.HttpStatusError(400, { "apiStatus": "Failure", "msg": "Error while fetching groups details for supplier Id: " + supId + ", Please check your request again."}));
                } 
                else {
                    if(docs && docs.length> 0){
                        groupBySupId = docs[0].surveyIds;                      
                        cb();
                    }
                    else{
                        console.log("No closed group found for supplier -->Reason:-supplierId could be wrong or no closed group found in DB related to this supplier");
                        return next(new errors.HttpStatusError(404, { "apiStatus": "Failure", "msg": "No closed group found"}));
                    }
                }
            });
        }
    ], function (error) {                
        if (error) {
            console.log("No closed group found for supplier -->Reason:-supplierId could be wrong or no closed group found in DB related to this supplier & date time");
            return next(new errors.HttpStatusError(400, { "apiStatus": "Failure", "msg": "No closed group found for this Supplier & date time, Please check your request again."}));
        }
        
        var finalGroupsArr = [];
        for (var grpInd = groupBySupId.length - 1; grpInd >= 0; grpInd--) {
            if(groupsAfterGivenDate.indexOf(groupBySupId[grpInd]) > -1){
                finalGroupsArr.push(groupBySupId[grpInd]);
            }
        }              
        return res.status(200).json({
            "apiStatus": "success",
            "msg": "closed Survey IDs are successfully searched",
            "result": finalGroupsArr
        });
    }); 

    
};


/**
 * This function get Survey Stats
 * Content-Type application
 * @param req {Object} the request object
 * @param res {Object} the response object
 * @param next {Object} the error object
 */
exports.getSurveyStats = function (req, res, next) {
    var supId = parseInt(req.user.usr_id);
    async.waterfall([function(cb){
        //function to get supplier stats from verified token job stats
        verifiedTknModel.getSupplierStats(parseInt(req.params.survNum), supId, function(err, grpSupStats){
            if(err){
                console.log("Error while fetching verified survey statistics ");
                next(new errors.HttpStatusError(400, { "apiStatus": "Failure", "msg": "Error while fetching survey statistics for verified token , Please check your request again."}));
            }else{
                cb(null,grpSupStats);
            }
        });

    },function(supplierStats, cb){
        //function to check whether group is verified or not
        if(supplierStats && supplierStats.length){
            //case to calculating supplier statistics from new varify token job stats
            var suppliers = {
                isVerified : true,
                clicks: supplierStats[0].groups["sup" + supId].clks || 0,
                surveyStarts: supplierStats[0].groups["sup" + supId].surStart || 0,
                completes: supplierStats[0].groups["sup" + supId].cmps || 0,
                completesValid: supplierStats[0].groups["sup" + supId].cmps_valid || 0,
                completesInvalid: supplierStats[0].groups["sup" + supId].cmps_invalid || 0,
                completesPending: (supplierStats[0].groups["sup" + supId].cmps - (supplierStats[0].groups["sup" + supId].cmps_valid + supplierStats[0].groups["sup" + supId].cmps_invalid)) || 0,
                fails: supplierStats[0].groups["sup" + supId].fls || 0,
                overQuota: supplierStats[0].groups["sup" + supId].oq || 0,
                qualityTerms: supplierStats[0].groups["sup" + supId].qt || 0,
                preSurveyTerminates: supplierStats[0].groups["sup" + supId].pst || 0,
                preSurveyOverQuota: supplierStats[0].groups["sup" + supId].preSurOq || 0,
                preSurveyQualityTermination: supplierStats[0].groups["sup" + supId].preSurQt || 0,
                averageLOI : (supplierStats[0].groups["sup" + supId].LOI) ? (supplierStats[0].groups["sup" + supId].LOI/supplierStats[0].groups["sup" + supId].loi_cmps).toFixed(2) : 0,
                revenue : supplierStats[0].groups["sup" + supId].cost || 0,
                Conversion : (!isNaN(supplierStats[0].groups["sup" + supId].cmps_valid /supplierStats[0].groups["sup" + supId].surStart)) ? ((supplierStats[0].groups["sup" + supId].cmps_valid /supplierStats[0].groups["sup" + supId].surStart)*100).toFixed(2) : 0
            };
            cb(null, suppliers);
        }else{
            //case to calculating supplier statistics from old job stats
            jobStatsModel.supplierStats(parseInt(req.params.survNum), supId, function (err, obj){
                if(err){
                    console.log("Error while fetching survey statistics ");
                    next(new errors.HttpStatusError(400, { "apiStatus": "Failure", "msg": "Error while fetching survey statistics, Please check your request again."}));
                }else if(obj && obj.length){
                    var supObj = obj[0].groups;
                    var conversion = 0;
                     if(!isNaN(supObj["sup" + supId].cmps / supObj["sup" + supId].surStart) && (supObj["sup" + supId].cmps / supObj["sup" + supId].surStart) != null){
                        conversion = ((supObj["sup" + supId].cmps / supObj["sup" + supId].surStart) * 100);
                    }
                    var suppliers = {
                        isVerified : false,
                        clicks: supObj["sup" + supId].clks || 0,
                        surveyStarts: supObj["sup" + supId].surStart || 0,
                        completes: supObj["sup" + supId].cmps || 0,
                        fails: supObj["sup" + supId].fls || 0,
                        overQuota: supObj["sup" + supId].oq || 0,
                        qualityTerms: supObj["sup" + supId].qt || 0,
                        preSurveyTerminates: supObj["sup" + supId].terminates || 0,
                        preSurveyOverQuota: supObj["sup" + supId].preSurOq || 0,
                        preSurveyQualityTermination: supObj["sup" + supId].preSurQt || 0,
                        averageLOI : (!isNaN(supObj['sup'+supId].loi / supObj['sup'+supId].cmps)) ? (supObj['sup'+supId].loi / supObj['sup'+supId].cmps).toFixed(2) : 0,
                        revenue : supObj['sup'+supId].cost || 0,
                        Conversion : conversion.toFixed(2)
                    };
                    cb(null, suppliers);
                }else{
                    console.log("No data found for survey: "+req.params.survNum+" and supplierId: "+supId +" -->Reason:-surveyId/supplierId could be wrong or no data found in DB related to this supplier");
                    next(new errors.HttpStatusError(404, {
                        "apiStatus": "Failure",
                        "msg": "No data found for surveyId: "+req.params.survNum+" and supplierId: "+supId+", Please check your request again."
                    }));
                }
            });
        }
    }], function(err, supplier){
        if(!err){
            return res.status(200).json({
                "apiStatus": "success",
                "msg": "Survey Stats are successfully searched",
                "result": supplier
            });
        }
    });
};

/**
 * This function get Survey Transactions data
 * Content-Type application
 * @param req {Object} the request object
 * @param res {Object} the response object
 * @param next {Object} the error object
 */
exports.getSurveyTransactions = function (req, res, next) {
    var supId = parseInt(req.user.usr_id);
    var startDate = req.query.startDate;
    var endDate = req.query.endDate;
    var conditions = {};
    conditions['supCode'] = supId;
    conditions['grp.grpId'] = req.params.survNum;
    async.waterfall([function(cb){
        //function to create query expression object
        //case to check, if query params is passed or not
        if(!Object.keys(req.query).length){
            cb(null, conditions);
        }else{
            //validate , both startDate and endDate should be present
            if((!startDate || !endDate)){
                cb(true, 400, "Bad Request, Either Start date or End date is missing in the request.", "Failure" ,{});
            }else{
                if(!lib.isValidDateFormat(startDate) || !lib.isValidDateFormat(endDate)){
                    cb(true, 400, "Bad Request, Either Start date or End date is Invalid in the request.", "Failure", {});
                }else{
                    //validate startDate is less than equal to endDate
                    if(new Date(startDate).getTime() > new Date(endDate).getTime()){
                        cb(true, 400, "Please check your request , Start Date must be less than End Date", "Failure", {});
                    }else{
                        endDate = moment(endDate).add(1,'d').format('YYYY-MM-DD');
                        conditions['crtd_on'] = {$gte: lib.PSTtoGMT(startDate), $lt: lib.PSTtoGMT(endDate)};
                        cb(null, conditions);
                    }
                }
            }
        }
    }, function(conditions, cb){
        //function to check if query string has status or not
        if(!Object.keys(req.query).length || Object.keys(req.query).length == 2){
            cb(null, conditions, {});
        }else{
            //validate, status params
            if(Object.keys(req.query).indexOf('status') == -1){
                cb(true, 400, 'Bad Request, Query params status must be invalid, Please check your request','Failure',{});
            }else{
                //case to check, status shouldn't be blank
                var stTxt = req.query['status'].split(',');
                if(stTxt.indexOf('') > -1){
                    cb(true, 400, 'Bad Request, Status value/values must be missing, Please check your request.', 'Failure', {});
                }else{
                    //function calling to create status condition object
                    getStatusConditionObject(stTxt, true, function(err, stObj){
                        if(err){
                            cb(true, 400, 'Bad Request, Status is Invalid in the request','Failure',{})
                        }else{
                            cb(null, conditions, stObj);
                        }
                    });
                }
            }
        }
    }, function(conditions, stObj, cb){
        //function to check, whether to modified query expression object or not
        if(!Object.keys(stObj).length){
            cb(null, conditions)
        }else{
            //case to check , status shouldn't be undefined
            conditions['st'] = {$in: stObj['st']};
            cb(null, conditions);
        }
    }, function(conditions, cb){
        //getting transactions on the basis or query expression object
        jobTransModel.getPidSup(conditions, '-_id id mbr_id ip supCPI st clkDt clientSurUrl stDt endDt termReason verifyToken verifiedTknDt', null, {}, function(err, jobTrans){
            if (err) {
                console.log("Error while fetching Survey Transactions data ");
                cb(true, 400, "Error while fetching Survey Transactions data, Please check your request again.", "Failure", {});
            }else{
                if(jobTrans && jobTrans.length > 0) {
                    var surveyStatus = lib.array_flip(dbConstants.surveyStatus);
                    var transStatus = lib.array_flip(dbConstants.transStatus);
                    jobTrans.map(function (obj) {
                        obj.CPI = (obj.supCPI)?obj.supCPI.toFixed(2) : 0; delete obj.supCPI;
                        obj.PID = obj.mbr_id; delete obj.mbr_id;
                        obj.token = obj.id; delete obj.id;
                        obj.surveyUrl = obj.clientSurUrl; delete obj.clientSurUrl;
                        if(obj.stDt){
                            obj.st_date_time = lib.GMTtoPST(obj.stDt); delete obj.stDt;
                        }if(obj.clkDt){
                            obj.clkDateTime = lib.GMTtoPST(obj.clkDt); delete obj.clkDt;
                        }
                        if(obj.endDt){
                            obj.completeDateTime = lib.GMTtoPST(obj.endDt); delete obj.endDt;
                        }
                        if(obj.st == dbConstants.surveyStatus['Pre Survey Termination'] || obj.st == dbConstants.surveyStatus['Pre Survey Over Quota'] || obj.st == dbConstants.surveyStatus['Pre Survey Quality Termination']){
                            obj.termReason = obj.termReason;
                        }else{
                            obj.termReason = '';
                        }
                        obj.status = surveyStatus[obj.st]; delete obj.st;
                        obj.verifyToken = transStatus[obj.verifyToken];
                        if(obj.verifiedTknDt){
                            obj.verifiedTknDt = lib.GMTtoPST(obj.verifiedTknDt);
                        }
                    });
                    cb(false, 200, "Survey Transactions are successfully searched", "success", jobTrans)
                }
                else{
                    console.log("No data found for survey: "+req.params.survNum+" and supplierId: "+supId +" -->Reason:-surveyId/supplierId could be wrong or no data found in DB related to this supplier");
                    cb(true, 400, "No data found for survey: "+req.params.survNum+" and supplierId: "+supId +" -->Reason:-surveyId/supplierId could be wrong or no data found in DB related to this supplier.", "Failure", {})
                }
            }
        });
    }], function(err, status, message, apiStatus, result){
        if(err){
            next (new errors.HttpStatusError(status, {"apiStatus": apiStatus, "msg": message}));
        }else{
            return res.status(status).json({"apiStatus": apiStatus, "msg": "Survey Transactions are successfully searched","result": result});
        }
    })
};

/**
 * This function get Survey Transactions data by PID, survey number and supplier Id
 * Content-Type application
 * @param req {Object} the request object
 * @param res {Object} the response object
 * @param next {Object} the error object
 */
exports.getSurveyTransactionsByCond = function (req, res, next) {
    var supId = parseInt(req.user.usr_id);
    jobTransModel.getPidSup({'supCode':supId, 'mbr_id': req.params.pid, 'grp.grpId': req.params.survNum},'-_id id ip supCPI st clkDt clientSurUrl stDt endDt termReason verifyToken verifiedTknDt', null, {}, function(err, jobTrans){
        if (err) {
            console.log("Error while fetching Survey Transactions data ");
            next(new errors.HttpStatusError(400, { "apiStatus": "Failure", "msg": "Error while fetching Survey Transactions data, Please check your request again."}));
        }else{
            if(jobTrans && jobTrans.length > 0) {
                var surveyStatus = lib.array_flip(dbConstants.surveyStatus);
                var transStatus = lib.array_flip(dbConstants.transStatus);
                jobTrans.map(function (obj) {
                    obj.CPI = (obj.supCPI)?obj.supCPI.toFixed(2) : 0; delete obj.supCPI;
                    obj.surveyUrl = obj.clientSurUrl; delete obj.clientSurUrl;
                    if(obj.stDt){
                        obj.st_date_time = lib.GMTtoPST(obj.stDt); delete obj.stDt;
                    }
                    if(obj.clkDt){
                        obj.clkDateTime = lib.GMTtoPST(obj.clkDt); delete obj.clkDt;
                    }
                    if(obj.endDt){
                        obj.completeDateTime = lib.GMTtoPST(obj.endDt); delete obj.endDt;
                    }
                    if(obj.st == dbConstants.surveyStatus['Pre Survey Termination'] || obj.st == dbConstants.surveyStatus['Pre Survey Over Quota'] || obj.st == dbConstants.surveyStatus['Pre Survey Quality Termination']){
                        obj.termReason = obj.termReason;
                    }else{
                        obj.termReason = '';
                    }
                    obj.status = surveyStatus[obj.st]; delete obj.st;
                    obj.verifyToken = transStatus[obj.verifyToken];
                    if(obj.verifiedTknDt){
                        obj.verifiedTknDt = lib.GMTtoPST(obj.verifiedTknDt);
                    }
                });
                return res.status(200).json({
                    "apiStatus": "success",
                    "msg": "Survey Transactions are successfully searched",
                    "result": jobTrans
                });
            }
            else{
                console.log("No data found for survey: "+req.params.survNum+ ", PID: "+req.params.pid+" and supplierId: "+supId +" -->Reason:-surveyId/supplierId/PID could be wrong or no data found in DB related to the conditions passed");
                next(new errors.HttpStatusError(404, { "apiStatus": "Failure", "msg": "No data found for surveyId: "+req.params.survNum+ ", PID: "+req.params.pid+" and supplierId: "+supId+", Please check your request again."}));
            }
        }
    });
};

/**
 * This function get Survey Transactions data by date
 * Content-Type application
 * @param req {Object} the request object
 * @param res {Object} the response object
 * @param next {Object} the error object
 */
exports.getSurveyTransactionsByDateRange = function(req, res, next){
    var supId = parseInt(req.user.usr_id);
    var startDate = req.query.startDate;
    var endDate = req.query.endDate;
    var vrfdStDt = req.query.verifiedStartDate;
    var vrfdEndDt = req.query.verifiedEndDate;
    var vrfdTknRegex = /(Valid)|(Invalid)\b/ig;
    var statusRegex = /(Pre Survey DNC)|(Completed)|(Failed)|(Over Quota)|(Quality Termination)|(Pre Survey Termination)|(Start Survey DNC)|(Pre Survey Over Quota)|(Pre Survey Quality Termination)\b/ig;
    async.waterfall([function(cb){
        //validate quey params for startDate/verifiedStartDate and endDate/verifiedEndDate
        if(startDate && endDate || vrfdStDt && vrfdEndDt){
            //checking for date format
            if(lib.isValidDateFormat(startDate || vrfdStDt) && lib.isValidDateFormat(endDate || vrfdEndDt)){
                var validateDate = moment(startDate || vrfdStDt).add(config.dateRangeLimit, 'days').format("YYYY-MM-DD");
                //checking dates lies in range
                if(new Date(validateDate).getTime() >= new Date(endDate || vrfdEndDt).getTime()){
                    var modEndDate = moment(endDate || vrfdEndDt).add(1,'d').format('YYYY-MM-DD');
                    var condition = {'supCode': supId};
                    //create query expression object on the basis of condition
                    (startDate && endDate) ? condition['crtd_on'] = {$gte: lib.PSTtoGMT(startDate), $lt: lib.PSTtoGMT(modEndDate)} : condition['verifiedTknDt'] = {$gte: lib.PSTtoGMT(vrfdStDt), $lt: lib.PSTtoGMT(modEndDate)};
                    cb(null, condition);
                }else{
                    cb(true, 400, 'Date range out of limit, Please make sure date range lies within '+config.dateRangeLimit+ ' days', 'Failure' ,{})
                }
            }else{
                cb(true, 400, 'Bad Request, Either Start date or End date is Invalid in the request', 'Failure', {});
            }
        }else{
            cb(true, 400, 'Bad Request, Either Start date/Verified Start date  or End date/Verified End Date is missing in the request.', 'Failure', {});
        }
    }, function(condition, cb){
        //function to check for query params, if query params has status, validate status
        if(Object.keys(req.query).length == 2){
            cb(null, condition, {});
        }else{
            //validate 'status' query params
            if(!req.query.hasOwnProperty('status')){
                cb(true, 400, 'Bad Request, Query params status must be misspelled, Please check your request','Failure',{});
            }else{
                 var stTxt = req.query['status'].split(',');
                 //case to check 'status' params is not blank
                if(stTxt.indexOf('') > -1){
                    cb(true, 400, 'Bad Request, Status value/values must be missing, Please check your request.', 'Failure', {});
                }else{
                    //cases to check combination, combination of either startDate and endDate with (survey statuses) or verifiedStartDate and verifiedEndDate with status (verified token statues)
                    if(vrfdStDt && vrfdEndDt && req.query['status'].match(vrfdTknRegex) != null){
                        //function calling to create status condition object
                        getStatusConditionObject(stTxt, false, function(err, stObj){
                            if(err){
                                cb(true, 400, 'Bad Request, Status is Invalid in the request','Failure',{})
                            }else{
                                cb(null, condition, stObj)
                            }
                        });
                    }else if(startDate && endDate && req.query['status'].match(statusRegex) != null){
                        //function calling to create status condition object
                        getStatusConditionObject(stTxt, true, function(err, stObj){
                            if(err){
                                cb(true, 400, 'Bad Request, Status is Invalid in the request','Failure',{})
                            }else{
                                cb(null, condition, stObj)
                            }
                        });
                    }else{
                        cb(true, 400, 'Bad Request, Either combination of Start date/Verified Start date or End date/Verified end date and Status is Invalid in the request.', 'Failure', {});
                    }
                }
            }
        }
    }, function(condition, objSt, cb){
        if(!Object.keys(objSt).length){
            cb(null, condition)
        }else{
            objSt['st'].length ? condition['st'] = {$in: objSt['st']} : condition['verifyToken'] = {$in: objSt['vrfdTknSt']}
            cb(null, condition);
        }
    },function(condition, cb){
        //function to get transaction on basis of query expression
        jobTransModel.getPidSup(condition, '-_id id mbr_id ip supCPI st clkDt clientSurUrl stDt endDt termReason grp.grpId verifyToken verifiedTknDt', null, {}, function(err, trans){
            if(err){
                cb(true, 400, 'Error while fetching Survey Transactions data, Please check your request again.','Failure', {});
            }else if(trans && trans.length>0){
                var surveyStatus = lib.array_flip(dbConstants.surveyStatus);
                var transStatus = lib.array_flip(dbConstants.transStatus);
                trans.map(function (obj) {
                    obj.CPI = (obj.supCPI)?obj.supCPI.toFixed(2) : 0; delete obj.supCPI;
                    obj.PID = obj.mbr_id; delete obj.mbr_id;
                    obj.surveyUrl = obj.clientSurUrl; delete obj.clientSurUrl;
                    if(obj.stDt){
                        obj.st_date_time = lib.GMTtoPST(obj.stDt); delete obj.stDt;
                    }
                    if(obj.clkDt){
                        obj.clkDateTime = lib.GMTtoPST(obj.clkDt); delete obj.clkDt;
                    }
                    if(obj.endDt){
                        obj.completeDateTime = lib.GMTtoPST(obj.endDt); delete obj.endDt;
                    }
                    obj.surveyId = obj.grp.grpId; delete obj.grp.grpId;
                    if(obj.st == dbConstants.surveyStatus['Pre Survey Termination'] || obj.st == dbConstants.surveyStatus['Pre Survey Over Quota'] || obj.st == dbConstants.surveyStatus['Pre Survey Quality Termination']){
                        obj.termReason = obj.termReason;
                    }else{
                        obj.termReason = '';
                    }
                    obj.status = surveyStatus[obj.st]; delete obj.st;
                    obj.verifyToken = transStatus[obj.verifyToken];
                    if(obj.verifiedTknDt){
                        obj.verifiedTknDt = lib.GMTtoPST(obj.verifiedTknDt);
                    }
                });
                cb(false, 200, 'Survey Transactions are successfully searched.', 'success', trans);
            }else{
                cb(true, 400, 'No data found for this date range please check your request.', 'Failure', {});
            }
        });

    }], function(err, status, message, apiStatus, result){
        if(err){
            next(new errors.HttpStatusError(status, {"apiStatus": apiStatus, "msg": message}));
        }else{
            return res.status(status).json({"apiStatus": apiStatus, "msg": message, "result": result});
        }
    });
}

/**
 * This function get Survey Statistics Transactions data by date
 * Content-Type application
 * @param req {Object} the request object
 * @param res {Object} the response object
 * @param next {Object} the error object
 */
exports.getSurveyStatsByDateRange = function(req, res, next){
    var supId = req.user.usr_id;
    var startDate = req.query.startDate;
    var endDate = req.query.endDate;
    var vrfdStDt = req.query.verifiedStartDate;
    var vrfdEndDt = req.query.verifiedEndDate;
    if(startDate && endDate || vrfdStDt && vrfdEndDt){
        //checking for date format
        if(lib.isValidDateFormat(startDate || vrfdStDt) && lib.isValidDateFormat(endDate || vrfdEndDt)){
            var validateDate = moment(startDate || vrfdStDt).add(config.dateRangeLimit, 'days').format("YYYY-MM-DD");
            //checking dates lies in range
            if(new Date(validateDate).getTime() >= new Date(endDate || vrfdEndDt).getTime()){
                var modEndDate = moment(endDate || vrfdEndDt).add(1,'d').format('YYYY-MM-DD');
                var matchCond = {'supCode': supId};
                //create query expression object on the basis of condition
                (startDate && endDate) ? matchCond['crtd_on'] = {$gte: lib.PSTtoGMT(startDate), $lt: lib.PSTtoGMT(modEndDate)} : matchCond['verifiedTknDt'] = {$gte: lib.PSTtoGMT(vrfdStDt), $lt: lib.PSTtoGMT(modEndDate)};
                jobTransModel.getTransactionsStats(matchCond, function(err, transStats){
                    if(err){
                        next(new errors.HttpStatusError(400, { "apiStatus": "Failure", "msg": "Error while fetching Survey Transactions data, Please check your request again."}));
                    }else if(transStats && transStats.length){
                        var surStart = transStats[0].cmps + transStats[0].fls  +transStats[0].oq + transStats[0].qt + transStats[0].dnc;
                        var surveyStats = {
                            clicks: transStats[0].clks,
                            surveyStarts : surStart,
                            completes: transStats[0].cmps,
                            fails : transStats[0].fls,
                            overQuota : transStats[0].oq,
                            qualityTerms : transStats[0].qt,
                            preSurveyTerminates : transStats[0].pst,
                            preSurveyOverQuota : transStats[0].psoq,
                            preSurveyQualityTermination : transStats[0].psqt,
                            averageLOI : (!transStats[0].loi_cmps) ? ((!isNaN(transStats[0].LOI/(transStats[0].cmps))) ? ((transStats[0].LOI/(1000*60))/(transStats[0].cmps)).toFixed(2) : 0) : ((!isNaN(transStats[0].LOI/transStats[0].loi_cmps)) ? ((transStats[0].LOI/(1000*60))/transStats[0].loi_cmps).toFixed(2) : 0),
                            revenue : transStats[0].supRev.toFixed(2),
                            Conversion : (!isNaN(transStats[0].cmps/surStart)) ? ((transStats[0].cmps/surStart)*100).toFixed(2) : 0,
                            validCompletes: transStats[0].vld_cmps,
                            invalidCompletes: transStats[0].invld_cmps,
                            pendingCompletes : transStats[0].pending_cmps
                            // Conversion : (vrfdStDt && vrfdEndDt) ? ((!isNaN(transStats[0].vld_cmps/surStart)) ? ((transStats[0].vld_cmps/surStart)*100).toFixed(2) : 0) : ((!isNaN(transStats[0].cmps/surStart)) ? ((transStats[0].cmps/surStart)*100).toFixed(2) : 0)
                        };
                        if(vrfdStDt && vrfdEndDt){
                            delete surveyStats['clicks'];
                            delete surveyStats['surveyStarts'];
                            delete surveyStats['fails'];
                            delete surveyStats['overQuota'];
                            delete surveyStats['qualityTerms'];
                            delete surveyStats['preSurveyTerminates'];
                            delete surveyStats['preSurveyOverQuota'];
                            delete surveyStats['preSurveyQualityTermination'];
                            delete surveyStats['Conversion'];
                            delete surveyStats['pendingCompletes'];
                        }
                        return res.status(200).json({
                            "apiStatus": "success",
                            "msg": "Survey Stats are successfully searched",
                            "result": surveyStats
                        });
                    }else{
                        next(new errors.HttpStatusError(404, {"apiStatus": "Failure", "msg":" No data found for this date range please check your request"}));
                    }
                });
            }else{
                next(new errors.HttpStatusError(400, {"apiStatus": "Failure", "msg": "Date range out of limit, Please make sure date range lies within "+config.dateRangeLimit+" days",}));
            }
        }else{
            next(new errors.HttpStatusError(400, {"apiStatus": "Failure", "msg": "Bad Request, Either Start date or End date is Invalid in the request"}));
        }
    }else{
        next(new errors.HttpStatusError(400, {"apiStatus": "Failure", "msg": "Bad Request, Either Start date/Verified Start date or End date/Verified End date is missing in the request"}));
    }
}


/*
*This function is to create status condition object
*@stTxt -> Array of status/statuses name
*@cb -> callback 
*@Error -> if status is undefined,
*@statusObj -> Status condtion object
*/
function getStatusConditionObject(stTxt, isStatus, cb){
    var statusConstants = (isStatus) ? dbConstants.surveyStatus : dbConstants.transStatus;
    var statusObj = {vrfdTknSt : [], st : []};
    async.eachSeries(stTxt, function(txt, nextTxt){
        //Error if status is undefined
        if(statusConstants[txt.trim()] == undefined){
            nextTxt(true);
        }else{
            if(isStatus){
                statusObj['st'].push(statusConstants[txt.trim()]);
            }else{
                statusObj['vrfdTknSt'].push(statusConstants[txt.trim()]); 
            }
            nextTxt(null);
        }
    }, function(err){
        if(err){
            cb(true, null);
        }else{
            cb(null, statusObj);
        }
    });
}