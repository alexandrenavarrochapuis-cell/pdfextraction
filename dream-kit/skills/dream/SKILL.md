---
name: dream
description: Memory consolidation. Scans recent session transcripts and merges findings into persistent memory files. Use when the user says "dream", "/dream", "dream dry run", "consolidate memory", or when a ~/.claude/.dream-pending flag exists at session start.
---

# Dream — memory consolidation

Consolidate what recent sessions learned into durable memory files, then keep
the index small enough to stay useful.

## Hard boundaries

These are not suggestions. A run that violates one is a failed run.

- **Read** session transcripts. **Read and write** the memory directory. Nothing else.
- **Never** edit project source, config, or tests.
- **Never** run `git` — no status, no add, no commit, no push.
- **Never** delete an entry without replacing it or archiving it first.
- **Never** write a secret. See the redaction gate in phase 2.

## Paths

- Memory directory: `<project>/memory/` under `~/.claude/projects/<project-slug>/`
  (create it if absent).
- Index: `<memory-dir>/MEMORY.md`
- Topic files: `preferences.md`, `decisions.md`, `corrections.md`, `patterns.md`, `facts.md`
- Archive: `<memory-dir>/archive/YYYY-QN.md`
- Timestamp: `<memory-dir>/.last-dream`
- Transcripts: `~/.claude/projects/*/sessions/*.jsonl` — and, on installs that
  write transcripts flat, `~/.claude/projects/*/*.jsonl`. Glob both.

On Windows the same tree lives at `%USERPROFILE%\.claude\`. Prefer the Glob and
Grep tools over shell commands for discovery — they behave the same on every
platform, and the shell snippets below are illustrative, not required.

## First run against a project

Before the first consolidation in a given project:

1. Copy the memory directory to `<memory-dir>.bak-YYYY-MM-DD`.
2. Run the four phases in **dry-run** mode — compute everything, print the
   proposed diff, write nothing.
3. Stop and wait for the user's approval. Do not write until they approve.

A dry run is also requested explicitly ("dream dry run"). Same rule: print the
diff, write nothing, stop.

---

## Phase 1 — ORIENT

Read the memory directory and `MEMORY.md`. Write nothing in this phase.

Note and hold in working memory:

- `MEMORY.md` line count.
- Which topic files exist and roughly what each covers.
- Entries that look stale (old date, no recent reference).
- Entries that contradict each other.

## Phase 2 — GATHER SIGNAL

Find transcripts modified in the last 7 days. Glob `**/*.jsonl` under the
projects directory and keep the ones whose mtime falls inside the window, or:

```bash
find ~/.claude/projects -name '*.jsonl' -mtime -7 2>/dev/null
```

```powershell
Get-ChildItem "$env:USERPROFILE\.claude\projects" -Filter *.jsonl -Recurse -File |
  Where-Object { $_.LastWriteTime -gt (Get-Date).AddDays(-7) }
```

(Narrow the window if the user asked for one — "last 3 days only" is `-3`.)

**Use targeted `grep` against these files. Never read a transcript in full.**
Transcripts are large; a full read burns the context this skill exists to protect.

Grep for four signal classes:

| Class | What to look for |
| --- | --- |
| Corrections | "no,", "actually", "that's wrong", "not what I", "I said" |
| Preferences | "I prefer", "always", "never", "from now on", "going forward" |
| Decisions | "let's go with", "we decided", "use X instead", "final answer" |
| Patterns | the same question, file, or failure recurring across sessions |

For each finding, record:

- the fact, stated as one self-contained sentence;
- the date, taken from the transcript file's mtime;
- confidence: high / medium / low;
- any contradiction with an entry already in memory.

### Redaction gate (mandatory)

Before a finding leaves this phase, drop it if it contains any of:

- credentials, API keys, tokens, passwords;
- connection strings or internal hostnames;
- client or constituent PII;
- non-public contract figures or commercial terms;
- personal details about third parties.

**Keep the working fact, drop the secret.** "Uses Postgres for the jobs table"
survives; the connection string does not. Count what you dropped — the summary
reports it.

If a finding cannot be separated from its secret, drop the whole finding.

## Phase 3 — CONSOLIDATE

Rules, in order of precedence:

1. **Never duplicate.** If the fact is already in memory, skip it — or update
   the existing line in place.
2. **All dates absolute.** "yesterday", "last week", "recently" must not survive
   into a memory file. Convert against the transcript mtime.
3. **Contradictions replace, with a trail.** When a new fact contradicts an old
   one, rewrite the old line and append
   `(updated YYYY-MM-DD, previously: X)`.
4. **Preserve provenance.** Keep `(source: session YYYY-MM-DD)` on every entry.
5. **Sort by kind** into `preferences.md`, `decisions.md`, `corrections.md`,
   `patterns.md`, `facts.md`.

Entry format — one line, no wrapping:

```
- [YYYY-MM-DD] The fact. (source: session, confidence: high)
```

## Phase 4 — PRUNE AND INDEX

- Keep `MEMORY.md` **under 200 lines**. It is a pure index: a list of the topic
  files with a one-line description of each, plus a **Quick Reference** section
  of at most **10** always-relevant facts. No narrative, no duplicated entries.
- Archive entries older than **90 days** with no recent reference — move them to
  `archive/YYYY-QN.md`, do not delete them.
- Stamp and clear the flag:

```bash
date +%s > "<memory-dir>/.last-dream"
rm -f ~/.claude/.dream-pending
```

```powershell
# NOT Get-Date -UFormat %s: on Windows PowerShell 5.1 that builds the epoch from
# LOCAL time, so the stamp lands off by your UTC offset (early west of UTC, late
# east of it) and the 24h gate in should-dream misfires by the same amount.
[DateTimeOffset]::UtcNow.ToUnixTimeSeconds() | Set-Content "<memory-dir>\.last-dream"
Remove-Item "$env:USERPROFILE\.claude\.dream-pending" -Force -ErrorAction SilentlyContinue
```

---

## Summary block (required)

End every run — including dry runs — with exactly this block, filled in:

```
DREAM SUMMARY
  sessions scanned:        N
  entries added:           N
  entries updated:         N
  entries archived:        N
  contradictions resolved: N
  findings redacted:       N
  MEMORY.md lines:         N / 200
  notable:                 <one line>
```

Report only this block. Do not narrate the phases.
