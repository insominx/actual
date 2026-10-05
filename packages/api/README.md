```
npm install @actual-app/api
```

View docs here: https://actualbudget.org/docs/api/

## TypeScript

`@actual-app/api` publishes TypeScript declarations. Consumers using TypeScript must set `moduleResolution` to `"bundler"`, `"nodenext"`, or `"node16"` in their `tsconfig.json`. Legacy `"node"` / `"node10"` / `"classic"` resolution is not supported in strict mode — the published declarations rely on package.json `exports` conditions that older resolvers don't honor.

Guarded category deletion uses `previewCategoryDeletion({ id, transferCategoryId })` and `applyCategoryDeletion(proposal)`. The optional destination must be a different live category of the same income type. Preview preserves rows and declares canonical tombstone, forwarding mappings and expense allocation transfers for every created month. Apply checks budget identity and source state before writing and verifies the actual owner effects. Income deletion preserves the existing allocation behavior.

`previewCategoryGroupCreation({ name, is_income, hidden, categories })` and `applyCategoryGroupCreation(proposal)` expose guarded group creation. Flags default to false. Names keep their exact spelling. Optional `categories` retain the existing creation behavior and do not create child categories. Preview binds canonical ordering and source state; apply returns `groupCreation.groupId` from the actual owner insertion.
