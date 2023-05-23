# Contributing to LearnHouse

## Backend Codebase

### Tech

- **FastAPI** - A high performance, async API framework for Python
- **Pydantic** - Data validation and settings management using Python type annotations.
- **Ruff** - An extremely fast Python linter, written in Rust.
- **Motor** - the async Python driver for MongoDB and Tornado or asyncio
- **Uvicorn** - an ASGI web server implementation for Python.

### Get started

Use the Docker Image available in `./Dockerfile`

    docker-compose up -d

Initiate a dev environment, please check the official guide [here](https://docs.learnhouse.app/technical-docs/dev-env)

## Frontend Codebase

### Tech

- **Next.js** (13 with the App Directory) - The React Framework
- **TailwindCSS** - Styling
- **Radix UI** - Accessible UI Components
- **Tiptap** - An editor framework and headless wrapper around ProseMirror
- **YJS** - Shared data types for building collaborative software
- **MongoDB** - NoSQL Database
- **React** - duh

### Get started

Use the Docker Image available in `front/Dockerfile`, or install the frontend package on your computer for greater performance.

#### Start the Backend server first

You need to have the backend running, to initiate a dev environment please check the official guide [here](https://docs.learnhouse.app/technical-docs/dev-env)

#### Environment Files

Please check if you initiated your `.env` files, here is a [guide](https://docs.learnhouse.app/technical-docs/dev-env) on how to do it.

#### Install the frontend package

    npm i

#### Run in Dev environment

    npm run dev

## Submitting Contributions

This project follows [GitHub's standard forking model](https://guides.github.com/activities/forking/). Please fork the project to submit pull requests.

### Submitting a bug/fix

- Start an issue [here](https://github.com/learnhouse/learnhouse/issues) to report the bug.
- Please include a detailed description of the bug and how it can be reproduced.
- Someone from the team will review the issue and will give you a go ahead.

### Submitting a feature / idea

- Start a Discussion [here](https://github.com/learnhouse/learnhouse/discussions/categories/ideas) to propose your idea and how it should be implemented.
- Someone from the team will review your idea and will give you a go ahead.
- Start an issue & link the discussion to it.
- Clone your fork locally
- Create a new branch and make your commits
- Push your commits to your forked repo
- Make a Pull request
- Code will be added after review
