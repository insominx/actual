---
title: API Reference
---

import { types, objects, PrimitiveTypeList, PrimitiveType, StructType, Method, MethodBox } from './types';
import APIList from './APIList';

<APIList title="Budgets" sections={[
"getBudgetMonths",
"getBudgetMonth",
"setBudgetAmount",
"setBudgetCarryover",
"holdBudgetForNextMonth",
"resetBudgetHold"
]} />

<APIList title="Transactions" sections={[
"Transaction",
"addTransactions",
"importTransactions",
"getTransactions",
"updateTransaction",
"previewTransactionUpdate",
"applyTransactionUpdate",
"deleteTransaction",
"mergeTransactions"
]} />

<APIList title="Accounts" sections={[
"Account",
"getAccounts",
"createAccount",
"previewAccountCreation",
"applyAccountCreation",
"updateAccount",
"previewAccountUpdate",
"applyAccountUpdate",
"closeAccount",
"reopenAccount",
"previewAccountReopen",
"applyAccountReopen",
"deleteAccount",
"getAccountBalance"
]} />

<APIList title="Categories" sections={[
"Category",
"getCategories",
"createCategory",
"updateCategory",
"deleteCategory"
]} />

<APIList title="Category Groups" sections={[
"Category group",
"getCategoryGroups",
"createCategoryGroup",
"updateCategoryGroup",
"deleteCategoryGroup"
]} />

<APIList title="Payees" sections={[
"Payee",
"getPayees",
"createPayee",
"updatePayee",
"deletePayee",
"mergePayees"
]} />

<APIList title="Tags" sections={[
"Tag",
"getTags",
"createTag",
"updateTag",
"deleteTag"
]} />

<APIList title="Rules" sections={[
"ConditionOrAction",
"Rule",
"getRules",
"getPayeeRules",
"createRule",
"updateRule",
"deleteRule"
]} />

<APIList title="Schedules" sections={[
"Schedule",
"RecurConfig",
"getSchedules",
"createSchedule",
"updateSchedule",
"deleteSchedule"
]} />

<APIList title="Notes" sections={[
"getNote",
"updateNote"
]} />

<APIList title="Misc" sections={[
"BudgetFile",
"initConfig",
"init",
"shutdown",
"sync",
"runBankSync",
"runImport",
"getBudgets",
"loadBudget",
"downloadBudget",
"importBudget",
"restoreBudget",
"previewBudgetRestore",
"applyBudgetRestore",
"exportBudget",
"batchBudgetUpdates",
"runQuery",
"getIDByName",
"getPreferences",
"setPreference"
]} />

## Types of Methods

API methods are categorized into one of four types:

- `get`
- `create`
- `update`
- `delete`

Objects may have fields specific for a type of method. For example, the `payee` field of a `transaction` is only available in a `create` method. This field doesn't exist in objects returned from a `get` method (`payee_id` is used instead).

Fields specific to a type of request are marked as such in the notes.

`id` is a special field. All objects have an `id` field. However, you don't need to specify an `id` in a `create` method; all `create` methods will return the created `id` back to you.

All `update` and `delete` methods take an `id` to specify the desired object. `update` takes the fields to update as a second argument — it does not take a full object. That means even if a field is required, you don't have to pass it to `update`. For example, a `category` requires the `group_id` field, however `updateCategory(id, { name: "Food" })` is a valid call. Required means that an `update` can't set the field to `null` and a `create` must always contain the field.

