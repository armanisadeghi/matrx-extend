# The app's place in git, for the release path (release.sh, ship.sh, the release workflows).
# matrx-extend is either its own repository (standalone) or the folder apps/matrx-extend of the aidream
# monorepo (nested). Every release script asks this file, never `--show-toplevel` or root-anchored
# paths directly, so both layouts release exactly the app (the pattern of matrx-desktop's app-git.sh):
#
#   app_git_layout <app dir>  sets APP_DIR (the app folder, physical), GIT_TOP (the repository toplevel),
#                             APP_PREFIX ("" standalone, "apps/matrx-extend/" nested), TAG_PREFIX
#                             ("" standalone: tags v0.2.N; "matrx-extend/" nested: aidream's own tags
#                             are plain v*, so Extend's are matrx-extend/v0.2.N), AIDREAM_DIR (the aidream
#                             checkout the gates read: $AIDREAM_ROOT, else GIT_TOP nested, else ../aidream)
#                             and EXTEND_GITHUB_REPO (the GitHub repository the app's commits live in).
#   app_is_nested             0 when nested
#   app_tree <treeish>        the tree id of the app in <treeish> (the whole tree standalone)
#
# CLI (workflows, tests, the move rehearsal):
#   bash scripts/app-git.sh {layout|tag-prefix|prefix|aidream-dir|github-repo|tree <treeish>}

app_git_layout() { # app_git_layout <app dir>
  APP_DIR="$(cd "$1" && pwd -P)" || return 1
  GIT_TOP="$(git -C "$APP_DIR" rev-parse --show-toplevel)" || return 1
  GIT_TOP="$(cd "$GIT_TOP" && pwd -P)" || return 1
  APP_PREFIX="$(git -C "$APP_DIR" rev-parse --show-prefix)" || return 1
  if [[ -z "$APP_PREFIX" ]]; then
    TAG_PREFIX=""
    AIDREAM_DIR="${AIDREAM_ROOT:-$APP_DIR/../aidream}"
    EXTEND_GITHUB_REPO="${MATRX_EXTEND_GITHUB_REPO:-armanisadeghi/matrx-extend}"
  else
    TAG_PREFIX="matrx-extend/"
    AIDREAM_DIR="${AIDREAM_ROOT:-$GIT_TOP}"
    EXTEND_GITHUB_REPO="${MATRX_EXTEND_GITHUB_REPO:-AI-Matrix-Engine/aidream}"
  fi
  [[ -d "$AIDREAM_DIR" ]] && AIDREAM_DIR="$(cd "$AIDREAM_DIR" && pwd -P)"
  return 0
}

app_is_nested() { [[ -n "${APP_PREFIX:-}" ]]; }

app_tree() { # app_tree <treeish>
  if [[ -z "$APP_PREFIX" ]]; then
    git -C "$GIT_TOP" rev-parse --verify "$1^{tree}"
  else
    git -C "$GIT_TOP" rev-parse --verify "$1:${APP_PREFIX%/}"
  fi
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  set -euo pipefail
  app_git_layout "$(dirname "$0")/.."
  case "${1:-}" in
    layout) printf 'APP_DIR=%s\nGIT_TOP=%s\nAPP_PREFIX=%s\nTAG_PREFIX=%s\nAIDREAM_DIR=%s\nEXTEND_GITHUB_REPO=%s\n' \
      "$APP_DIR" "$GIT_TOP" "$APP_PREFIX" "$TAG_PREFIX" "$AIDREAM_DIR" "$EXTEND_GITHUB_REPO" ;;
    tag-prefix) printf '%s\n' "$TAG_PREFIX" ;;
    prefix) printf '%s\n' "$APP_PREFIX" ;;
    aidream-dir) printf '%s\n' "$AIDREAM_DIR" ;;
    github-repo) printf '%s\n' "$EXTEND_GITHUB_REPO" ;;
    tree) app_tree "${2:?tree <treeish>}" ;;
    *) echo "usage: bash scripts/app-git.sh {layout|tag-prefix|prefix|aidream-dir|github-repo|tree <treeish>}" >&2; exit 2 ;;
  esac
fi
