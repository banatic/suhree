from __future__ import annotations

# suhree release script (adapted from Hypercool).
# Bumps the version in package.json / Cargo.toml / tauri.conf.json in lockstep, builds &
# signs the MSI (TAURI_SIGNING_PRIVATE_KEY[_PASSWORD] loaded from .env), rewrites latest.json
# with the new version/notes/signature/url, creates a GitHub Release (uploads MSI + .sig via
# `gh`), then commits & pushes latest.json. Requires: python 3.10+, npm, gh (authenticated),
# git with an `origin` remote pointing at the suhree GitHub repo.
#
# Usage (easiest): edit the CONFIG block at the bottom (version + notes) and run:
#     npm run release            (== python scripts/release_method.py)
# Or CLI: set USE_CLI = True, then:
#     python scripts/release_method.py 0.1.2 --notes "릴리스 노트"

import argparse
import datetime as dt
import json
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

SEMVER_RE = re.compile(r"^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$")

# Change this if your GitHub repo is not banatic/suhree.
DEFAULT_REPO = "banatic/suhree"


@dataclass
class ReleaseConfig:
    version: str
    notes: str
    pub_date: Optional[str] = None
    skip_build: bool = False
    msi_path: Optional[Path] = None
    bundle_dir: Path = Path("src-tauri/target/release/bundle/msi")
    latest_path: Path = Path("latest.json")
    repo_download_url: Optional[str] = None
    skip_github_release: bool = False
    skip_git_push: bool = False


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Automate a suhree release.")
    parser.add_argument("version", help="Semver to apply to package.json, Cargo.toml, tauri.conf.json, latest.json")
    parser.add_argument("--notes", help="Release notes for latest.json")
    parser.add_argument("--notes-file", type=Path, help="File read into latest.json notes")
    parser.add_argument("--pub-date", help="RFC3339 timestamp (defaults to now UTC)")
    parser.add_argument("--skip-build", action="store_true", help="Skip `npm run tauri build`")
    parser.add_argument("--msi-path", type=Path, help="Explicit MSI path")
    parser.add_argument("--bundle-dir", type=Path, default=Path("src-tauri/target/release/bundle/msi"))
    parser.add_argument("--latest-path", type=Path, default=Path("latest.json"))
    parser.add_argument("--repo-download-url", help="Override base download URL, e.g. https://github.com/banatic/suhree/releases/download")
    parser.add_argument("--skip-github-release", action="store_true")
    parser.add_argument("--skip-git-push", action="store_true")
    return parser.parse_args()


def config_from_args(args: argparse.Namespace) -> ReleaseConfig:
    notes = read_notes(args.notes, args.notes_file)
    return ReleaseConfig(
        version=args.version,
        notes=notes,
        pub_date=args.pub_date,
        skip_build=args.skip_build,
        msi_path=args.msi_path,
        bundle_dir=args.bundle_dir,
        latest_path=args.latest_path,
        repo_download_url=args.repo_download_url,
        skip_github_release=args.skip_github_release,
        skip_git_push=args.skip_git_push,
    )


def ensure_semver(value: str) -> str:
    if not SEMVER_RE.match(value):
        raise SystemExit(f"[error] Invalid version '{value}'. Expected SemVer such as 0.1.2")
    return value


def read_notes(arg_value: Optional[str], path: Optional[Path]) -> str:
    if arg_value and path:
        raise SystemExit("[error] Use either --notes or --notes-file, not both.")
    if path:
        if not path.exists():
            raise SystemExit(f"[error] Notes file not found: {path}")
        return path.read_text(encoding="utf-8").strip()
    if arg_value:
        return arg_value.strip()
    raise SystemExit("[error] Provide release notes via --notes or --notes-file.")


def normalize_rfc3339(value: Optional[str]) -> str:
    if value:
        candidate = value.strip()
        try:
            parsed = dt.datetime.fromisoformat(candidate.replace("Z", "+00:00"))
        except ValueError as exc:
            raise SystemExit(f"[error] Invalid --pub-date '{value}': {exc}") from exc
        normalized = parsed.astimezone(dt.timezone.utc)
    else:
        normalized = dt.datetime.now(dt.timezone.utc)
    iso = normalized.isoformat(timespec="milliseconds")
    if iso.endswith("+00:00"):
        iso = iso[:-6] + "Z"
    return iso


def update_package_json(path: Path, new_version: str) -> str:
    data = json.loads(path.read_text(encoding="utf-8"))
    old_version = data.get("version")
    data["version"] = new_version
    write_json(path, data, indent=2)
    return old_version


def update_tauri_conf(path: Path, new_version: str) -> str:
    data = json.loads(path.read_text(encoding="utf-8"))
    old_version = data.get("version")
    data["version"] = new_version
    write_json(path, data, indent=2)
    return old_version


