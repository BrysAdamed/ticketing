# Original brief (verbatim from the product owner)

> I need a jira like app that will allow me to track projects. I want to have a users management (CRUD + role assignments + private access tokens for api / mcp access). Each user should be able to create project. Project can be private or public. Each project can contain tickets. Each ticket can have a "parent" ticket. Each project should have some kind of dashboard that shows some statistics of the tickets in it.
>
> Ticket has: key (project-slug + autoincremented integer), title, description (markdown), type, severity and priority, story points (integer), version (free text), labels (list of strings), list of test cases, comments.
>
> Version and labels should have a hint with previous values used in a given project.
>
> Ticket types: epic, spike, user story, technical, bug.
>
> Ticket statuses: To Do, In progress, On Hold, Review, Ready For testing, Testing, Ready for deploy, Done.
>
> Each test cases should have a title + steps (list of strings) as well as status - at first we have a "new", and the user can either change it to "manual" or to "automatic". We should then be able to view all of the test cases for the given project. Each project should have a regressions view, where we can create a new regression session. Each session should add all of the manual test cases to it, and make them "waiting for execution". The automatic one should automatically mark as "passes". Then each user can assign a given case to them - and then change the status in the session to "passes" or "fails". If we change the status to fails we should be able to automatically create a bug in the backlog with that repro steps.
>
> We should also be able to create boards - each board can contain tickets from multiple projects. Each board shows the swimlines with the statuses of the tickets that are assigned to that board. Each project should contain backlog of the tickets. Ticket is either in a backlog or in a board.
>
> I should also have an MCP server created for that app, so that I can hook it up to the LLM, so you can use it.
>
> For now it can be just in english. It would be nice, if we could have a feature-flags mechanism incorporated in it. Also, when developing a views - make sure that they will in a future support some A/B testing. For now do not make any multiple views - but keep that in mind.
>
> My motivation for this project is to replace Jira. We are currently paying a lot of money and we are not using 99% of the features. We would like to have a ticketing system that is easily integrated with llms like Claude Code.
>
> Required deliverables: a working project written in C#, with Angular frontend, PostgreSQL database, Docker, Playwright e2e tests, integration tests featuring Testcontainers, and documentation — glossary, ADRs, domain workflows, decisions, ideas, CLAUDE.md. The app should look professional and work super smooth — nobody likes a ticketing system that is slow.
