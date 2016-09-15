
const http = require('http');
const SLACK_APP = 'slack_app';
const SLACK_CI = 'slack_ci';
const platforms = [SLACK_APP, SLACK_CI];
const config = { debug: true, json_file_store: 'json_db' };

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
  bot.startConversation(message, (error, convo) => {
    convo.say('Hi - thanks for your query. I will attempt to find the most appropriate people to help!');

    http.get(`http://localhost:8080/ask?q=${message.text}`, (response) => {
      console.log('response code: ' + response.statusCode);

      response.on('data', (raw) => {
        console.log('data: ' + raw);
        var result = JSON.parse(raw);

        if (result.users.length == 0) {
          convo.say('I\'m sorry, I can\'t find anybody who might be able to help');
        } else {
          convo.say('I may have found somebody who can help - let me check if they are available');
          //need to find a way to invite additional users to the conversation.
          //convo.say(`Paging <@U10UXQ66L>, <@U1SKL4B42>, and <@U1HFBD52N> - can any of you help <@${message.user}> with the following...`);
        }

        convo.next();
      });
    }).on('error', (e) => {
      console.error('Failed to connect to social-search API', e);
      convo.say('Eek! Sorry, I seem to be having some trouble with my subsystems. Please try again later.');
      convo.next();
    });
  });
});
