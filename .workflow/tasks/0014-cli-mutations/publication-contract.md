# Guarded publication: contract and authority map

Status: guarded publication verified locally on Windows. The cadence-corrected full publication profile passes all eleven checks and all 61 packaged cases, including all eight publication interruption cases. Evidence: verification-publication-cadence-final-2026-10-03.json and verification-publication-integration-full.txt. Task 0014 remains partial; remaining adapters and roadmap acceptance are pending.
Basis: task 0014 plan, preserved lifecycle publication recovery, and current owner inspection on 2026-10-03.

## Required behavior

- Preview binds the explicit local source ID, source fingerprint, exact server, and encrypted/plaintext mode. It creates no publication identity or remote file.
- Prepared apply rejects changed source/server/mode before local identity preparation. The engine also checks the source inside the serialized export that creates the uploaded payload.
- The existing publication owner retains its cloud identity and encryption key preparation. Guarded intent records a proposal fingerprint with that identity. Credentials stay outside proposals and receipts.
- Acknowledged IDs reuse their outcome despite the source acquiring cloud/sync IDs. Request collisions still reject. Publication returns actual remote identity and verified synchronization state.
- An uncertain publication can recover only after authenticated remote inspection proves acceptance of its retained identity and encryption mode. An absent or mismatched remote file remains uncertain. Recovery never submits an initial upload.
- Original legacy publication retains its existing behavior. Version 2 publication requires an operation ID and uses the shared journal.

## Authority and boundaries

Current source owners:

- server/api.ts api/publish-budget owns mode/server validation, persistent local publication identity, remote inspection, encryption, upload, and synchronization.
- server/cloud-storage.ts exportBuffer acquires runMutator and creates the upload snapshot. upload invokes exportBuffer and owns the upload request.
- server/encryption/app.ts key-prepare-publication retains key ID/salt/test and validates reused credentials.
- server/sync/index.ts applies inbound messages through runMutator.
- CLI guarded-changes.ts/change-journal.ts own durable intent and acknowledged receipts. CLI connection/cache/lifecycle locks protect local process sequencing through shutdown.

Do not put the entire publication workflow in runMutator: export and inbound sync acquire it themselves. Validate and prepare local identity in one short serialized boundary. Pass the source guard into the existing serialized export, without introducing another export/upload path. Keep network upload and sync outside that boundary.

A source edit after local intent but before export can reject the upload while leaving local publication metadata. This is partial/uncertain, not failed-before-commit. Preserve the identity for inspection. Do not infer remote acceptance from a matching budget name or ledger values.

Publication identity changes require explicit handling in shared preview/apply retries. Stable local ID, original request, exact server/mode, and persisted guarded intent must match. Do not relax identity checks for other operations.

Server URLs containing user information or query credentials must not enter receipts. Validate the guarded server locator before intent and emit a generic error without echoing secrets. Keep exact canonical server path/mode matching.

## Acceptance and evidence to obtain

| Scenario                              | Required proof                                                                                                                                |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Plaintext and encrypted preview       | Source domain snapshot, publication metadata and independent remote inventory are preserved; no credentials appear in receipt/output.         |
| Stale source / wrong server / mode    | Rejection precedes identity preparation/upload; independent remote inventory stays unchanged.                                                 |
| Edit between preparation and snapshot | Export guard rejects changed source before upload; local intent is disclosed as uncertain.                                                    |
| Initial publication                   | Exactly one remote identity, encrypted bytes when requested, canonical source contents, actual sync ID, and retained receipt.                 |
| Retried acknowledged ID               | Same outcome/checkpoint/remote identity; no upload; changed request/server/mode rejects.                                                      |
| Lost upload response                  | Remote acceptance is independently observed; recovery uses retained identity and verifies encryption without another initial upload.          |
| Uncertain remote absence              | Original receipt stays uncertain; no initial upload occurs; repeated IDs do not create another file.                                          |
| Exact interruption boundaries         | Observe before-engine, after-remote-acceptance and before durable acknowledgement; restart preserves explicit uncertainty or acknowledgement. |
| Legacy and shared regression          | Existing encrypted first-publication/lifecycle proofs plus API/CLI/types/build/browser/integration/lint/format checks remain valid.           |

Only disposable local servers and synthetic budgets are authorized verification inputs. Full task 0014 remains partial after this slice until remaining version 2 mutation adapters pass.

## API checkpoint evidence

The canonical publication owner now serves legacy, guarded apply, and recovery. An internal export callback checks the source inside the existing snapshot mutator. Saved publication metadata binds the proposal fingerprint to the retained cloud identity. Recovery rejects an absent remote file without uploading.

`verification-publication-api-final.txt` passes all eleven packaged cases: eight new guarded cases plus three existing lifecycle cases. Both encryption modes cover preview preservation, stale source/server rejection, successful publication and independent download, lost upload response, repeated recovery with remote absence, and a source edit after identity preparation but before export. The proxy counts upload requests. Recovery sends no second upload; a stale export sends none.

`verification-publication-guards-red.txt` fails all four remote-absence/source-race cases when the corresponding owner guards are removed. The guards are restored, rebuilt, and all eleven cases pass. No perturbation remains. Earlier root types and all 59 API tests pass; normal CLI/API/server builds, browser build, targeted lint and diff checks pass. This checkpoint does not establish CLI receipts, exact publication kills, unsafe URL acceptance, or the full task's completion.

The CLI checkpoint adds two packaged receipt cases to the eight API cases and three lifecycle cases. All thirteen pass in verification-publication-cli-final-current.txt. D21 records authenticated ownership attachment moving from unpublished load to successful publication. Both receipt cases retain strict source metadata preservation. Lost-response lifecycle recovery uses the same receipt ID. Retention preserves missing acknowledgements and uncertainty; all 233 CLI units pass. Exact kills, dedicated CLI remote absence and unsafe URL proof remain required.