**Note:** `updateRule` is an exception — it requires the full [`Rule`](#rule) object including `id`, and returns `Promise<Rule>`.

## Primitives

These are types.

<PrimitiveTypeList />

## Budgets

#### `getBudgetMonths`

<Method name="getBudgetMonths" args={[]}  returns="Promise<month[]>" />

#### `getBudgetMonth`

<Method name="getBudgetMonth" args={[{ name: 'month', type: 'month' }]} returns="Promise<Budget>" />

#### `setBudgetAmount`

<Method name="setBudgetAmount" args={[{ name: 'month', type: 'month' }, { name: 'categoryId', type: 'id' }, { name: 'value', type: 'amount' }]} returns="Promise<null>" />

#### `setBudgetCarryover`

<Method name="setBudgetCarryover" args={[{ name: 'month', type: 'month' }, { name: 'categoryId', type: 'id' }, { name: 'flag', type: 'bool' }]} returns="Promise<null>" />

#### `holdBudgetForNextMonth`

<Method name="holdBudgetForNextMonth" args={[{ name: 'month', type: 'month' }, { name: 'value', type: 'amount' }]} returns="Promise<null>" />

#### `resetBudgetHold`

<Method name="resetBudgetHold" args={[{ name: 'month', type: 'month' }]} returns="Promise<null>" />

## Transactions

#### Transaction

<StructType fields={objects.transaction} />

#### Split Transactions

A split transaction has several sub-transactions that split the total
amount across them. You can create a split transaction by specifying
an array of sub-transactions in the `subtransactions` field. This field is primarily used during creation and retrieval.

When creating a split with `addTransactions`, each subtransaction requires an integer `amount`. Optional fields include `category`, `payee`, and `notes`. A `payee` can identify an account's transfer payee; enable `runTransfers` to create its counterpart.

The engine supplies child IDs, account, date, parent linkage, and split flags. You can update an existing child through `updateTransaction(childId, fields)`. The engine recalculates the parent error and preserves omitted child fields. To change inherited account, date, cleared, or reconciled values, update the parent.

If the amounts of the sub-transactions do not equal the total amount
of the transaction, currently the API call will succeed but an error
will be displayed within the app.

#### Parent Transaction Requirements

For `addTransactions`, supply the parent date, amount, and a nonempty `subtransactions` array. The engine marks the parent and children as a split; callers do not need to supply `is_parent`, child account, or child date. Updating a normal transaction with a nonempty `subtransactions` array also converts it into a split.

A working example of API fields:

**Note:** When creating a new split transaction, you typically don't need to provide an `id` for the parent; the system will generate one. The parent transaction's `amount` should equal the sum of all subtransaction amounts.

```js
{
  "id": "parent-id",
  "is_parent": true,
  "subtransactions": [
    {
      "amount": 142000,
      "account": "9c1e5de4-ecf8-41c2-8a97-4a1e8bc385c9",
      "date": "2024-08-12",
      "parent_id": "parent-id",
      "is_child": true,
      "is_parent": false,
      "category": "71376207-72f9-4b2b-ae24-0931a226f76a",
    },
    {
      "amount": 150,
      "account": "9c1e5de4-ecf8-41c2-8a97-4a1e8bc385c9",
      "date": "2024-08-12",
      "parent_id": "parent-id",
      "is_child": true,
      "is_parent": false,
      "category": "315d3776-d2a8-4d82-8a69-648b0d80125a",
    }
  ]
}
```

#### Transfers

Existing transfers will have the `transfer_id` field which points to the transaction on the other side. **You should not change this** or you will cause unexpected behavior. (You are allowed to set this when importing, however.)

If you want to create a transfer, use the transfer payee for the account you wish to transfer to/from. Load the payees, use the [`transfer_acct`](#payee) field of the payee to find the account you want to transfer to/from, and assign that payee to the transaction. A transfer with a transaction in both accounts will be created. (See [transfer payees](#transfers-1).)

#### Methods

#### `addTransactions`

<Method name="addTransactions" args={[{ name: 'accountId', type: 'id'}, { name: 'transactions', type: 'Transaction[]'}, { name: 'runTransfers = false', type: 'bool?'}, { name: 'learnCategories = false', type: 'bool?'}]} returns="Promise<id[]>" />

Adds multiple transactions at once. Does not reconcile (see `importTransactions`). Returns an array of ids of the newly created transactions.

This method does **not** avoid duplicates. Use `importTransactions` if you want the full reconcile behavior.

This method has the following optional flags:

- `runTransfers`: create transfers for transactions where transfer payee is given (defaults to false)
- `learnCategories`: update Rules based on the category field in the transactions (defaults to false)

This method is mainly for custom importers that want to skip all the automatic stuff because it wants to create raw data. You probably want to use `importTransactions`.

#### `importTransactions`

<Method name="importTransactions" args={[{ name: 'accountId', type: 'id'}, { name: 'transactions', type: 'Transaction[]'}, { name: 'opts = {}', type: 'object?'}]} returns="Promise<{ errors, added, updated }>" />

Adds multiple transactions at once, while going through the same process as importing a file or downloading transactions from a bank.
In particular, all rules are run on the specified transactions before adding them.
Use `addTransactions` instead for adding raw transactions without post-processing.

The import will "reconcile" transactions to avoid adding duplicates. Transactions with the same `imported_id` will never be added more than once. Otherwise, the system will match transactions with the same amount and with similar dates and payees and try to avoid duplicates. If not using `imported_id` you should check the results after importing.

It will also create transfers if a transfer payee is specified. See [transfers](#transfers).

This method has the following optional flags (passed as the `opts` object):

- `defaultCleared`: whether imported transactions should be marked as cleared (defaults to `true`)
- `dryRun`: if `true`, returns what would be added/updated without actually modifying the database (defaults to `false`)
- `reimportDeleted`: if `true`, transactions that were previously imported and then deleted will be reimported; if `false`, they will be skipped (defaults to `true` for backward compatibility — note that the [file import UI](../transactions/importing.md#avoiding-duplicate-transactions) defaults to `false`)
- `payeeNameNormalization`: how `payee_name` is processed when creating a payee — `'title-case'` re-capitalizes each word, `'original'` keeps the name as given, apart from trimming surrounding whitespace (defaults to `'title-case'`)

Example using opts:

```js
await api.importTransactions(accountId, transactions, {
  reimportDeleted: false,
  defaultCleared: false,
});
```

This method returns an object with the following fields:

- `added`: an array of ids of transactions that were added
- `updated`: an array of ids of transactions that were updated (such as being cleared)
- `errors`: any errors that occurred during the process (most likely a single error with no changes to transactions)

#### `getTransactions`

<Method name="getTransactions" args={[{ name: 'accountId', type: 'id'}, { name: 'startDate', type: 'date' }, { name: 'endDate', type: 'date' }]} returns="Promise<Transaction[]>" />

Get all the transactions in `accountId` between the specified dates (inclusive). Returns an array of [`Transaction`](#transaction) objects.

#### `updateTransaction`

<Method name="updateTransaction" args={[{ name: 'id', type: 'id'}, { name: 'fields', type: 'object'} ]} />

Update fields of a transaction. `fields` can specify any field described in [`Transaction`](#transaction).

#### `previewTransactionUpdate`

`previewTransactionUpdate({ id, fields })` returns a version 1 proposal for an ordinary transaction. The initial guarded scope supports notes, amount, date, and cleared. The proposal contains exact budget identities, detached before/after values, reference preconditions, and declared side effects. Preview does not write the transaction. Split and transfer updates remain unavailable through this guarded method.

#### `applyTransactionUpdate`

`applyTransactionUpdate(proposal)` compares the proposal with current state inside the core mutation boundary. It returns either `rejected` with a stable code or `committed-local` with changed status, affected IDs, and an observed checkpoint. The method awaits canonical batch completion before acknowledging the outcome. It does not synchronize remotely or create durable operation receipts. The CLI changes commands own those local receipts and prevent automatic replay of uncertain operations. Independent remote edits after refresh are not globally locked.

#### `deleteTransaction`

<Method name="deleteTransaction" args={[{ name: 'id', type: 'id'}]} />

Delete a transaction.

#### `mergeTransactions`

<Method name="mergeTransactions" args={[{ name: 'ids', type: 'id[]' }]} returns="Promise<id>" />

Merge exactly two distinct transactions from the same account into one. Returns the id of the surviving transaction; the other one is deleted.

The order of the ids does not decide which transaction survives:

- an imported transaction is kept over a manually entered one
- otherwise, the transaction with the earlier date is kept

The surviving transaction keeps its own field values and fills in any empty ones from the deleted transaction. It is marked cleared if either transaction was.

The merge fails if you pass the same id twice, or if the two transactions are in different accounts, have different amounts, or are transfers to different accounts.

#### Examples

```js
// Create a transaction of $12.00. A payee of "Kroger" will be
// automatically created if it does not exist already and
// assigned to the transaction.

await importTransactions(accountId, [
  {
    date: '2019-08-20',
    amount: 1200,
    payee_name: 'Kroger',
    category: 'c179c3f4-28a6-4fbd-a54d-195cced07a80',
  },
]);
```

```js
// Get all transactions in an account for the month of August
// (it doesn't matter that August 31st doesn't exist).

await getTransactions(accountId, '2019-08-01', '2019-08-31');
```

```js
// Assign the "Food" category to a transaction

let categories = await getCategories();
let foodCategory = category.find(cat => cat.name === 'Food');
await updateTransaction(id, { category: foodCategory.id });
```

## Accounts

#### Account

<StructType fields={objects.account} />

#### Closing Accounts

Avoid setting the `closed` property directly to close an account; instead use the `closeAccount` method. If the account still has money in it you will be required to specify another account to transfer the current balance to. This will help track your money correctly.

If you want to fully delete an account and remove it entirely from the system, use [`deleteAccount`](#deleteaccount). Note that if it's an on budget account, any money coming from that account will disappear.

#### Methods

#### `getAccounts`

<Method name="getAccounts" args={[]} returns="Promise<Account[]>" />

Get all accounts. Returns an array of [`Account`](#account) objects.

#### `createAccount`

<Method name="createAccount" args={[{ name: 'account', type: 'Account' }, { name: 'initialBalance = 0', type: 'amount?' }]} returns="Promise<id>" />

Create an account with an initial balance of `initialBalance` (defaults to 0). Remember that [`amount`](#primitives) has no decimal places. Returns the `id` of the new account.

#### `previewAccountCreation`

`previewAccountCreation({ name, offbudget, initialBalance, closed? })` returns an `accounts.create` proposal for the loaded budget. `initialBalance` uses signed integer cents. Preview records the source fingerprint, account fields, transfer payee creation, and any opening transaction. It inspects Starting Balance references without creating a payee. A nonzero opening balance binds the execution date and the canonical income category. Off-budget opening transactions have no category.

#### `applyAccountCreation`

`applyAccountCreation(proposal)` rechecks the budget identity, source fingerprint, references, and opening date before calling the canonical account writer. A committed result includes `accountCreation` with actual account, transfer payee, opening transaction, and Starting Balance payee IDs. The last two IDs are null for a zero opening balance. API callers must manage retries themselves; the CLI stores durable operation receipts. A matching account name cannot establish an uncertain creation outcome.

#### `updateAccount`

<Method name="updateAccount" args={[{ name: 'id', type: 'id' }, { name: 'fields', type: 'object' }]} />

Update fields of an account. `fields` can specify any field described in [`Account`](#account).

#### `previewAccountUpdate`

`previewAccountUpdate({ id, fields })` supports `name`, `offbudget`, `closed`, `balance_current`, and `account_group_id`. Supply at least one field. `balance_current` uses integer cents or null; it is the stored bank balance, not the computed ledger balance. `account_group_id` accepts an existing group ID or null. Preview validates references and preserves account, payee, and transaction records. It records before/after account fields and derived transfer payee names. Its source fingerprint binds the persistent ledger and references.

#### `applyAccountUpdate`

`applyAccountUpdate(proposal)` rechecks the exact budget and complete proposal before invoking the existing account update writer. Omitted fields and ledger transactions remain unchanged. Renaming changes displayed transfer payee names through the account join, without writing payees. Updating `closed` through this method only changes the account field. Use `closeAccount` when bank unlink or a balance transfer is required. A committed outcome includes the account ID, checkpoint, and whether account fields changed. The CLI adds durable receipts and safe retries.

#### `closeAccount`

<Method name="closeAccount" args={[{ name: 'id', type: 'id' }, { name: 'transferAccountId', type: 'id?' }, { name: 'transferCategoryId', type: 'id?' }]} />

Close an account. `transferAccountId` and `transferCategoryId` are optional if the balance of the account is 0, otherwise see next paragraph.

If the account has a non-zero balance, you need to specify an account with `transferAccountId` to transfer the money into. If you are transferring from an on budget account to an off budget account, you can optionally specify a category with `transferCategoryId` to categorize the transfer transaction.

Transferring money to an off budget account needs a category because money is taken out of the budget, so it needs to come from somewhere.

If you want to simply delete an account, see [`deleteAccount`](#deleteaccount).

#### `reopenAccount`

<Method name="reopenAccount" args={[{ name: 'id', type: 'id' }]} />

Reopen a closed account.

#### `previewAccountReopen`

`previewAccountReopen({ id })` returns a proposal for the loaded budget. Preview preserves all records and shows `closed` changing to false. The fingerprint binds the persistent source, ledger, account, and references. Reopening does not relink a bank, transfer money, or rename a payee.

#### `applyAccountReopen`

`applyAccountReopen(proposal)` rechecks the exact operation, budget, and complete proposal before calling the canonical reopening writer. It preserves stored provider fields and ledger records. A committed outcome includes the account ID and checkpoint; `changed` is false when the account was already open. API callers manage retries themselves. CLI receipts prevent replay after an acknowledged reopening or an uncertain outcome.

#### `deleteAccount`

<Method name="deleteAccount" args={[{ name: 'id', type: 'id' }]} />

Delete an account.

#### `getAccountBalance`

<Method name="getAccountBalance" args={[{ name: 'id', type: 'id' }, { name: 'cutoff', type: 'Date?'}]} returns="Promise<number>" />

Gets the balance for an account. If a cutoff is given, it gives the account balance as of that date. If no cutoff is given, it uses the current date as the cutoff.

#### Examples

```js
// Create a savings account
createAccount({
  name: 'Ally Savings',
});
```

```js
// Get all accounts

let accounts = await getAccounts();
```

## Account Groups

### Account Group

<StructType fields={objects.accountGroup} />

Account groups let you organize accounts into named groups, for example "Savings" or "Credit Cards". An account can belong to at most one group, set through the `account_group_id` field on [`Account`](#account).

#### Methods

#### `getAccountGroups`

<Method name="getAccountGroups" args={[]} returns="Promise<AccountGroup[]>" />

Get all account groups. Returns an array of [`Account Group`](#account-group) objects.

#### `createAccountGroup`

<Method name="createAccountGroup" args={[{ name: 'group', type: 'AccountGroup' }]} returns="Promise<id>" />

Create an account group. Returns the `id` of the new group.

#### `updateAccountGroup`

<Method name="updateAccountGroup" args={[{ name: 'id', type: 'id' }, { name: 'fields', type: 'object' }]} />

Update fields of an account group. `fields` can specify the `name` field described in [`Account Group`](#account-group).

#### `deleteAccountGroup`

<Method name="deleteAccountGroup" args={[{ name: 'id', type: 'id' }]} />

Delete an account group. Any accounts in the group are left ungrouped.

#### Examples

```js
// Group two accounts under "Savings"

const groupId = await createAccountGroup({ name: 'Savings' });
await updateAccount(allySavingsId, { account_group_id: groupId });
await updateAccount(marcusSavingsId, { account_group_id: groupId });
```

## Categories

#### Category

<StructType fields={objects.category} />

#### Methods

#### `getCategories`

<Method name="getCategories" args={[{ name: 'options = {}', type: 'object?' }]} returns="Promise<Category[]>" />

Get categories. By default, returns every category.

The `options` object supports:

- `hidden`: filter by hidden status. Pass `false` to return only visible categories, or `true` to return only hidden ones. Omit to return both.

#### `createCategory`

<Method name="createCategory" args={[{ name: 'category', type: 'Category' }]} returns="Promise<id>" />

Create a category. Returns the `id` of the new category.

#### `updateCategory`

<Method name="updateCategory" args={[{ name: 'id', type: 'id' }, { name: 'fields', type: 'object' }]} returns="Promise<null>" />

Update fields of a category. `fields` can specify any field described in [`Category`](#category).

#### `deleteCategory`

<Method name="deleteCategory" args={[{ name: 'id', type: 'id' }]} returns="Promise<null>" />

Delete a category.

### Examples

```js
{
  name: "Food",
  group_id: "238d4d38-a512-4e28-9bbe-e96fd5d99251"
}
```

#### Income Categories

Set `is_income` to `true` to create an income category. The `group_id` of the category should point to the existing income group category (currently only one ever exists, see [category group](#category-group)).

## Category Groups

#### Category Group

<StructType fields={objects.categoryGroup} />

```js
{
  name: 'Bills';
}
```

#### Income Category Groups

There should only ever be one income category group,

#### Methods

#### `getCategoryGroups`

<Method name="getCategoryGroups" args={[{ name: 'options = {}', type: 'object?' }]} returns="Promise<CategoryGroup[]>" />

Get category groups. By default, returns every group with all of its categories nested under it.

The `options` object supports:

- `hidden`: filter by hidden status, applied to both groups and their nested categories. Pass `false` to return only visible groups and categories, or `true` to return only hidden ones. Omit to return both.

#### `createCategoryGroup`

<Method name="createCategoryGroup" args={[{ name: 'group', type: 'CategoryGroup' }]} returns="Promise<id>" />

Create a category group. Returns the `id` of the new group.

#### `updateCategoryGroup`

<Method name="updateCategoryGroup" args={[{ name: 'id', type: 'id' }, { name: 'fields', type: 'object' }]} returns="Promise<id>" />

Update fields of a category group. `fields` can specify any field described in [`CategoryGroup`](#category-group). Omitted fields keep their values. Nested `categories` are read metadata; group updates never change child categories.

#### `deleteCategoryGroup`

<Method name="deleteCategoryGroup" args={[{ name: 'id', type: 'id' }]} returns="Promise<null>" />

Delete a category group.

## Payees

#### Payee

<StructType fields={objects.payee} />

```js
{
  name: "Kroger",
  category: "a1bccbd1-039e-410a-ba05-a76b97a74fc8"
}
```

#### Transfers

Transfers use payees to indicate which accounts to transfer money to/from. This lets the system use the same payee matching logic to manage transfers as well.

Each account has a corresponding "transfer payee" already created in the system. If a payee is a transfer payee, it will have the `transfer_acct` field set to an account id. Use this to create transfer transactions with [`importTransactions`](#importtransactions).

#### Methods

#### `getPayees`

<Method name="getPayees" args={[]} returns="Promise<Payee[]>" />

Get all payees.

#### `getCommonPayees`

<Method name="getCommonPayees" args={[]} returns="Promise<Payee[]>" />

Get common payees that appear frequently in transactions.

#### `createPayee`

<Method name="createPayee" args={[{ name: 'payee', type: 'Payee' }]} returns="Promise<id>" />

Create a payee. Returns the `id` of the new payee.

#### `updatePayee`

<Method name="updatePayee" args={[{ name: 'id', type: 'id' }, { name: 'fields', type: 'object' }]} returns="Promise<id>" />

Update fields of a payee. `fields` can specify any field described in [`Payee`](#payee).

#### `deletePayee`

<Method name="deletePayee" args={[{ name: 'id', type: 'id' }]} returns="Promise<null>" />

Delete a payee.

#### `mergePayees`

<Method name="mergePayees" args={[{ name: 'targetId', type: 'id' }, { name: 'mergeIds', type: 'id[]' }]} returns="Promise<null>" />

Merge one or more payees into the target payee, retaining the name of the target.

## Tags

#### Tag

<StructType fields={objects.tag} />

#### Methods

#### `getTags`

<Method name="getTags" args={[]} returns="Promise<Tag[]>" />

Get all tags.

#### `createTag`

<Method name="createTag" args={[{ name: 'tag', type: 'Tag' }]} returns="Promise<id>" />

Create a tag. Returns the `id` of the new tag.

#### `updateTag`

<Method name="updateTag" args={[{ name: 'id', type: 'id' }, { name: 'fields', type: 'object' }]} returns="Promise<null>" />

Update fields of a tag. `fields` can specify any field described in [`Tag`](#tag).

#### `deleteTag`

<Method name="deleteTag" args={[{ name: 'id', type: 'id' }]} returns="Promise<null>" />

Delete a tag.

#### Examples

```js
// Create a tag
await createTag({
  tag: 'groceries',
  color: '#ff0000',
  description: 'Grocery shopping expenses',
});
```

```js
// Get all tags
let tags = await getTags();
```

```js
// Update a tag's color
await updateTag(id, { color: '#00ff00' });
```

## Rules

#### ConditionOrAction

<StructType fields={objects.condition} />

#### Rule

<StructType fields={objects.rule} />

#### Methods

#### `getRules`

<Method name="getRules" args={[]} returns="Promise<Rule[]>" />

Get all rules.

#### `getPayeeRules`

<Method name="getPayeeRules" args={[{ name: 'payeeId', type: "id" }]} returns="Promise<Rule[]>" />

Get all rules associated with `payeeId`. These are ordinary `Rule` objects, in the same shape `getRules` returns. A rule is associated with a payee when one of its conditions or actions has a `payee` field referencing that id, so the returned rules have no `payee_id` property.

#### `createRule`

<Method name="createRule" args={[{ name: 'rule', type: 'Rule' }]} returns="Promise<Rule>" />

Create a rule. Returns the new rule, including the `id`.

#### `updateRule`

<Method name="updateRule" args={[{ name: 'rule', type: 'Rule' }]} returns="Promise<Rule>" />

Update a rule. Unlike other update methods, this requires the full rule object including `id`. Returns the updated rule.

#### `deleteRule`

<Method name="deleteRule" args={[{ name: 'id', type: 'id' }]} returns="Promise<null>" />

Delete a rule.

#### Examples

```js
{
  stage: 'pre',
  conditionsOp: 'and',
  conditions: [
    {
      field: 'payee',
      op: 'is',
      value: 'test-payee',
    },
  ],
  actions: [
    {
      op: 'set',
      field: 'category',
      value: 'fc3825fd-b982-4b72-b768-5b30844cf832',
    },
  ],
}
```

## Schedule

#### Schedule

<StructType fields={objects.schedule} />

#### RecurConfig

<StructType fields={objects.recurConfig} />

#### Methods

#### `getSchedules`

<Method name="getSchedules" args={[]} returns="Promise<Schedule[]>" />

Get all schedules. Returns an array of [`Schedule`](#schedule) objects.

#### `createSchedule`

<Method name="createSchedule" args={[{ name: 'schedule', type: 'Schedule' }]} returns="Promise<id>" />

Create schedule based on information filled in the schedule object. Please refer to notes of schedule object for details each field.

#### `updateSchedule`

<Method name="updateSchedule" args={[{ name: 'id', type: 'id' }, { name: 'fields', type: 'object' }]} returns="Promise<schedule>" />

Update fields of a rule. `fields` can specify any field described in [`Schedule`](#schedule). Returns the updated rule.

#### `deleteSchedule`

<Method name="deleteSchedule" args={[{ name: 'id', type: 'id' }]} returns="Promise<null>" />

## Notes

Notes can be attached to any entity (categories, budget months, etc.) by ID. They are also used to define budget templates and savings goals (e.g. `#template 250`, `#goal 1000`).

#### `getNote`

<Method name="getNote" args={[{ name: 'id', type: 'id' }]} returns="Promise<Note | null>" />

Returns the note for the given entity ID, or `null` if no note has been set.

#### `updateNote`

<Method name="updateNote" args={[{ name: 'id', type: 'id' }, { name: 'note', type: 'string' }]} returns="Promise<void>" />

Sets the note on the entity with the given ID. Pass an empty string to clear the note.

## Misc

#### BudgetFile

<StructType fields={objects.budgetFile} />

#### InitConfig

<StructType fields={objects.initConfig} />

#### Methods

#### `init`

<Method name="init" args={[{ name: 'config', type: 'InitConfig?' }]} returns="Promise<void>" />

Initializes the API by connecting to an Actual Budget server. The config parameter is optional and defaults to `{}` (local-only mode).

#### `shutdown`

<Method name="shutdown" args={[]} returns="Promise<void>" />

Shuts down the API. This will close any open budget and clean up any resources.

#### `sync`

<Method name="sync" args={[]} returns="Promise<void>" />

Synchronizes the locally cached budget files with the server's copy.

#### `runBankSync`

<Method name="runBankSync" args={[{ properties: [{ name: 'accountId', type: 'string' }] }]} returns="Promise<void>" />

Run the 3rd party (GoCardless, SimpleFIN) bank sync operation. This will download the transactions and insert them into the ledger.

#### `runImport`

<Method name="runImport" args={[{ name: 'budgetName', type: 'string' }, { name: 'func', type: 'func' }]} returns="Promise<void>" />

Creates a new budget file with the given name, and then runs the custom importer function to populate it with data.

#### `getBudgets`

<Method name="getBudgets" args={[]} returns="Promise<BudgetFile[]>" />

Returns a list of all budget files either locally cached or on the remote server. Remote files have a `state` field and local files have an `id` field.

#### `loadBudget`

<Method name="loadBudget" args={[{ properties: [{ name: 'budgetId', type: 'string' }, { name: 'options', type: '{ offline?: boolean }' }] }]} returns="Promise<void>" />

Load a locally cached budget file.

For an explicit offline session, initialize the API without a server and pass `{ offline: true }`. This records local changes for later synchronization. The default behavior remains unchanged. Offline loading rejects an API instance initialized with a server.

#### `downloadBudget`

<Method name="downloadBudget" args={[{ properties: [{ name: 'syncId', type: 'string' }, { name: 'password', type: 'string?' }] }]} returns="Promise<void>" />

Load a budget file. If the file exists locally, it will load from there. Otherwise, it will download the file from the server.

#### `importBudget`

<Method name="importBudget" args={[{ name: 'input', type: 'string | ArrayBuffer | Uint8Array' }, { name: 'options', type: "{ type?: 'actual' | 'ynab4' | 'ynab5', filename?: string }?" }]} returns="Promise<{ id: string }>" />

Import a budget from an exported file and load it. `input` is either a path to the file or the raw file contents. By default the file is treated as an Actual export (a `.zip` file containing `db.sqlite` and `metadata.json`); pass `type: 'ynab4'` or `type: 'ynab5'` to import a YNAB export instead. When passing raw contents, you can supply the original file name with `filename` — some import types use it to derive the budget name. Returns the id of the imported budget, which is now the loaded budget.

#### `restoreBudget`

<Method name="restoreBudget" args={[{ name: 'input', type: 'ArrayBuffer | Uint8Array' }, { name: 'options', type: '{ name: string }' }]} returns="Promise<{ id: string }>" />

Restore an Actual archive into a new local budget and load it. Initialize the API without a server before calling this method. The name must be unique and contain 1 to 100 characters. The engine generates a new local ID, clears publication/encryption/sync metadata, and resets the synchronization clock. It never publishes the restored budget. It preserves existing budgets and removes incomplete new files on failure. If cleanup fails, the error has code `creation-cleanup-failed`; inspect the data directory before retrying.

#### `previewBudgetRestore`

`previewBudgetRestore(input, { name })` prepares a version 1 `backups.restore` proposal. Initialize without a server. Preview captures the exact archive SHA-256, byte count, source metadata ID, and destination name availability. The destination has no ID yet (`budget: null`). Preview uses the canonical archive reader and checks SQLite integrity in a separate in-memory database. It preserves the selected budget and creates no directory. This check does not prove that every migration or domain read will succeed; CLI restore also needs isolated full archive validation.

#### `applyBudgetRestore`

`applyBudgetRestore(proposal, input)` checks the archive fingerprint and destination name inside one serialized mutation. The canonical restore owner creates and loads a new local identity. A rejected proposal leaves existing budgets unchanged. A successful result includes `committed-local`, the actual destination ID in `affectedIds`, and an observed checkpoint. Archive bytes stay separate from the proposal. These API methods do not maintain durable receipts. CLI restore uses the shared receipt executor and isolated full validation. Retained acknowledged IDs return the original destination; uncertain outcomes never replay.

#### `exportBudget`

<Method name="exportBudget" args={[]} returns="Promise<Uint8Array>" />

Export the currently loaded budget as raw bytes in the zip format. You can save the bytes to a `.zip` file, or pass them back to `importBudget` to restore the budget later.

#### `batchBudgetUpdates`

<Method name="batchBudgetUpdates" args={[{ name: 'func', type: 'func' }]} returns="Promise<void>" />

Performs a batch of budget updates. This is useful for making multiple changes to the budget in a single call to the server.

#### `runQuery`

<Method name="runQuery" args={[{ properties: [{ name: 'query', type: 'ActualQL' }] }]} returns="Promise<unknown>" />

Allows running any arbitrary ActualQL query on the open budget.

#### `getIDByName`

<Method name="getIDByName" args={[{ properties: [{ name: 'type', type: 'string' }, { name: 'string', type: 'string'}] }]} returns="Promise<string>" />

get the ID for any Account, Payee, Category or Schedule by providing the corresponding name. Allowed types are 'accounts', 'schedules', 'categories', 'payees'.

#### `getServerVersion`

<Method name="getServerVersion" args={[]} returns="Promise<{error?: string;} | {version: string;}>" />

return error or the current server versions.

#### `getPreferences`

<Method name="getPreferences" args={[]} returns="Promise<SyncedPrefs>" />

Returns the budget's synced preferences — settings that sync across devices, such as the number format (`numberFormat`, `hideFraction`), currency (`defaultCurrencyCode`, `currencySymbolPosition`, `currencySpaceBetweenAmountAndSymbol`), date format (`dateFormat`), and first day of the week (`firstDayOfWeekIdx`). All values are strings (or `undefined` if the preference has never been set). The `SyncedPrefs` type is exported from `@actual-app/api/models`.

#### `setPreference`

<Method name="setPreference" args={[{ name: 'id', type: 'keyof SyncedPrefs' }, { name: 'value', type: 'string | undefined' }]} returns="Promise<void>" />

Sets a single synced preference. The `id` must be a valid SyncedPrefs key.

#### `previewBudgetAmount`

`previewBudgetAmount({ month, categoryId, amount })` returns a version 1 `budgets.set-amount` proposal. The month uses YYYY-MM and amount uses integer cents. The engine validates the category and current budget mode. The proposal records the current allocation row, before/after amount, category/group references, and recalculation side effects. Preview does not change allocations, carryover, goals, or templates.

#### `applyBudgetAmount`

`applyBudgetAmount(proposal)` compares the exact budget identity and current allocation/reference state inside the core mutation boundary. It returns `rejected` with a stable code or `committed-local` with changed status, affected category IDs, and an observed checkpoint. The existing engine amount setter owns the write. The API does not create a durable CLI receipt or synchronize remotely. The CLI changes commands provide those transport and journal behaviors.

#### `previewBudgetCreation`

`previewBudgetCreation({ name, currency? })` prepares a version 1 `budgets.create` proposal for a new local budget. Initialize the API without a server. The engine validates name availability and the optional uppercase three-letter currency code. The proposal declares `budget: null` because no destination identity exists yet. Preview preserves the loaded budget and local inventory. It does not reserve the name or create files.

#### `applyBudgetCreation`

`applyBudgetCreation(proposal)` rechecks the exact proposal and name availability in the serialized core mutation boundary. The existing lifecycle owner creates and loads a new local budget. The result is `rejected` with a stable code or `committed-local` with the actual destination ID in `affectedIds` and an observed checkpoint. Creation does not publish the budget. Reapplying the proposal fails once its name is occupied. This API acknowledgement does not itself provide durable retry. CLI creation uses the shared device-local receipt protocol and never automatically replays uncertain outcomes. If a response is lost, a matching budget name does not prove that this operation created it.

#### `previewBudgetClone`

`previewBudgetClone({ id, name })` prepares a version 1 `budgets.clone` proposal for the selected source budget. Initialize without a server. The proposal captures exact local/sync/cloud identity, source name/currency/archive state, destination name availability, and a SHA-256 fingerprint of the copied persistent state. It fingerprints persistent tables, schema, and metadata normalized through the existing clone owner. It excludes the derived cache and synchronization clock. Preview does not close the source or create a destination.

#### `applyBudgetClone`

`applyBudgetClone(proposal)` rechecks source identity, copied state, and destination name availability inside one serialized mutation. The canonical clone owner creates and loads a new local identity without publishing it. The result is `rejected` or `committed-local`, with the actual destination ID in `affectedIds` and an observed checkpoint. This public API does not maintain a durable receipt. CLI clone uses the shared receipt protocol: acknowledged retries reuse the destination, and uncertain outcomes never replay automatically.

#### `previewCategoryCreation` and `applyCategoryCreation`

`previewCategoryCreation({ name, group_id, is_income?, hidden? })` returns a read-only proposal. The flags default to false. It trims names through the canonical budget owner, rejects duplicate live names in the destination group, and captures canonical ordering changes and self mapping creation. `applyCategoryCreation(proposal)` rechecks budget identity, source and destination references within the engine mutator, invokes that same owner, and verifies actual category, mapping and sibling-order outcomes. Its committed `categoryCreation` includes `categoryId`, `mappingId` and `updatedCategoryIds`. Acknowledgements describe actual generated IDs; an uncertain operation cannot be inferred from matching names.

#### `previewCategoryUpdate` and `applyCategoryUpdate`

`previewCategoryUpdate({ id, fields })` returns a read-only proposal for category updates. Supported public fields are `name`, `group_id`, `is_income`, `hidden` and an optional matching `id`. Preview trims supplied names through the canonical owner, preserves omitted columns and captures the destination group and full source fingerprint. `applyCategoryUpdate(proposal)` rejects stale or tampered scope within the engine mutation boundary, updates through the same owner and verifies the actual raw category row. Its outcome includes changed status, checkpoint and affected ID. Existing category API behavior remains available.

#### `previewAccountClosure` and `applyAccountClosure`

`previewAccountClosure({ id, transferAccountId?, categoryId? })` returns a read-only proposal for canonical account closure. Nonzero balances require a transfer account. The proposal binds a generated source ID, closing date and row order. It evaluates counterpart notes, cleared and schedule rules with the planned source included in running balances. It records the resulting source/counterpart fields and unlink consequences. Empty accounts are deleted; already-closed accounts preserve their ledger after unlink.

`applyAccountClosure(proposal)` rechecks the exact operation, budget identity, ledger, rule/schedule and provider references within the engine mutation boundary. It rejects stale consequences and source ID collisions before writing. The committed outcome includes `accountClosure`, its actual action, account ID, generated transfer IDs and provider status. Provider status distinguishes acknowledgement, skipped removal and uncertain responses. The proposal excludes credential values. The existing `closeAccount` API retains its void result and input scope.

#### `previewAccountDeletion` and `applyAccountDeletion`

`previewAccountDeletion({ id })` returns a read-only proposal for the canonical forced closure, including complete source rows, counterpart references and consumed bank/provider consequences. Requests contain only `id`. `applyAccountDeletion(proposal)` rechecks the exact operation, budget identity and complete source/references at the engine mutation boundary. Its committed outcome includes actual account action, affected IDs, checkpoint and `accountClosure`, with actual deleted/updated transaction and deleted payee IDs. Provider unlink status distinguishes local changes, successful remote acknowledgement, skipped removal and uncertain responses. Credentials are excluded from proposals and outcomes. API callers manage retries; the CLI preserves acknowledged outcomes in receipts. Already-closed accounts preserve the existing unlink-only behavior.


#### `previewCategoryGroupUpdate` and `applyCategoryGroupUpdate`

`previewCategoryGroupUpdate({ id, fields })` returns a read-only proposal. Fields support exact `name`, boolean `is_income` and `hidden`, optional matching `id`, and nested `categories` metadata. The shared owner preserves omitted columns and children. Preview binds the full raw group, group/child references and source fingerprint. `applyCategoryGroupUpdate(proposal)` rejects stale, tampered or wrong-budget proposals inside the engine mutator. It invokes the canonical owner and verifies the actual group row before returning changed status, checkpoint and affected ID. Supplied categories do not update children.


#### `previewCategoryGroupDeletion` and `applyCategoryGroupDeletion`

`previewCategoryGroupDeletion({ id, transferCategoryId? })` returns a read-only proposal. A supplied destination must be live and outside the group. The proposal binds all children, including tombstoned children, forwarding mappings, live child allocations and the full source fingerprint. `applyCategoryGroupDeletion(proposal)` rejects wrong-budget, stale or tampered scope inside the engine mutator, invokes the shared group owner and verifies actual tombstones, mappings and allocations. Its acknowledgement includes changed status, checkpoint and affected IDs. Group deletion transfers live allocations for both income and expense groups. Source allocations and raw transaction rows remain preserved. Without a destination, mappings and allocations remain preserved.
