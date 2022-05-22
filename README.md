# Local enviornment setup

    - Launch visual studio code as administrator
    - Remove `node_modules` (if any)
    - Remove `package-lock.json` (if any)
    - npm cache clean -f
    - Run `npm install` which will install all dependecies specified in `package.json`
    - To debug locally, go to `package.json` => `scripts` and click on `Debug` link appear above it. (todo: more steps to be added)

# Change the APY

```bash
# change the APY_PER_DAY
vim <soteria-backend-cloudfunctions-dir>/index.js

# deploy
gcloud functions deploy rebase
```

# Deploy HTTP functions

```bash
gcloud auth login
gcloud config set project <project name of the environment you want to deploy to>

# new function deployment
gcloud functions deploy <function name to be deployed> --runtime nodejs10 --trigger-http

gcloud functions deploy withdrawal_request --runtime=nodejs10 --trigger-http
gcloud functions deploy withdrawal_cancel --runtime=nodejs10 --trigger-http
gcloud functions deploy withdrawal_done --runtime=nodejs10 --trigger-http
gcloud functions deploy conversion_request --runtime=nodejs10 --trigger-http

# existing function deployment
gcloud functions deploy <function name to be deployed>

gcloud functions deploy withdrawal_request
gcloud functions deploy withdrawal_cancel
gcloud functions deploy withdrawal_done
gcloud functions deploy conversion_request
```

# Deploy pub/sub functions

```bash

# new function deployment
gcloud functions deploy <function name to be deployed> --runtime=nodejs10 --trigger-topic=<topic name>

gcloud functions deploy conversion_batch --runtime=nodejs10 --trigger-topic=convert_trigger
gcloud functions deploy distribute_interest --runtime=nodejs10 --trigger-topic=interest_timer
gcloud functions deploy rebase --runtime=nodejs10 --trigger-topic=rebase_timer
gcloud functions deploy rebalance_usds --runtime=nodejs10 --trigger-topic=rebalance_usds_timer
gcloud functions deploy update_balance_usds --runtime=nodejs10 --trigger-topic=usds_watcher_timer
gcloud functions deploy usds_watcher --runtime=nodejs10 --trigger-topic=usds_watcher_timer
gcloud functions deploy rebase_watcher --runtime=nodejs10 --trigger-topic=rebase_watcher

# existing function deployment
gcloud functions deploy <function name to be deployed>

gcloud functions deploy conversion_batch
gcloud functions deploy distribute_interest
gcloud functions deploy rebase
gcloud functions deploy rebalance_usds
gcloud functions deploy update_balance_usds
gcloud functions deploy usds_watcher
gcloud functions deploy rebase_watcher
```
