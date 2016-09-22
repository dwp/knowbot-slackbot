
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


// Respond to messages directed at the bot containing 'ping'
controller.hears(
    '^ping$',
    ['direct_message', 'mention', 'direct_mention'],
    (bot, message) => bot.reply(message, 'pong'));


controller.on('direct_message', (bot, message) => {
    var asker = message.user;
    var question = message.text;

    bot.reply(message, 'Hi - thanks for your query. I will attempt to find somebody who can help!');

    http.get(`${SOCIAL_SEARCH_URI}/ask?q=${question}`, (response) => {
        console.log('response code: ' + response.statusCode);
        response.on('data', (raw) => {
            console.log('data: ' + raw);
            var result = JSON.parse(raw);

            // remove the user asking the question from the response if present & limit to top three user IDs
            result.users = result.users.filter(user => user.user_id != message.user).map(user => user.user_id).slice(0, 3);

            if (result.users.length == 0) {
                bot.reply(message, 'I\'m sorry, I can\'t find anybody who might be able to help :flushed:');
                return;
            }

            console.log(`Found the following users to contact: ${result.users.join(', ')}.`);

            // start conversation with each of the found users, asking if they're available to answer a question

            result.users.forEach((userId) => {
                console.log(`starting private message with user: ${userId}`);
                bot.startPrivateConversation({user: userId}, (error, convo) => {
                    convo.ask(`Hi! <@${asker}> has a query that I think you may be able to answer. Do you have time to help?`, [
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
                                            fallback: `Question from ${asker}`,
                                            pretext: "Thanks! Here's the question. If you have an answer, please respond here.",
                                            author_name: asker,
                                            text: question
                                        }
                                    ]
                                }, (response, convo) => {
                                    var answer = response.text;
                                    var responderId = response.user;

                                    console.log(`An answer has been provided by user ${responderId}`);
                                    convo.say(`Thanks for providing an answer. I'll pass it on to <@${asker}>.`);
                                    convo.next();

                                    // start private conversation with the original asker of the question
                                    bot.startPrivateConversation({user: asker}, (error, convoWithAsker) => {
                                        convoWithAsker.say({
                                            attachments: [
                                                {
                                                    fallback: `Answer from ${responderId}`,
                                                    pretext: "Here's one answer to your question.",
                                                    author_name: responderId,
                                                    text: answer
                                                }
                                            ]
                                        });

                                        convoWithAsker.ask('Was this answer helpful?', [
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
                                                    convo.say('Fantastic!');
                                                    convo.next();

                                                    // record the question and answer somewhere
                                                }
                                            }
                                        ]);

                                        convoWithAsker.next();
                                    });
                                });

                                convo.next();
                            }
                        }
                    ]);
                });
            });
        });
    }).on('error', (e) => {
        console.error('Failed to connect to social-search API', e);
        bot.reply(message, 'Eek! Sorry, I seem to be having some trouble with my subsystems. Please try again later.');
    });
});
