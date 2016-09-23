
const http = require('http');
const SLACK_APP = 'slack_app';
const SLACK_CI = 'slack_ci';
const SOCIAL_SEARCH_URI = process.env.SOCIAL_SEARCH_API || 'http://localhost:8080';
const platforms = [SLACK_APP, SLACK_CI];
const config = {
  debug: true,
  json_file_store: 'json_db'
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
 * and a callback of type function(asker, question, users) where `users` is an array
 * of user IDs that have been found who may be able to answer the question.
 */
function findUsers(asker, question, callback) {
    http.get(`${SOCIAL_SEARCH_URI}/ask?q=${question}`, (response) => {
        console.log('response code: ' + response.statusCode);
        response.on('data', (raw) => {
            console.log('data: ' + raw);
            var result = JSON.parse(raw);
            var users = result.users.filter(user => user.user_id != asker).map(user => user.user_id).slice(0, 3);
            callback(asker, question, users);
        });
    }).on('error', (e) => {
        console.error('Failed to connect to social-search API', e);
        callback(asker, question, []);
    });
}

/**
 * Curried function that returns a function with access to a bot that
 * forwards the question on to a list of users which may have the
 * relevant knowledge to answer it.
 */
function forwardQuestionToUsers(bot, message) {
    return function (asker, question, users) {
        if (users.length == 0) {
            bot.reply(message, 'I\'m sorry, I can\'t find anybody who can help :flushed:');
            return;
        }

        console.log(`Found the following users to contact: ${users.join(', ')}.`);

        users.forEach((userId) => {
            console.log(`starting private message with user: ${userId}`);
            bot.startPrivateConversation({user: userId}, (error, convo) => {
                // beginning of private conversation with user who might be able to answer question
                convo.ask(`Hi! <@${asker}> has a question that I think you may be able to answer. Do you have time to help?`, [
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
                                        fallback: `Question from <@${asker}>`,
                                        pretext: "Thanks! Here's the question. If you have an answer, please respond here.",
                                        author_name: `<@${asker}>`,
                                        text: question
                                    }
                                ]
                            }, (response, convo) => {
                                var answer = response.text;
                                var responder = response.user;

                                console.log(`An answer has been provided by user ${responder}`);
                                convo.say(`Thanks for providing an answer. I'll pass it on to <@${asker}>.`);
                                convo.next();

                                forwardAnswerToAsker(bot)(asker, responder, answer);
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
function forwardAnswerToAsker(bot) {
    return function (asker, responder, answer) {
        bot.startPrivateConversation({user: asker}, (error, convo) => {
            convo.say({
                attachments: [
                    {
                        fallback: `Answer from ${responder}`,
                        pretext: "Here's one answer to your question.",
                        author_name: responder,
                        text: answer
                    }
                ]
            });

            convo.ask('Was this answer helpful?', [
                {
                    pattern: bot.utterances.no,
                    callback: (response, convo) => {
                        convo.say('Oh dear... sorry about that!');
                        convo.next();
                    }
                },
                {
                    pattern: bot.utterances.yes,
                    callback: (response, convo) => {
                        convo.say('Fantastic! Glad I could help.');
                        convo.next();
                        // record the question and answer somewhere
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
    var asker = message.user;
    var question = message.text;

    bot.reply(message, 'Hi - thanks for your query. I will attempt to find somebody who can help!');

    findUsers(asker, question, forwardQuestionToUsers(bot, message));
});
