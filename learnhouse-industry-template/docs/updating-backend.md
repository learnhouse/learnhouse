# Updating backend from LearnHouse upstream
1. cd apps/api
2. git subtree pull --prefix=. https://github.com/learnhouse/learnhouse.git main --squash
3. Review changes and retest
4. Deploy via Cloud Build/Run
