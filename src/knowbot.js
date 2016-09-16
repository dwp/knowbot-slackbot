
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
    'ping',
    ['direct_message', 'mention', 'direct_mention'],
    (bot, message) => bot.reply(message, 'pong'));


controller.on('direct_message', (bot, message) => {
    // use say to force the response to go out instantly rather than waiting to batch in reply.
    bot.say({
        'text': 'Hi - thanks for your query. I will attempt to find the most appropriate people to help!',
        'channel': message.channel
    });

    http.get(SOCIAL_SEARCH_URI + `/ask?q=${message.text}`, (response) => {
        console.log('response code: ' + response.statusCode);
        response.on('data', (raw) => {
            console.log('data: ' + raw);
            var result = JSON.parse(raw);
            // remove the user asking the question from the response if present & limit to top three
            result.users = result.users.filter(user => {
                console.log(`Filtering users: comparing ${user.user_id} with ${message.user}.`);
                return user.user_id != message.user;
            }).slice(0,3);
            if (result.users.length == 0) {
                bot.reply(message, 'I\'m sorry, I can\'t find anybody who might be able to help');
            } else {
                //convo.say('I may have found somebody who can help - let me check if they are available');
                //need to find a way to invite additional users to the conversation.
                //convo.say(`Paging <@U10UXQ66L>, <@U1SKL4B42>, and <@U1HFBD52N> - can any of you help <@${message.user}> with the following...`);
                bot.reply(message, `I have found the following users who may be able to help you: ${result.users.map(user => `<@${user.user_id}>`).join(', ')}.`)
            }
        });
    }).on('error', (e) => {
        console.error('Failed to connect to social-search API', e);
        bot.reply(message, 'Eek! Sorry, I seem to be having some trouble with my subsystems. Please try again later.');
    });
});
