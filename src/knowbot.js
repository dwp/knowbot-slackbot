const SLACK_APP = 'slack_app';
const SLACK_CI = 'slack_ci';
const platforms = [SLACK_APP, SLACK_CI];
const SOCIAL_SEARCH_API = process.env.SOCIAL_SEARCH_API || 'http://localhost:8080';
const MONGO_DB_URI = process.env.MONGO_DB_URI || 'mongodb://localhost:27017';

const http = require('http');
const uuid = require('node-uuid');
const mongoStorage = require('botkit-storage-mongo')({ mongoUri: MONGO_DB_URI });

// Note, the following allows for manual access to mongo.
// This is needed to have more control over how to store
// questions and answers, as using the botkit storage API
// doesn't really provide a scalable way of storing large
// amounts of data.
const mongo = require('mongodb').MongoClient

// in-memory register of answers that will be held until user
// has confirmed if answer is accepted or rejected.
const AnswerRegister = {};

const config = {
  debug: true,
  interactive_replies: true,
  storage: mongoStorage
};

const controller = (() => {
    switch (process.env.BOT_PLATFORM) {
        case SLACK_CI:
            return require('./slack_custom_int').init(config, initCallback);
        case SLACK_APP:
            // See a list of all scopes: https://api.slack.com/docs/oauth-scopes
            config.scopes = ['bot', 'identify', 'chat:write:bot', 'channels:read', 'users:read'];
            return require('./slack_app').init(config, initCallback);
        default:
            console.error(`The BOT_PLATFORM environment variable must be set to one of: ${platforms.join(', ')}!`);
            process.exit(1);
    }
})();

function initCallback(bot) {
    // do stuff here
}

// ================= Bot logic goes below =================

/**
 * Accept the ID of the user asking a question, the text of the question
 * and a callback of type function(askedBy, question, users) where `users` is an array
 * of user IDs that have been found who may be able to answer the question.
 */
function findUsers(team, askedBy, question, callback) {
    http.get(`${SOCIAL_SEARCH_API}/ask?q=${question}&team=${team}`, (response) => {
        console.log('response code: ' + response.statusCode);
        response.on('data', (raw) => {
            console.log('data: ' + raw);
            var result = JSON.parse(raw);
            var users = result.users.filter(user => user.user_id != askedBy).map(user => user.user_id).slice(0, 3);
            callback(askedBy, question, users);
        });
    }).on('error', (error) => {
        console.error('Failed to connect to social-search API', error);
        callback(askedBy, question, []);
    });
}

/**
 * Curried function that returns a function with access to a bot that
 * forwards the question on to a list of users which may have the
 * relevant knowledge to answer it.
 */
function forwardQuestionToUsers(bot, message) {
    return function (askedBy, question, users) {
        if (users.length == 0) {
            bot.reply(message, 'I\'m sorry, I can\'t find anybody who can help :flushed:');
            return;
        }

        console.log(`Found the following users to contact: ${users.join(', ')}.`);

        users.forEach((userId) => {
            console.log(`starting private message with user: ${userId}`);
            bot.startPrivateConversation({user: userId}, (error, convo) => {
                // beginning of private conversation with user who might be able to answer question
                convo.ask(`Hi! <@${askedBy}> has a question that I think you may be able to answer. Do you have time to help?`, [
                    {
                        pattern: bot.utterances.no,
                        callback: (response, convo) => {
                            console.log(`User ${response.user} not available to answer at this time.`);
                            convo.say('Ok, no problem. Maybe next time!');
                            convo.next();
                        }
                    },
                    {
                        pattern: bot.utterances.yes,
                        callback: (response, convo) => {
                            console.log(`User ${response.user} is available to answer the question.`);
                            convo.ask({
                                attachments: [
                                    {
                                        fallback: `Question from <@${askedBy}>`,
                                        pretext: "Thanks! Here's the question. If you have an answer, please respond here.",
                                        author_name: `<@${askedBy}>`,
                                        text: question
                                    }
                                ]
                            }, (response, convo) => {
                                var answer = response.text;
                                var answeredBy = response.user;

                                console.log(`An answer has been provided by user ${answeredBy}`);
                                convo.say(`Thanks for providing an answer. I'll pass it on to <@${askedBy}>.`);
                                convo.next();

                                forwardAnswerToAsker(bot, message)(askedBy, question, answeredBy, answer);
                            });

                            convo.next();
                        }
                    }
                ]);
            });
        });
    }
}

/**
 * Curried function that returns a function with access to a bot that
 * forwards an answer back to the user that asked the question.
 */
function forwardAnswerToAsker(bot, message) {
    return function (askedBy, question, answeredBy, answer) {
        bot.startPrivateConversation({user: askedBy}, (error, convo) => {
            var callbackId = uuid.v1();
            AnswerRegister[callbackId] = {
                "question": question,
                "answer": answer,
                "asked_by": askedBy,
                "answered_by": answeredBy
            };

            convo.ask({
                attachments: [
                    {
                        fallback: `Answer from <@${answeredBy}>`,
                        pretext: "Here's one answer to your question.",
                        author_name: `<@${answeredBy}>`,
                        text: answer + "\n\n Is this answer useful?",
                        callback_id: callbackId,
                        actions: [
                            {
                                "name":"accept",
                                "text": "Accept",
                                "value": "accept",
                                "type": "button",
                            },
                            {
                                "name":"reject",
                                "text": "Reject",
                                "value": "reject",
                                "type": "button",
                            }
                        ]
                    }
                ]
            }, [
                {
                    pattern: 'reject',
                    callback: (response, convo) => {
                        convo.say('Oh dear... sorry about that!');
                        convo.next();
                    }
                },
                {
                    pattern: 'accept',
                    callback: (response, convo) => {
                        convo.say('Fantastic! Glad I could help.');
                        convo.next();

                        console.log(response.callback_id);

                        var answer = AnswerRegister[response.callback_id];
                        console.log(answer);
                        if (!answer) {
                            console.error("Unable to find answer!");
                            return;
                        }

                        mongo.connect(MONGO_DB_URI, (error, db) => {
                            if (error) {
                                console.error("Failed to connect to MongoDB", error);
                                return;
                            }

                            db.collection('questionsanswers').insert(answer, (error, result) => {
                                if (error) console.error("Failed to insert document", error);
                                db.close();
                            });
                        });
                    }
                }
            ]);

            convo.next();
        });
    }
}

// Respond to direct messages of 'ping' with a 'pong'
controller.hears('^ping$', ['direct_message'], (bot, message) => bot.reply(message, 'pong'));

// Accept a question, forward it on to other users, and return the answer to the user
controller.on('direct_message', (bot, message) => {
    bot.reply(message, 'Hi - thanks for your query. I will attempt to find somebody who can help!');
    console.log(message);
    findUsers(message.team, message.user, message.text, forwardQuestionToUsers(bot, message));
});

// receive an interactive message to determine if the provided answer was useful (or not)
// controller.on('interactive_message_callback', (bot, message) => {
//
// });