def write_json(path: Path, data: dict, indent: int) -> None:
    text = json.dumps(data, ensure_ascii=False, indent=indent)
    path.write_text(text + "\n", encoding="utf-8")


def update_cargo_toml(path: Path, new_version: str) -> str:
    content = path.read_text(encoding="utf-8")
    pattern = re.compile(r'^(version\s*=\s*)"([^"]+)"', re.MULTILINE)
    match = pattern.search(content)
    if not match:
        raise SystemExit("[error] Could not locate the package version entry inside Cargo.toml")
    old_version = match.group(2)
    new_content = pattern.sub(rf'\1"{new_version}"', content, count=1)
    path.write_text(new_content, encoding="utf-8")
    return old_version


def run_build(root: Path) -> None:
    import os

    env_file = root / ".env"
    if env_file.exists():
        content = env_file.read_text(encoding="utf-8-sig")
        for match in re.finditer(r'^([A-Za-z0-9_]+)=(?:"([^"]*)"|([^\n]*))', content, re.MULTILINE):
            key = match.group(1)
            val = match.group(2) if match.group(2) is not None else match.group(3)
            val = val.replace("\\n", "\n")
            os.environ[key] = val
            print(f"[info] Loaded environment variable from .env: {key}")

    npm_exec = shutil.which("npm") or shutil.which("npm.cmd") or shutil.which("npm.exe")
    if not npm_exec:
        raise SystemExit("[error] Could not find `npm` on PATH.")

    print("[info] Running `npm run tauri build` ...")
    subprocess.run([npm_exec, "run", "tauri", "build"], cwd=root, check=True)


def resolve_msi_path(root: Path, desired_version: str, explicit: Optional[Path], bundle_dir: Path) -> Path:
    if explicit:
        candidate = explicit if explicit.is_absolute() else (root / explicit)
        if not candidate.exists():
            raise SystemExit(f"[error] Provided MSI path does not exist: {candidate}")
        return candidate
    search_dir = bundle_dir if bundle_dir.is_absolute() else (root / bundle_dir)
    if not search_dir.exists():
        raise SystemExit(f"[error] Bundle directory not found: {search_dir}")
    matches = sorted(search_dir.glob(f"*{desired_version}*.msi"))
    if not matches:
        raise SystemExit(f"[error] No MSI containing '{desired_version}' in {search_dir}")
    if len(matches) > 1:
        print("[warn] Multiple MSI files matched; using the first one.")
    return matches[0]


def read_signature(msi_path: Path) -> str:
    sig_path = msi_path.parent / f"{msi_path.name}.sig"
    if not sig_path.exists():
        raise SystemExit(f"[error] Missing signature file: {sig_path}")
    return sig_path.read_text(encoding="utf-8").strip()


def update_latest_json(path, version, notes, pub_date, signature, artifact_name, repo_download_url) -> None:
    data = json.loads(path.read_text(encoding="utf-8"))
    previous_version = data.get("version")
    data["version"] = version
    data["notes"] = notes
    data["pub_date"] = pub_date
    platforms = data.setdefault("platforms", {})
    win = platforms.setdefault("windows-x86_64", {})
    win["signature"] = signature
    win["url"] = build_download_url(
        current_url=win.get("url", ""),
        previous_version=previous_version,
        version=version,
        artifact_name=artifact_name,
        repo_download_url=repo_download_url,
    )
    write_json(path, data, indent=4)


def build_download_url(current_url, previous_version, version, artifact_name, repo_download_url) -> str:
    tag_version = f"v{version}"
    if repo_download_url:
        base = repo_download_url.rstrip("/")
        return f"{base}/{tag_version}/{artifact_name}"
    if current_url and "github.com" in current_url and "/releases/download/" in current_url:
        parts = current_url.split("/releases/download/")
        if len(parts) == 2:
            base_url = parts[0] + "/releases/download"
            return f"{base_url}/{tag_version}/{artifact_name}"
    return f"https://github.com/{DEFAULT_REPO}/releases/download/{tag_version}/{artifact_name}"


def check_gh_cli() -> bool:
    gh_exec = shutil.which("gh") or shutil.which("gh.exe")
    if not gh_exec:
        return False
    try:
        subprocess.run([gh_exec, "auth", "status"], capture_output=True, check=True)
        return True
    except subprocess.CalledProcessError:
        return False


