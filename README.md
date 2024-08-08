# CS-Trainer

CS-Trainer is a backend database project to accompany my front end website (yet to come). It's functionality aims to allow users to sign up, create/join teams and collaborate on roles/tactics. 

## Table of Contents

- [Features to come](#features-to-come)
- [Installation](#installation)
- [Usage](#usage)
- [Contact](#contact)
- [Screenshots](#screenshots)

## Features to come

-Frontend site.

-User sign in/up.

-Interactive tactics board that is shared with members of the team, this will include phases on rounds by which each member will be given detailed instructions on their role, lineups of smokes/flashes etc. The purpose is to allow team leaders or IGLs to outline plans for each round. 

-'Game Mode' functionality by which when the team are in-game they can have the site up on a second monitor or in-game overlay. The IGL/Leader can then select saved tactics at the start of the round and each member of the team will be given specific instructions on what they need to do.

-Steam sign-in/sign-up to accompany user sign-in/sign-up.

-Interactive calendar for team leaders to implement training/practice days shared amongst the team.

-Demo viewer implementation using cs-demo-manager by akiver to allow teams to go through previous games, see what went well/wrong.

## Installation

1. Clone the repo
    ```sh
    git clone https://github.com/caddickdaniel/cs-trainer.git
    ```
2. Install dependencies
    ```sh
    npm install
    ```
3. Create a knexfile.js using this template and replace the 'user' and 'password' to match your psql user/password
    ```sh
    const ENV = process.env.NODE_ENV || 'development';
    const dbConfig = {
        client: 'pg',
        migrations: {
            directory: './db/migrations',
        },
        seeds: {
            directory: './db/seeds',
        },
    };
    const customConfigs = {
        development: { connection: { database: 'cs_trainer_test', user: 'danny', password: 'password', } },
        test: { connection: { database: 'cs_trainer_test', user: 'danny', password: 'password', } },
        production: { connection: { database: 'cs_trainer', user: 'danny', password: 'password', } }
    };
    module.exports = { ...dbConfig, ...customConfigs[ENV] };
    ```
4. Start the server
    ```sh
    npm start
    ```
If you would like to run tests do the following

1. Run tests
    ```sh
    npm t
    ```

## Usage

Once you've started the server, go to your API testing software/site and referencing the endpoints.js file feel free to get/post/delete to your hearts content

## Screenshots (Frontend Design)

1. Home (incomplete) - https://imgur.com/DvG9xKb
2. Team (joined/not joined) - https://imgur.com/hJEACD5 https://imgur.com/ALmpUlA
3. Training - https://imgur.com/ncidJxo
4. Schedule - https://imgur.com/J5Spigj
5. Tactics - https://imgur.com/hwwcyD0
6. Gamemode (incomplete) - https://imgur.com/U6phOB4

## Contact

Daniel Caddick - caddickdaniel93@gmail.com
Project link - https://github.com/caddickdaniel/cs-trainer

