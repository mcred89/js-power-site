# js-power-site CI/CD

1. Make github personal token
2. Enter token into AWS secrets manager as a string
    - CodepipelineGitHubToken is the default name, but you can name it whatever
3. Deploy pipeline template twice, filling in your github info and choices for either dev or prod.