def create_github_release(root, version, notes, msi_path, sig_path=None) -> None:
    gh_exec = shutil.which("gh") or shutil.which("gh.exe")
    if not gh_exec:
        raise SystemExit("[error] GitHub CLI (gh) not found. Install from https://cli.github.com/")
    if not check_gh_cli():
        raise SystemExit("[error] GitHub CLI not authenticated. Run `gh auth login` first.")
    tag = f"v{version}"
    title = f"Release {tag}"
    print(f"[info] Creating GitHub release {tag}...")
    files_to_upload = [str(msi_path)]
    if sig_path and sig_path.exists():
        files_to_upload.append(str(sig_path))
    cmd = [gh_exec, "release", "create", tag, "--title", title, "--notes", notes] + files_to_upload
    try:
        subprocess.run(cmd, cwd=root, check=True)
        print(f"[info] GitHub release {tag} created.")
    except subprocess.CalledProcessError as exc:
        raise SystemExit(f"[error] Failed to create GitHub release: {exc}")


def git_add_commit_push(root, version, latest_path) -> None:
    git_exec = shutil.which("git") or shutil.which("git.exe")
    if not git_exec:
        raise SystemExit("[error] Git not found on PATH.")
    try:
        status_result = subprocess.run(
            [git_exec, "status", "--porcelain", str(latest_path)],
            cwd=root, capture_output=True, text=True, check=True,
        )
        if not status_result.stdout.strip():
            print("[info] No changes to latest.json, skipping git operations.")
            return
    except subprocess.CalledProcessError as exc:
        raise SystemExit(f"[error] Failed to check git status: {exc}")
    print("[info] Staging + committing + pushing latest.json...")
    try:
        subprocess.run([git_exec, "add", str(latest_path)], cwd=root, check=True)
        subprocess.run([git_exec, "commit", "-m", f"Update latest.json for version {version}"], cwd=root, check=True)
        subprocess.run([git_exec, "push"], cwd=root, check=True)
        print("[info] Pushed latest.json to remote.")
    except subprocess.CalledProcessError as exc:
        raise SystemExit(f"[error] git push failed: {exc}")


def run_release(config: ReleaseConfig) -> int:
    root = Path(__file__).resolve().parents[1]
    version = ensure_semver(config.version)
    notes = config.notes.strip()
    if not notes:
        raise SystemExit("[error] Release notes must not be empty.")
    pub_date = normalize_rfc3339(config.pub_date)

    package_path = root / "package.json"
    cargo_path = root / "src-tauri" / "Cargo.toml"
    tauri_conf_path = root / "src-tauri" / "tauri.conf.json"
    latest_path = config.latest_path if config.latest_path.is_absolute() else root / config.latest_path

    print("[info] Bumping package.json, Cargo.toml, tauri.conf.json ...")
    old_pkg = update_package_json(package_path, version)
    old_cargo = update_cargo_toml(cargo_path, version)
    old_tauri = update_tauri_conf(tauri_conf_path, version)
    print(f"[info] Versions bumped from {old_pkg}/{old_cargo}/{old_tauri} to {version}")

    if not config.skip_build:
        run_build(root)
    else:
        print("[info] Skipping build step as requested.")

    msi_path = resolve_msi_path(root, version, config.msi_path, config.bundle_dir)
    signature = read_signature(msi_path)
    update_latest_json(
        latest_path, version=version, notes=notes, pub_date=pub_date,
        signature=signature, artifact_name=msi_path.name, repo_download_url=config.repo_download_url,
    )

    if not config.skip_github_release:
        sig_path = msi_path.parent / f"{msi_path.name}.sig"
        create_github_release(root=root, version=version, notes=notes, msi_path=msi_path,
                              sig_path=sig_path if sig_path.exists() else None)
    else:
        print("[info] Skipping GitHub release creation as requested.")

    if not config.skip_git_push:
        git_add_commit_push(root=root, version=version, latest_path=latest_path)
    else:
        print("[info] Skipping git push as requested.")

    print("\nAll done ✅")
    print(f"- MSI: {msi_path}")
    return 0


def main() -> int:
    return run_release(config_from_args(parse_args()))


if __name__ == "__main__":
    if sys.version_info < (3, 10):
        raise SystemExit("[error] Python 3.10 or newer is required.")

    # CLI 예시: python scripts/release_method.py 0.1.2 --notes "릴리스 노트"
    USE_CLI = False

    if USE_CLI:
        raise SystemExit(main())

    # ▼▼▼ 릴리스할 때 여기 version / notes 만 바꾸고 `npm run release` ▼▼▼
    CONFIG = ReleaseConfig(
        version="0.1.2",
        notes="친구 양방향 추가 · 강제 자동 업데이트(1분 주기) · 쿨다운 표시/계산 안정화",
        pub_date=None,  # None이면 현재 UTC 시간 사용
        skip_build=False,
        msi_path=None,
        bundle_dir=Path("src-tauri/target/release/bundle/msi"),
        latest_path=Path("latest.json"),
        repo_download_url=None,
        skip_github_release=False,
        skip_git_push=False,
    )

    raise SystemExit(run_release(CONFIG))
