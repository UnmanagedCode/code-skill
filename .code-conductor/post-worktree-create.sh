#!/usr/bin/env bash
# Project wiki (out-of-tree): exclude it, then link the main checkout's copy.
# --git-path finds the exclude file every worktree shares; '/.wiki' has no
# trailing slash so it also matches the symlink.
(
    cd "${CC_WORKTREE_PATH:?CC_WORKTREE_PATH is unset}" || exit 1
    WIKI_EXCLUDE="$(git rev-parse --git-path info/exclude)"
    if ! grep -qxF '/.wiki' "$WIKI_EXCLUDE" 2>/dev/null; then
        mkdir -p "$(dirname "$WIKI_EXCLUDE")"
        if [ -s "$WIKI_EXCLUDE" ] && [ -n "$(tail -c1 "$WIKI_EXCLUDE")" ]; then echo >> "$WIKI_EXCLUDE"; fi
        echo '/.wiki' >> "$WIKI_EXCLUDE"
    fi
    WIKI_PARENT="${CC_PARENT_PATH:?CC_PARENT_PATH is unset}/.wiki"
    if [ ! -e .wiki ] && [ ! -L .wiki ]; then
        if [ -d "$WIKI_PARENT" ]; then
            ln -s "$WIKI_PARENT" .wiki
        else
            echo "[post-worktree-create] WARNING: ${WIKI_PARENT} not found; no .wiki symlink." >&2
        fi
    fi
)
