
const Botkit = require('botkit');

var activeBots = {};

function handleError(error) {
    if (error) {
        console.error(error);
        process.exit(1);
    }
}

module.exports = {
    init: (config, callback) => {
        const port = process.env.PORT || 8080;
        const clientId = process.env.CLIENT_ID;
        const clientSecret = process.env.CLIENT_SECRET;

        if (!clientId || !clientSecret) {
            handleError('Both the CLIENT_ID and CLIENT_SECRET environment variables must be set!');
        }

        const controller = Botkit.slackbot(config).configureSlackApp({
            clientId: clientId,
            clientSecret: clientSecret,
            scopes: config.scopes || []
        });

        controller.setupWebserver(port, (error, webserver) => {
            handleError(error);

            controller.createOauthEndpoints(webserver, (error, request ,response) => {
                if (error) {
                    response.status(500).send('ERROR: ' + error);
                } else {
                    response.send('Success!');
                }
            });

            controller.on('create_bot', (bot, config) => {
                if (!activeBots.hasOwnProperty(bot.config.token)) {
                    bot.startRTM((error, bot, response) => {
                        handleError(error);
                        activeBots[bot.config.token] = bot;
                        if (callback) callback(bot);
                    });
                }
            });

            controller.storage.teams.all((error, teams) => {
                handleError(error);
                for (var team of teams) {
                    if (team.bot) {
                        controller.spawn(team).startRTM((error, bot, response) => {
                            handleError(error);
                            activeBots[bot.config.token] = bot;
                            if (callback) callback(bot);
                        });
                    }
                }
            });
        });

        return controller;
    }
};
