# Social Search - Slack bot user interface
In order to demonstrate the concept behind Social Search, or rather, providing a mechanism to find and extract latent knowledge within the organisation, a user interface to the Social Search project has been developed. This takes the form of a Slack bot, providing a _basic_ level of interaction allowing users to ask a question and, hopefully, receive an answer from another user.

## Interactions
Users can communicate with bot directly, sending a private message with a question that needs answering. The bot will then make a request to the Social Search API to find a list of users most likely able to help. Each will then be asked if they have the time to help, and if they do, the question will be forwarded to them. If the users have an answer, they can submit this directly back to the bot, which will return it to the user that asked the question. The bot will check with the user to find out if the answer was useful, and if so, will store the question and answer for future work (i.e. performing some machine learning against the data to gain better insights and potentially feed this information back into the social search, to better identify the knowledge held by different users).

As stated, these interactions are quite basic and built purely to demonstrate the concept. Much work will need to be undertaken to turn the bot into a useful interface to properly support dynamic back-and-forth interaction that is capable of handling multiple lines, dealing with unhelpful answers, and so on. In fact, the ideal solution would probably open a new private channel between the user asking a question and any other users capable of answering it, with the bot merely there to record the conversation and capture the knowledge.

## Running the bot
The bot requires a running instance of the Social Search API and will also need a Slack App or Custom Integration to be configured.

If running the bot using Docker with the provided Dockerfile and Docker Compose config file, Tokens or OAuth ID & secrets should be configured in the `.env` file. The URI for the Social Search API should also be configured, or the application will default to `localhost:8080`.

If connecting the bot via a Slack app, you will need to use OAuth to connect the bot to a specific team instance. This will require `BOT_PLATFORM` variable in the `.env` file to be set to `slack_app`, in addition to providing the `CLIENT_ID` and `CLIENT_SECRET` variables. Once the bot has been started, navigate to `/login`, which will redirect you to the Slack auth page where you can select the specific team to connect to.

If running the bot using `npm` directly, then the relevant environment variables will need to be exported. See the `.env` file for a list of the required variables.

**Note, you may prefer to use the Social Search Platform project to run all of the components needed more easily. Checkout that repository and review the README file.**
