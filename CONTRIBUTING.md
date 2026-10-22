# Contributing

Thanks for wanting to help. AskCharts is open source, so you're free to fork it and build whatever you like. This
page is about getting a change into this repo.

## How

1. For anything bigger than a small fix, open an issue first, so I can say whether it fits before you put in the
   work.
2. Send a pull request against `main`. Keep it to one change, and say what it does and how you tested it.
3. I review every pull request and decide what's merged. A change I don't merge can still live on in your fork.

## Licence

By sending a pull request you agree that your change is licensed under the Apache License 2.0, like the rest of
AskCharts (section 5 of `LICENSE`). Only send code you wrote, or code you have the right to share under that
licence.

## What fits

- AskCharts runs on the user's own computer or server. No tracking, no accounts, and nothing that sends their data
  anywhere except the market data sources and the AI provider they choose.
- AskCharts AI works on the chart the way a person would. It doesn't place trades or tell anyone to buy or sell.
- The app runs on plain Node.js with no `npm install`. A new dependency needs a very good reason.
- Plain language in the app and the docs. Short sentences, no jargon where a common word works.
